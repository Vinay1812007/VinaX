/* Trending — what signed-in users play more of, against the period just
 * before: songs climbing the chart (place change and plays per day), new
 * entries, top artists and languages. Follows the date range in the top bar.
 * Route: GET /api/admin/trends?view=trending&days= (stats_trending, schema 11).
 * A song opens Music Library searching for it. */
(function () {
  'use strict';
  var VX = window.VX, h = VX.h, ui = VX.ui, fmt = VX.fmt, arr = VX.arr, obj = VX.obj, num = VX.num;

  function rangeText(ctx) { return ctx.range.days === 1 ? 'today' : ctx.range.key === 'custom' ? 'in ' + ctx.range.label : 'in the ' + String(ctx.range.label || '').toLowerCase(); }
  function beforeText(ctx) { return ctx.range.days === 1 ? 'yesterday' : 'the ' + fmt.plural(Math.min(90, num(ctx.range.days) || 7), 'day') + ' before'; }

  /** The card shown while the database is older than schema 11. */
  function updateNeeded(ctx) {
    return ui.card({ title: 'One-time database update needed', tone: 'warn', body: [
      h('p', 'This page needs numbers the database can give only after its one-time update. Every other page keeps working.'),
      VX.can('owner')
        ? h('div.toolbar', ui.button('How to update', { kind: 'primary', small: true, icon: 'database', onClick: function () { ctx.go('database', 'maintenance'); } }))
        : h('p.muted.small', 'Ask an Owner to run it from Database › Maintenance.')
    ] });
  }

  /** "▲3", "▼2", "=" or "NEW": how a place in the chart moved since the period before. */
  function move(r) {
    if (r.prev_rank == null) return h('span.tr-move.new', { title: 'Not played in the period before', 'aria-label': 'New entry' }, 'NEW');
    var d = num(r.prev_rank) - num(r.rank);
    if (d > 0) return h('span.tr-move.up', { title: 'Up ' + fmt.plural(d, 'place') + ' (was ' + num(r.prev_rank) + ')', 'aria-label': 'Up ' + fmt.plural(d, 'place') }, '▲' + d);
    if (d < 0) return h('span.tr-move.down', { title: 'Down ' + fmt.plural(-d, 'place') + ' (was ' + num(r.prev_rank) + ')', 'aria-label': 'Down ' + fmt.plural(-d, 'place') }, '▼' + -d);
    return h('span.tr-move.same', { title: 'Same place as before', 'aria-label': 'Same place' }, '=');
  }
  /** "+40%" against the period before, or "new". */
  function change(cur, prev) {
    cur = num(cur); prev = num(prev);
    if (!prev) return cur ? ui.pill('New', 'info') : null;
    var p = Math.round((cur - prev) / prev * 100);
    return ui.pill((p > 0 ? '▲ ' : p < 0 ? '▼ ' : '') + Math.abs(p) + '%', p > 0 ? 'ok' : p < 0 ? 'bad' : null);
  }
  function openSong(r, ctx) { ctx.go('library', null, { q: r.title || '' }); }

  /** One song in a chart list: place, move, picture and names, plays per day, plays now and before. */
  function songRow(r, ctx) {
    var daily = arr(r.daily).map(num);
    return h('li',
      h('button.tr-row', { type: 'button', title: 'Find “' + (r.title || 'this song') + '” in Music Library', onclick: function () { openSong(r, ctx); } },
        h('span.tr-rank', String(num(r.rank) || '—')),
        move(r),
        h('span.tr-song', ui.media(r.image, r.title || 'Untitled', r.artist || null)),
        daily.length > 1 && daily.some(function (v) { return v > 0; }) ? h('span.tr-spark', { title: 'Plays per day: ' + daily.join(', ') }, ui.spark(daily, { width: 90, height: 26 })) : h('span.tr-spark'),
        h('span.tr-plays', h('strong', fmt.num(r.plays)), h('span.muted.small', num(r.prev_plays) ? 'was ' + fmt.num(r.prev_plays) : 'new'))));
  }

  function render(host, ctx) {
    return ui.load(host, function () {
      return VX.api.get('/api/admin/trends', { view: 'trending', days: ctx.range.days }).then(function (res) {
        // An older database: say what to do instead of an error.
        return !res.ok && res.error === 'db_update_needed' ? { ok: true, status: res.status, data: { updateNeeded: true } } : res;
      });
    }, function (d) {
      if (d && d.updateNeeded) return updateNeeded(ctx);
      var gate = ui.gate(d, ctx);
      if (gate) return gate;
      var data = obj(d.data), t = obj(data.totals);
      var songs = arr(data.songs), artists = arr(data.artists), langs = arr(data.languages);
      var climbing = songs.filter(function (s) { return num(s.prev_plays) > 0 && num(s.plays) > num(s.prev_plays); });
      var rising = songs.filter(function (s) { return num(s.plays) > num(s.prev_plays); })
        .sort(function (a, b) { return (num(b.plays) - num(b.prev_plays)) - (num(a.plays) - num(a.prev_plays)) || num(a.rank) - num(b.rank); })
        .slice(0, 12);
      var fresh = songs.filter(function (s) { return s.prev_rank == null; });
      var stats = ui.stats([
        { label: 'Plays', value: fmt.num(t.plays), delta: VX.change(t.plays, t.prev_plays), deltaLabel: 'vs before', sub: t.prev_plays != null ? 'before: ' + fmt.num(t.prev_plays) : null, info: 'How many songs signed-in users played ' + rangeText(ctx) + ', compared with ' + beforeText(ctx) + '.' },
        { label: 'People listening', value: fmt.num(t.listeners), delta: VX.change(t.listeners, t.prev_listeners), deltaLabel: 'vs before', info: 'Signed-in users who played at least one song ' + rangeText(ctx) + ', compared with ' + beforeText(ctx) + '.' },
        { label: 'Songs climbing', value: fmt.num(climbing.length), sub: songs.length ? 'of the top ' + fmt.num(songs.length) : null, info: 'Songs in the chart below that were played before and got more plays ' + rangeText(ctx) + '.' },
        { label: 'New entries', value: fmt.num(t.new_songs != null ? t.new_songs : fresh.length), sub: fresh.length ? fmt.num(fresh.length) + ' in the chart' : null, info: 'Different songs played ' + rangeText(ctx) + ' that nobody played in ' + beforeText(ctx) + '.' }
      ]);
      if (!songs.length) {
        return [stats, ui.card({ body: ui.emptyState('No plays ' + rangeText(ctx), 'Trending fills in once signed-in users play music. Try a longer date range.') })];
      }
      return [
        stats,
        h('div.grid.cols-2',
          ui.card({ title: 'Rising songs', sub: 'Most extra plays compared with ' + beforeText(ctx) + '. ▲ is how many places a song climbed; NEW was not played before. Choose a song to find it in Music Library.', body:
            rising.length ? h('ol.tr-list', rising.map(function (r) { return songRow(r, ctx); })) : ui.emptyState('Nothing is rising ' + rangeText(ctx), 'A song shows here when it gets more plays than in the period before.') }),
          ui.card({ title: 'The chart', sub: 'The most played songs ' + rangeText(ctx) + ', with their move since ' + beforeText(ctx) + '.', body:
            h('ol.tr-list', songs.slice(0, 15).map(function (r) { return songRow(r, ctx); })) })),
        h('div.grid.cols-2',
          ui.card({ title: 'Top artists', sub: 'Plays ' + rangeText(ctx) + ' and the change since ' + beforeText(ctx) + '.', pad: false, body: ui.dataTable({
            columns: [
              { key: 'rank', label: '#', align: 'right', width: '44px', render: function (r) { return String(num(r.rank)); } },
              { key: 'move', label: 'Move', sort: false, render: move },
              { key: 'artist', label: 'Artist', always: true, render: function (r) { return h('strong', r.artist || '—'); } },
              { key: 'plays', label: 'Plays', align: 'right', render: function (r) { return fmt.num(r.plays); } },
              { key: 'change', label: 'Change', align: 'right', sortVal: function (r) { return num(r.prev_plays) ? (num(r.plays) - num(r.prev_plays)) / num(r.prev_plays) : 9999; }, render: function (r) { return change(r.plays, r.prev_plays); } },
              { key: 'listeners', label: 'Users', align: 'right', hidden: true, render: function (r) { return fmt.num(r.listeners); } }
            ],
            rows: artists, rowId: function (r) { return r.artist; }, search: false, exportName: 'vinax-trending-artists', pageSize: 10,
            rowMenu: function (r) { return [
              { label: 'Find in Music Library', icon: 'search', onClick: function () { ctx.go('library', 'search', { q: r.artist, type: 'artists' }); } },
              { label: 'Copy name', icon: 'copy', onClick: function () { VX.copy(r.artist, 'Name copied'); } }
            ]; },
            empty: { title: 'No artists yet', hint: 'Artists appear once signed-in users play music.' }
          }) }),
          ui.card({ title: 'Languages', sub: 'Plays by language ' + rangeText(ctx) + ', and the change since ' + beforeText(ctx) + '.', body: ui.hbars(langs.filter(function (l) { return num(l.plays) > 0; }).map(function (l) {
            var c = num(l.prev_plays) ? Math.round((num(l.plays) - num(l.prev_plays)) / num(l.prev_plays) * 100) : null;
            return { label: VX.langName(l.language), value: num(l.plays), sub: c == null ? 'new' : (c > 0 ? '▲ ' : c < 0 ? '▼ ' : '') + Math.abs(c) + '% vs before' };
          }), { empty: 'No plays ' + rangeText(ctx) }) }))
      ];
    });
  }

  VX.page({
    id: 'trending', title: 'Trending', group: 'Music', icon: 'flame', order: 3, range: true,
    desc: 'Songs, artists and languages getting more plays than in the period before.',
    keywords: 'trending rising climbing chart new entries hot popular artists languages',
    render: render
  });
})();
