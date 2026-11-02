/* VinaX console — Users.
 * Everyone who signed in with Google (anonymous devices are never listed).
 * GET /api/admin/listeners does the filtering, sorting and paging on the
 * server; ?filters=1 gives the dropdown choices; ?account= opens a profile.
 * Actions: block / unblock, sign one device out, delete a person's data
 * (owner only, type-to-confirm), add as VinaX AI testers, send a notification. */
(function () {
  'use strict';
  var VX = window.VX, h = VX.h, ui = VX.ui, fmt = VX.fmt, arr = VX.arr, obj = VX.obj, num = VX.num;
  var API = '/api/admin/listeners';
  var KEYS = ['q', 'platform', 'active', 'joined', 'joinedFrom', 'joinedTo', 'country', 'region', 'city', 'version', 'language', 'sort', 'limit', 'offset'];
  var SORTS = [{ value: 'last_active', label: 'Last active' }, { value: 'joined', label: 'Joined (newest)' }, { value: 'plays', label: 'Most plays' }, { value: 'name', label: 'Name A–Z' }];
  var COL_SORT = { lastSeen: 'last_active', joined: 'joined', plays: 'plays', user: 'name' };

  VX.page({
    id: 'users', title: 'Users', group: 'People', icon: 'users', order: 1,
    desc: 'Everyone who signed in to VinaX with Google. Click a person to see their profile.',
    keywords: 'listeners people accounts google profile block delete devices',
    render: render
  });

  /* ---------------------------------------------------------- helpers */

  function who(u) { return u.name || u.email || 'User'; }
  function place(r) { return [r.city, r.region, fmt.country(r.country)].filter(function (x) { return x && x !== '—'; }).join(', ') || null; }
  function cmpVersion(a, b) {
    var x = String(a || '').split('.').map(Number), y = String(b || '').split('.').map(Number);
    for (var i = 0; i < Math.max(x.length, y.length); i++) { var d = (x[i] || 0) - (y[i] || 0); if (d) return d < 0 ? -1 : 1; }
    return 0;
  }
  var latest = null;
  function latestVersion() {
    if (latest) return latest;
    latest = VX.api.get('/api/version', null, { noAuthRedirect: true }).then(function (res) { var d = obj(res.data); return d.version || d.versionName || null; });
    return latest;
  }
  function old(r, newest) { return !!(newest && r.appVersion && /^\d+(\.\d+)*$/.test(r.appVersion) && cmpVersion(r.appVersion, newest) < 0); }
  function playingNow(r) { return r.isPlaying && obj(r.nowPlaying).title && Date.parse(r.lastSeen) > Date.now() - 5 * 60000; }

  /** Add people to the VinaX AI testers (the vinax-ai setting), after a confirm. */
  VX.addAiTesters = function (people) {
    people = (people || []).filter(function (p) { return p && p.id; });
    if (!people.length) return Promise.resolve(false);
    return VX.api.get('/api/admin/settings', { key: 'vinax-ai' }, { fresh: true }).then(function (res) {
      if (!res.ok) { VX.toast('Something went wrong — ' + res.message, 'bad'); return false; }
      var value = obj(obj(res.data).value);
      var testers = arr(value.testers).filter(function (t) { return typeof t === 'string'; });
      var fresh = people.filter(function (p) { return testers.indexOf(p.id) < 0; });
      if (!fresh.length) { VX.toast(people.length === 1 ? who(people[0]) + ' is already an AI tester.' : 'They are all AI testers already.', 'ok'); return false; }
      if (testers.length + fresh.length > 50) { VX.toast('VinaX AI allows up to 50 testers. Remove some on App Settings → Features & AI first.', 'bad'); return false; }
      var names = fresh.slice(0, 3).map(who).join(', ') + (fresh.length > 3 ? ' and ' + (fresh.length - 3) + ' more' : '');
      return VX.confirm({ title: 'Add as AI testers?', body: names + ' will be able to use VinaX AI before it is open to everyone. Users see this within 1 minute.', confirmLabel: 'Add testers' }).then(function (ok) {
        if (!ok) return false;
        var next = Object.assign({}, value, { testers: testers.concat(fresh.map(function (p) { return p.id; })) });
        return VX.api.post('/api/admin/settings', { key: 'vinax-ai', value: next }).then(function (r) {
          VX.toast(r.ok ? 'Added ' + fmt.plural(fresh.length, 'AI tester') + ' ✓' : 'Something went wrong — ' + r.message, r.ok ? 'ok' : 'bad');
          return r.ok;
        });
      });
    });
  };

  function setBlocked(u, block, done) {
    return VX.confirm({
      title: block ? 'Block ' + who(u) + '?' : 'Unblock ' + who(u) + '?',
      body: block ? 'They are signed out everywhere and cannot sign in again until you unblock them. They can still listen without signing in.' : 'They can sign in with Google again.',
      danger: block, confirmLabel: block ? 'Block user' : 'Unblock'
    }).then(function (ok) {
      if (!ok) return;
      return VX.api.post(API, { action: block ? 'block' : 'unblock', account: u.id }).then(function (res) {
        VX.toast(res.ok ? (block ? 'Blocked ✓' : 'Unblocked ✓') : 'Something went wrong — ' + res.message, res.ok ? 'ok' : 'bad');
        if (res.ok && done) done();
      });
    });
  }

  function deleteData(u, done) {
    var reason = 'They asked us to delete it';
    var m = VX.modal({
      title: 'Delete everything about ' + who(u) + '?',
      body: [
        h('p', 'This removes their Google sign-in, their synced library, their listening history on every device, their VinaX AI chats and files. It cannot be undone.'),
        ui.dropdown('Why?', ['They asked us to delete it', 'Spam or abuse', 'Test account', 'Other reason'], reason, function (v) { reason = v; })
      ],
      actions: [
        { label: 'Cancel', kind: 'ghost' },
        { label: 'Continue', kind: 'danger', onClick: function (close) {
          close();
          VX.confirm({ title: 'Type CONFIRM to delete', body: 'Everything about ' + who(u) + ' is deleted for good.', typed: true, danger: true, confirmLabel: 'Delete for good' }).then(function (ok) {
            if (!ok) return;
            VX.api.post(API, { action: 'delete', account: u.id, reason: reason }).then(function (res) {
              VX.toast(res.ok ? 'Deleted ✓' : 'Something went wrong — ' + res.message, res.ok ? 'ok' : 'bad');
              if (res.ok && done) done();
            });
          });
        } }
      ]
    });
    return m;
  }

  function personMenu(u, ctx, reload, inDrawer) {
    var edit = VX.can('edit'), owner = VX.can('owner');
    return [
      inDrawer ? null : { label: 'View profile', icon: 'user', onClick: function () { openProfile(u, ctx, reload); } },
      { label: 'Send notification', icon: 'send', hidden: !edit, onClick: function () { ctx.go('notifications', 'compose', { users: u.id }); } },
      { label: 'Copy email', icon: 'copy', hidden: !u.email, onClick: function () { VX.copy(u.email, 'Email copied'); } },
      { label: 'Add as AI tester', icon: 'spark', hidden: !edit, onClick: function () { VX.addAiTesters([u]); } },
      { label: u.blocked ? 'Unblock user' : 'Block user', icon: 'lock', hidden: !edit, danger: !u.blocked, onClick: function () { setBlocked(u, !u.blocked, reload); } },
      owner ? '-' : null,
      { label: 'Delete user’s data', icon: 'trash', danger: true, hidden: !owner, onClick: function () { deleteData(u, reload); } }
    ].filter(Boolean);
  }

  /* ------------------------------------------------------------- page */

  function render(host, ctx) {
    var state = {};
    KEYS.forEach(function (k) { if (ctx.params[k]) state[k] = ctx.params[k]; });
    state.limit = Number(state.limit) || 25;
    state.offset = Number(state.offset) || 0;
    var cardsHost = h('div.users-stats'), filterHost = h('div.user-filters'), tableHost = h('div');
    var filters = { places: [], versions: [], languages: [] };
    var newest = null;

    function sync() {
      KEYS.forEach(function (k) { ctx.setParam(k, k === 'limit' ? (state.limit !== 25 ? state.limit : '') : k === 'offset' ? (state.offset || '') : state[k] || ''); });
    }
    function set(changes) { Object.keys(changes).forEach(function (k) { if (changes[k] == null || changes[k] === '') delete state[k]; else state[k] = changes[k]; }); state.offset = 0; sync(); drawFilters(); load(); }
    function query(extra) {
      var o = { limit: state.limit, offset: state.offset };
      KEYS.forEach(function (k) { if (state[k] && k !== 'limit' && k !== 'offset') o[k] = state[k]; });
      return Object.assign(o, extra || {});
    }
    function anyFilter() { return KEYS.some(function (k) { return state[k] && ['sort', 'limit', 'offset'].indexOf(k) < 0; }); }

    /* -- filters -- */
    function opts(list, all) { return [{ value: '', label: all }].concat(list); }
    function uniq(list) { var s = {}; return list.filter(function (x) { if (!x || s[x]) return false; s[x] = 1; return true; }); }
    function drawFilters() {
      var places = arr(filters.places);
      var countries = uniq(places.map(function (p) { return p.country; }));
      var regions = uniq(places.filter(function (p) { return !state.country || p.country === state.country; }).map(function (p) { return p.region; }));
      var cities = uniq(places.filter(function (p) { return (!state.country || p.country === state.country) && (!state.region || p.region === state.region); }).map(function (p) { return p.city; }));
      var versions = arr(filters.versions).filter(function (v) { return !state.platform || v.platform === state.platform; });
      var joined = state.joinedFrom ? 'custom' : state.joined || '';
      var customLabel = state.joinedFrom ? fmt.day(state.joinedFrom) + ' – ' + fmt.day(state.joinedTo || VX.time.today()) : 'Custom…';
      VX.mount(filterHost,
        h('div.toolbar.filter-row',
          ui.search('Search by name or email…', function (v) { set({ q: v }); }, state.q),
          ui.dropdown('Sort by', SORTS, state.sort || 'last_active', function (v) { set({ sort: v === 'last_active' ? '' : v }); }, { inline: true })),
        h('div.filter-grid',
          ui.dropdown('Platform', opts([{ value: 'android', label: 'Android' }, { value: 'web', label: 'Web' }, { value: 'ios', label: 'iOS' }], 'All platforms'), state.platform || '', function (v) { set({ platform: v, version: '' }); }),
          ui.dropdown('Last active', opts([{ value: '1', label: 'Today' }, { value: '7', label: 'Last 7 days' }, { value: '30', label: 'Last 30 days' }], 'Any time'), state.active || '', function (v) { set({ active: v }); }),
          ui.dropdown('Joined', opts([{ value: '1', label: 'Today' }, { value: '7', label: 'Last 7 days' }, { value: '30', label: 'Last 30 days' }, { value: 'custom', label: customLabel }], 'Any time'), joined, function (v) {
            if (v !== 'custom') { set({ joined: v, joinedFrom: '', joinedTo: '' }); return; }
            var r = { start: state.joinedFrom || '', end: state.joinedTo || '' };
            VX.modal({ title: 'Joined between', body: [ui.dateRange(r, function (x) { r = x; }, { startLabel: 'From', endLabel: 'To', startHint: ' ', endHint: 'Leave empty for today' })],
              onClose: drawFilters,
              actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Apply', kind: 'primary', onClick: function (close) {
                if (!r.start) { VX.toast('Choose a start date.', 'bad'); return; }
                if (r.end && r.end < r.start) { VX.toast('The end date is before the start date.', 'bad'); return; }
                close(); set({ joined: '', joinedFrom: r.start, joinedTo: r.end });
              } }] });
          }),
          ui.dropdown('Country', opts(countries.map(function (c) { return { value: c, label: fmt.country(c) }; }), 'All countries'), state.country || '', function (v) { set({ country: v, region: '', city: '' }); }),
          ui.dropdown('State', opts(regions.map(function (r) { return { value: r, label: r }; }), state.country ? 'All states' : 'All states'), state.region || '', function (v) { set({ region: v, city: '' }); }),
          ui.dropdown('City', opts(cities.map(function (c) { return { value: c, label: c }; }), 'All cities'), state.city || '', function (v) { set({ city: v }); }),
          ui.dropdown('App version', opts(versions.map(function (v) { return { value: v.platform + '|' + v.version, label: VX.platformName(v.platform) + ' ' + v.version + (newest && cmpVersion(v.version, newest) === 0 ? ' (latest)' : '') + ' · ' + fmt.num(v.users) }; }), 'All versions'),
            state.version ? (state.platform || (arr(filters.versions).filter(function (v) { return v.version === state.version; })[0] || {}).platform) + '|' + state.version : '',
            function (v) { var p = v.split('|'); set(v ? { platform: p[0], version: p[1] } : { version: '' }); }),
          ui.dropdown('Language', opts(arr(filters.languages).map(function (l) { return { value: l.language, label: VX.langName(l.language) }; }), 'All languages'), state.language || '', function (v) { set({ language: v }); })),
        anyFilter() ? h('div.toolbar', ui.button('Clear filters', { kind: 'ghost', small: true, icon: 'close', onClick: function () { KEYS.forEach(function (k) { if (k !== 'limit') delete state[k]; }); state.offset = 0; sync(); drawFilters(); load(); } })) : null);
    }

    /* -- list -- */
    function columns() {
      return [
        { key: 'user', label: 'User', always: true, render: function (r) {
          var m = ui.media(r.picture, who(r), r.name ? r.email : null, true);
          if (r.blocked) m.lastChild.firstChild.appendChild(h('span', ' ', ui.pill('Blocked', 'bad')));
          return m;
        }, csv: function (r) { return who(r); } },
        { key: 'email', label: 'Email', hidden: true, sort: false },
        { key: 'devices', label: 'Devices', sort: false, render: function (r) { return fmt.plural(r.devices || 1, 'device'); }, csv: function (r) { return num(r.devices); } },
        { key: 'platform', label: 'Platform & version', sort: false, render: function (r) {
          return h('span.plat', VX.platformName(r.platform), r.appVersion ? h('span.muted.small', ' ' + r.appVersion) : null, old(r, newest) ? [' ', ui.pill('Update available', 'warn')] : null);
        }, csv: function (r) { return VX.platformName(r.platform) + (r.appVersion ? ' ' + r.appVersion : ''); } },
        { key: 'place', label: 'Location', sort: false, render: function (r) { var top = r.city || r.region || (r.country ? fmt.country(r.country) : null); if (!top) return null; var rest = [r.city ? r.region : null, r.country && top !== fmt.country(r.country) ? fmt.country(r.country) : null].filter(Boolean).join(', '); return h('div', { title: place(r) }, h('div.cell-main.nowrap', top), rest ? h('div.cell-sub', rest) : null); }, csv: place },
        { key: 'nowPlaying', label: 'Now playing', sort: false, render: function (r) {
          var s = obj(r.nowPlaying);
          if (!s.title) return null;
          return h('span.now', playingNow(r) ? ui.dot('ok') : null, h('span', fmt.trunc(s.title, 32)), s.artist ? h('span.muted.small', ' · ' + fmt.trunc(s.artist, 24)) : null);
        }, csv: function (r) { return obj(r.nowPlaying).title || ''; } },
        { key: 'language', label: 'Favourite language', hidden: true, sort: false, render: function (r) { return r.language ? VX.langName(r.language) : null; } },
        { key: 'plays', label: 'Plays', align: 'right', hidden: true, render: function (r) { return fmt.num(r.plays); } },
        { key: 'joined', label: 'Joined', render: function (r) { return ui.ago(r.joined); }, csv: function (r) { return fmt.full(r.joined); } },
        { key: 'lastSeen', label: 'Last active', render: function (r) { return ui.ago(r.lastSeen); }, csv: function (r) { return fmt.full(r.lastSeen); } }
      ];
    }
    function exportAll() {
      var all = [], offset = 0;
      function page() {
        return VX.api.get(API, query({ limit: 200, offset: offset }), { fresh: true }).then(function (res) {
          var rows = arr(obj(res.data).rows);
          all = all.concat(rows);
          offset += 200;
          return rows.length === 200 && all.length < 5000 ? page() : all;
        });
      }
      VX.toast('Preparing the download…', 'ok');
      return page();
    }

    function load() {
      return ui.load(tableHost, function () { return VX.api.get(API, query()); }, function (d) {
        var gate = ui.gate(d, ctx);
        if (gate) { VX.clear(cardsHost); return gate; }
        var c = obj(d.counts), byP = obj(c.byPlatform);
        VX.mount(cardsHost, ui.stats([
          { label: 'Total users', value: fmt.num(c.users), info: 'Everyone who has signed in to VinaX with Google.', onClick: function () { KEYS.forEach(function (k) { if (k !== 'limit') delete state[k]; }); set({}); } },
          { label: 'New this week', value: fmt.num(c.new7d), info: 'People who signed in for the first time in the last 7 days.', onClick: function () { set({ joined: '7', joinedFrom: '', joinedTo: '', sort: 'joined' }); } },
          { label: 'Active today', value: fmt.num(c.activeToday), info: 'People who used the app today (India time).', onClick: function () { set({ active: '1' }); } },
          { label: 'Android', value: fmt.num(byP.android || 0), info: 'Users whose newest device is the Android app.', onClick: function () { set({ platform: 'android', version: '' }); } },
          { label: 'Web', value: fmt.num(byP.web || 0), info: 'Users whose newest device is a web browser.', onClick: function () { set({ platform: 'web', version: '' }); } },
          { label: 'iOS', value: fmt.num(byP.ios || 0), info: 'Users whose newest device is an iPhone or iPad.', onClick: function () { set({ platform: 'ios', version: '' }); } }
        ]));
        var rows = arr(d.rows);
        var total = num(d.total);
        var sortKey = Object.keys(COL_SORT).filter(function (k) { return COL_SORT[k] === (state.sort || 'last_active'); })[0];
        var table = ui.dataTable({
          rowId: function (r) { return r.id; },
          columns: columns(),
          rows: rows,
          exportName: 'vinax-users',
          rowMenu: function (r) { return personMenu(r, ctx, load); },
          onRow: function (r) { openProfile(r, ctx, load); },
          bulk: [
            { label: 'Send notification', icon: 'send', onClick: function (sel) { if (!VX.can('edit')) { VX.toast(VX.errorText('forbidden'), 'bad'); return; } ctx.go('notifications', 'compose', { users: sel.map(function (u) { return u.id; }).join(',') }); } },
            { label: 'Export', icon: 'download', onClick: function (sel) { VX.download.csv('vinax-users-' + VX.stamp(), sel, columns().filter(function (cl) { return cl.label; }).map(function (cl) { return { key: cl.key, label: cl.label, csv: cl.csv }; })); } },
            { label: 'Add as AI testers', icon: 'spark', onClick: function (sel) { if (!VX.can('edit')) { VX.toast(VX.errorText('forbidden'), 'bad'); return; } VX.addAiTesters(sel); } }
          ],
          server: {
            total: total, offset: state.offset, limit: state.limit, sortKey: sortKey, sortDir: state.sort === 'name' ? 'asc' : 'desc',
            onPage: function (o) { state.offset = o; sync(); load(); },
            onPageSize: function (n) { state.limit = n; state.offset = 0; sync(); load(); },
            onSort: function (key) { if (COL_SORT[key]) set({ sort: COL_SORT[key] === 'last_active' ? '' : COL_SORT[key] }); else VX.toast('This column cannot be sorted. Use “Sort by”.', 'ok'); },
            exportAll: exportAll
          },
          empty: anyFilter()
            ? { title: 'Nobody matches these filters', hint: 'Try fewer filters or a different search.', action: { label: 'Clear filters', icon: 'close', onClick: function () { KEYS.forEach(function (k) { if (k !== 'limit') delete state[k]; }); state.offset = 0; sync(); drawFilters(); load(); } } }
            : { title: 'No users yet', hint: 'People appear here after they sign in to the app with Google.' }
        });
        return ui.card({ title: 'Users · signed in with Google', sub: anyFilter() ? fmt.plural(total, 'person matches', 'people match') + ' these filters' : fmt.plural(total, 'person', 'people'), pad: false, body: table });
      }, { skeleton: 8 });
    }

    VX.mount(host, cardsHost, filterHost, tableHost);
    drawFilters();
    VX.api.get(API, { filters: 1 }).then(function (res) { if (res.ok) { filters = obj(res.data); drawFilters(); } });
    if (ctx.params.user) setTimeout(function () { openProfile({ id: ctx.params.user }, ctx, load, function () { ctx.setParam('user', ''); }); }, 30);
    // The newest app version decides the "Update available" chips: wait for it briefly.
    var wait = new Promise(function (resolve) { setTimeout(resolve, 1500); });
    return Promise.race([latestVersion(), wait]).then(function (v) {
      if (v) { newest = v; drawFilters(); }
      else latestVersion().then(function (x) { if (x) { newest = x; drawFilters(); load(); } });
      return load();
    });
  }

  /* ---------------------------------------------------------- profile */

  function openProfile(row, ctx, reload, onClose) {
    if (!row || !/^\d{1,40}$/.test(String(row.id || ''))) return;
    ctx.setParam('user', row.id);
    var dr = VX.drawer({ title: 'User profile' });
    var baseClose = dr.close;
    function refreshAll() { dr.close(); if (reload) reload(); }
    // Leaving the page (any navigation) closes the drawer.
    ctx.onDispose(function () { if (document.getElementById('drawer')) dr.close(); });
    var obs = new MutationObserver(function () { if (!document.getElementById('drawer')) { obs.disconnect(); ctx.setParam('user', ''); if (onClose) onClose(); } });
    obs.observe(document.body, { childList: true });
    void baseClose;
    function load() {
      return ui.load(dr.body, function () { return VX.api.get(API, { account: row.id }, { fresh: true }); }, function (d) {
        var p = obj(d.profile), a = obj(p.account);
        var u = { id: a.id || row.id, name: a.name, email: a.email, picture: a.picture, blocked: !!a.blockedAt };
        var panel = h('div.profile-panel');
        var tabs = [
          { id: 'overview', label: 'Overview' },
          { id: 'history', label: 'Listening history' },
          { id: 'devices', label: 'Devices', badge: arr(p.devices).length || null },
          { id: 'feedback', label: 'Feedback sent', badge: arr(p.feedback).length || null },
          { id: 'activity', label: 'Activity log' }
        ];
        function show(id) {
          var fn = { overview: overview, history: history, devices: devices, feedback: feedback, activity: activity }[id];
          VX.mount(panel, fn(p, u, ctx, load));
        }
        var bar = ui.tabs(tabs, 'overview', show);
        show('overview');
        return [
          h('div.profile-top',
            ui.media(u.picture, who(u), u.name ? u.email : null, true),
            u.blocked ? ui.pill('Blocked', 'bad') : null,
            h('span.grow'),
            VX.can('edit') ? ui.button('Send notification', { kind: 'ghost', small: true, icon: 'send', onClick: function () { dr.close(); ctx.go('notifications', 'compose', { users: u.id }); } }) : null,
            ui.menu(personMenu(u, ctx, refreshAll, true), { label: 'More for ' + who(u) })),
          bar.el, panel
        ];
      }, { skeleton: 8 });
    }
    load();
    return dr;
  }

  function overview(p) {
    var a = obj(p.account), st = obj(p.stats), bk = obj(p.backup);
    var langs = arr(p.languages).filter(function (l) { return l.language !== 'unknown'; });
    return [
      ui.stats([
        { label: 'Total plays', value: fmt.num(st.plays), sub: fmt.num(st.plays30d) + ' in the last 30 days', info: 'Songs this person played on all their devices.' },
        { label: 'Active days', value: fmt.num(st.activeDays30d), sub: 'of the last 30', info: 'Days in the last month they opened the app.' },
        { label: 'Liked songs', value: fmt.num(st.favorites), info: 'Times they tapped the heart on a song.' },
        { label: 'Problems hit', value: fmt.num(st.errors), tone: num(st.errors) ? 'warn' : null, info: 'Errors the app reported while they used it.' }
      ]),
      ui.dl([
        ['Email', a.email || '—'],
        ['Joined', a.createdAt ? h('span', fmt.date(a.createdAt), h('span.muted.small', ' · ' + fmt.ago(a.createdAt))) : '—'],
        ['Last active', ui.ago(a.lastSeen)],
        ['Favourite language', langs[0] ? VX.langName(langs[0].language) : '—'],
        ['Lives in', place(a) || '—'],
        ['Uses', [VX.platformName(a.platform), a.appVersion].filter(Boolean).join(' ') || '—'],
        ['Library backup', bk.updatedAt ? 'Synced ' + fmt.ago(bk.updatedAt) + ' · ' + fmt.bytes(bk.bytes) : 'Not synced yet']
      ]),
      h('div.grid.cols-2.profile-lists',
        h('div', ui.heading('Top artists', 'Artists this person played most.'), ui.hbars(arr(p.topArtists).map(function (x) { return { label: x.artist, value: num(x.plays) }; }), { empty: 'No plays yet', limit: 6 })),
        h('div', ui.heading('Top songs', 'Songs this person played most.'), ui.hbars(arr(p.topSongs).map(function (x) { return { label: x.title, sub: x.artist, value: num(x.plays) }; }), { empty: 'No plays yet', limit: 6 })))
    ];
  }

  function history(p) {
    return ui.dataTable({
      columns: [
        { key: 'at', label: 'When', nowrap: true, render: function (e) { return ui.ago(e.at); }, csv: function (e) { return fmt.full(e.at); } },
        { key: 'title', label: 'Song', render: function (e) { return ui.media(e.image, e.title, e.artist); } },
        { key: 'language', label: 'Language', render: function (e) { return VX.langName(e.language); } },
        { key: 'platform', label: 'Device', render: function (e) { return VX.platformName(e.platform); } }
      ],
      rows: arr(p.history), exportName: 'vinax-listening-history', search: 'Search songs…', pageSize: 25, sortKey: 'at',
      empty: { title: 'No songs played yet', hint: 'Songs they play while signed in show up here.' }
    });
  }

  function devices(p, u, ctx, reload) {
    var list = arr(p.devices);
    if (!list.length) return ui.emptyState('No devices yet', 'A device appears once they use the app while signed in.');
    var canEdit = VX.can('edit');
    function signOut(dev, n) {
      return VX.confirm({ title: 'Sign out this device?', body: VX.platformName(dev.platform) + ' device ' + n + ' is signed out the next time it opens VinaX. They can sign in again.', danger: true, confirmLabel: 'Sign out device' }).then(function (ok) {
        if (!ok) return;
        return VX.api.post(API, { action: 'signout_device', account: u.id, device: dev.id }).then(function (res) {
          VX.toast(res.ok ? 'Device signed out ✓' : 'Something went wrong — ' + res.message, res.ok ? 'ok' : 'bad');
          if (res.ok) reload();
        });
      });
    }
    return h('ul.device-list', list.map(function (dev, i) {
      var np = obj(dev.nowPlaying);
      var active = Date.parse(dev.lastSeen) > Date.now() - 5 * 60000;
      return h('li.device',
        h('div.device-icon', VX.icon(dev.platform === 'web' ? 'globe' : 'phone')),
        h('div.device-main',
          h('strong', VX.platformName(dev.platform) + ' · device ' + (i + 1), active ? [' ', ui.pill('Online', 'ok')] : null, dev.signedOutAt ? [' ', ui.pill('Signed out', 'warn')] : null),
          h('div.muted.small', ['App version ' + (dev.appVersion || 'not known'), place(dev)].filter(Boolean).join(' · ')),
          h('div.muted.small', 'Last seen ', ui.ago(dev.lastSeen), ' · first used ', fmt.date(dev.firstSeen)),
          np.title ? h('div.small', dev.isPlaying ? ui.dot('ok') : null, ' ', np.title + (np.artist ? ' · ' + np.artist : '')) : null),
        canEdit && !dev.signedOutAt ? ui.button('Sign out this device', { kind: 'ghost', small: true, icon: 'logout', onClick: function () { return signOut(dev, i + 1); } }) : null);
    }));
  }

  var FEEDBACK_KIND = { bug: 'Bug', idea: 'Idea', content: 'Music', other: 'Other' };
  var FEEDBACK_STATUS = { new: ['New', 'warn'], read: ['Read', null], resolved: ['Resolved', 'ok'] };
  function feedback(p, u, ctx) {
    var list = arr(p.feedback);
    if (!list.length) return ui.emptyState('No feedback from this person', 'Messages they send from Settings → Feedback appear here.');
    return [h('ul.feedback-mini', list.map(function (f) {
      var st = FEEDBACK_STATUS[f.status] || ['New', 'warn'];
      return h('li', h('div.toolbar', ui.pill(FEEDBACK_KIND[f.kind] || 'Other'), ui.pill(st[0], st[1]), h('span.grow'), ui.ago(f.at)), h('p', f.message || ''));
    })), h('div.toolbar', ui.button('Open Feedback page', { kind: 'ghost', small: true, icon: 'message', onClick: function () { ctx.go('feedback', 'all'); } }))];
  }

  function activity(p) {
    return ui.dataTable({
      columns: [
        { key: 'at', label: 'When', nowrap: true, render: function (e) { return ui.ago(e.at); }, csv: function (e) { return fmt.full(e.at); } },
        { key: 'kind', label: 'What they did', sortVal: function (e) { return VX.kindText ? VX.kindText(e.kind) : e.kind; }, render: function (e) { return ui.pill(VX.kindText ? VX.kindText(e.kind) : e.kind, e.kind === 'error' ? 'bad' : null); } },
        { key: 'title', label: 'Detail', sortVal: function (e) { return e.title || e.message; }, render: function (e) { return e.title ? h('span', e.title, e.artist ? h('span.muted.small', ' · ' + e.artist) : null) : e.message ? fmt.trunc(e.message, 80) : null; } },
        { key: 'platform', label: 'Device', render: function (e) { return VX.platformName(e.platform); } },
        { key: 'city', label: 'City' }
      ],
      rows: arr(p.activity), exportName: 'vinax-activity', search: 'Search activity…', pageSize: 25, sortKey: 'at',
      empty: { title: 'No activity yet', hint: 'What they do in the app shows up here.' }
    });
  }
})();
