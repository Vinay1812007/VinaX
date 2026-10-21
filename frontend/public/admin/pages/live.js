/* VinaX console — Live page.
 * What is happening right now, in four tabs that each poll their own data:
 *   Now listening   /api/admin/live      devices seen in the last 2 minutes and their song (every 10 s)
 *   Activity feed   /api/admin/activity  the 80 newest listener events, filterable (every 15 s)
 *   Listen Together /api/admin/rooms     active rooms; end one or close all (POST /api/admin/maintenance)
 *   Pulse           /api/admin/realtime  last-minute / 5-minute counters, AI latency, recent errors, live cities (every 10 s)
 * Rows open the listener drawer from the Listeners page (VX.openListener) when it is loaded. */
(function () {
  'use strict';
  var VX = window.VX, h = VX.h, ui = VX.ui, fmt = VX.fmt;

  VX.page({
    id: 'live', title: 'Live', group: 'Dashboards', icon: 'live',
    desc: 'Who is listening right now, the latest activity, Listen Together rooms and the live pulse.',
    // Every tab polls its own panel; a whole-page re-render would reset filters and paging.
    noAuto: true,
    tabs: [
      { id: 'now', label: 'Now listening', desc: 'Devices that checked in during the last 2 minutes. Refreshes every 10 seconds.', render: renderNow },
      { id: 'activity', label: 'Activity feed', desc: 'The 80 newest listener events. Refreshes every 15 seconds.', render: renderActivity },
      { id: 'rooms', label: 'Listen Together', desc: 'Rooms active in the last 2 hours. End a room to disconnect everyone in it.', render: renderRooms },
      { id: 'pulse', label: 'Pulse', desc: 'Last-minute and 5-minute counters, AI reply speed, recent errors and live cities. Refreshes every 10 seconds.', render: renderPulse }
    ]
  });

  /* ------------------------------------------------------------ helpers */

  var TYPE_LABEL = {
    play: 'Play', complete: 'Finished', skip: 'Skip', search: 'Search', favorite: 'Like', download: 'Download',
    share: 'Share', error: 'Error', open: 'Open', register: 'Name set', heartbeat: 'Heartbeat', playlist: 'Playlist'
  };
  var TYPE_TONE = { play: 'accent', complete: 'ok', favorite: 'ok', download: 'info', share: 'info', search: null, skip: 'warn', error: 'bad' };
  function typeLabel(t) { return TYPE_LABEL[t] || (t ? String(t).charAt(0).toUpperCase() + String(t).slice(1).replace(/[-_]/g, ' ') : 'Event'); }
  function typePill(t) { return ui.pill(typeLabel(t), TYPE_TONE[t] || null); }

  function place(city, country) {
    var c = country && country !== '??' && country !== 'XX' ? fmt.country(country) : '';
    var parts = [city && city !== 'Unknown' ? city : '', c].filter(Boolean);
    return parts.length ? parts.join(', ') : null;
  }
  function platformLabel(p) {
    var v = String(p || '').toLowerCase();
    if (!v) return 'Web';
    if (v === 'android') return 'Android';
    if (v === 'ios') return 'iOS';
    if (v === 'web' || v === 'pwa') return v === 'pwa' ? 'Installed web app' : 'Web';
    return v.charAt(0).toUpperCase() + v.slice(1);
  }
  function songLine(title, artist) { return title ? (artist ? title + ' — ' + artist : title) : null; }
  function shortId(id) { var s = String(id || ''); return s.length > 12 ? s.slice(0, 6) + '…' + s.slice(-4) : s || '—'; }

  /** Open the listener drawer (owned by the Listeners page), or jump there. */
  function openListener(ctx, deviceId, name) {
    if (!deviceId) return;
    if (typeof VX.openListener === 'function') VX.openListener(deviceId, name);
    else ctx.go('listeners', 'all', { open: deviceId });
  }

  function notConnected() {
    return ui.empty('Database not connected', 'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the Worker to see live data.');
  }

  /** Mount a "last updated" line that can be bumped after each poll. */
  function stampLine() {
    var el = h('span.muted.small');
    el.bump = function () { el.textContent = 'Updated ' + new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }); };
    return el;
  }

  /* ------------------------------------------------------ Now listening */

  function renderNow(host, ctx) {
    var top = h('div.page-body');
    var listHost = h('div');
    var stamp = stampLine();
    var table = null;
    host.appendChild(h('div.page-body', top, listHost));

    function draw(d) {
      if (d.configured === false) { table = null; VX.mount(top, notConnected()); VX.clear(listHost); return; }
      var listeners = d.listeners || [];
      var byCountry = d.byCountry || {};
      var countries = Object.keys(byCountry).map(function (k) { return { label: k === '??' ? 'Unknown' : fmt.country(k), value: byCountry[k] }; })
        .sort(function (a, b) { return b.value - a.value; });
      var songs = {};
      listeners.forEach(function (l) {
        if (!l.playing || !l.song) return;
        var k = l.song + '|' + (l.artist || '');
        songs[k] = songs[k] || { label: l.song, sub: l.artist || null, value: 0 };
        songs[k].value += 1;
      });
      var songList = Object.keys(songs).map(function (k) { return songs[k]; }).sort(function (a, b) { return b.value - a.value; });
      var platforms = {};
      listeners.forEach(function (l) { var p = platformLabel(l.platform); platforms[p] = (platforms[p] || 0) + 1; });

      VX.mount(top,
        ui.kpis([
          { label: 'Active now', value: fmt.num(d.count), sub: 'checked in · 2 min', tone: Number(d.count) > 0 ? 'ok' : null },
          { label: 'Playing a song', value: fmt.num(d.playing), sub: Number(d.count) ? fmt.ratio(Number(d.playing) / Number(d.count)) + ' of active' : 'nobody active' },
          { label: 'Countries', value: fmt.num(countries.length) },
          { label: 'Different songs', value: fmt.num(songList.length), sub: 'playing right now' }
        ]),
        ui.grid([
          ui.card({ title: 'Playing right now', sub: 'Songs on active devices, most listeners first', body: ui.hbars(songList, { empty: 'Nothing playing right now', emptyHint: 'Songs appear here while listeners play them.' }) }),
          ui.card({ title: 'Where they are', sub: 'Active devices by country', body: ui.share(countries, { empty: 'No active listeners' }) }),
          ui.card({ title: 'Platforms', sub: 'Active devices', body: ui.share(Object.keys(platforms).map(function (k) { return { label: k, value: platforms[k] }; }), { empty: 'No active listeners' }) })
        ])
      );

      var rows = listeners.map(function (l) {
        return {
          deviceId: l.deviceId, name: l.name || 'Anonymous', image: l.image, song: l.song, artist: l.artist,
          place: place(l.city, l.country), platform: platformLabel(l.platform), playing: !!l.playing, lastSeen: l.lastSeen
        };
      });
      if (table) { table.update(rows); stamp.bump(); return; }
      table = ui.table({
        columns: [
          { key: 'name', label: 'Listener', render: function (r) { return h('div', h('div.cell-main', r.name), h('div.cell-sub', shortId(r.deviceId))); } },
          { key: 'song', label: 'Song', sortVal: function (r) { return songLine(r.song, r.artist); }, render: function (r) { return r.song ? ui.media(r.image, r.song, r.artist) : h('span.muted', 'Browsing'); } },
          { key: 'playing', label: 'State', sortVal: function (r) { return r.playing ? 'Playing' : 'Paused'; }, render: function (r) { return r.playing ? ui.pill('Playing', 'ok') : ui.pill('Paused'); } },
          { key: 'place', label: 'Place' },
          { key: 'platform', label: 'Platform', nowrap: true },
          { key: 'lastSeen', label: 'Last check-in', align: 'right', nowrap: true, render: function (r) { return fmt.ago(r.lastSeen); } }
        ],
        rows: rows, sortKey: 'lastSeen', sortDir: 'desc', exportName: 'vinax-live-listeners', pageSize: 25,
        empty: 'Nobody is listening right now',
        emptyHint: 'Listeners appear here within seconds of opening the app; they drop off 2 minutes after their last check-in.',
        onRow: function (r) { openListener(ctx, r.deviceId, r.name); }
      });
      VX.mount(listHost, ui.card({ title: 'Active listeners', sub: 'Click a listener for their profile', actions: [stamp], body: table, pad: false }));
      stamp.bump();
    }

    function poll(first) {
      return VX.api.get('/api/admin/live', null, { fresh: true }).then(function (res) {
        if (res.ok) { draw(res.data || {}); return res; }
        if (first || !table) { table = null; VX.clear(listHost); VX.mount(top, ui.error(res.message, function () { return poll(true); }, res.status ? 'HTTP ' + res.status + ' · ' + res.error : null)); }
        else stamp.textContent = 'Update failed: ' + res.message;
        return res;
      });
    }
    VX.mount(top, ui.skeleton(4));
    ctx.every(10000, function () { poll(false); });
    return poll(true);
  }

  /* ------------------------------------------------------ Activity feed */

  var FILTERS = [
    { value: 'all', label: 'All' }, { value: 'play', label: 'Plays' }, { value: 'search', label: 'Searches' },
    { value: 'favorite', label: 'Likes' }, { value: 'download', label: 'Downloads' }, { value: 'share', label: 'Shares' },
    { value: 'error', label: 'Errors' }, { value: 'other', label: 'Other' }
  ];
  var MAIN_TYPES = { play: 1, search: 1, favorite: 1, download: 1, share: 1, error: 1 };

  function renderActivity(host, ctx) {
    var filter = ctx.params.type || 'all';
    var events = [];
    var summary = h('div');
    var body = h('div');
    var stamp = stampLine();
    var table = null;
    host.appendChild(h('div.page-body', summary, body));

    function pick() {
      return events.filter(function (e) {
        if (filter === 'all') return true;
        if (filter === 'other') return !MAIN_TYPES[e.type];
        return e.type === filter;
      }).map(function (e) {
        return {
          created_at: e.created_at, type: e.type, song: songLine(e.song_title, e.song_artist), device_id: e.device_id,
          place: place(e.city, e.country), platform: e.platform ? platformLabel(e.platform) : null
        };
      });
    }

    function drawSummary() {
      var counts = {};
      events.forEach(function (e) { counts[e.type] = (counts[e.type] || 0) + 1; });
      var devices = {};
      events.forEach(function (e) { if (e.device_id) devices[e.device_id] = 1; });
      var oldest = events.length ? events[events.length - 1].created_at : null;
      VX.mount(summary, ui.kpis([
        { label: 'Events shown', value: fmt.num(events.length), sub: oldest ? 'since ' + fmt.ago(oldest) : 'none yet' },
        { label: 'Listeners', value: fmt.num(Object.keys(devices).length), sub: 'in these events' },
        { label: 'Plays', value: fmt.num(counts.play || 0) },
        { label: 'Searches', value: fmt.num(counts.search || 0) },
        { label: 'Errors', value: fmt.num(counts.error || 0), tone: counts.error ? 'bad' : null }
      ]));
    }

    function build() {
      var seg = ui.segmented(FILTERS, filter, function (v) { filter = v; ctx.setParam('type', v === 'all' ? '' : v); table.update(pick()); }, 'Event type');
      table = ui.table({
        columns: [
          { key: 'created_at', label: 'When', nowrap: true, render: function (r) { return h('span', { title: fmt.dateTime(r.created_at) }, fmt.ago(r.created_at)); } },
          { key: 'type', label: 'Event', sortVal: function (r) { return typeLabel(r.type); }, render: function (r) { return typePill(r.type); } },
          { key: 'song', label: 'Song / detail' },
          { key: 'device_id', label: 'Listener', render: function (r) { return r.device_id ? ui.mono(shortId(r.device_id)) : null; } },
          { key: 'place', label: 'Place' },
          { key: 'platform', label: 'Platform', nowrap: true }
        ],
        rows: pick(), sortKey: 'created_at', sortDir: 'desc', exportName: 'vinax-activity', pageSize: 20, toolbar: [seg],
        empty: 'No activity yet',
        emptyHint: 'Plays, searches, likes and errors appear here as listeners use the app.',
        onRow: function (r) { openListener(ctx, r.device_id); }
      });
      VX.mount(body, ui.card({ title: 'Latest events', sub: 'Newest first · click a row for the listener', actions: [stamp], body: table, pad: false }));
    }

    function poll(first) {
      return VX.api.get('/api/admin/activity', null, { fresh: true }).then(function (res) {
        if (!res.ok) {
          if (first || !table) { table = null; VX.clear(summary); VX.mount(body, ui.error(res.message, function () { return poll(true); }, res.status ? 'HTTP ' + res.status + ' · ' + res.error : null)); }
          else stamp.textContent = 'Update failed: ' + res.message;
          return res;
        }
        var d = res.data || {};
        if (d.configured === false) { table = null; VX.clear(summary); VX.mount(body, notConnected()); return res; }
        events = d.events || [];
        drawSummary();
        if (!table) build(); else table.update(pick());
        stamp.bump();
        return res;
      });
    }
    VX.mount(body, ui.skeleton(6));
    ctx.every(15000, function () { poll(false); });
    return poll(true);
  }

  /* ----------------------------------------------------- Listen Together */

  function renderRooms(host, ctx) {
    var body = h('div');
    var stamp = stampLine();
    host.appendChild(body);

    function endRoom(code) {
      return VX.confirm({
        title: 'End room ' + code + '?',
        body: 'Everyone in this room is disconnected and the room is deleted. Listeners can start a new room at any time.',
        danger: true, confirmLabel: 'End room'
      }).then(function (yes) {
        if (!yes) return null;
        return VX.api.post('/api/admin/maintenance', { action: 'end_room', code: code }).then(function (res) {
          if (res.ok) VX.toast('Room ' + code + ' ended', 'ok');
          else VX.toast('Could not end the room: ' + (res.message || 'the database did not confirm it'), 'bad');
          return load(true);
        });
      });
    }
    function closeAll() {
      return VX.confirm({
        title: 'Close every room?',
        body: 'Every Listen Together room and all its members are deleted. Anyone listening together right now is disconnected.',
        danger: true, confirmLabel: 'Close all rooms', typed: 'CLOSE'
      }).then(function (yes) {
        if (!yes) return null;
        return VX.api.post('/api/admin/maintenance', { action: 'close_rooms' }).then(function (res) {
          if (res.ok) VX.toast('All rooms closed', 'ok');
          else VX.toast('Could not close the rooms: ' + (res.message || 'the database did not confirm it'), 'bad');
          return load(true);
        });
      });
    }

    function load(quiet) {
      return ui.load(body, function () { return VX.api.get('/api/admin/rooms', null, { fresh: true }); }, function (d) {
        if (d.configured === false) return notConnected();
        var rooms = d.rooms || [];
        stamp.bump();
        return h('div.page-body',
          ui.kpis([
            { label: 'Active rooms', value: fmt.num(d.active), sub: 'with at least one member', tone: Number(d.active) > 0 ? 'ok' : null },
            { label: 'Listening together', value: fmt.num(d.listeners), sub: 'members seen in the last minute' },
            { label: 'Rooms · 2 hours', value: fmt.num(rooms.length), sub: 'updated recently' },
            { label: 'Playing now', value: fmt.num(rooms.filter(function (r) { return r.playing; }).length), sub: 'rooms' }
          ]),
          ui.card({
            title: 'Rooms', sub: 'Newest activity first', pad: false,
            actions: [stamp, rooms.length ? ui.button('Close all rooms', { kind: 'danger', small: true, icon: 'trash', onClick: closeAll }) : null],
            body: ui.table({
              columns: [
                { key: 'code', label: 'Room', render: function (r) { return ui.mono(r.code); } },
                { key: 'host', label: 'Host', render: function (r) { return r.host || h('span.muted', 'Unnamed host'); } },
                { key: 'members', label: 'Members', align: 'right' },
                { key: 'song', label: 'Song', sortVal: function (r) { return songLine(r.song_title, r.song_artist); }, render: function (r) { return r.song_title ? h('div', h('div.cell-main', r.song_title), r.song_artist ? h('div.cell-sub', r.song_artist) : null) : h('span.muted', 'Nothing queued'); } },
                { key: 'playing', label: 'State', sortVal: function (r) { return r.playing ? 'Playing' : 'Paused'; }, render: function (r) { return r.playing ? ui.pill('Playing', 'ok') : ui.pill('Paused'); } },
                { key: 'updated_at', label: 'Last update', align: 'right', nowrap: true, render: function (r) { return fmt.ago(r.updated_at); } },
                { key: 'end', label: '', sort: false, csv: function () { return ''; }, render: function (r) {
                  return ui.button('End', { kind: 'ghost', small: true, ariaLabel: 'End room ' + r.code, onClick: function () { return endRoom(r.code); } });
                } }
              ],
              rows: rooms, sortKey: 'updated_at', sortDir: 'desc', exportName: 'vinax-rooms',
              empty: 'No Listen Together rooms right now',
              emptyHint: 'Rooms appear here when a listener starts Listen Together and stay for 2 hours after their last update.'
            })
          })
        );
      }, { quiet: quiet, skeleton: quiet ? null : 5 });
    }
    ctx.every(15000, function () { if (!document.querySelector('.scrim')) load(true); });
    return load(false);
  }

  /* ---------------------------------------------------------------- Pulse */

  function renderPulse(host, ctx) {
    var body = h('div');
    var stamp = stampLine();
    host.appendChild(body);

    function capped(n, cap) { return Number(n) >= cap ? fmt.num(cap) + '+' : fmt.num(n); }

    function load(quiet) {
      return ui.load(body, function () { return VX.api.get('/api/admin/realtime', null, { fresh: true }); }, function (d) {
        if (d.configured === false) return notConnected();
        stamp.bump();
        var errors = d.recentErrors || [];
        var people = d.liveCities || [];
        var cities = {};
        people.forEach(function (p) {
          var label = place(p.city, p.country);
          if (!label) return;
          cities[label] = (cities[label] || 0) + 1;
        });
        var cityList = Object.keys(cities).map(function (k) { return { label: k, value: cities[k] }; }).sort(function (a, b) { return b.value - a.value; });
        var aiOn = Number(d.aiCalls15m) > 0;

        return h('div.page-body',
          ui.kpis([
            { label: 'Listening now', value: capped(d.liveListeners, 100), sub: 'active in 5 min', tone: Number(d.liveListeners) > 0 ? 'ok' : null },
            { label: 'Plays started', value: capped(d.startsPerMin, 500), sub: 'last minute' },
            { label: 'New devices', value: capped(d.joins5m, 200), sub: 'last 5 min' },
            { label: 'Errors', value: capped(d.errors5m, 10), sub: 'last 5 min', tone: Number(d.errors5m) > 0 ? 'bad' : null, hint: 'Counts up to 10; the list below shows the newest ones.' },
            { label: 'AI reply time', value: aiOn && d.aiP50 != null ? fmt.ms(d.aiP50) : '—', sub: aiOn ? 'median · 15 min' : 'no AI calls in 15 min' },
            { label: 'AI success', value: aiOn && d.aiOkRate != null ? fmt.pct(d.aiOkRate) : '—', sub: aiOn ? capped(d.aiCalls15m, 200) + ' calls · 15 min' : 'no AI calls in 15 min', tone: aiOn && Number(d.aiOkRate) < 90 ? 'warn' : null },
            { label: 'Listen Together', value: fmt.num(d.activeRooms), sub: 'rooms active · 5 min' }
          ]),
          ui.grid([
            ui.card({
              title: 'Recent errors', sub: 'Newest 10 app errors', actions: [stamp],
              body: errors.length ? h('ul.list.feed', errors.map(function (e) {
                return h('li',
                  h('span.feed-time', { title: fmt.dateTime(e.created_at) }, fmt.ago(e.created_at)),
                  h('div.grow', h('div', ui.pill(e.error_kind || 'error', 'bad')), h('div.cell-sub', fmt.trunc(e.message || 'No message', 240))));
              })) : ui.empty('No recent errors', 'App errors reported by listeners appear here.')
            }),
            ui.card({ title: 'Live cities', sub: 'Listeners active in the last 5 minutes', body: ui.hbars(cityList, { empty: 'Nobody active in the last 5 minutes', emptyHint: 'Cities appear as listeners open the app.' }) }),
            ui.card({
              title: 'Who is listening', sub: 'Active in the last 5 minutes', pad: false,
              body: ui.table({
                columns: [
                  { key: 'name', label: 'Listener', render: function (r) { return r.name || h('span.muted', 'Anonymous'); }, sortVal: function (r) { return r.name || 'Anonymous'; } },
                  { key: 'place', label: 'Place' },
                  { key: 'current_song_title', label: 'Last song' }
                ],
                rows: people.map(function (p) { return { name: p.name, place: place(p.city, p.country), current_song_title: p.current_song_title }; }),
                exportName: 'vinax-live-now', pageSize: 10, dense: true,
                empty: 'Nobody active in the last 5 minutes', emptyHint: 'Listeners appear here as they open the app.'
              })
            })
          ])
        );
      }, { quiet: quiet, skeleton: quiet ? null : 5 });
    }
    ctx.every(10000, function () { load(true); });
    return load(false);
  }
})();
