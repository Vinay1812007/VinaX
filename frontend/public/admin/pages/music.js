/* VinaX console — Music page.
 * What listeners play and look for. Top charts (/api/admin/music, plus the
 * hour-of-day and rising-songs panels from /api/admin/insights), Search
 * (/api/admin/search-analytics: top and zero-result queries), Skips
 * (/api/admin/skips — the skip rate is computed here from the raw skip and
 * play counts, never from the server's rounded integer) and a Song drilldown
 * (/api/admin/songstats). Blocking a song from Skips or the drilldown posts to
 * /api/admin/content. */
(function () {
  'use strict';
  var VX = window.VX, h = VX.h, ui = VX.ui, fmt = VX.fmt;

  VX.page({
    id: 'music', title: 'Music', group: 'Music', icon: 'music',
    desc: 'What listeners play, search for and skip.',
    tabs: [
      { id: 'top', label: 'Top charts', desc: 'The most played songs, artists and languages.', render: renderTop },
      { id: 'search', label: 'Search', desc: 'What listeners type into search, and which searches find nothing.', render: renderSearch },
      { id: 'skips', label: 'Skips', desc: 'Songs listeners skip most often, among songs with enough plays to judge.', render: renderSkips },
      { id: 'song', label: 'Song drilldown', desc: 'Every number for one song: plays, skips, listeners, countries and devices.', render: renderSong }
    ]
  });

  var NOT_CONNECTED = 'The database is not connected. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the Worker.';

  function daysParam(ctx, def, allowed) {
    var d = Number(ctx.params.days) || def;
    if (allowed && allowed.indexOf(d) < 0) d = def;
    return d;
  }
  function windowLabel(days) { return days === 1 ? 'the last 24 hours' : 'the last ' + days + ' days'; }
  function sum(list, key) { return (list || []).reduce(function (a, r) { return a + (Number(r && r[key]) || 0); }, 0); }
  /** skips ÷ plays as a 0..1 ratio, or null when there are no plays to judge. */
  function skipRatio(skips, plays) {
    var p = Number(plays) || 0, s = Number(skips) || 0;
    if (p <= 0) return null;
    return Math.min(1, s / p);
  }

  function blockSong(id, title, reason) {
    return VX.confirm({
      title: 'Block this song?',
      body: '“' + (title || id) + '” will disappear from search, charts and recommendations for every listener. You can unblock it later in Catalog → Blocked content.',
      confirmLabel: 'Block song', danger: true
    }).then(function (yes) {
      if (!yes) return null;
      return VX.api.post('/api/admin/content', { action: 'block', kind: 'song', songId: String(id), songTitle: title || '', reason: reason || '' }).then(function (res) {
        if (res.ok) VX.toast('Blocked “' + (title || id) + '”', 'ok');
        else VX.toast('Could not block: ' + res.message, 'bad');
        return res;
      });
    });
  }

  /* ------------------------------------------------------------ top */

  function renderTop(host, ctx) {
    var days = daysParam(ctx, 7, [1, 7, 30, 90]);
    var body = h('div.page-body');
    var extra = h('div');
    host.appendChild(h('div.toolbar', ui.daysPicker(days, function (d) { ctx.setParam('days', d); ctx.refresh(); })));
    host.appendChild(body);
    host.appendChild(extra);

    var main = ui.load(body, function () { return VX.api.get('/api/admin/music', { days: days }); }, function (d) {
      if (d.configured === false) return ui.notice(NOT_CONNECTED, 'warn');
      var songs = d.topSongs || [], artists = d.topArtists || [], langs = d.topLanguages || [];
      var chartDays = Math.min(Math.max(days, 7), 30);
      var daily = VX.fillDays(d.playsByDay, chartDays, 'day', ['plays']);
      var windowPlays = sum((d.playsByDay || []).slice(-Math.min(days, 30)), 'plays');
      var songPlays = sum(songs, 'plays');
      var busiest = (d.playsByDay || []).reduce(function (best, r) { return !best || Number(r.plays) > Number(best.plays) ? r : best; }, null);
      var known = langs.filter(function (l) { return l.language && l.language !== 'unknown'; });
      var empty = !songs.length && !windowPlays;

      return [
        empty ? ui.notice('No plays in ' + windowLabel(days) + ' yet. These charts fill in as listeners play songs — nothing needs to be imported.', 'info') : null,
        ui.kpis([
          { label: 'Plays', value: fmt.num(windowPlays), sub: days > 30 ? 'last 30 days (daily data stops at 30)' : windowLabel(days), spark: daily.values.plays },
          { label: 'Plays per day', value: windowPlays ? fmt.num(Math.round(windowPlays / Math.min(days, 30))) : '—', sub: 'average' },
          { label: 'Busiest day', value: busiest ? fmt.day(busiest.day) : '—', sub: busiest ? fmt.plural(busiest.plays, 'play') : 'no plays yet' },
          { label: 'Top language', value: known[0] ? cap(known[0].language) : '—', sub: known[0] ? fmt.plural(known[0].plays, 'play') : null },
          { label: 'Top 25 share', value: windowPlays && songPlays ? fmt.ratio(Math.min(1, songPlays / windowPlays)) : '—', sub: 'of plays go to the 25 biggest songs', hint: 'How concentrated listening is. High = a few hits dominate.' }
        ]),
        ui.grid([
          ui.card({ title: 'Plays per day', sub: 'Last ' + chartDays + ' days (UTC)', span: 2,
            body: ui.chart({ labels: daily.labels, series: [{ name: 'Plays', values: daily.values.plays }], type: 'area', height: 220, empty: 'No plays yet', emptyHint: 'Fills in as listeners play songs.' }) }),
          ui.card({ title: 'Top artists', sub: 'Plays in ' + windowLabel(days),
            body: ui.hbars(artists.map(function (r) { return { label: r.song_artist || 'Unknown artist', value: r.plays }; }), { limit: 10, empty: 'No artists yet', emptyHint: 'Artists appear once their songs are played.' }) }),
          ui.card({ title: 'Top songs', sub: 'Most played in ' + windowLabel(days) + ' · click a song for its drilldown', span: 2, pad: false,
            body: ui.table({
              columns: [
                { key: 'rank', label: '#', align: 'right', width: '44px', render: function (r) { return String(r.rank); } },
                { key: 'song_title', label: 'Song', render: function (r) { return ui.media(r.song_image, r.song_title || 'Untitled', r.song_artist); } },
                { key: 'song_artist', label: 'Artist', hide: true },
                { key: 'plays', label: 'Plays', align: 'right', render: function (r) { return fmt.num(r.plays); } },
                { key: 'share', label: 'Share of plays', align: 'right', sortVal: function (r) { return r.share; }, render: function (r) { return r.share == null ? '—' : fmt.ratio(r.share); } }
              ],
              rows: songs.map(function (r, i) { return Object.assign({}, r, { rank: i + 1, share: windowPlays ? Number(r.plays) / windowPlays : null }); }),
              exportName: 'vinax-top-songs-' + days + 'd', pageSize: 10,
              empty: 'No plays yet', emptyHint: 'Songs appear here once listeners play them.',
              onRow: function (r) { ctx.go('music', 'song', { q: r.song_title || '', days: Math.max(days, 7) }); }
            }) }),
          ui.card({ title: 'Languages', sub: 'Share of plays',
            body: ui.share(langs.map(function (r) { return { label: r.language === 'unknown' || !r.language ? 'Unknown' : cap(r.language), value: r.plays }; }), { empty: 'No plays yet' }) })
        ])
      ];
    }, { skeleton: 6 });

    // Hour-of-day and rising songs come from a second endpoint; it fails on its own.
    // Started only once the main charts loaded, so a database outage shows one error, not two.
    main.then(function (ok) { if (ok && !(ok.data && ok.data.configured === false)) loadExtra(); });
    function loadExtra() { return ui.load(extra, function () { return VX.api.get('/api/admin/insights', { days: days }); }, function (d) {
      if (d.configured === false) return null;
      var hours = [];
      var byHour = {};
      (d.playsByHour || []).forEach(function (r) { byHour[Number(r.hour)] = Number(r.plays) || 0; });
      for (var i = 0; i < 24; i++) hours.push(byHour[i] || 0);
      var peak = hours.indexOf(Math.max.apply(null, hours));
      var rising = (d.trending || []).map(function (r) {
        var prev = Number(r.prev_plays) || 0, now = Number(r.plays) || 0;
        return Object.assign({}, r, { change: now - prev, prev: prev });
      });
      return ui.grid([
        ui.card({ title: 'When people listen', sub: 'Plays by hour of day (UTC — add 5½ h for India time)' + (hours.some(Boolean) ? ' · busiest ' + pad2(peak) + ':00 UTC' : ''),
          body: ui.chart({ labels: hours.map(function (_, i) { return pad2(i) + ':00'; }), series: [{ name: 'Plays', values: hours }], type: 'bar', height: 200, empty: 'No plays yet', emptyHint: 'The busiest hours show once listeners play songs.' }) }),
        ui.card({ title: 'Rising songs', sub: 'Plays in ' + windowLabel(days) + ' vs the window before', pad: false,
          body: ui.table({
            columns: [
              { key: 'song_title', label: 'Song', render: function (r) { return ui.media(r.song_image, r.song_title || 'Untitled', r.song_artist); } },
              { key: 'plays', label: 'Now', align: 'right', render: function (r) { return fmt.num(r.plays); } },
              { key: 'prev', label: 'Before', align: 'right', render: function (r) { return fmt.num(r.prev); } },
              { key: 'change', label: 'Change', align: 'right', render: function (r) { return r.prev ? (r.change >= 0 ? '+' : '') + fmt.num(r.change) : ui.pill('New', 'accent'); } }
            ],
            rows: rising, sortKey: 'change', exportName: 'vinax-rising-songs', pageSize: 10, search: false,
            empty: 'Nothing rising yet', emptyHint: 'Needs plays in this window and the one before it.'
          }) })
      ]);
    }, { quiet: false }); }
    return main;
  }

  /* --------------------------------------------------------- search */

  function renderSearch(host, ctx) {
    var days = daysParam(ctx, 7, [1, 7, 30, 90]);
    var body = h('div.page-body');
    host.appendChild(h('div.toolbar', ui.daysPicker(days, function (d) { ctx.setParam('days', d); ctx.refresh(); })));
    host.appendChild(body);
    return ui.load(body, function () { return VX.api.get('/api/admin/search-analytics', { days: days }); }, function (d) {
      if (d.configured === false) return ui.notice(NOT_CONNECTED, 'warn');
      var total = Number(d.total) || 0;
      var top = d.top || [], zero = d.zero || [];
      var zeroCount = sum(zero, 'count');
      var capped = total >= 3000;
      return [
        !total ? ui.notice('No searches in ' + windowLabel(days) + ' yet. Queries appear here as listeners use search.', 'info') : null,
        ui.kpis([
          { label: 'Searches', value: fmt.num(total) + (capped ? '+' : ''), sub: capped ? 'newest 3,000 read' : windowLabel(days) },
          { label: 'Found nothing', value: total ? fmt.ratio(Math.min(1, zeroCount / total)) : '—', sub: fmt.plural(zeroCount, 'search', 'searches') + ' with no results', tone: total && zeroCount / total > 0.1 ? 'warn' : null, hint: 'Counted over the 20 most common no-result queries' },
          { label: 'Most searched', value: top[0] ? fmt.trunc(top[0].query, 22) : '—', sub: top[0] ? fmt.plural(top[0].count, 'time') : null }
        ]),
        ui.grid([
          ui.card({ title: 'Top searches', sub: 'Most typed queries · ' + windowLabel(days), pad: false,
            body: ui.table({
              columns: [
                { key: 'query', label: 'Query', render: function (r) { return h('span', r.query || '—'); } },
                { key: 'count', label: 'Searches', align: 'right', render: function (r) { return fmt.num(r.count); } },
                { key: 'share', label: 'Share', align: 'right', render: function (r) { return r.share == null ? '—' : fmt.ratio(r.share); } }
              ],
              rows: top.map(function (r) { return Object.assign({}, r, { share: total ? Number(r.count) / total : null }); }),
              exportName: 'vinax-top-searches', search: false,
              empty: 'No searches yet', emptyHint: 'Fills in as listeners search.'
            }) }),
          ui.card({ title: 'Searches that found nothing', sub: 'Fix these with a search synonym, or pin a better query', pad: false,
            body: ui.table({
              columns: [
                { key: 'query', label: 'Query', render: function (r) { return h('span', r.query || '—'); } },
                { key: 'count', label: 'Times', align: 'right', render: function (r) { return fmt.num(r.count); } },
                { key: 'act', label: '', sort: false, render: function (r) {
                  return ui.button('Add synonym', { kind: 'ghost', small: true, title: 'Rewrite this query to something the catalogue finds', onClick: function () { ctx.go('catalog', 'synonyms', { from: r.query }); } });
                } }
              ],
              rows: zero, exportName: 'vinax-zero-result-searches', search: false,
              empty: 'Every search found something', emptyHint: 'Queries that return no songs will be listed here.'
            }) })
        ], 2)
      ];
    }, { skeleton: 5 });
  }

  /* ---------------------------------------------------------- skips */

  function renderSkips(host, ctx) {
    var days = daysParam(ctx, 7, [1, 7, 30]);
    var min = [3, 5, 10, 25].indexOf(Number(ctx.params.min)) >= 0 ? Number(ctx.params.min) : 5;
    var body = h('div.page-body');
    host.appendChild(h('div.toolbar',
      ui.segmented([{ value: 1, label: '24h' }, { value: 7, label: '7d' }, { value: 30, label: '30d' }], days, function (d) { ctx.setParam('days', d); ctx.refresh(); }, 'Time range'),
      h('span.muted.small', 'At least'),
      ui.segmented([3, 5, 10, 25].map(function (n) { return { value: n, label: n + ' plays' }; }), min, function (n) { ctx.setParam('min', n); ctx.refresh(); }, 'Minimum plays')));
    host.appendChild(body);
    return ui.load(body, function () { return VX.api.get('/api/admin/skips', { days: days, min: min }); }, function (d) {
      if (d.configured === false) return ui.notice(NOT_CONNECTED, 'warn');
      var rows = (d.items || []).map(function (r) {
        var ratio = skipRatio(r.skips, r.plays);
        return Object.assign({}, r, { ratio: ratio });
      });
      var plays = sum(rows, 'plays'), skips = sum(rows, 'skips');
      var overall = skipRatio(skips, plays);
      var high = rows.filter(function (r) { return r.ratio != null && r.ratio >= 0.5; }).length;
      return [
        ui.kpis([
          { label: 'Songs judged', value: fmt.num(rows.length), sub: 'with ' + min + '+ plays · ' + windowLabel(Number(d.days) || days) },
          { label: 'Skip rate', value: overall == null ? '—' : fmt.ratio(overall), sub: 'skips ÷ plays across these songs', tone: overall != null && overall >= 0.4 ? 'warn' : null },
          { label: 'Skipped half the time', value: fmt.num(high), sub: 'songs at 50% or more', tone: high ? 'warn' : null },
          { label: 'Events read', value: fmt.num(d.sampled), sub: d.source === 'sampled' ? 'sample of recent plays and skips' : 'every play and skip' }
        ]),
        d.source === 'sampled' ? ui.notice('The exact skip report is unavailable, so these numbers come from the newest 10,000 play and skip events.', 'warn') : null,
        ui.card({ title: 'Most skipped songs', sub: 'Skip rate = skips ÷ plays. Capped at 100% when a song was skipped more often than it was started in this window.', pad: false,
          body: ui.table({
            columns: [
              { key: 'title', label: 'Song', render: function (r) { return ui.media(r.image, r.title || 'Untitled', r.artist); } },
              { key: 'artist', label: 'Artist', hide: true },
              { key: 'plays', label: 'Plays', align: 'right', render: function (r) { return fmt.num(r.plays); } },
              { key: 'skips', label: 'Skips', align: 'right', render: function (r) { return fmt.num(r.skips); } },
              { key: 'ratio', label: 'Skip rate', align: 'right', width: '170px', sortVal: function (r) { return r.ratio; }, csv: function (r) { return r.ratio == null ? '' : Math.round(r.ratio * 1000) / 10; },
                render: function (r) {
                  if (r.ratio == null) return '—';
                  return h('div', { style: { display: 'grid', gap: '4px' } }, h('span', fmt.ratio(r.ratio)), ui.meter(r.ratio, r.ratio >= 0.5 ? 'bad' : r.ratio >= 0.3 ? 'warn' : 'ok'));
                } },
              { key: 'act', label: '', sort: false, render: function (r) {
                return h('div.actions',
                  ui.button('Details', { kind: 'ghost', small: true, onClick: function () { ctx.go('music', 'song', { q: r.id || r.title, days: Math.max(Number(d.days) || days, 7) }); } }),
                  r.id ? ui.button('Block', { kind: 'ghost', small: true, icon: 'close', onClick: function () { return blockSong(r.id, r.title, 'Skipped ' + (r.ratio == null ? '' : fmt.ratio(r.ratio)) + ' of plays'); } }) : null);
              } }
            ],
            rows: rows, sortKey: 'ratio', exportName: 'vinax-skips-' + days + 'd',
            empty: 'No song has ' + min + ' plays yet', emptyHint: 'Songs appear once they reach ' + min + ' plays in this window. Try a longer range or a lower minimum.'
          }) })
      ];
    }, { skeleton: 6 });
  }

  /* ----------------------------------------------------------- song */

  function renderSong(host, ctx) {
    var q = String(ctx.params.q || '').trim();
    var days = daysParam(ctx, 30, [7, 30, 90]);
    var input = ui.input({ type: 'search', placeholder: 'Song title or song id', value: q, 'aria-label': 'Song title or id', maxlength: '120' });
    var body = h('div.page-body');
    function run(next) {
      ctx.setParam('q', next.trim());
      ctx.refresh();
    }
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); run(input.value); } });
    host.appendChild(h('div.toolbar',
      h('div.search-box', VX.icon('search'), input),
      ui.button('Look up', { kind: 'primary', icon: 'search', onClick: function () { run(input.value); } }),
      ui.segmented([{ value: 7, label: '7d' }, { value: 30, label: '30d' }, { value: 90, label: '90d' }], days, function (d) { ctx.setParam('days', d); ctx.refresh(); }, 'Time range')));
    host.appendChild(body);
    if (!q) {
      VX.mount(body, ui.empty('Look up a song', 'Type part of a title (or paste a song id) and press Enter. The most played match opens, with other matches listed below it.'));
      setTimeout(function () { try { input.focus(); } catch (e) {} }, 30);
      return null;
    }
    return ui.load(body, function () { return VX.api.get('/api/admin/songstats', { q: q, days: days }); }, function (d) {
      if (d.configured === false) return ui.notice(NOT_CONNECTED, 'warn');
      var m = d.match;
      var cands = d.candidates || [];
      if (!m) {
        return ui.empty('No plays match “' + q + '”', 'Only songs that were played in the last ' + days + ' days can be found. Try fewer words, a longer range, or the song id.');
      }
      var t = d.totals || {};
      var skipR = skipRatio(t.skips, t.plays);
      var doneR = Number(t.plays) > 0 ? Math.min(1, (Number(t.completes) || 0) / Number(t.plays)) : null;
      var series = VX.fillDays(d.byDay, days, 'day', ['plays', 'skips']);
      return [
        ui.card({
          title: m.title || 'Untitled',
          sub: (m.artist || 'Unknown artist') + ' · last ' + days + ' days',
          actions: [
            h('span.muted.small', 'id '), ui.mono(m.id),
            ui.button('Copy id', { kind: 'ghost', small: true, icon: 'copy', onClick: function () { return copy(m.id); } }),
            ui.button('Block song', { kind: 'ghost', small: true, icon: 'close', onClick: function () { return blockSong(m.id, m.title, 'Blocked from song drilldown'); } })
          ],
          body: h('div.media',
            /^https:\/\//.test(m.image || '') ? h('img.thumb', { src: m.image, alt: '', referrerpolicy: 'no-referrer', style: { width: '72px', height: '72px' } }) : null,
            h('div.grow', ui.kpis([
              { label: 'Plays', value: fmt.num(t.plays), spark: series.values.plays },
              { label: 'Listeners', value: fmt.num(t.listeners), sub: 'different devices' },
              { label: 'Skip rate', value: skipR == null ? '—' : fmt.ratio(skipR), sub: fmt.plural(t.skips, 'skip'), tone: skipR != null && skipR >= 0.5 ? 'warn' : null },
              { label: 'Played to the end', value: doneR == null ? '—' : fmt.ratio(doneR), sub: fmt.plural(t.completes, 'full play') },
              { label: 'Favourited', value: fmt.num(t.favorites), sub: 'times' }
            ])))
        }),
        ui.grid([
          ui.card({ title: 'Plays and skips per day', sub: 'Last ' + days + ' days (UTC)', span: 2,
            body: ui.chart({ labels: series.labels, series: [{ name: 'Plays', values: series.values.plays }, { name: 'Skips', values: series.values.skips, color: 'var(--c4)' }], type: 'bar', height: 220, empty: 'No plays in this window' }) }),
          ui.card({ title: 'Countries', sub: 'Where it was played',
            body: ui.hbars((d.countries || []).map(function (r) { return { label: fmt.country(r.country), value: r.n }; }), { empty: 'No locations yet', emptyHint: 'Country is known for plays from devices that share location.' }) }),
          ui.card({ title: 'Devices', sub: 'Plays by platform',
            body: ui.share((d.platforms || []).map(function (r) { return { label: r.platform ? cap(r.platform) : 'Unknown', value: r.n }; }), { empty: 'No platform data yet' }) }),
          ui.card({ title: 'Other matches', sub: cands.length ? 'Not the song you meant? Open another match.' : 'No other song matched “' + q + '”', pad: false,
            body: cands.length ? ui.table({
              columns: [
                { key: 'title', label: 'Song', render: function (r) { return ui.media(r.image, r.title || 'Untitled', r.artist); } },
                { key: 'n', label: 'Plays', align: 'right', render: function (r) { return fmt.num(r.n); } },
                { key: 'go', label: '', sort: false, render: function (r) { return ui.button('Open', { kind: 'ghost', small: true, onClick: function () { run(String(r.id)); } }); } }
              ],
              rows: cands, exportName: false, search: false,
              onRow: function (r) { run(String(r.id)); }
            }) : ui.empty('No other matches', 'Only the song above matched.') })
        ])
      ];
    }, { skeleton: 6 });
  }

  /* ---------------------------------------------------------- utils */

  function cap(s) { s = String(s || ''); return s ? s.charAt(0).toUpperCase() + s.slice(1) : '—'; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function copy(text) {
    var done = function () { VX.toast('Copied', 'ok'); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(String(text)).then(done, function () { VX.toast('Copy failed — select the id and copy it by hand', 'bad'); });
    } catch (e) {}
    VX.toast('Copy is not available in this browser', 'bad');
    return null;
  }
})();
