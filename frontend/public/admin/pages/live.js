/* VinaX console — Listening Now, Recent Activity and Listen Together Rooms
 * (one page each, sharing the live cards and refresh).
 * GET /api/admin/live (refreshes on its own, every 15 s by default):
 * signed-in people listening now with their song, the newest activity, and
 * the Listen Together rooms. Ending rooms needs the Editor role. */
(function () {
  'use strict';
  var VX = window.VX, h = VX.h, ui = VX.ui, fmt = VX.fmt, arr = VX.arr, obj = VX.obj, num = VX.num;
  var MS_KEY = 'vinax_admin_live_ms';
  var INTERVALS = [{ value: '15000', label: 'Every 15 s' }, { value: '30000', label: 'Every 30 s' }, { value: '60000', label: 'Every minute' }, { value: '0', label: 'Do not refresh' }];

  var KIND = {
    play: 'Played a song', heartbeat: 'Listening', complete: 'Finished a song', skip: 'Skipped a song', pause: 'Paused',
    favorite: 'Liked a song', search: 'Searched', share: 'Shared a song', open: 'Opened the app', presence: 'Had the app open', register: 'Chose a name',
    error: 'Hit a problem', 'lyric-miss': 'Lyrics not found', rec_served: 'Got suggestions', rec_outcome: 'Used a suggestion'
  };
  VX.kindText = function (k) { return KIND[k] || fmt.label(k || 'activity'); };

  VX.page({
    id: 'listening-now', title: 'Listening Now', group: 'Overview', icon: 'live', order: 2, noAuto: true,
    desc: 'Who has the app open right now and what they are playing. Signed-in users only.',
    keywords: 'live realtime now playing active',
    render: function (host, ctx) { return frame(host, ctx, now); }
  });
  VX.page({
    id: 'recent-activity', title: 'Recent Activity', group: 'Overview', icon: 'inbox', order: 3, noAuto: true,
    desc: 'The latest things people did in the app: songs played, sign-ins and more.',
    keywords: 'live activity feed latest plays events',
    render: function (host, ctx) { return frame(host, ctx, activity); }
  });
  VX.page({
    id: 'listen-together', title: 'Listen Together Rooms', group: 'Overview', icon: 'users', order: 4, noAuto: true,
    desc: 'Rooms where friends are listening to the same song at the same time.',
    keywords: 'live rooms listen together party friends',
    render: function (host, ctx) { return frame(host, ctx, rooms); }
  });

  function intervalMs() { var v = '15000'; try { v = localStorage.getItem(MS_KEY) || '15000'; } catch (e) {} return INTERVALS.some(function (i) { return i.value === v; }) ? v : '15000'; }

  /** Cards + refresh dropdown, then the tab's own panel; polls quietly. */
  function frame(host, ctx, panel) {
    var top = h('div');
    var body = h('div');
    var bar = h('div.toolbar.live-bar',
      h('span.live-dot', ui.dot('live'), h('span', 'Live')),
      h('span.grow'),
      ui.dropdown('Refresh', INTERVALS, intervalMs(), function (v) { try { localStorage.setItem(MS_KEY, v); } catch (e) {} ctx.refresh(); }, { inline: true }));
    VX.mount(host, bar, top, body);
    var first = true;
    function load() {
      return ui.load(body, function () { return VX.api.get('/api/admin/live', null, { fresh: true }); }, function (d) {
        var gate = ui.gate(d, ctx);
        if (gate) { VX.clear(top); return gate; }
        var c = obj(d.counts);
        var cards = ui.stats([
          { label: 'Active now', value: fmt.num(c.activeNow), tone: num(c.activeNow) ? 'ok' : null, info: 'Signed-in people with the app open in the last 5 minutes.', onClick: function () { ctx.go('listening-now'); } },
          { label: 'Playing now', value: fmt.num(c.playingNow), info: 'Of those, how many have a song playing at this moment.', onClick: function () { ctx.go('listening-now'); } },
          { label: 'Rooms open', value: fmt.num(c.roomsOpen), info: 'Listen Together rooms with activity in the last 15 minutes.', onClick: function () { ctx.go('listen-together'); } },
          { label: 'Server time', value: fmt.time(d.now), sub: VX.tzShort(), info: 'The time on the server when these numbers were read, in your time zone.' }
        ]);
        first = false;
        VX.mount(top, cards);
        ctx.stamp();
        return panel(d, ctx);
      }, { quiet: !first, skeleton: 6 });
    }
    var ms = Number(intervalMs());
    if (ms) ctx.every(ms, load);
    return load();
  }

  function userMenu(u, ctx) {
    return [
      { label: 'View profile', icon: 'user', onClick: function () { ctx.go('user', null, { id: u.id }); } },
      { label: 'Send notification', icon: 'send', hidden: !VX.can('edit'), onClick: function () { ctx.go('send-notification', null, { users: u.id }); } },
      { label: 'Copy email', icon: 'copy', hidden: !u.email, onClick: function () { VX.copy(u.email, 'Email copied'); } }
    ];
  }
  function person(u) { u = obj(u); return ui.media(u.picture, u.name || u.email || 'Someone', u.name ? u.email : null, true); }
  function songCell(s) { s = obj(s); return s.title ? ui.media(s.image, s.title, s.artist) : h('span.muted', 'Nothing playing'); }
  function place(r) { return [r.city, fmt.country(r.country)].filter(function (x) { return x && x !== '—'; }).join(', ') || null; }

  function now(d, ctx) {
    var rows = arr(d.listening);
    var points = rows.map(function (r) { return { country: r.country, city: r.city, count: 1, playing: r.isPlaying && r.song ? 1 : 0 }; });
    return [mapCard(points), ui.card({ title: 'Listening now', sub: fmt.plural(rows.length, 'person', 'people') + ' in the last 5 minutes', pad: false, body: ui.dataTable({
      rowId: function (r) { return r.key; },
      columns: [
        { key: 'user', label: 'User', always: true, sortVal: function (r) { return obj(r.user).name || obj(r.user).email; }, render: function (r) { return person(r.user); } },
        { key: 'song', label: 'Song & artist', sortVal: function (r) { return obj(r.song).title; }, render: function (r) { return songCell(r.song); } },
        { key: 'isPlaying', label: 'Status', sortVal: function (r) { return r.isPlaying ? 1 : 0; }, render: function (r) { return r.song ? ui.pill(r.isPlaying ? 'Playing' : 'Paused', r.isPlaying ? 'ok' : null) : ui.pill('Browsing'); } },
        { key: 'platform', label: 'Platform', sortVal: function (r) { return r.platform; }, render: function (r) { return VX.platformName(r.platform); } },
        { key: 'city', label: 'City', sortVal: place, render: place },
        { key: 'lastSeen', label: 'Last seen', render: function (r) { return ui.ago(r.lastSeen); } }
      ],
      rows: rows, exportName: 'vinax-listening-now', search: 'Search people or songs…', sortKey: 'lastSeen',
      rowMenu: function (r) { return userMenu(obj(r.user), ctx); },
      onRow: function (r) { ctx.go('user', null, { id: obj(r.user).id }); },
      empty: { title: 'Nobody is listening right now', hint: 'Signed-in people show up here the moment they open the app.', action: { label: 'See all users', icon: 'users', onClick: function () { ctx.go('users'); } } }
    }) })];
  }

  /** "Where people are listening": glowing dots on a world map (geo.js). */
  function mapCard(points) {
    var places = {};
    points.forEach(function (p) { if (p.country) places[p.country] = 1; });
    var n = Object.keys(places).length;
    return ui.card({ title: 'Where people are listening', sub: n ? fmt.plural(n, 'country', 'countries') + ' right now · green means a song is playing' : 'Nobody is listening right now',
      body: VX.worldMap(points) });
  }
  VX.liveMapCard = mapCard;

  function activity(d, ctx) {
    var rows = arr(d.feed);
    return ui.card({ title: 'Recent activity', sub: 'The newest things signed-in people did in the app', pad: false, body: ui.dataTable({
      columns: [
        { key: 'at', label: 'When', nowrap: true, render: function (r) { return ui.ago(r.at); } },
        { key: 'user', label: 'User', sortVal: function (r) { return obj(r.user).name; }, render: function (r) { return person(r.user); } },
        { key: 'kind', label: 'What they did', sortVal: function (r) { return VX.kindText(r.kind); }, render: function (r) { return ui.pill(VX.kindText(r.kind), r.kind === 'error' ? 'bad' : r.kind === 'favorite' ? 'accent' : null); } },
        { key: 'song', label: 'Song or detail', sortVal: function (r) { return obj(r.song).title || r.message; }, render: function (r) { return r.song ? songCell(r.song) : r.message ? h('span', fmt.trunc(r.message, 80)) : null; } },
        { key: 'platform', label: 'Platform', render: function (r) { return VX.platformName(r.platform); } },
        { key: 'city', label: 'City' }
      ],
      rows: rows, exportName: 'vinax-recent-activity', search: 'Search activity…', sortKey: 'at',
      rowMenu: function (r) { return userMenu(obj(r.user), ctx); },
      empty: { title: 'No activity yet', hint: 'What signed-in people do in the app appears here as it happens.' }
    }) });
  }

  function rooms(d, ctx) {
    var rows = arr(d.rooms);
    var canEdit = VX.can('edit');
    function end(code) {
      return VX.confirm({ title: 'End room ' + code + '?', body: 'Everyone in this room stops listening together. Their music keeps playing on their own phones.', danger: true, confirmLabel: 'End room' }).then(function (ok) {
        if (!ok) return;
        return VX.api.post('/api/admin/live', { action: 'end_room', code: code }).then(function (res) { VX.toast(res.ok ? 'Room ended ✓' : 'Something went wrong — ' + res.message, res.ok ? 'ok' : 'bad'); if (res.ok) ctx.refresh(); });
      });
    }
    function endAll() {
      return VX.confirm({ title: 'End every room?', body: 'All ' + fmt.plural(rows.length, 'room') + ' close at once. Type CONFIRM to go ahead.', typed: true, danger: true, confirmLabel: 'End all rooms' }).then(function (ok) {
        if (!ok) return;
        return VX.api.post('/api/admin/live', { action: 'end_all_rooms' }).then(function (res) { VX.toast(res.ok ? 'Ended ' + fmt.plural(obj(res.data).ended, 'room') + ' ✓' : 'Something went wrong — ' + res.message, res.ok ? 'ok' : 'bad'); if (res.ok) ctx.refresh(); });
      });
    }
    return ui.card({ title: 'Listen Together rooms', sub: 'Rooms with activity in the last 6 hours', pad: false,
      actions: rows.length && canEdit ? [ui.button('End all rooms', { kind: 'ghost', small: true, icon: 'close', onClick: endAll })] : null,
      body: ui.dataTable({
        rowId: function (r) { return r.code; },
        columns: [
          { key: 'code', label: 'Room', render: function (r) { return h('strong', r.code); } },
          { key: 'hostName', label: 'Started by' },
          { key: 'members', label: 'People in it', align: 'right', render: function (r) { return fmt.num(r.members); } },
          { key: 'song', label: 'Playing', sortVal: function (r) { return obj(r.song).title; }, render: function (r) { return songCell(r.song); } },
          { key: 'playing', label: 'Status', render: function (r) { return ui.pill(r.playing ? 'Playing' : 'Paused', r.playing ? 'ok' : null); } },
          { key: 'createdAt', label: 'Opened', render: function (r) { return ui.ago(r.createdAt); } },
          { key: 'updatedAt', label: 'Last activity', render: function (r) { return ui.ago(r.updatedAt); } }
        ],
        rows: rows, exportName: 'vinax-rooms', search: false, sortKey: 'updatedAt',
        rowMenu: function (r) { return [{ label: 'End this room', icon: 'close', danger: true, disabled: !canEdit, title: canEdit ? null : 'Editors and owners only', onClick: function () { end(r.code); } }]; },
        empty: { title: 'No rooms are open', hint: 'When friends start Listen Together in the app, their room shows up here.' }
      }) });
  }
})();
