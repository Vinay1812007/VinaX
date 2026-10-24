/* VinaX console — Live page.
 * GET /api/admin/live: who is listening right now (polled every 15 s), the
 * latest activity, and the Listen Together rooms (end one, or all). */
(function () {
  'use strict';
  var VX = window.VX, h = VX.h, ui = VX.ui, fmt = VX.fmt, arr = VX.arr, obj = VX.obj;

  VX.page({
    id: 'live', title: 'Live', group: 'System', icon: 'live',
    desc: 'What is happening right now: who is listening, the latest activity, and the rooms.',
    tabs: [
      { id: 'now', label: 'Now listening', desc: 'Listeners active in the last few minutes, refreshed every 15 seconds.', render: renderNow },
      { id: 'activity', label: 'Activity', desc: 'The newest usage events as they arrive.', render: renderActivity },
      { id: 'rooms', label: 'Listen Together', desc: 'Rooms that are open now. Ending a room disconnects its guests.', render: renderRooms }
    ]
  });

  function songCell(s) {
    s = obj(s);
    return s.title ? ui.media(s.image, s.title, s.artist) : h('span.muted', 'Nothing playing');
  }
  function who(r) { return r.name || r.handle || (r.id ? fmt.trunc(r.id, 14) : 'Listener'); }

  function renderNow(host, ctx) {
    var body = h('div');
    host.appendChild(body);
    function load(quiet) {
      return ui.load(body, function () { return VX.api.get('/api/admin/live', null, { fresh: true }); }, function (d) {
        var gate = ui.gate(d, ctx);
        if (gate) return gate;
        var rows = arr(d.listening);
        var playing = rows.filter(function (r) { return r.isPlaying; }).length;
        return [
          ui.kpis([
            { label: 'Active now', value: fmt.num(rows.length), tone: rows.length ? 'ok' : null },
            { label: 'Playing', value: fmt.num(playing) },
            { label: 'Rooms open', value: fmt.num(arr(d.rooms).length) },
            { label: 'Server time', value: d.now ? fmt.time(d.now) : '—' }
          ]),
          ui.card({ title: 'Listening now', pad: false, body: ui.table({
            columns: [
              { key: 'name', label: 'Listener', sortVal: who, render: function (r) { return ui.media(null, who(r), r.handle ? '@' + r.handle : null, true); } },
              { key: 'song', label: 'Playing', sort: false, render: function (r) { return songCell(r.song); } },
              { key: 'isPlaying', label: 'State', sortVal: function (r) { return r.isPlaying ? 1 : 0; }, render: function (r) { return r.isPlaying ? ui.pill('Playing', 'ok') : ui.pill('Paused'); } },
              { key: 'platform', label: 'Platform' },
              { key: 'country', label: 'Place', render: function (r) { return [r.city, fmt.country(r.country)].filter(Boolean).join(', ') || null; } },
              { key: 'lastSeen', label: 'Seen', render: function (r) { return ui.ago(r.lastSeen); } }
            ],
            rows: rows, exportName: 'vinax-live', search: rows.length > 8, pageSize: 50,
            empty: 'Nobody is listening right now', emptyHint: 'Listeners with usage sharing on (the default since 14.0.3) appear here within a minute of pressing play; the ones who switched it off never do.',
            onRow: function (r) { if (r.id) ctx.go('listeners', null, { id: r.id }); }
          }) })
        ];
      }, { quiet: quiet, skeleton: 4 });
    }
    ctx.every(15000, function () { load(true); });
    return load(false);
  }

  function renderActivity(host, ctx) {
    return ui.load(host, function () { return VX.api.get('/api/admin/live', null, { fresh: true }); }, function (d) {
      var gate = ui.gate(d, ctx);
      if (gate) return gate;
      var feed = arr(d.feed);
      if (!feed.length) return ui.empty('No activity yet', 'Events arrive once listeners with usage sharing on start using the app.');
      return ui.card({ title: 'Latest events', sub: fmt.plural(feed.length, 'event'), body: h('ul.list.feed', feed.map(function (e) {
        var l = obj(e.listener), s = obj(e.song);
        return h('li',
          h('span.feed-time', e.at ? fmt.time(e.at) : '—'),
          h('span.feed-kind', ui.pill(e.kind || 'event', e.kind === 'error' ? 'bad' : e.kind === 'play' ? 'ok' : null)),
          h('div.grow',
            h('div.cell-main', s.title ? s.title + (s.artist ? ' · ' + s.artist : '') : e.message ? fmt.trunc(e.message, 120) : (e.kind || '')),
            h('div.cell-sub', [l.name || (l.id ? fmt.trunc(l.id, 12) : null), e.platform, fmt.country(e.country) !== '—' ? fmt.country(e.country) : null].filter(Boolean).join(' · '))));
      })) });
    }, { skeleton: 6 });
  }

  function renderRooms(host, ctx) {
    var body = h('div');
    host.appendChild(body);
    function load() {
      return ui.load(body, function () { return VX.api.get('/api/admin/live', null, { fresh: true }); }, function (d) {
        var gate = ui.gate(d, ctx);
        if (gate) return gate;
        var rooms = arr(d.rooms);
        function endRoom(r) {
          return VX.confirm({ title: 'End room ' + r.code + '?', body: 'Everyone in the room is disconnected and the host has to start a new one.', confirmLabel: 'End room', danger: true }).then(function (yes) {
            if (!yes) return;
            return VX.api.post('/api/admin/live', { action: 'end_room', code: r.code }).then(function (res) {
              VX.toast(res.ok ? 'Room ended' : res.message, res.ok ? 'ok' : 'bad');
              return load();
            });
          });
        }
        function endAll() {
          return VX.confirm({ title: 'End every room?', body: fmt.plural(rooms.length, 'room') + ' will close and every guest is disconnected.', confirmLabel: 'End all', danger: true, typed: 'END' }).then(function (yes) {
            if (!yes) return;
            return VX.api.post('/api/admin/live', { action: 'end_all_rooms' }).then(function (res) {
              VX.toast(res.ok ? fmt.plural(obj(res.data).ended, 'room') + ' ended' : res.message, res.ok ? 'ok' : 'bad');
              return load();
            });
          });
        }
        return ui.card({ title: 'Open rooms', sub: fmt.plural(rooms.length, 'room'), pad: false,
          actions: rooms.length ? [ui.button('End all rooms', { kind: 'danger', small: true, icon: 'trash', onClick: endAll })] : null,
          body: ui.table({
            columns: [
              { key: 'code', label: 'Code', render: function (r) { return ui.mono(r.code); } },
              { key: 'hostName', label: 'Host' },
              { key: 'members', label: 'Members', align: 'right', render: function (r) { return fmt.num(r.members); } },
              { key: 'song', label: 'Playing', sort: false, render: function (r) { return songCell(r.song); } },
              { key: 'playing', label: 'State', render: function (r) { return r.playing ? ui.pill('Playing', 'ok') : ui.pill('Paused'); } },
              { key: 'createdAt', label: 'Started', render: function (r) { return ui.ago(r.createdAt); } },
              { key: 'updatedAt', label: 'Updated', render: function (r) { return ui.ago(r.updatedAt); } },
              { key: 'act', label: '', sort: false, render: function (r) { return ui.button('End', { kind: 'ghost', small: true, icon: 'close', ariaLabel: 'End room ' + r.code, onClick: function () { return endRoom(r); } }); } }
            ],
            rows: rooms, exportName: false, search: false,
            empty: 'No rooms open', emptyHint: 'Rooms appear while a host has Listen Together running.'
          }) });
      }, { skeleton: 4 });
    }
    return load();
  }
})();
