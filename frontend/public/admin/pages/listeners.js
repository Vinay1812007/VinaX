/* VinaX console — Listeners page.
 * Listener and account management. "All listeners" pages through
 * /api/admin/users (listener devices from vinax_users merged with signed-in
 * accounts that have no device), with server search, client filters, CSV of
 * the loaded rows or of everyone. "Top listeners" ranks devices by plays
 * (/api/admin/insights). Any row opens the listener drawer: profile from
 * /api/admin/user, Gmail/photo/place/platform/version, play counts, top songs,
 * languages, recent activity, downloads (report / JSON / activity CSV, built
 * from ?full=1) and delete (POST /api/admin/maintenance {action:'delete_user'}).
 * The drawer is exported as VX.openListener(deviceId, name, opts) so other
 * pages (Live, Growth & engagement) open the same drilldown. */
(function () {
  'use strict';
  var VX = window.VX, h = VX.h, ui = VX.ui, fmt = VX.fmt;

  VX.page({
    id: 'listeners', title: 'Listeners', group: 'Audience', icon: 'users',
    desc: 'Every listener device and signed-in account: search, open a profile, download or delete.',
    noAuto: true, // a long list the owner scrolls and filters; refresh on demand
    tabs: [
      { id: 'all', label: 'All listeners', desc: 'Listener devices that share usage, plus signed-in accounts without a device. Most recently seen first.', render: renderAll },
      { id: 'top', label: 'Top listeners', desc: 'Devices with the most plays in the chosen window.', render: renderTop }
    ]
  });

  /* ------------------------------------------------------------ helpers */

  var TYPE_LABEL = {
    play: 'Play', complete: 'Finished', skip: 'Skip', search: 'Search', favorite: 'Like', download: 'Download',
    share: 'Share', error: 'Error', open: 'Open', register: 'Name set', heartbeat: 'Heartbeat'
  };
  var TYPE_TONE = { play: 'accent', complete: 'ok', favorite: 'ok', download: 'info', share: 'info', skip: 'warn', error: 'bad' };
  function typeLabel(t) { return TYPE_LABEL[t] || (t ? String(t).charAt(0).toUpperCase() + String(t).slice(1).replace(/[-_]/g, ' ') : 'Event'); }

  var ERRORS = {
    not_found: 'This listener no longer exists — it may already have been deleted.',
    delete_failed: 'The database did not confirm the delete. Try again.',
    reason_required: 'Give a reason of at least 3 characters.',
    bad_request: 'That listener id is not valid.'
  };
  function errText(res) { return ERRORS[res.error] || res.message || 'Something went wrong.'; }

  function isAccountOnly(u) { return u && (u.kind === 'account' || /^account:/.test(String(u.device_id || ''))); }
  function kindOf(u) { return isAccountOnly(u) ? 'account' : u && u.signed_in ? 'signed' : 'device'; }
  function kindPill(u) {
    var k = kindOf(u);
    if (k === 'account') return ui.pill('Account only', 'info');
    if (k === 'signed') return ui.pill('Signed in', 'ok');
    return ui.pill('Device');
  }
  function displayName(u) {
    if (!u) return 'Anonymous';
    return u.name || (u.username ? '@' + u.username : 'Anonymous');
  }
  function place(u) {
    if (!u) return null;
    var c = u.country && u.country !== '??' && u.country !== 'XX' ? fmt.country(u.country) : '';
    var parts = [u.city && u.city !== 'Unknown' ? u.city : '', u.region || '', c].filter(Boolean);
    // City and region are often the same word; show it once.
    parts = parts.filter(function (p, i) { return parts.indexOf(p) === i; });
    return parts.length ? parts.join(', ') : null;
  }
  function platformLabel(p) {
    var v = String(p || '').toLowerCase();
    if (!v) return null;
    if (v === 'android') return 'Android';
    if (v === 'ios') return 'iOS';
    if (v === 'pwa') return 'Installed web app';
    if (v === 'web') return 'Web';
    return v.charAt(0).toUpperCase() + v.slice(1);
  }
  function shortId(id) { var s = String(id || ''); return s.length > 14 ? s.slice(0, 8) + '…' + s.slice(-4) : s || '—'; }
  function activeRecently(u, mins) { var t = u && u.last_seen ? new Date(u.last_seen).getTime() : NaN; return !isNaN(t) && Date.now() - t < mins * 60000; }
  function safeName(s) { return String(s || 'listener').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'listener'; }

  function notConnected() {
    return ui.empty('Database not connected', 'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the Worker to see listeners.');
  }

  var CSV_COLUMNS = [
    { key: 'device_id', label: 'id' }, { key: 'kind', label: 'type', csv: function (u) { return kindOf(u) === 'account' ? 'account only' : kindOf(u) === 'signed' ? 'signed in' : 'device'; } },
    { key: 'name', label: 'name' }, { key: 'username', label: 'username' }, { key: 'email', label: 'email' },
    { key: 'platform', label: 'platform' }, { key: 'app_version', label: 'app_version' }, { key: 'country', label: 'country' },
    { key: 'region', label: 'region' }, { key: 'city', label: 'city' }, { key: 'is_playing', label: 'is_playing' },
    { key: 'first_seen', label: 'first_seen' }, { key: 'last_seen', label: 'last_seen' }
  ];

  /* ------------------------------------------------------- All listeners */

  var KIND_FILTERS = [
    { value: 'all', label: 'All' }, { value: 'signed', label: 'Signed in' }, { value: 'device', label: 'Devices only' },
    { value: 'account', label: 'Accounts only' }, { value: 'active', label: 'Active · 24h' }
  ];

  function renderAll(host, ctx) {
    var q = ctx.params.q || '';
    var kind = ctx.params.kind || 'all';
    var rows = [], next = 0, hasMore = false;
    var head = h('div');
    var listHost = h('div');
    var more = h('div.actions');
    var table = null, shell = false, tableHost = h('div'), info = h('span.muted.small');
    var openedDeepLink = false;
    var reqId = 0;

    host.appendChild(h('div.page-body', head, listHost));

    function filtered() {
      return rows.filter(function (u) {
        if (kind === 'all') return true;
        if (kind === 'active') return activeRecently(u, 24 * 60);
        return kindOf(u) === kind;
      });
    }

    function drawKpis(d) {
      var s = d.summary || {};
      VX.mount(head,
        d.unavailable && d.unavailable.indexOf('accounts') >= 0 ? ui.notice('Signed-in accounts could not be read just now, so this list shows listener devices only.', 'warn') : null,
        ui.kpis([
          { label: 'Listeners', value: fmt.num(s.total_users), sub: 'devices + accounts without one' },
          { label: 'Signed-in accounts', value: s.accounts_total == null ? '—' : fmt.num(s.accounts_total), sub: 'Google sign-in' },
          { label: 'Active · 24h', value: fmt.num(s.active_24h) },
          { label: 'New · 24h', value: fmt.num(s.new_24h) },
          { label: 'Plays · all time', value: fmt.num(s.total_plays) }
        ]));
    }

    function drawTable(rebuild) {
      var list = filtered();
      info.textContent = hasMore
        ? 'Showing the ' + fmt.num(rows.length) + ' most recently seen' + (kind !== 'all' ? ' · filters apply to these' : '')
        : fmt.plural(rows.length, 'listener') + (q ? ' match “' + q + '”' : '');
      VX.mount(more, hasMore ? ui.button('Load 50 more', { kind: 'ghost', small: true, icon: 'chevron', onClick: function () { return fetchPage(false); } }) : null);
      if (table && !rebuild) { table.update(list); return; }
      table = ui.table({
        columns: [
          { key: 'name', label: 'Listener', sortVal: function (u) { return displayName(u) + ' ' + (u.email || '') + ' ' + (u.username || ''); }, csv: function (u) { return u.name; },
            render: function (u) { return ui.media(u.picture, displayName(u), u.email || (u.username && u.name ? '@' + u.username : shortId(u.device_id)), true); } },
          { key: 'kind', label: 'Type', sortVal: function (u) { return kindOf(u); }, render: kindPill },
          { key: 'place', label: 'Place', sortVal: place, render: function (u) { return place(u); } },
          { key: 'platform', label: 'Platform', nowrap: true, render: function (u) { return platformLabel(u.platform); } },
          { key: 'is_playing', label: 'Now', sortVal: function (u) { return u.is_playing && activeRecently(u, 5) ? 1 : 0; },
            render: function (u) { return u.is_playing && activeRecently(u, 5) ? ui.pill('Playing', 'ok') : activeRecently(u, 5) ? ui.pill('Online') : null; } },
          { key: 'first_seen', label: 'Joined', nowrap: true, render: function (u) { return fmt.date(u.first_seen); } },
          { key: 'last_seen', label: 'Last seen', align: 'right', nowrap: true, render: function (u) { return h('span', { title: fmt.dateTime(u.last_seen) }, fmt.ago(u.last_seen)); } }
        ],
        rows: list, search: false, pageSize: 50, sortKey: 'last_seen', sortDir: 'desc', exportName: 'vinax-listeners',
        empty: q ? 'No listener matches “' + q + '”' : rows.length ? 'No listener of this type is loaded' : 'No listeners yet',
        emptyHint: q ? 'Search looks at names, @usernames, Gmail addresses and device ids.'
          : rows.length ? 'Pick “All”, or load more listeners.'
          : 'Listeners appear here once someone opens the app with usage sharing on, or signs in with Google.',
        onRow: function (u) { openListener(u.device_id, displayName(u), { onChanged: function () { fetchPage(true); } }); }
      });
      VX.mount(tableHost, table);
    }

    function buildShell() {
      var search = ui.search('Search name, @username, Gmail or device id', function (v) {
        q = v; ctx.setParam('q', v); fetchPage(true);
      }, q);
      var seg = ui.segmented(KIND_FILTERS, kind, function (v) { kind = v; ctx.setParam('kind', v === 'all' ? '' : v); drawTable(true); }, 'Listener type');
      VX.mount(listHost, ui.card({
        title: 'Listeners', sub: 'Click a listener for their profile', pad: false,
        actions: [info, ui.button('Download everyone', { kind: 'ghost', small: true, icon: 'download', title: 'CSV of every listener matching the search', onClick: function () { return downloadAll(q); } })],
        body: [h('div.card-body', h('div.toolbar', search, seg)), tableHost, h('div.card-body', more)]
      }));
      shell = true;
    }

    function fetchPage(reset) {
      var my = ++reqId;
      if (reset) { next = 0; }
      return VX.api.get('/api/admin/users', { limit: 50, offset: next, q: q }, { fresh: true }).then(function (res) {
        if (my !== reqId) return res; // a newer search won
        if (!res.ok) {
          if (!shell) { VX.clear(head); VX.mount(listHost, ui.error(res.message, function () { return fetchPage(true); }, res.status ? 'HTTP ' + res.status + ' · ' + res.error : null)); }
          else VX.toast('Could not load listeners: ' + res.message, 'bad');
          return res;
        }
        var d = res.data || {};
        if (d.configured === false) { VX.clear(head); VX.mount(listHost, notConnected()); return res; }
        var page = d.users || [];
        rows = reset ? page : rows.concat(page);
        hasMore = !!d.hasMore;
        next = (Number(d.offset) || 0) + (Number(d.limit) || 50);
        if (reset || !head.firstChild) drawKpis(d);
        if (!shell) buildShell();
        drawTable(reset);
        if (!openedDeepLink && ctx.params.open) {
          openedDeepLink = true;
          var hit = rows.filter(function (u) { return u.device_id === ctx.params.open; })[0];
          openListener(ctx.params.open, hit ? displayName(hit) : null, { onChanged: function () { fetchPage(true); }, onClose: function () { ctx.setParam('open', ''); } });
        }
        return res;
      });
    }

    VX.mount(listHost, ui.skeleton(8));
    return fetchPage(true);
  }

  /** Walk every page (100 at a time) and save one CSV. */
  function downloadAll(q) {
    var all = [];
    var pages = 0;
    function step(offset) {
      return VX.api.get('/api/admin/users', { limit: 100, offset: offset, q: q }, { fresh: true }).then(function (res) {
        if (!res.ok) { VX.toast('Download stopped: ' + res.message, 'bad'); return null; }
        var d = res.data || {};
        all = all.concat(d.users || []);
        pages += 1;
        if (d.hasMore && pages < 100) return step((Number(d.offset) || 0) + (Number(d.limit) || 100));
        if (!all.length) { VX.toast(q ? 'No listener matches that search.' : 'There are no listeners to download yet.', 'bad'); return null; }
        VX.download.csv('vinax-listeners' + (q ? '-' + safeName(q) : '') + '-' + VX.stamp(), all, CSV_COLUMNS);
        VX.toast('Downloaded ' + fmt.plural(all.length, 'listener'), 'ok');
        return null;
      });
    }
    return step(0);
  }

  /* ------------------------------------------------------- Top listeners */

  function renderTop(host, ctx) {
    var days = Number(ctx.params.days) || 7;
    var body = h('div');
    host.appendChild(h('div.toolbar', ui.daysPicker(days, function (d) { ctx.setParam('days', d); ctx.refresh(); })));
    host.appendChild(body);
    return ui.load(body, function () { return VX.api.get('/api/admin/insights', { days: days }); }, function (d) {
      if (d.configured === false) return notConnected();
      var list = (d.topListeners || []).map(function (r, i) { return { rank: i + 1, device_id: r.device_id, name: r.name, username: r.username, plays: Number(r.plays) || 0 }; });
      var total = list.reduce(function (a, b) { return a + b.plays; }, 0);
      return ui.card({
        title: 'Most plays', sub: 'Top 20 devices · last ' + fmt.plural(d.days || days, 'day'), pad: false,
        body: ui.table({
          columns: [
            { key: 'rank', label: '#', align: 'right', width: '48px' },
            { key: 'name', label: 'Listener', sortVal: function (r) { return displayName(r); }, render: function (r) { return h('div', h('div.cell-main', displayName(r)), h('div.cell-sub', r.username && r.name ? '@' + r.username : shortId(r.device_id))); } },
            { key: 'plays', label: 'Plays', align: 'right', render: function (r) { return fmt.num(r.plays); } },
            { key: 'share', label: 'Share of top 20', sortVal: function (r) { return total ? r.plays / total : 0; }, render: function (r) {
              return h('div', { style: { display: 'grid', gap: '4px', 'min-width': '120px' } }, h('span.small', fmt.ratio(total ? r.plays / total : 0)), ui.meter(total ? r.plays / total : 0));
            } }
          ],
          rows: list, sortKey: 'plays', sortDir: 'desc', exportName: 'vinax-top-listeners-' + days + 'd',
          empty: 'No plays in this window', emptyHint: 'Listeners are ranked here once they play songs.',
          onRow: function (r) { openListener(r.device_id, displayName(r)); }
        })
      });
    }, { skeleton: 8 });
  }

  /* ------------------------------------------------------ Listener drawer */

  function facts(events) {
    var ev = events || [];
    var count = {};
    var songs = {}, langs = {};
    ev.forEach(function (e) {
      count[e.type] = (count[e.type] || 0) + 1;
      if (e.type !== 'play') return;
      if (e.song_title) {
        var k = e.song_title + '|' + (e.song_artist || '');
        songs[k] = songs[k] || { label: e.song_title, sub: e.song_artist || null, value: 0 };
        songs[k].value += 1;
      }
      var l = e.language || 'Unknown';
      langs[l] = (langs[l] || 0) + 1;
    });
    var sort = function (m) { return Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) { return b.value - a.value; }); };
    return {
      count: count,
      songs: sort(songs),
      languages: Object.keys(langs).map(function (k) { return { label: k.charAt(0).toUpperCase() + k.slice(1), value: langs[k] }; }).sort(function (a, b) { return b.value - a.value; })
    };
  }

  function openListener(deviceId, name, opts) {
    opts = opts || {};
    if (!deviceId) return;
    var dr = VX.drawer({ title: name || 'Listener' });
    if (opts.onClose) {
      // The drawer removes itself; watch for that to clear a deep link.
      var mo = new MutationObserver(function () { if (!document.getElementById('drawer')) { mo.disconnect(); opts.onClose(); } });
      mo.observe(document.body, { childList: true });
    }
    function load() {
      return ui.load(dr.body, function () { return VX.api.get('/api/admin/user', { deviceId: deviceId }, { fresh: true }); }, function (d) {
        if (d.configured === false) return notConnected();
        var u = d.user;
        var events = d.events || [];
        if (!u && !events.length) return ui.empty('Listener not found', 'There is no record for ' + shortId(deviceId) + ' — it may have been deleted.');
        u = u || { device_id: deviceId };
        dr.setTitle(displayName(u));
        return drawerBody(u, events, deviceId, dr, opts);
      }, { skeleton: 10 });
    }
    load();
    return dr;
  }
  VX.openListener = openListener;

  function drawerBody(u, events, deviceId, dr, opts) {
    var f = facts(events);
    var acct = isAccountOnly(u);
    var nowPlaying = u.is_playing && u.current_song_title && activeRecently(u, 5);

    var copyBtn = ui.button('', { kind: 'ghost', small: true, icon: 'copy', ariaLabel: 'Copy id', title: 'Copy id', onClick: function () {
      if (!navigator.clipboard) { VX.toast('Copy is not available in this browser', 'bad'); return null; }
      return navigator.clipboard.writeText(String(deviceId)).then(function () { VX.toast('Id copied', 'ok'); }, function () { VX.toast('Could not copy', 'bad'); });
    } });

    var header = h('div', { style: { display: 'flex', gap: '12px', 'align-items': 'center', 'flex-wrap': 'wrap' } },
      ui.media(u.picture, displayName(u), u.email || (u.username ? '@' + u.username : null), true),
      h('span.grow'),
      kindPill(u),
      nowPlaying ? ui.pill('Playing now', 'ok') : activeRecently(u, 5) ? ui.pill('Online') : null);

    var profile = ui.dl([
      ['Gmail', u.email || (acct || u.signed_in ? null : 'Not signed in')],
      ['Name', u.name],
      ['Username', u.username ? '@' + u.username : null],
      [acct ? 'Account id' : 'Device id', h('span', { style: { display: 'inline-flex', gap: '6px', 'align-items': 'center', 'flex-wrap': 'wrap' } }, ui.mono(u.device_id || deviceId), copyBtn)],
      ['Place', place(u)],
      ['Platform', platformLabel(u.platform)],
      ['App version', u.app_version ? 'v' + String(u.app_version).replace(/^v/, '') : null],
      [acct ? 'Account created' : 'First seen', fmt.dateTime(u.first_seen)],
      u.account_created ? ['Signed up', fmt.dateTime(u.account_created)] : null,
      ['Last seen', u.last_seen ? fmt.dateTime(u.last_seen) + ' · ' + fmt.ago(u.last_seen) : null],
      u.current_song_title ? [nowPlaying ? 'Playing' : 'Last song', u.current_song_title + (u.current_song_artist ? ' — ' + u.current_song_artist : '')] : null
    ]);

    var n = events.length;
    var activityTable = ui.table({
      columns: [
        { key: 'created_at', label: 'When', nowrap: true, render: function (e) { return h('span', { title: fmt.dateTime(e.created_at) }, fmt.ago(e.created_at)); } },
        { key: 'type', label: 'Event', sortVal: function (e) { return typeLabel(e.type); }, render: function (e) { return ui.pill(typeLabel(e.type), TYPE_TONE[e.type] || null); } },
        { key: 'song_title', label: 'Song', render: function (e) { return e.song_title ? h('div', h('div.cell-main', e.song_title), e.song_artist ? h('div.cell-sub', e.song_artist) : null) : null; } },
        { key: 'place', label: 'Place', sortVal: function (e) { return place(e); }, render: function (e) { return place(e); } }
      ],
      rows: events, sortKey: 'created_at', sortDir: 'desc', pageSize: 10, dense: true, exportName: 'vinax-activity-' + safeName(displayName(u)),
      empty: 'No activity recorded', emptyHint: acct ? 'This account has no linked device sharing usage, so there is no listening history.' : 'Plays, searches and likes from this device appear here.'
    });

    return [
      header,
      acct ? ui.notice('This Google account has no device sharing usage, so there is no listening history — only the account details.', 'info') : null,
      h('section', h('h4', 'Profile'), profile),
      n ? h('section', h('h4', 'From the latest ' + fmt.plural(n, 'event')),
        ui.kpis([
          { label: 'Plays', value: fmt.num(f.count.play || 0) },
          { label: 'Finished', value: fmt.num(f.count.complete || 0) },
          { label: 'Likes', value: fmt.num(f.count.favorite || 0) },
          { label: 'Searches', value: fmt.num(f.count.search || 0) }
        ])) : null,
      n ? h('section', h('h4', 'Top songs'), ui.hbars(f.songs, { limit: 8, empty: 'No plays yet' })) : null,
      f.languages.length ? h('section', h('h4', 'Languages'), ui.share(f.languages, { title: 'Plays by language' })) : null,
      h('section', h('h4', 'Recent activity'), activityTable),
      h('section', h('h4', 'Download'),
        h('p.muted.small', 'Built from the full record (up to 2,000 events). The report is a single page you can read, print or send.'),
        h('div.actions',
          ui.button('Report', { kind: 'ghost', small: true, icon: 'download', onClick: function () { return downloadProfile(deviceId, 'html'); } }),
          ui.button('JSON', { kind: 'ghost', small: true, icon: 'download', onClick: function () { return downloadProfile(deviceId, 'json'); } }),
          ui.button('Activity CSV', { kind: 'ghost', small: true, icon: 'download', onClick: function () { return downloadProfile(deviceId, 'csv'); } }))),
      dangerZone(u, deviceId, dr, opts)
    ];
  }

  function dangerZone(u, deviceId, dr, opts) {
    var acct = isAccountOnly(u);
    var reason = ui.input({ placeholder: 'e.g. listener asked to be removed', maxlength: '300' });
    var what = acct
      ? 'Deletes this Google account and the library and settings synced to it. The person can sign in again later as a new account.'
      : 'Deletes this device’s usage row and every event it sent, removes it from Listen Together rooms and anonymises its feedback.' +
        (u.signed_in ? ' The linked Google account is kept but unlinked from this device.' : '');
    return ui.card({
      title: acct ? 'Delete account' : 'Delete listener', tone: 'bad',
      body: [
        h('p.small', what),
        ui.field('Reason', reason, 'Required (at least 3 characters). Saved in the audit log.'),
        h('div.actions', ui.button(acct ? 'Delete account' : 'Delete listener', { kind: 'danger', icon: 'trash', onClick: function () {
          var why = reason.value.trim();
          if (why.length < 3) { reason.classList.add('invalid'); reason.focus(); VX.toast('Give a reason of at least 3 characters.', 'bad'); return null; }
          reason.classList.remove('invalid');
          return VX.confirm({
            title: acct ? 'Delete this account?' : 'Delete this listener?',
            body: what + ' This cannot be undone.',
            danger: true, confirmLabel: 'Delete', typed: 'DELETE'
          }).then(function (yes) {
            if (!yes) return null;
            return VX.api.post('/api/admin/maintenance', { action: 'delete_user', device_id: deviceId, reason: why }).then(function (res) {
              if (res.ok) {
                VX.toast((acct ? 'Account' : 'Listener') + ' deleted', 'ok');
                dr.close();
                if (opts.onChanged) opts.onChanged();
              } else {
                VX.toast('Not deleted: ' + errText(res), 'bad');
                if (res.error === 'not_found' && opts.onChanged) { dr.close(); opts.onChanged(); }
              }
              return res;
            });
          });
        } }))
      ]
    });
  }

  /* ---------------------------------------------------------- downloads */

  function downloadProfile(deviceId, format) {
    return VX.api.get('/api/admin/user', { deviceId: deviceId, full: 1 }, { fresh: true, timeout: 40000 }).then(function (res) {
      if (!res.ok) { VX.toast('Download failed: ' + res.message, 'bad'); return res; }
      var d = res.data || {};
      var u = d.user || { device_id: deviceId };
      var events = d.events || [];
      var base = 'vinax-' + safeName(displayName(u)) + '-' + VX.stamp();
      if (format === 'json') {
        VX.download.json(base, { exported_at: new Date().toISOString(), user: d.user || null, events: events });
      } else if (format === 'csv') {
        if (!events.length) { VX.toast('This listener has no activity to download.', 'bad'); return res; }
        VX.download.csv(base + '-activity', events, ['created_at', 'type', 'song_id', 'song_title', 'song_artist', 'language', 'platform', 'app_version', 'country', 'region', 'city', 'origin_verified']
          .map(function (k) { return { key: k, label: k }; }));
      } else {
        VX.download.blob(base + '.html', new Blob([reportHtml(u, events, deviceId)], { type: 'text/html;charset=utf-8' }));
      }
      VX.toast('Downloaded', 'ok');
      return res;
    });
  }

  /**
   * A self-contained, printable HTML report. Built as DOM in a detached
   * document and serialised, so every listener-supplied string is escaped by
   * the serializer (no string-built markup).
   */
  function reportHtml(u, events, deviceId) {
    var doc = document.implementation.createHTMLDocument('VinaX listener report');
    var el = function (tag, text, attrs) {
      var x = doc.createElement(tag);
      if (attrs) Object.keys(attrs).forEach(function (k) { x.setAttribute(k, attrs[k]); });
      if (text != null) x.textContent = String(text);
      return x;
    };
    var add = function (parent) { for (var i = 1; i < arguments.length; i++) if (arguments[i]) parent.appendChild(arguments[i]); return parent; };
    var meta = el('meta'); meta.setAttribute('charset', 'utf-8');
    var vp = el('meta', null, { name: 'viewport', content: 'width=device-width, initial-scale=1' });
    var style = el('style', 'body{font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1d1d1f;max-width:860px;margin:32px auto;padding:0 20px}' +
      'h1{font-size:24px;margin:0 0 4px}h2{font-size:16px;margin:28px 0 8px}.muted{color:#6e6e73}table{width:100%;border-collapse:collapse;font-size:13px}' +
      'th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #e5e5ea;vertical-align:top}th{color:#6e6e73;font-weight:600}' +
      '.cards{display:flex;gap:12px;flex-wrap:wrap}.c{border:1px solid #e5e5ea;border-radius:10px;padding:10px 14px;min-width:110px}.c b{display:block;font-size:20px}' +
      'td.n{text-align:right;font-variant-numeric:tabular-nums}@media print{body{margin:0}}');
    add(doc.head, meta, vp, style);
    var b = doc.body;
    var f = facts(events);
    var acct = isAccountOnly(u);
    add(b, el('h1', displayName(u)));
    add(b, el('p', [u.email, place(u) || 'Place unknown', acct ? 'account · no usage sharing' : platformLabel(u.platform) || 'Web', u.app_version ? 'v' + u.app_version : null,
      'joined ' + fmt.date(u.first_seen), 'last seen ' + fmt.date(u.last_seen)].filter(Boolean).join(' · '), { class: 'muted' }));
    add(b, el('p', 'Id: ' + deviceId, { class: 'muted' }));
    var cards = el('div', null, { class: 'cards' });
    [['Plays', f.count.play || 0], ['Finished', f.count.complete || 0], ['Likes', f.count.favorite || 0], ['Searches', f.count.search || 0], ['Events', events.length]]
      .forEach(function (c) { var box = el('div', null, { class: 'c' }); add(box, el('b', fmt.num(c[1])), el('span', c[0], { class: 'muted' })); cards.appendChild(box); });
    add(b, cards);
    function table(head, rows) {
      var t = el('table'), tr = el('tr');
      head.forEach(function (x) { tr.appendChild(el('th', x)); });
      add(t, add(el('thead'), tr));
      var tb = el('tbody');
      rows.forEach(function (r) { var row = el('tr'); r.forEach(function (c) { row.appendChild(el('td', c == null || c === '' ? '—' : c, typeof c === 'number' ? { class: 'n' } : null)); }); tb.appendChild(row); });
      return add(t, tb);
    }
    add(b, el('h2', 'Top songs'));
    add(b, f.songs.length ? table(['Song', 'Artist', 'Plays'], f.songs.slice(0, 25).map(function (s) { return [s.label, s.sub, s.value]; })) : el('p', 'No plays recorded.', { class: 'muted' }));
    if (f.languages.length) { add(b, el('h2', 'Languages')); add(b, table(['Language', 'Plays'], f.languages.map(function (l) { return [l.label, l.value]; }))); }
    add(b, el('h2', 'Activity'));
    add(b, events.length ? table(['When', 'Event', 'Song', 'Place'], events.slice(0, 500).map(function (e) {
      return [fmt.dateTime(e.created_at), typeLabel(e.type), e.song_title ? e.song_title + (e.song_artist ? ' — ' + e.song_artist : '') : '', place(e)];
    })) : el('p', 'No activity recorded.', { class: 'muted' }));
    if (events.length > 500) add(b, el('p', 'Showing the newest 500 of ' + fmt.num(events.length) + ' events. The activity CSV has all of them.', { class: 'muted' }));
    add(b, el('p', 'Exported from the VinaX console on ' + new Date().toLocaleString() + '.', { class: 'muted' }));
    return '<!DOCTYPE html>\n' + new XMLSerializer().serializeToString(doc.documentElement);
  }
})();
