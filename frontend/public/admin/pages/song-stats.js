/* Song Stats (was Analytics) — what signed-in users play, where they are,
 * how much they listen, whether they come back, and what they skip.
 * Every tab follows the date range in the top bar (ctx.range.days).
 * Route: GET /api/admin/analytics?view=…&days=. Also defines VX.music, the
 * song / album actions Music Library shares. */
(function () {
  'use strict';
  var VX = window.VX, h = VX.h, ui = VX.ui, fmt = VX.fmt, arr = VX.arr, obj = VX.obj, num = VX.num;
  var SITE = 'https://www.vinaxmusic.online';

  /* ------------------------------------------------ shared music actions */
  var REASONS = ['Copyright', 'Wrong audio', 'Offensive', 'Other'];
  var NOUN = { song: 'song', album: 'album', artist: 'artist', playlist: 'playlist', keyword: 'word' };
  var music = VX.music = {
    REASONS: REASONS,
    /** The public page for a song, album, artist or playlist. */
    url: function (kind, id) { return SITE + '/' + (kind || 'song') + '/' + encodeURIComponent(id); },
    open: function (kind, id) { window.open(music.url(kind, id), '_blank', 'noopener'); },
    /** Ask why, then block. Resolves to the saved row or null. */
    block: function (kind, value, label) {
      if (!VX.can('edit')) { VX.toast(VX.errorText('forbidden'), 'bad'); return Promise.resolve(null); }
      return new Promise(function (resolve) {
        var reason = 'Copyright', done = false;
        VX.modal({
          title: 'Block this ' + (NOUN[kind] || 'item') + '?',
          body: [
            h('p', '“' + (label || value) + '” will disappear from search, Home and playlists in the app within a few minutes. You can unblock it any time.'),
            ui.dropdown('Why are you blocking it?', REASONS, reason, function (v) { reason = v; })
          ],
          onClose: function () { if (!done) resolve(null); },
          actions: [
            { label: 'Cancel', kind: 'ghost' },
            { label: 'Block', kind: 'danger', onClick: function (close) {
              done = true; close();
              VX.api.post('/api/admin/content', { action: 'block', kind: kind, value: String(value), label: label || null, reason: reason }).then(function (res) {
                if (!res.ok) { VX.toast('Something went wrong — ' + res.message, 'bad'); resolve(null); return; }
                VX.toast(res.data && res.data.already ? 'Already blocked ✓' : 'Blocked ✓', 'ok');
                resolve((res.data && res.data.row) || {});
              });
            } }
          ]
        });
      });
    },
    /** "⋯" items for a song row. s = { id, title, artist }. */
    songMenu: function (s, ctx) {
      var id = s.id ? String(s.id) : '';
      return [
        { label: 'Copy song ID', icon: 'copy', disabled: !id, onClick: function () { VX.copy(id, 'Song ID copied'); } },
        { label: 'Open in app', icon: 'external', disabled: !id, onClick: function () { music.open('song', id); } },
        { label: 'Add to banner', icon: 'layout', disabled: !id || !VX.can('edit'), onClick: function () { ctx.go('app-settings/home-screen', null, { section: 'banners', addSong: id, title: s.title || '' }); } },
        { label: 'Use in notification', icon: 'bell', disabled: !id || !VX.can('edit'), onClick: function () { ctx.go('notifications', 'compose', { song: id, title: s.title || '' }); } },
        '-',
        { label: 'Block song', icon: 'trash', danger: true, disabled: !id || !VX.can('edit'), onClick: function () { music.block('song', id, [s.title, s.artist].filter(Boolean).join(' — ')); } }
      ];
    },
    /** A ▶ button that plays the first 30 seconds of `src`. */
    previewButton: function (src, title) {
      if (!src || !/^https:\/\//.test(src)) return null;
      var b = h('button.icon-btn.preview-btn', { type: 'button', 'aria-label': 'Play a 30-second preview of ' + (title || 'this song'), title: '30-second preview' }, VX.icon('play'));
      b.addEventListener('click', function (e) { e.stopPropagation(); music.toggle(src, b); });
      return b;
    },
    toggle: function (src, btn) {
      var a = music._audio || (music._audio = new Audio());
      if (music._btn === btn && !a.paused) { a.pause(); return; }
      if (music._btn) music._btn.classList.remove('playing');
      music._btn = btn;
      a.src = src; a.currentTime = 0;
      a.ontimeupdate = function () { if (a.currentTime >= 30) a.pause(); };
      a.onpause = function () { btn.classList.remove('playing'); };
      a.onended = a.onpause;
      a.onerror = function () { btn.classList.remove('playing'); VX.toast('This preview could not play.', 'bad'); };
      btn.classList.add('playing');
      var p = a.play(); if (p && p.catch) p.catch(function () { btn.classList.remove('playing'); });
    },
    stop: function () { if (music._audio) music._audio.pause(); }
  };

  /* ------------------------------------------------------------ helpers */
  function load(host, view, ctx, render) {
    return ui.load(host, function () { return VX.api.get('/api/admin/analytics', { view: view, days: ctx.range.days }); }, function (d) {
      return ui.gate(d, ctx) || render(VX.obj(d.data), d);
    });
  }
  function rangeText(ctx) { return ctx.range.days === 1 ? 'today' : ctx.range.key === 'custom' ? 'in ' + ctx.range.label : 'in the ' + ctx.range.label.toLowerCase(); }
  function songCell(r) { return ui.media(r.image, r.title || 'Untitled', r.artist || null); }
  /** "▲ rising" when a song gained clearly on the period before. */
  function risingChip(r) {
    var p = num(r.prev_plays), n = num(r.plays);
    if (p === 0 && n >= 3) return ui.pill('New', 'info');
    if (p > 0 && n >= p * 1.2 && n - p >= 3) return ui.pill('▲ rising', 'ok');
    return null;
  }
  function emptySongs(ctx) { return { title: 'No plays ' + rangeText(ctx), hint: 'Songs appear here once signed-in users play music. Try a longer date range.' }; }

  /* -------------------------------------------------------------- tabs */
  function topSongs(host, ctx) {
    return load(host, 'music', ctx, function (d) {
      var songs = arr(d.songs), langs = arr(d.languages);
      var plays = songs.reduce(function (a, s) { return a + num(s.plays); }, 0);
      var top = langs.filter(function (l) { return l.language !== 'unknown'; })[0];
      return [
        ui.stats([
          { label: 'Plays of top songs', value: fmt.num(plays), info: 'How many times signed-in users played the songs in this list ' + rangeText(ctx) + '.' },
          { label: 'Songs in the list', value: fmt.num(songs.length), info: 'Different songs signed-in users played (up to the 100 most played).' },
          { label: 'Most loved song', value: songs[0] ? fmt.trunc(songs[0].title, 22) : '—', sub: songs[0] ? fmt.plural(songs[0].plays, 'play') : null, info: 'The song with the most plays ' + rangeText(ctx) + '.' },
          { label: 'Top language', value: top ? VX.langName(top.language) : '—', sub: top ? fmt.plural(top.plays, 'play') : null, info: 'The language signed-in users played most ' + rangeText(ctx) + '.' }
        ]),
        ui.card({ title: 'Top songs', sub: 'Most played by signed-in users ' + rangeText(ctx) + '. “▲ rising” means clearly more plays than the period before.', pad: false, body: ui.dataTable({
          columns: [
            { key: 'rank', label: '#', align: 'right', width: '44px', sortVal: function (r) { return songs.indexOf(r) + 1; }, render: function (r) { return String(songs.indexOf(r) + 1); } },
            { key: 'title', label: 'Song', always: true, render: function (r) { return h('div.song-cell', songCell(r), risingChip(r)); } },
            { key: 'artist', label: 'Artist', hidden: true },
            { key: 'plays', label: 'Plays', align: 'right', render: function (r) { return fmt.num(r.plays); } },
            { key: 'listeners', label: 'Users', align: 'right', render: function (r) { return fmt.num(r.listeners); } },
            { key: 'prev_plays', label: 'Plays before', align: 'right', hidden: true, render: function (r) { return fmt.num(r.prev_plays); } }
          ],
          rows: songs, rowId: function (r) { return String(r.id || r.title); }, search: 'Search songs or artists…', exportName: 'vinax-top-songs',
          rowMenu: function (r) { return music.songMenu(r, ctx); }, empty: emptySongs(ctx)
        }) })
      ];
    });
  }

  function rising(host, ctx) {
    return load(host, 'rising', ctx, function (d) {
      var list = arr(d.rising);
      return ui.card({ title: 'Biggest gainers', sub: 'Songs with the most extra plays compared with the period just before.', pad: false, body: ui.dataTable({
        columns: [
          { key: 'title', label: 'Song', always: true, render: songCell },
          { key: 'gain', label: 'Extra plays', align: 'right', sortVal: function (r) { return num(r.plays) - num(r.prev_plays); }, render: function (r) { return h('span.gain', '+' + fmt.num(num(r.plays) - num(r.prev_plays))); } },
          { key: 'pct', label: 'Change', align: 'right', sortVal: function (r) { return r.prev_plays ? (num(r.plays) - num(r.prev_plays)) / num(r.prev_plays) : 9999; }, render: function (r) { return num(r.prev_plays) ? ui.pill('▲ ' + fmt.pct((num(r.plays) - num(r.prev_plays)) / num(r.prev_plays) * 100), 'ok') : ui.pill('New', 'info'); } },
          { key: 'plays', label: 'Plays now', align: 'right', render: function (r) { return fmt.num(r.plays); } },
          { key: 'prev_plays', label: 'Plays before', align: 'right', render: function (r) { return fmt.num(r.prev_plays); } }
        ],
        rows: list, rowId: function (r) { return String(r.id || r.title); }, exportName: 'vinax-rising', rowMenu: function (r) { return music.songMenu(r, ctx); },
        empty: { title: 'Nothing is rising ' + rangeText(ctx), hint: 'A song shows here when it gets more plays than in the period before.' }
      }) });
    });
  }

  function artists(host, ctx) {
    return load(host, 'music', ctx, function (d) {
      var list = arr(d.artists);
      return [
        ui.card({ title: 'Top artists', sub: 'By plays from signed-in users ' + rangeText(ctx) + '.', body: ui.hbars(list.slice(0, 12).map(function (a) { return { label: a.artist, value: num(a.plays), sub: fmt.plural(a.listeners, 'user') }; }), { empty: 'No plays ' + rangeText(ctx) }) }),
        ui.card({ title: 'All artists', pad: false, body: ui.dataTable({
          columns: [
            { key: 'artist', label: 'Artist', always: true, render: function (r) { return h('strong', r.artist || '—'); } },
            { key: 'plays', label: 'Plays', align: 'right', render: function (r) { return fmt.num(r.plays); } },
            { key: 'listeners', label: 'Users', align: 'right', render: function (r) { return fmt.num(r.listeners); } }
          ],
          rows: list, rowId: function (r) { return r.artist; }, exportName: 'vinax-top-artists',
          rowMenu: function (r) { return [
            { label: 'Copy name', icon: 'copy', onClick: function () { VX.copy(r.artist, 'Name copied'); } },
            { label: 'Find in Music Library', icon: 'search', onClick: function () { ctx.go('library', 'search', { q: r.artist, type: 'artists' }); } },
            '-',
            { label: 'Block artist', icon: 'trash', danger: true, disabled: !VX.can('edit'), onClick: function () { music.block('artist', r.artist, r.artist); } }
          ]; },
          empty: { title: 'No artists yet', hint: 'Artists appear once signed-in users play music.' }
        }) })
      ];
    });
  }

  function languages(host, ctx) {
    return load(host, 'music', ctx, function (d) {
      var list = arr(d.languages);
      return [
        h('div.grid.cols-2',
          ui.card({ title: 'Plays by language', body: ui.hbars(list.map(function (l) { return { label: VX.langName(l.language), value: num(l.plays), sub: fmt.plural(l.listeners, 'user') }; }), { empty: 'No plays ' + rangeText(ctx) }) }),
          ui.card({ title: 'Share of plays', body: ui.share(list.map(function (l) { return { label: VX.langName(l.language), value: num(l.plays) }; }), { title: 'Share of plays by language' }) })),
        ui.card({ title: 'Languages', pad: false, body: ui.dataTable({
          columns: [
            { key: 'language', label: 'Language', always: true, sortVal: function (r) { return VX.langName(r.language); }, render: function (r) { return VX.langName(r.language); } },
            { key: 'plays', label: 'Plays', align: 'right', render: function (r) { return fmt.num(r.plays); } },
            { key: 'listeners', label: 'Users', align: 'right', render: function (r) { return fmt.num(r.listeners); } }
          ],
          rows: list, rowId: function (r) { return r.language; }, search: false, exportName: 'vinax-languages',
          empty: { title: 'No languages yet', hint: 'Languages appear once signed-in users play music.' }
        }) })
      ];
    });
  }

  function places(host, ctx) {
    return load(host, 'geo', ctx, function (d) {
      var countries = arr(d.countries), regions = arr(d.regions), cities = arr(d.cities);
      var country = ctx.params.country || '', region = ctx.params.region || '';
      var detail = h('div');
      function placeName(v) { return !v || v === 'Unknown' ? 'Not known' : v; }
      function draw() {
        var regs = regions.filter(function (r) { return !country || r.country === country; });
        var cits = cities.filter(function (c) { return (!country || c.country === country) && (!region || (c.region || 'Unknown') === region); });
        var countrySel = ui.dropdown('Country', [{ value: '', label: 'All countries' }].concat(countries.map(function (c) { return { value: c.country, label: fmt.country(c.country) }; })), country, function (v) { country = v; region = ''; ctx.setParam('country', v); ctx.setParam('region', ''); draw(); }, { inline: true });
        var regionSel = ui.dropdown('State', [{ value: '', label: country ? 'All states' : 'Choose a country first' }].concat(country ? regs.map(function (r) { return { value: r.region, label: placeName(r.region) }; }) : []), region, function (v) { region = v; ctx.setParam('region', v); draw(); }, { disabled: !country, inline: true });
        VX.mount(detail,
          h('div.toolbar.filters', countrySel, regionSel),
          h('div.stack',
            ui.card({ title: country ? 'States in ' + fmt.country(country) : 'Top states', pad: false, body: ui.dataTable({
              columns: [
                { key: 'region', label: 'State', always: true, render: function (r) { return h('div', h('div.cell-main', placeName(r.region)), country ? null : h('div.cell-sub', fmt.country(r.country))); } },
                { key: 'listeners', label: 'Users', align: 'right', render: function (r) { return fmt.num(r.listeners); } },
                { key: 'plays', label: 'Plays', align: 'right', render: function (r) { return fmt.num(r.plays); } }
              ],
              rows: regs, rowId: function (r) { return r.country + '|' + r.region; }, search: false, exportName: 'vinax-states', pageSize: 25,
              onRow: function (r) { if (!country) { country = r.country; ctx.setParam('country', country); } region = r.region; ctx.setParam('region', region); draw(); },
              empty: { title: 'No states yet', hint: 'Places come from the network, never from GPS.' }
            }) }),
            ui.card({ title: region ? 'Cities in ' + placeName(region) : 'Top cities', pad: false, body: ui.dataTable({
              columns: [
                { key: 'city', label: 'City', always: true, render: function (r) { return h('div', h('div.cell-main', placeName(r.city)), h('div.cell-sub', [placeName(r.region), fmt.country(r.country)].join(', '))); } },
                { key: 'listeners', label: 'Users', align: 'right', render: function (r) { return fmt.num(r.listeners); } },
                { key: 'plays', label: 'Plays', align: 'right', render: function (r) { return fmt.num(r.plays); } }
              ],
              rows: cits, rowId: function (r) { return [r.country, r.region, r.city].join('|'); }, search: 'Search cities…', exportName: 'vinax-cities', pageSize: 25,
              empty: { title: 'No cities yet', hint: 'Cities appear once signed-in users play music.' }
            }) })));
      }
      var top = h('div');
      function drawAll() {
        VX.mount(top,
          ui.stats([
            { label: 'Countries', value: fmt.num(countries.length), info: 'Countries signed-in users listened from ' + rangeText(ctx) + '. Places come from the network, never from GPS.' },
            { label: 'Top country', value: countries[0] ? fmt.country(countries[0].country) : '—', sub: countries[0] ? fmt.plural(countries[0].listeners, 'user') : null, info: 'The country with the most signed-in users ' + rangeText(ctx) + '.' },
            { label: 'Top state', value: regions[0] ? placeName(regions[0].region) : '—', sub: regions[0] ? fmt.plural(regions[0].listeners, 'user') : null, info: 'The state or region with the most signed-in users.' },
            { label: 'Top city', value: cities[0] ? placeName(cities[0].city) : '—', sub: cities[0] ? fmt.plural(cities[0].listeners, 'user') : null, info: 'The city with the most signed-in users.' }
          ]),
          ui.card({ title: 'Users by country', sub: 'Choose a country below to see its states and cities.', body: ui.hbars(countries.slice(0, 10).map(function (c) { return { label: fmt.country(c.country), value: num(c.listeners), sub: fmt.plural(c.plays, 'play') }; }), { empty: 'No places ' + rangeText(ctx), format: function (v) { return fmt.plural(v, 'user'); } }) }));
        draw();
      }
      drawAll();
      return [top, detail];
    });
  }

  function engagement(host, ctx) {
    return load(host, 'engagement', ctx, function (d) {
      var per = obj(d.perUser), b = obj(per.buckets), seg = obj(d.segments), tl = arr(d.timeline);
      var peak = obj(obj(d.hourly).peak);
      var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      return [
        ui.stats([
          { label: 'People listening', value: fmt.num(per.people), info: 'Signed-in users who did anything in the app ' + rangeText(ctx) + '.' },
          { label: 'Plays per person', value: per.playsPerPerson == null ? '—' : fmt.num(per.playsPerPerson), info: 'On average, how many songs each of those people played ' + rangeText(ctx) + '.' },
          { label: 'Days active per person', value: per.daysPerPerson == null ? '—' : fmt.num(per.daysPerPerson), info: 'On average, on how many different days each person used the app ' + rangeText(ctx) + '.' },
          { label: 'Busiest time', value: peak.n ? DAYS[peak.day] + ' ' + String(peak.hour).padStart(2, '0') + ':00' : '—', info: 'The hour of the week (India time) with the most listening.' }
        ]),
        ui.card({ title: 'Plays per person each day', sub: 'Plays divided by the people who listened that day.', body: ui.chart({
          labels: tl.map(function (x) { return x.day; }), type: 'bar', height: 200,
          series: [{ name: 'Plays per person', values: tl.map(function (x) { return num(x.listeners) ? Math.round(num(x.plays) / num(x.listeners) * 10) / 10 : 0; }) }],
          format: function (v) { return fmt.num(v); }, empty: 'No plays ' + rangeText(ctx)
        }) }),
        h('div.grid.cols-2',
          ui.card({ title: 'How much people listen', sub: 'Signed-in users by plays ' + rangeText(ctx) + '.', body: ui.hbars([
            { label: 'Light (1–9 plays)', value: num(b.light) },
            { label: 'Regular (10–49 plays)', value: num(b.regular) },
            { label: 'Heavy (50+ plays)', value: num(b.heavy) }
          ], { format: function (v) { return fmt.plural(v, 'person', 'people'); }, empty: 'No listening ' + rangeText(ctx) }) }),
          ui.card({ title: 'Who is coming back', sub: 'All signed-in users, today.', body: ui.hbars([
            { label: 'Joined this week', value: num(seg.new7d) },
            { label: 'Came back this week', value: num(seg.returning7d) },
            { label: 'Quiet for 1–4 weeks', value: num(seg.inactive30d) },
            { label: 'Away for over a month', value: num(seg.dormant) },
            { label: 'Big fans (20+ plays in 30 days)', value: num(seg.power) }
          ], { format: function (v) { return fmt.plural(v, 'person', 'people'); } }) })),
        ui.card({ title: 'When people listen', sub: 'Each square is one hour of the week (India time). Darker means more listening.', body: ui.heatmap(obj(d.hourly).cells, { empty: 'No listening ' + rangeText(ctx) }) }),
        h('p.muted.small', 'Minutes listened are not recorded by the app yet, so listening is shown as plays.')
      ];
    });
  }

  function retention(host, ctx) {
    return load(host, 'retention', ctx, function (rows) {
      rows = arr(rows);
      if (!rows.length) return ui.emptyState('No groups yet', 'Each week’s new users form a group. It shows here once people start signing in and listening.');
      function cell(n, size) {
        var p = size ? num(n) / size * 100 : 0;
        return h('td.right.cohort', { style: { '--p': (p / 100).toFixed(2) }, title: fmt.plural(n, 'person', 'people') + ' of ' + fmt.num(size) }, size ? fmt.pct(p) : '—');
      }
      var all = rows.reduce(function (a, r) { a.size += num(r.size); a.d7 += num(r.d7); a.d30 += num(r.d30); a.d1 += num(r.d1); return a; }, { size: 0, d1: 0, d7: 0, d30: 0 });
      return [
        ui.stats([
          { label: 'Came back after 1 day', value: all.size ? fmt.pct(all.d1 / all.size * 100) : '—', info: 'Of people who started in these weeks, how many used the app again the next day.' },
          { label: 'Came back after 7 days', value: all.size ? fmt.pct(all.d7 / all.size * 100) : '—', info: 'How many used the app again between day 2 and day 7.' },
          { label: 'Came back after 30 days', value: all.size ? fmt.pct(all.d30 / all.size * 100) : '—', info: 'How many used the app again between day 8 and day 30.' }
        ]),
        ui.card({ title: 'Do they come back?', sub: 'Each row is the people whose first visit was that week. Darker means more of them came back.', pad: false, body: h('div.tbl-scroll', h('table.tbl.cohort-grid',
          h('thead', h('tr', h('th', { scope: 'col' }, 'First visit in the week of'), h('th.right', { scope: 'col' }, 'People'), h('th.right', { scope: 'col' }, 'Came back after 1 day'), h('th.right', { scope: 'col' }, 'Came back after 7 days'), h('th.right', { scope: 'col' }, 'Came back after 30 days'))),
          h('tbody', rows.map(function (r) {
            return h('tr', h('td', fmt.day(r.week)), h('td.right', fmt.num(r.size)), cell(r.d1, num(r.size)), cell(r.d7, num(r.size)), cell(r.d30, num(r.size)));
          })))) })
      ];
    });
  }

  function funnel(host, ctx) {
    return load(host, 'funnel', ctx, function (steps) {
      steps = arr(steps);
      var first = steps.length ? num(steps[0].listeners) : 0;
      if (!first) return ui.emptyState('No visits ' + rangeText(ctx), 'The journey shows once people open the app. Try a longer date range.');
      return ui.card({ title: 'Sign-up journey', sub: 'Of everyone who opened the app ' + rangeText(ctx) + ', how many reached each step.', body: h('ol.funnel', steps.map(function (s, i) {
        var n = num(s.listeners), pct = n / first * 100;
        var prev = i ? num(steps[i - 1].listeners) : 0;
        return h('li.funnel-step',
          h('div.funnel-top', h('strong', s.label || fmt.label(s.id)), h('span', fmt.num(n) + ' · ' + fmt.pct(pct))),
          h('div.funnel-track', h('div.funnel-fill', { style: { width: Math.max(1.5, pct) + '%' } })),
          i ? h('div.muted.small', prev ? fmt.pct(n / prev * 100) + ' of the step before' : '') : null);
      })) });
    });
  }

  function skips(host, ctx) {
    return load(host, 'skips', ctx, function (list) {
      list = arr(list);
      return ui.card({ title: 'Songs people skip', sub: 'Songs played at least 5 times ' + rangeText(ctx) + ', by how often signed-in users skipped them.', pad: false, body: ui.dataTable({
        columns: [
          { key: 'title', label: 'Song', always: true, render: songCell },
          { key: 'rate', label: 'Skip rate', align: 'right', render: function (r) { return h('div.skip-rate', ui.meter(num(r.rate) / 100, num(r.rate) >= 50 ? 'bad' : num(r.rate) >= 30 ? 'warn' : 'ok', 'Skip rate'), h('span', fmt.pct(r.rate))); } },
          { key: 'skips', label: 'Skips', align: 'right', render: function (r) { return fmt.num(r.skips); } },
          { key: 'plays', label: 'Plays', align: 'right', render: function (r) { return fmt.num(r.plays); } }
        ],
        rows: list, rowId: function (r) { return String(r.id); }, exportName: 'vinax-skips', sortKey: 'rate', rowMenu: function (r) { return music.songMenu(r, ctx); },
        empty: { title: 'No songs skipped often ' + rangeText(ctx), hint: 'A song shows here after at least 5 plays with some skips.' }
      }) });
    });
  }

  VX.page({
    id: 'song-stats', title: 'Song Stats', group: 'Music', icon: 'growth', order: 1, range: true,
    desc: 'What signed-in users play, where they are, how much they listen and whether they come back.',
    keywords: 'analytics top songs artists languages places engagement retention funnel skips',
    tabs: [
      { id: 'top-songs', label: 'Top Songs', render: topSongs },
      { id: 'rising', label: 'Rising', render: rising },
      { id: 'artists', label: 'Top Artists', render: artists },
      { id: 'languages', label: 'Languages', render: languages },
      { id: 'places', label: 'Where Users Are', render: places },
      { id: 'engagement', label: 'How Much They Listen', render: engagement },
      { id: 'retention', label: 'Do They Come Back', render: retention },
      { id: 'funnel', label: 'Sign-up Journey', render: funnel },
      { id: 'skips', label: 'Songs People Skip', render: skips }
    ]
  });
})();
