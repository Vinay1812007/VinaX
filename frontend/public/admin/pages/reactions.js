/* VinaX console — Song Reactions (schema 19). The five reactions people leave on
 * songs (fire, love, feels, dance, wow): how many, by whom (count only — never
 * who), which songs get the most, each reaction's share and a per-day series.
 * Follows the date range in the top bar. Route: GET /api/admin/reactions?days=. */
(function () {
  'use strict';
  var VX = window.VX, h = VX.h, ui = VX.ui, fmt = VX.fmt, arr = VX.arr, obj = VX.obj, num = VX.num;
  var EMOJI = { fire: ['🔥', 'Fire'], love: ['❤️', 'Love'], sad: ['😢', 'Feels'], dance: ['🕺', 'Dance'], wow: ['🤩', 'Wow'] };
  var ORDER = ['fire', 'love', 'sad', 'dance', 'wow'];
  function name(k) { return EMOJI[k] ? EMOJI[k][0] + ' ' + EMOJI[k][1] : fmt.label(k); }
  function rangeText(ctx) { return ctx.range.days === 1 ? 'today' : ctx.range.key === 'custom' ? 'in ' + ctx.range.label : 'in the ' + ctx.range.label.toLowerCase(); }

  function render(host, ctx) {
    return ui.load(host, function () { return VX.api.get('/api/admin/reactions', { days: ctx.range.days, limit: 50 }); }, function (d) {
      var gate = ui.gate(d, ctx);
      if (gate) return gate;
      var by = arr(d.byEmoji), top = arr(d.top), byDay = arr(d.byDay);
      var topEmoji = by[0] ? name(by[0].emoji) : '—';
      var stats = ui.stats([
        { label: 'Reactions', value: fmt.num(d.total), delta: VX.change(d.total, d.prevTotal), deltaLabel: 'vs before', info: 'Reactions left on songs ' + rangeText(ctx) + '. One device can leave one reaction per song; changing it does not count twice.' },
        { label: 'People reacting', value: fmt.num(d.people), info: 'Devices that left at least one reaction ' + rangeText(ctx) + '. Who they are is never kept beyond the device id the usage reports use.' },
        { label: 'Songs reacted to', value: fmt.num(d.songs), info: 'Different songs with at least one reaction ' + rangeText(ctx) + '.' },
        { label: 'Most used', value: topEmoji, sub: by[0] ? fmt.num(by[0].n) + ' times' : null, info: 'The reaction people chose most ' + rangeText(ctx) + '.' }
      ]);
      var share = ui.card({ title: 'Which reactions', sub: 'Share of all reactions ' + rangeText(ctx) + '.', body: ui.share(by.map(function (x) { return { label: name(x.emoji), value: num(x.n) }; }), { empty: 'No reactions ' + rangeText(ctx) }) });
      var chart = ui.card({ title: 'Reactions each day', sub: 'Days in India time.', body: ui.chart({ labels: byDay.map(function (r) { return r.day; }), type: 'bar', height: 180, title: 'Reactions per day', series: [{ name: 'Reactions', values: byDay.map(function (r) { return num(r.n); }), color: 'var(--c6)' }], empty: 'No reactions ' + rangeText(ctx) }) });
      var columns = [
        { key: 'title', label: 'Song', always: true, primary: true, sortVal: function (r) { return r.title || ''; }, render: function (r) { return ui.media(r.image, r.title || r.id, r.artist || null); }, csv: function (r) { return r.title; } },
        { key: 'total', label: 'Reactions', align: 'right', render: function (r) { return fmt.num(r.total); } }
      ].concat(ORDER.map(function (k) {
        return { key: k, label: EMOJI[k][0], title: EMOJI[k][1], align: 'right', sortVal: function (r) { return num(obj(r.counts)[k]); }, render: function (r) { var n = num(obj(r.counts)[k]); return n ? fmt.num(n) : h('span.muted', '·'); }, csv: function (r) { return num(obj(r.counts)[k]); } };
      })).concat([
        { key: 'language', label: 'Language', render: function (r) { return r.language ? fmt.label(r.language) : h('span.muted', '—'); } }
      ]);
      var table = ui.card({ title: 'Songs people react to', sub: 'The songs with the most reactions ' + rangeText(ctx) + ', and which ones.', pad: false, body: ui.dataTable({
        columns: columns, rows: top, rowId: function (r) { return r.id; }, sortKey: 'total', exportName: 'vinax-song-reactions', pageSize: 25, search: 'Search songs…',
        rowMenu: function (r) { return [{ label: 'Open in the app', icon: 'external', onClick: function () { window.open('/song/' + encodeURIComponent(r.id), '_blank', 'noopener'); } }]; },
        empty: { title: 'No reactions ' + rangeText(ctx), hint: 'Reactions appear once people tap one under a song on its page or in Now Playing.' }
      }) });
      return [stats, h('div.grid.cols-2', share, chart), table];
    }, { skeleton: 5 });
  }

  VX.page({
    id: 'song-reactions', title: 'Song Reactions', group: 'Music Stats', icon: 'spark', order: 6, range: true,
    desc: 'The reactions people leave on songs — how many, which ones, and the songs that get them.',
    keywords: 'reactions emoji fire love feels dance wow songs',
    render: render
  });
})();
