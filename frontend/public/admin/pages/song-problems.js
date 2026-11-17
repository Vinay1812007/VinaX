/* Songs With Problems — the songs that most often fail to play, and the
 * songs most often opened with no lyrics. Each row has a one-click Block
 * (the blocklist, /api/admin/content) and Find Music. Follows the date range
 * in the top bar. Every device counts, like App Errors.
 * Route: GET /api/admin/analytics?view=problems&days= (stats_song_problems, schema 24).
 * Uses VX.music from song-stats.js (block, song menu). */
(function () {
  'use strict';
  var VX = window.VX, h = VX.h, ui = VX.ui, fmt = VX.fmt, arr = VX.arr, obj = VX.obj, num = VX.num;

  function rangeText(ctx) { return ctx.range.days === 1 ? 'today' : ctx.range.key === 'custom' ? 'in ' + ctx.range.label : 'in the ' + String(ctx.range.label || '').toLowerCase(); }
  function label(r) { return [r.title, r.artist].filter(Boolean).join(' — ') || String(r.id || ''); }

  /** The card shown while the database is older than schema 24. */
  function updateNeeded(ctx) {
    return ui.card({ title: 'One-time database update needed', tone: 'warn', body: [
      h('p', 'This page needs numbers the database can give only after its one-time update. Every other page keeps working.'),
      VX.can('owner')
        ? h('div.toolbar', ui.button('How to update', { kind: 'primary', small: true, icon: 'database', onClick: function () { ctx.go('db-maintenance'); } }))
        : h('p.muted.small', 'Ask an Owner to run it from Database › Maintenance.')
    ] });
  }

  /** Block (or "Blocked") and Find Music for one song. */
  function actions(r, ctx) {
    var blocked = r.blocked === true;
    return h('div.toolbar',
      blocked ? ui.pill('Blocked') : ui.button('Block', {
        kind: 'danger', small: true, icon: 'lock', disabled: !r.id || !VX.can('edit'), ariaLabel: 'Block ' + label(r),
        onClick: function () { return VX.music.block('song', String(r.id), label(r)).then(function (row) { if (row) ctx.refresh(); }); }
      }),
      ui.button('Find Music', {
        kind: 'ghost', small: true, icon: 'search', ariaLabel: 'Look up ' + label(r) + ' in Find Music',
        onClick: function () { ctx.go('find-music', null, { q: [r.title, r.artist].filter(Boolean).join(' ') || String(r.id || '') }); }
      }));
  }
  function songCell(r) { return ui.media(r.image, r.title || 'Untitled', r.artist || null); }

  function render(host, ctx) {
    return ui.load(host, function () {
      return VX.api.get('/api/admin/analytics', { view: 'problems', days: ctx.range.days }).then(function (res) {
        return !res.ok && res.error === 'db_update_needed' ? { ok: true, status: res.status, data: { updateNeeded: true } } : res;
      });
    }, function (d) {
      if (d && d.updateNeeded) return updateNeeded(ctx);
      var gate = ui.gate(d, ctx);
      if (gate) return gate;
      var data = obj(d.data);
      var playback = arr(data.playback), lyrics = arr(data.lyrics);
      return [
        ui.readOnlyNote(),
        ui.stats([
          { label: 'Songs that failed to play', value: fmt.num(data.songsFailing), sub: num(data.playbackErrors) ? fmt.plural(data.playbackErrors, 'report') : null, info: 'Different songs the app reported a playback problem for ' + rangeText(ctx) + '. One report is sent each time a song’s audio would not load or broke off.' },
          { label: 'Did not play at all', value: fmt.num(data.failedPlays), info: 'Times the app tried every source of a song ' + rangeText(ctx) + ' and none of them played.' },
          { label: 'Songs with no lyrics', value: fmt.num(data.songsNoLyrics), sub: num(data.lyricMisses) ? fmt.plural(data.lyricMisses, 'time') + ' opened' : null, info: 'Different songs where someone opened the lyrics ' + rangeText(ctx) + ' and no source had any.' },
          { label: 'Already blocked', value: fmt.num(playback.concat(lyrics).filter(function (r, i, all) { return r.blocked === true && all.findIndex(function (x) { return x.id === r.id; }) === i; }).length), info: 'Songs in these lists that are on the blocklist already, so the app no longer shows them.' }
        ]),
        ui.card({ title: 'Songs that fail to play', sub: 'Most failures first ' + rangeText(ctx) + '. “Did not play” means no source worked; “Reports” also counts a retry that then worked.', pad: false, body: ui.dataTable({
          columns: [
            { key: 'title', label: 'Song', always: true, render: songCell },
            { key: 'artist', label: 'Artist', hidden: true },
            { key: 'failed', label: 'Did not play', align: 'right', render: function (r) { return fmt.num(r.failed); } },
            { key: 'errors', label: 'Reports', align: 'right', render: function (r) { return fmt.num(r.errors); } },
            { key: 'people', label: 'People', align: 'right', render: function (r) { return fmt.num(r.people); } },
            { key: 'lastSeen', label: 'Last', render: function (r) { return ui.ago(r.lastSeen); } },
            { key: 'actions', label: '', sort: false, render: function (r) { return actions(r, ctx); } }
          ],
          rows: playback, rowId: function (r) { return String(r.id); }, sortKey: 'failed', exportName: 'vinax-songs-failing', search: playback.length > 10 ? 'Search songs or artists…' : false,
          rowMenu: function (r) { return VX.music.songMenu(r, ctx); },
          empty: { title: 'No playback problems ' + rangeText(ctx), hint: 'A song shows here when the app could not play it. Apps from before this update report problems without the song.' }
        }) }),
        ui.card({ title: 'Songs with no lyrics', sub: 'Songs people opened the lyrics for ' + rangeText(ctx) + ' where no source had any, most often first.', pad: false, body: ui.dataTable({
          columns: [
            { key: 'title', label: 'Song', always: true, render: songCell },
            { key: 'artist', label: 'Artist', hidden: true },
            { key: 'misses', label: 'Times', align: 'right', render: function (r) { return fmt.num(r.misses); } },
            { key: 'people', label: 'People', align: 'right', render: function (r) { return fmt.num(r.people); } },
            { key: 'lastSeen', label: 'Last', render: function (r) { return ui.ago(r.lastSeen); } },
            { key: 'actions', label: '', sort: false, render: function (r) { return actions(r, ctx); } }
          ],
          rows: lyrics, rowId: function (r) { return String(r.id); }, sortKey: 'misses', exportName: 'vinax-songs-no-lyrics', search: lyrics.length > 10 ? 'Search songs or artists…' : false,
          rowMenu: function (r) { return VX.music.songMenu(r, ctx); },
          empty: { title: 'No missing lyrics ' + rangeText(ctx), hint: 'A song shows here when someone opens its lyrics and none are found.' }
        }) })
      ];
    });
  }

  VX.page({
    id: 'song-problems', title: 'Songs With Problems', group: 'Music', icon: 'wrench', order: 7, range: true,
    desc: 'Songs that often fail to play or have no lyrics, with a one-click Block.',
    keywords: 'problems broken errors fails not playing lyrics missing no lyrics block',
    render: render
  });
})();
