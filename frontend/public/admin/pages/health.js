/* VinaX console — App Health (console rebuild).
 * Is everything working? Tabs:
 *   errors           App Errors: what went wrong in the app, grouped, with a status per problem (/api/admin/errors)
 *   checks           Server Checks: today's server requests against the free plan's daily allowance
 *                    (/api/admin/quota), then the website and the services the app calls (/api/admin/edge)
 *   sources          Music Sources: each music source checked with a one-song search (/api/admin/musicapi)
 *   ai               AI Assistant: VinaX AI's providers and models (/api/admin/ai)
 *   versions         App Versions: releases and builds (/api/admin/releases)
 *   keys             API Keys Status: Set ✓ / Missing ✗, never values (/api/admin/envcheck)
 */
(function () {
  'use strict';
  var VX = window.VX, h = VX.h, ui = VX.ui, fmt = VX.fmt, arr = VX.arr, obj = VX.obj, num = VX.num;

  [
    { id: 'app-errors', title: 'App Errors', icon: 'alert', range: true, render: renderErrors,
      desc: 'Problems people hit in the app, grouped so the same problem shows once. Set a status as you work on each one.',
      keywords: 'errors crashes problems bugs reports' },
    { id: 'server-checks', title: 'Server Checks', icon: 'pulse', render: renderChecks,
      desc: 'Today’s server requests, and the website and every service the app calls, checked from the server right now.',
      keywords: 'status up down outage services website requests quota allowance limit 1027' },
    { id: 'music-sources', title: 'Music Sources', icon: 'music', render: renderSources,
      desc: 'Where songs come from. Each source is checked with a one-song search.',
      keywords: 'music api catalogue sources search working' },
    { id: 'ai-status', title: 'AI Assistant', icon: 'spark', render: renderAi,
      desc: 'The companies and models behind VinaX AI, and whether each one is ready.',
      keywords: 'ai vinax ai models providers chat' },
    { id: 'app-versions', title: 'App Versions', icon: 'phone', render: renderVersions,
      desc: 'The newest app release and the latest builds.',
      keywords: 'versions releases builds apk android update' },
    { id: 'api-keys', title: 'API Keys Status', icon: 'key', render: renderKeys,
      desc: 'Which service keys the server has. Only “Set” or “Missing” is shown — never the keys themselves.',
      keywords: 'keys secrets env environment configured missing' }
  ].forEach(function (p, i) {
    VX.page(Object.assign({ group: 'Health', order: i + 1 }, p));
  });

  function extLink(url, text) {
    return /^https:\/\//i.test(String(url || '')) ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, text) : text;
  }

  /* ---------------------------------------------------------- App Errors */

  var CATEGORIES = [
    { value: 'download', label: 'Download failed' },
    { value: 'playback', label: 'Playback' },
    { value: 'crash', label: 'App crash' },
    { value: 'notifications', label: 'Notifications' },
    { value: 'other', label: 'Other' }
  ];
  var STATUSES = [
    { value: 'new', label: 'New' },
    { value: 'investigating', label: 'Investigating' },
    { value: 'fixed', label: 'Fixed' },
    { value: 'ignored', label: 'Ignore' }
  ];
  var CAT_LABEL = {}; CATEGORIES.forEach(function (c) { CAT_LABEL[c.value] = c.label; });

  /** A plain sentence and a category for one error group. Exported for tests as VX.health.explain. */
  function explain(g) {
    var kind = String(g.errorKind || '').toLowerCase();
    var text = (kind + ' ' + String(g.message || '') + ' ' + String(g.shape || '')).toLowerCase();
    var android = arr(g.platforms).length === 1 && String(arr(g.platforms)[0]).toLowerCase() === 'android';
    var timedOut = /timed? ?out|timeout|took too long/.test(text);
    if (/download|offline save|save offline/.test(text)) {
      return { category: 'download', what: timedOut ? 'Song download timed out' : /space|quota|storage/.test(text) ? 'Song download stopped: the phone is out of space' : /network|fetch|connection/.test(text) ? 'Song download stopped: the connection dropped' : 'Song download failed' };
    }
    if (/push|notification|fcm|messaging|vapid/.test(text)) {
      if (/not supported|unsupported|not available/.test(text)) return { category: 'notifications', what: android ? 'Notifications not supported on this Android version' : 'Notifications not supported on this device or browser' };
      if (/denied|permission|blocked/.test(text)) return { category: 'notifications', what: 'Notifications were blocked on the device' };
      // 1.19 — Firebase's own answers, so the owner knows which is theirs to fix.
      if (/fis_auth_error|authentication_failed/.test(text)) return { category: 'notifications', what: 'Notifications blocked by Firebase: the app’s key may not use the Installations API (Google Cloud → Credentials → allow Firebase Installations and Cloud Messaging APIs)' };
      if (/service_not_available/.test(text)) return { category: 'notifications', what: 'Notifications could not register: Google Play services had no connection to Firebase at the time' };
      return { category: 'notifications', what: 'Notifications could not be set up' };
    }
    if (/play|audio|media|decode|notallowederror|src not supported|no supported source|buffer|stream/.test(text)) {
      if (/notallowed|user didn.t interact|autoplay/.test(text)) return { category: 'playback', what: 'The browser stopped a song from starting by itself' };
      if (/network|fetch|connection|offline/.test(text)) return { category: 'playback', what: 'A song stopped because the connection dropped' };
      if (/decode|not supported|no supported source|format/.test(text)) return { category: 'playback', what: 'A song’s audio could not be read' };
      return { category: 'playback', what: 'A song would not play' };
    }
    if (/react|render|component|chunk|loading chunk|crash|typeerror|referenceerror|syntaxerror|rangeerror|undefined is not|cannot read|null is not|is not a function/.test(text) || kind === 'js' || kind === 'promise') {
      if (/chunk|dynamically imported|failed to fetch dynamically/.test(text)) return { category: 'crash', what: 'Part of the app failed to load (usually right after an update)' };
      if (/react|render|component/.test(kind + ' ' + text)) return { category: 'crash', what: 'A screen of the app stopped working' };
      return { category: 'crash', what: 'Something in the app went wrong and the screen may have stopped' };
    }
    if (/failed to fetch|network|load failed|connection|offline/.test(text)) return { category: 'other', what: 'The app could not reach the server' };
    if (/quota|storage|indexeddb|disk/.test(text)) return { category: 'other', what: 'The phone or browser ran out of storage space' };
    if (/lyric/.test(text)) return { category: 'other', what: 'Lyrics could not be loaded' };
    if (/search/.test(text)) return { category: 'other', what: 'A search did not work' };
    if (/sign.?in|auth|google|session/.test(text)) return { category: 'other', what: 'Signing in did not work' };
    var clean = String(g.shape || g.message || 'Unknown problem').replace(/[#…]+/g, '').replace(/\s+/g, ' ').trim();
    clean = clean.charAt(0).toUpperCase() + clean.slice(1);
    return { category: 'other', what: fmt.trunc(clean || 'Unknown problem', 90) };
  }
  VX.health = { explain: explain };

  function renderErrors(host, ctx) {
    var days = (ctx.range && ctx.range.days) || 7;
    var filt = { category: ctx.params.category || '', platform: ctx.params.platform || '', version: ctx.params.version || '', status: ctx.params.status || '' };
    return ui.load(host, function () { return VX.api.get('/api/admin/errors', { days: days }, { fresh: true }); }, function (d) {
      var gate = ui.gate(d, ctx);
      if (gate) return gate;
      var byDay = arr(d.byDay);
      var groups = arr(d.top).map(function (g) {
        var e = explain(g);
        var what = e.what;
        if (num(g.variants) > 1) what += e.category === 'download' || e.category === 'playback' ? ' — ' + fmt.plural(g.variants, 'song') : ' (' + fmt.plural(g.variants, 'variation') + ')';
        return Object.assign({}, g, { category: e.category, what: what, status: g.status || 'new' });
      });
      var platforms = [], versions = [];
      groups.forEach(function (g) {
        arr(g.platforms).forEach(function (p) { if (platforms.indexOf(p) < 0) platforms.push(p); });
        arr(g.versions).forEach(function (v) { if (versions.indexOf(v) < 0) versions.push(v); });
      });
      versions.sort(function (a, b) { return String(b).localeCompare(String(a), undefined, { numeric: true }); });
      var rangeLabel = (ctx.range && ctx.range.label ? ctx.range.label : 'last ' + fmt.plural(days, 'day')).toLowerCase();

      function shown() {
        return groups.filter(function (g) {
          return (!filt.category || g.category === filt.category) &&
            (!filt.platform || arr(g.platforms).indexOf(filt.platform) >= 0) &&
            (!filt.version || arr(g.versions).indexOf(filt.version) >= 0) &&
            (!filt.status || g.status === filt.status);
        });
      }
      var tableHost = h('div');
      function setFilter(k, v) { filt[k] = v; ctx.setParam(k, v); drawTable(); }
      var filters = [
        ui.dropdown('Category', [{ value: '', label: 'All categories' }].concat(CATEGORIES), filt.category, function (v) { setFilter('category', v); }, { inline: true }),
        ui.dropdown('Platform', [{ value: '', label: 'All platforms' }].concat(platforms.map(function (p) { return { value: p, label: VX.platformName(p) }; })), filt.platform, function (v) { setFilter('platform', v); }, { inline: true }),
        ui.dropdown('App version', [{ value: '', label: 'All versions' }].concat(versions.map(function (v) { return { value: v, label: v }; })), filt.version, function (v) { setFilter('version', v); }, { inline: true }),
        ui.dropdown('Status', [{ value: '', label: 'Any status' }].concat(STATUSES), filt.status, function (v) { setFilter('status', v); }, { inline: true })
      ];

      function setStatus(g, status, sel) {
        var before = g.status;
        g.status = status;
        return VX.api.post('/api/admin/errors', { action: 'status', fingerprint: g.fingerprint, status: status }).then(function (res) {
          if (res.ok) VX.toast('Marked “' + (STATUSES.filter(function (s) { return s.value === status; })[0] || {}).label + '” ✓', 'ok');
          else { g.status = before; sel.value = before; VX.toast('Something went wrong — ' + res.message, 'bad'); }
        });
      }
      function drawTable() {
        VX.mount(tableHost, ui.dataTable({
          rows: shown(), rowId: function (g) { return g.fingerprint; }, exportName: 'vinax-app-errors', search: 'Search problems…',
          filters: filters, sortKey: 'hits', sortDir: 'desc',
          empty: groups.length ? { title: 'No problems match these filters', hint: 'Choose “All” in the dropdowns to see every problem.' }
            : { title: 'No app errors in this period', hint: 'Good news — nobody hit a problem the app could report.' },
          columns: [
            { key: 'what', label: 'What happened', always: true, render: function (g) {
              return h('div.err-what', h('div.cell-main', g.what), h('div.cell-sub', CAT_LABEL[g.category]));
            } },
            { key: 'details', label: 'Technical details', sort: false, csv: function (g) { return (g.errorKind || '') + ': ' + (g.message || ''); }, render: function (g) {
              return h('details.tech', h('summary', 'Show'), h('dl.kv',
                h('dt', 'Kind'), h('dd', ui.mono(g.errorKind || 'error')),
                h('dt', 'Message'), h('dd', h('span.tech-msg', g.message || '—')),
                arr(g.samples).length > 1 ? [h('dt', 'Other examples'), h('dd', h('ul.tech-list', arr(g.samples).slice(1).map(function (m) { return h('li', fmt.trunc(m, 160)); })))] : null,
                g.firstSeen ? [h('dt', 'First seen'), h('dd', fmt.full(g.firstSeen))] : null));
            } },
            { key: 'hits', label: 'Times seen', align: 'right', render: function (g) { return fmt.num(g.hits); } },
            { key: 'users', label: 'Users affected', align: 'right', render: function (g) { return fmt.num(g.users); } },
            { key: 'platforms', label: 'Platforms', sortVal: function (g) { return arr(g.platforms).join(', '); }, render: function (g) { return arr(g.platforms).map(VX.platformName).join(', ') || null; } },
            { key: 'versions', label: 'Versions', sortVal: function (g) { return arr(g.versions).join(', '); }, render: function (g) { var v = arr(g.versions); return v.length ? v.slice(0, 3).join(', ') + (v.length > 3 ? ' +' + (v.length - 3) : '') : null; } },
            { key: 'lastSeen', label: 'Last seen', nowrap: true, render: function (g) { return ui.ago(g.lastSeen); } },
            { key: 'status', label: 'Status', sortVal: function (g) { return g.status; }, render: function (g) {
              var sel = ui.select(STATUSES, g.status, { 'aria-label': 'Status for: ' + g.what, disabled: !VX.can('edit') });
              sel.classList.add('status-sel', 'st-' + g.status);
              sel.addEventListener('change', function () { sel.className = 'input status-sel st-' + sel.value; setStatus(g, sel.value, sel); });
              return sel;
            } }
          ]
        }));
      }
      drawTable();

      function clear() {
        return VX.confirm({ title: 'Clear every error report?', body: 'All app error reports are deleted for good. Plays and everything else stay. Statuses you set come back if the same problem happens again.', danger: true, typed: true, confirmLabel: 'Clear errors' }).then(function (yes) {
          if (!yes) return;
          return VX.api.post('/api/admin/errors', { action: 'clear' }).then(function (res) {
            VX.toast(res.ok ? fmt.plural(obj(res.data).deleted, 'error report') + ' cleared ✓' : 'Something went wrong — ' + res.message, res.ok ? 'ok' : 'bad');
            if (res.ok) ctx.refresh();
          });
        });
      }
      var open = groups.filter(function (g) { return g.status === 'new' || g.status === 'investigating'; }).length;
      return [
        ui.stats([
          { label: 'Total errors', value: fmt.num(d.total), sub: rangeLabel, tone: num(d.total) ? 'warn' : 'ok', info: 'Every error report the app sent in this period, from everyone. One person hitting the same problem twice counts twice.' },
          { label: 'Different problems', value: fmt.num(d.groups), sub: fmt.num(open) + ' still open', info: 'Reports grouped so the same problem counts once — for example, one download timing out on 14 songs is one problem.' },
          { label: 'Users affected', value: fmt.num(d.users), sub: 'signed in with Google', info: 'How many signed-in people hit at least one problem. People who never signed in are not counted here, but their reports are in Total errors.' }
        ]),
        ui.card({ title: 'Errors per day', sub: 'Days in ' + VX.tzShort(), body: ui.chart({ labels: byDay.map(function (r) { return r.day; }), series: [{ name: 'Errors', values: byDay.map(function (r) { return num(r.hits); }), color: 'var(--c5)' }], type: 'bar', height: 180, empty: 'No errors in this period' }) }),
        ui.card({ title: 'Problems', sub: 'Most frequent first', pad: false,
          actions: VX.can('owner') && groups.length ? [ui.button('Clear errors', { kind: 'danger', small: true, icon: 'trash', onClick: clear })] : null,
          body: tableHost })
      ];
    });
  }

  /* ------------------------------------------------------- Server Checks */

  function renderChecks(host, ctx) {
    var body = h('div');
    var meter = h('div.request-meter');
    host.appendChild(meter);
    host.appendChild(h('div.toolbar', ui.button('Check again', { kind: 'primary', icon: 'refresh', onClick: function () { loadMeter(); return load(); } }), ui.muted('About 25 quick checks of the live site. Allowed a few times a minute.')));
    host.appendChild(body);
    function loadMeter() {
      return ui.load(meter, function () { return VX.api.get('/api/admin/quota', null, { fresh: true, timeout: 20000 }); }, function (d) { return meterCard(d, ctx); }, { skeleton: 3 });
    }
    loadMeter();
    function load() {
      return ui.load(body, function () { return VX.api.get('/api/admin/edge', null, { fresh: true, timeout: 40000 }); }, function (d) {
        var shell = obj(d.shell), assets = arr(d.assets), eps = arr(d.endpoints);
        var badAssets = assets.filter(function (a) { return !a.ok; }).length;
        var badEps = eps.filter(function (e) { return !e.ok; }).length;
        var result = function (ok) { return ok ? ui.pill('Working ✓', 'ok') : ui.pill('Not working ✗', 'bad'); };
        return [
          d.healthy ? ui.notice('All good — the website and every service answered as expected.', 'ok')
            : ui.notice(fmt.plural(d.problems, 'problem') + ' found. Anything not working is listed first.', 'bad'),
          ui.stats([
            { label: 'Website', value: shell.ok ? 'Working ✓' : 'Not working ✗', sub: shell.ok ? 'answered in ' + fmt.ms(shell.ms) : null, tone: shell.ok ? 'ok' : 'bad', info: 'Whether the main web page of the app loads.' },
            { label: 'Website files', value: fmt.num(assets.length - badAssets) + ' of ' + fmt.num(assets.length), sub: 'loading correctly', tone: badAssets ? 'bad' : null, info: 'The scripts and styles the web page needs. If one is broken, the web app can show a blank screen.' },
            { label: 'Services', value: fmt.num(eps.length - badEps) + ' of ' + fmt.num(eps.length), sub: 'working', tone: badEps ? 'bad' : null, info: 'The server features the app uses on every visit, such as settings, banners and search.' },
            { label: 'Website version', value: shell.build || '—', info: 'Which build of the website is live right now.' }
          ]),
          ui.grid([
            ui.card({ title: 'Services the app uses', pad: false, body: ui.dataTable({
              rows: eps.slice().sort(function (a, b) { return (a.ok ? 1 : 0) - (b.ok ? 1 : 0); }), exportName: 'vinax-server-checks', search: false, pageSize: 50,
              empty: 'Nothing was checked',
              columns: [
                { key: 'ok', label: 'Result', sortVal: function (r) { return r.ok ? 1 : 0; }, render: function (r) { return result(r.ok); } },
                { key: 'name', label: 'Service', always: true, render: function (r) { return h('div', h('div.cell-main', r.name || '—'), h('div.cell-sub', r.path || '')); } },
                { key: 'ms', label: 'Answered in', align: 'right', render: function (r) { return fmt.ms(r.ms); } },
                { key: 'note', label: 'Note', render: function (r) { return r.note ? fmt.trunc(r.note, 70) : null; } }
              ]
            }) }),
            ui.card({ title: 'Website files', sub: 'Each must load as a real script or style', pad: false, body: ui.dataTable({
              rows: assets.slice().sort(function (a, b) { return (a.ok ? 1 : 0) - (b.ok ? 1 : 0); }), exportName: false, search: false, pageSize: 50,
              empty: shell.ok ? 'The page uses no separate files' : 'The website did not load, so its files could not be checked',
              columns: [
                { key: 'ok', label: 'Result', sortVal: function (r) { return r.ok ? 1 : 0; }, render: function (r) { return result(r.ok); } },
                { key: 'path', label: 'File', render: function (r) { return h('span', { title: r.path }, fmt.trunc(String(r.path || '').split('/').pop(), 40)); } },
                { key: 'ms', label: 'Loaded in', align: 'right', render: function (r) { return fmt.ms(r.ms); } }
              ]
            }) })
          ], 2)
        ];
      });
    }
    return load();
  }

  /* ---------------------------------------------- Daily request meter */

  // What each outcome Cloudflare counts means, in plain words.
  var OUTCOME = {
    success: 'Answered', scriptThrewException: 'Failed in the server code', exceededResources: 'Ran out of time or memory',
    exceededCpu: 'Ran out of time', exceededMemory: 'Ran out of memory', clientDisconnected: 'The person left before the answer',
    internalError: 'Failed inside Cloudflare', responseStreamDisconnected: 'Answer cut off', loadSheddingRejected: 'Turned away by Cloudflare', unknown: 'Unknown'
  };
  var METER_KEYS = ['CF_ANALYTICS_TOKEN', 'CF_ACCOUNT_ID'];

  /** The meter, or its setup card when the two keys are not set. Exported for tests as VX.health.meterCard. */
  function meterCard(d, ctx) {
    d = obj(d);
    var allowance = num(d.allowance) || 100000;
    if (d.configured === false) {
      var missing = arr(d.missing).length ? arr(d.missing) : METER_KEYS;
      return ui.card({
        title: 'Daily request meter is not set up', tone: 'warn',
        body: [
          h('p', 'The free plan allows ' + fmt.num(allowance) + ' server requests a day. When they run out, everything in the app that needs the server stops working until 05:30 India time. Add two keys to see today’s count here, on the Dashboard and in Smart Alerts.'),
          h('ol.steps', { style: { 'margin-top': '10px' } },
            h('li', 'In Cloudflare, open My Profile › API Tokens › Create Token › Custom token, and give it only ', h('strong', 'Account › Account Analytics › Read'), '.'),
            h('li', 'Set the Worker keys ', h('code.mono', 'CF_ANALYTICS_TOKEN'), ' (that token) and ', h('code.mono', 'CF_ACCOUNT_ID'), ' (the account id on the Workers page).'),
            h('li', 'Come back to this page. The count shows on the next check.')),
          h('pre.json', { style: { 'margin-top': '10px' } }, missing.map(function (k) { return 'npx wrangler secret put ' + k + ' --config worker/wrangler.toml'; }).join('\n')),
          ctx && ctx.go ? h('div.toolbar', { style: { 'margin-top': '12px' } }, ui.button('See API Keys Status', { kind: 'ghost', small: true, icon: 'key', onClick: function () { ctx.go('api-keys'); } })) : null
        ]
      });
    }
    var used = num(d.requests), share = allowance ? used / allowance : 0;
    // The server says the level (_lib/cfAnalytics.ts usageLevel); the same thresholds when it does not.
    var level = d.level === 'ok' || d.level === 'warn' || d.level === 'bad' ? d.level : share >= 0.95 ? 'bad' : share >= 0.8 ? 'warn' : 'ok';
    var left = Math.max(0, allowance - used);
    var scripts = arr(d.byScript), outcomes = arr(d.byStatus);
    var reset = d.resetsAt ? fmt.time(d.resetsAt) + ' ' + VX.tzShort() : '05:30 India time';
    return ui.card({
      title: 'Server requests today', sub: 'Free plan: ' + fmt.num(allowance) + ' a day, counted from 00:00 UTC', span: 'full',
      body: [
        level !== 'ok' ? ui.notice(share >= 1
          ? 'Today’s requests have run out. Everything that needs the server fails until ' + reset + '.'
          : fmt.pct(Math.floor(share * 100)) + ' used. At 100% everything that needs the server stops until ' + reset + '. Look for a bot or a page sending too many requests.', level) : null,
        ui.stats([
          { label: 'Used today', value: fmt.num(used), sub: 'of ' + fmt.num(allowance), tone: level === 'ok' ? null : level, info: 'Requests every Worker on the Cloudflare account answered since 00:00 UTC. The allowance is for the whole account.' },
          { label: 'Left today', value: fmt.num(left), sub: fmt.pct(Math.max(0, 100 - Math.floor(share * 100))) + ' of the day’s allowance', info: 'How many more requests can be answered before the day’s allowance runs out.' },
          { label: 'Ended in an error', value: fmt.num(d.errors), sub: used ? fmt.ratio(num(d.errors) / used) + ' of today’s requests' : null, tone: num(d.errors) ? 'warn' : null, info: 'Requests where the server code failed or ran out of time. They still count toward the allowance.' },
          { label: 'Starts again', value: reset, sub: d.resetsAt ? fmt.ago(d.resetsAt) : null, info: 'The allowance starts again every day at 00:00 UTC, which is 05:30 India time.' }
        ]),
        ui.meter(share, level, 'Server requests used today'),
        h('p.muted.small', { style: { 'margin-top': '6px' } }, fmt.pct(Math.floor(share * 100)) + ' used · updated ' + (d.checkedAt ? fmt.ago(d.checkedAt) : '—') + ' (at most every 10 minutes)'),
        scripts.length > 1 || outcomes.length ? ui.grid([
          scripts.length > 1 ? h('div', h('h3.subhead', 'By Worker'), ui.hbars(scripts.map(function (r) { return { label: r.script || 'Unknown', value: num(r.requests), sub: num(r.errors) ? fmt.plural(r.errors, 'error') : null }; }), { limit: 6 })) : null,
          outcomes.length ? h('div', h('h3.subhead', 'How they ended'), ui.hbars(outcomes.map(function (r) { return { label: OUTCOME[r.status] || fmt.label(r.status), value: num(r.requests) }; }), { limit: 6 })) : null
        ].filter(Boolean), 2) : null,
        h('p.muted.small', 'Cloudflare’s count does not say which addresses were asked for. To find a bot or page using up the requests, open the Worker’s Metrics in the Cloudflare dashboard.')
      ]
    });
  }
  VX.health.meterCard = meterCard;

  /* ------------------------------------------------------- Music Sources */

  var SOURCE_LABEL = { 'vinax-cat': 'VinaX music catalogue', direct: 'Backup source (JioSaavn)' };
  function renderSources(host) {
    var body = h('div');
    VX.mount(body, ui.emptyState('Not checked yet', 'Press “Check sources” to search each source for one song. It takes up to 10 seconds.'));
    function check() {
      return ui.load(body, function () { return VX.api.get('/api/admin/musicapi', null, { fresh: true, timeout: 30000 }); }, function (d) {
        var rows = arr(d.mirrors).map(function (m, i) {
          var state = !m.ok ? 'down' : num(m.songs) > 0 ? 'ok' : 'empty';
          return { label: SOURCE_LABEL[m.id] || m.label || 'Source ' + (i + 1), state: state, songs: m.songs, ms: m.ms, note: m.note };
        });
        var up = rows.filter(function (r) { return r.state === 'ok'; }).length;
        return [
          ui.notice(fmt.num(up) + ' of ' + fmt.plural(rows.length, 'source') + ' found songs · checked at ' + fmt.time(d.checkedAt) + ' ' + VX.tzShort(), up ? (up === rows.length ? 'ok' : 'warn') : 'bad'),
          ui.dataTable({
            rows: rows, exportName: false, search: false, empty: 'No sources reported',
            columns: [
              { key: 'label', label: 'Source', always: true },
              { key: 'state', label: 'Result', render: function (r) { return r.state === 'ok' ? ui.pill('Working ✓', 'ok') : r.state === 'empty' ? ui.pill('Answered, found nothing', 'warn') : ui.pill('Not working ✗', 'bad'); } },
              { key: 'songs', label: 'Songs found', align: 'right', render: function (r) { return fmt.num(r.songs); } },
              { key: 'ms', label: 'Answered in', align: 'right', render: function (r) { return fmt.ms(r.ms); } },
              { key: 'note', label: 'Note' }
            ]
          })
        ];
      });
    }
    host.appendChild(ui.card({
      title: 'Music sources', sub: 'Where search results and songs come from. Turn sources on or off in App Settings → Search & Music Sources.',
      actions: [ui.button('Check sources', { kind: 'primary', small: true, icon: 'refresh', onClick: check })],
      body: body
    }));
    return Promise.resolve();
  }

  /* -------------------------------------------------------- AI Assistant */

  var REST_REASON = {
    rate: 'Too many requests', quota: 'Daily allowance used up', gone: 'Model no longer offered', auth: 'Key refused',
    forbidden: 'Not allowed for this key', upstream: 'The company had a problem', timeout: 'Too slow', network: 'Could not be reached',
    empty: 'Gave an empty answer', bad_request: 'Request refused', not_configured: 'No key'
  };
  function reason(kind) { return REST_REASON[kind] || (kind ? fmt.label(kind) : '—'); }
  function until(iso) { return iso ? h('span', { title: fmt.full(iso) }, 'until ' + fmt.time(iso)) : null; }

  var SEARCH_NAME = { tavily: 'Tavily', serper: 'Serper' };
  var SEARCH_FAIL = {
    not_configured: 'No search key, or the daily limit is 0', daily_limit: 'Today’s searches are used up',
    timeout: 'Too slow (no answer in 8 s)', empty: 'Answered, but found nothing'
  };
  function searchFail(r) {
    if (r.reason === 'failed') return r.status ? 'Refused (HTTP ' + r.status + ')' + (r.status === 401 || r.status === 403 ? ': check the key' : r.status === 429 || r.status === 432 || r.status === 433 ? ': credits or rate limit' : '') : 'Could not be reached';
    return SEARCH_FAIL[r.reason] || fmt.label(r.reason || 'failed');
  }

  /** The search API (Tavily or Serper) and the owner's Test search: one real search, counted like any other. */
  function searchCard(api) {
    var result = h('div', { 'aria-live': 'polite' });
    var name = SEARCH_NAME[api.provider] || fmt.label(api.provider || 'tavily');
    function test() {
      VX.mount(result, ui.muted('Searching…'));
      return VX.api.post('/api/admin/ai-search', {}, { timeout: 20000 }).then(function (res) {
        var r = obj(res.data);
        if (!res.ok) return VX.mount(result, ui.pill(res.message || 'Failed', 'bad'));
        var who = SEARCH_NAME[r.provider] || name;
        VX.mount(result, r.ok
          ? h('span', ui.pill('Working ✓', 'ok'), ' ' + fmt.plural(r.count, 'result') + ' in ' + fmt.ms(r.ms) + ' from ' + who, r.site ? ui.muted(' · first: ' + r.site) : null)
          : h('span', ui.pill(searchFail(r), 'bad'), ui.muted(' · ' + who + (r.ms ? ' · ' + fmt.ms(r.ms) : ''))));
      });
    }
    return ui.card({
      title: 'Web search', sub: 'Test search runs one real search, the way a chat does. It counts as one of today’s searches.',
      actions: [VX.can('edit') ? ui.button('Test search', { kind: 'primary', small: true, icon: 'search', disabled: !api.configured, onClick: test }) : null],
      body: [
        ui.dl([
          ['Search service', api.configured ? h('span', ui.pill('Set ✓', 'ok'), ' ' + name) : ui.pill('Not set up', 'warn')],
          ['Searches today', api.usedToday == null ? '—' : fmt.num(api.usedToday) + ' of ' + fmt.num(api.dailyLimit)]
        ]),
        result
      ]
    });
  }

  /** "82% 👍 · 17" from a model's thumbs in the window, or null with none. */
  function scoreOf(f) {
    var up = num(f && f.up), down = num(f && f.down), total = up + down;
    return total ? { share: up / total, total: total, up: up, down: down } : null;
  }

  function renderAi(host, ctx) {
    return ui.load(host, function () { return VX.api.get('/api/admin/ai', null, { fresh: true }); }, function (d) {
      var st = obj(d.settings), providers = arr(d.providers), models = arr(d.models);
      var search = obj(d.search), voice = obj(d.voice);
      var keyed = providers.filter(function (p) { return p.configured; }).length;
      var resting = models.filter(function (m) { return m.restingUntil; }).length;
      var testers = arr(st.testers).length;
      var cells = {};
      var progress = h('span.muted.small');
      var testable = models.filter(function (m) { return m.configured && m.ownerEnabled; });
      function testOne(m) {
        var cell = cells[m.id];
        VX.mount(cell, ui.muted('Testing…'));
        return VX.api.post('/api/admin/ai', { model: m.id }, { timeout: 45000 }).then(function (res) {
          var r = obj(res.data);
          if (!res.ok) return VX.mount(cell, ui.pill(res.message || 'Failed', 'bad'));
          VX.mount(cell, r.ok ? ui.pill('Working ✓ · ' + fmt.ms(r.firstTokenMs), 'ok') : ui.pill(reason(r.kind), 'bad'));
        });
      }
      function testAll() {
        var i = 0;
        function next() {
          if (i >= testable.length) { progress.textContent = 'Tested ' + fmt.plural(testable.length, 'model') + '.'; return Promise.resolve(); }
          var m = testable[i]; i += 1;
          progress.textContent = 'Testing ' + i + ' of ' + testable.length + '…';
          return testOne(m).then(next);
        }
        return next();
      }
      var g = obj(search.grounding), api = obj(search.api);
      // The listeners' thumbs on each model's replies (POST /api/ai/feedback); null when the database cannot say.
      var fb = d.feedback && typeof d.feedback === 'object' ? d.feedback : null;
      var fbDays = fb ? num(fb.days) || 30 : 30;
      models.forEach(function (m) { m.score = fb ? scoreOf(obj(fb.models)[m.id]) : null; });
      return [
        st.enabled ? ui.notice('VinaX AI is open to everyone signed in with Google.', 'ok')
          : ui.notice(testers ? 'VinaX AI is only open to ' + fmt.plural(testers, 'tester') + ' right now.' : 'VinaX AI is switched off for everyone.', 'warn'),
        ui.stats([
          { label: 'AI companies ready', value: keyed + ' of ' + providers.length, tone: keyed ? null : 'bad', info: 'AI companies the server has a key for. VinaX AI needs at least one.' },
          { label: 'Models resting', value: fmt.num(resting), sub: 'of ' + fmt.num(models.length), tone: resting ? 'warn' : 'ok', info: 'Models paused for a while because they were busy, out of allowance or failing. The assistant uses the next model meanwhile.' },
          { label: 'Free web searches today', value: g.usedToday == null ? '—' : fmt.num(g.usedToday), sub: 'of ' + fmt.num(g.dailyLimit), info: 'Web searches answered through Google’s free daily allowance.' },
          { label: 'Paid web searches today', value: api.usedToday == null ? '—' : fmt.num(api.usedToday), sub: api.configured ? 'of ' + fmt.num(api.dailyLimit) : 'not set up', info: 'Web searches through the separate search service, which has its own daily limit.' }
        ]),
        ui.card({ title: 'AI companies', sub: 'Keys show as Set or Missing, never the key itself', pad: false, body: ui.dataTable({
          rows: providers, exportName: false, search: false, rowId: function (p) { return p.name; },
          columns: [
            { key: 'name', label: 'Company', always: true },
            { key: 'configured', label: 'Key', render: function (p) { return p.configured ? ui.pill('Set ✓', 'ok') : ui.pill('Missing ✗', 'warn'); } },
            { key: 'restingUntil', label: 'Paused', render: function (p) { return until(p.restingUntil) || 'No'; } },
            { key: 'lastError', label: 'Last problem', sort: false, render: function (p) { var e = p.lastError; return e ? h('span', reason(e.kind), ui.muted(' · ' + fmt.ago(e.at))) : 'None'; } }
          ]
        }) }),
        ui.card({ title: 'Models', sub: 'Testing sends each switched-on model one tiny message. It uses a little free allowance, so it only runs when you press it. Thumbs up is the share of people’s ratings of each model’s replies that were thumbs up, over the last ' + fbDays + ' days. A model joins the menu only when its id is added to APPROVED_MODELS in models.ts.',
          actions: [progress, VX.can('edit') ? ui.button('Test all models', { kind: 'primary', small: true, icon: 'refresh', disabled: !testable.length, onClick: testAll }) : null],
          pad: false,
          body: ui.dataTable({
            rows: models, exportName: 'vinax-ai-models', search: models.length > 12 ? 'Search models…' : false, rowId: function (m) { return m.id; },
            columns: [
              { key: 'name', label: 'Model', always: true, render: function (m) { return h('div', h('div.cell-main', m.name), h('div.cell-sub', m.provider)); } },
              { key: 'group', label: 'In the model menu', render: function (m) { return m.group ? 'Yes' : ui.muted('Only for automatic choice'); } },
              { key: 'score', label: 'Thumbs up', align: 'right',
                sortVal: function (m) { return m.score ? m.score.share : -1; },
                csv: function (m) { return m.score ? Math.round(m.score.share * 100) + '% of ' + m.score.total : ''; },
                render: function (m) {
                  if (!m.score) return ui.muted(fb ? 'No ratings' : '—');
                  return h('div', { title: fmt.num(m.score.up) + ' up, ' + fmt.num(m.score.down) + ' down in the last ' + fbDays + ' days' },
                    h('div.cell-main', fmt.ratio(m.score.share, 0)), h('div.cell-sub', fmt.plural(m.score.total, 'rating')));
                } },
              { key: 'ownerEnabled', label: 'Switched on', render: function (m) {
                // Paused: on the approved list but failed the live check, so offered nowhere until it is moved back (models.ts PAUSED_MODELS).
                if (m.paused) return h('span', ui.pill('Paused', 'warn'), ui.muted(' · failed the live check; the daily model check (or Test) brings it back once it answers'));
                // Back: paused, but its latest daily check passed, so it is in the model menu again (picked by hand only).
                if (m.revived && m.ownerEnabled) return h('span', ui.pill('Back', 'ok'), ui.muted(' · passed the daily model check; picked by hand only, never in Auto'));
                return m.ownerEnabled ? ui.pill('On', 'ok') : ui.pill('Off');
              } },
              { key: 'restingUntil', label: 'Ready?', render: function (m) {
                if (!m.configured) return ui.muted('No key');
                if (m.restingUntil) return h('span', ui.pill(reason(m.restKind), 'warn'), ' ', until(m.restingUntil));
                return ui.pill('Ready ✓', 'ok');
              } },
              { key: 'test', label: 'Test', sort: false, render: function (m) {
                var cell = h('span', m.configured && VX.can('edit') ? ui.button('Test', { small: true, ariaLabel: 'Test ' + m.name, onClick: function () { return testOne(m); } }) : ui.muted('—'));
                cells[m.id] = cell;
                return cell;
              } }
            ]
          }) }),
        searchCard(api),
        ui.card({ title: 'Voice', body: ui.dl([
          ['Talk instead of typing', voice.dictation ? ui.pill('Available ✓', 'ok') : ui.pill('Needs a Groq or Gemini key', 'warn')],
          ['Read answers aloud', voice.readAloud ? ui.pill('Available ✓', 'ok') : ui.pill('Needs a Groq or Gemini key', 'warn')],
          ['Live voice chat', voice.live ? ui.pill('Available ✓', 'ok') : ui.pill('Needs a Gemini key', 'warn')]
        ]) }),
        h('p.muted.small', 'Open VinaX AI to everyone, choose testers and switch models on or off in ',
          h('a', { href: '#/app-settings/features', onclick: function (e) { e.preventDefault(); ctx.go('app-settings/features'); } }, 'App Settings → Features & AI'), '.')
      ];
    });
  }

  /* -------------------------------------------------------- App Versions */

  function runTone(r) {
    if (r.status && r.status !== 'completed') return { tone: 'info', label: r.status === 'in_progress' ? 'Running' : 'Waiting' };
    if (r.conclusion === 'success') return { tone: 'ok', label: 'Passed ✓' };
    if (r.conclusion === 'failure' || r.conclusion === 'timed_out') return { tone: 'bad', label: 'Failed ✗' };
    if (r.conclusion === 'cancelled' || r.conclusion === 'skipped') return { tone: null, label: r.conclusion === 'cancelled' ? 'Cancelled' : 'Skipped' };
    return { tone: 'warn', label: r.conclusion ? fmt.label(r.conclusion) : 'Unknown' };
  }
  function took(r) {
    if (!r.started || !r.finished || r.status !== 'completed') return null;
    var s = (Date.parse(r.finished) - Date.parse(r.started)) / 1000;
    return isFinite(s) && s >= 0 ? s : null;
  }
  function renderVersions(host, ctx) {
    return ui.load(host, function () { return VX.api.get('/api/admin/releases', null, { timeout: 30000 }); }, function (d) {
      if (d.configured === false) {
        return ui.card({ title: 'Release information is not connected', tone: 'warn', body: [
          h('p', 'The server needs the “App releases access” key to read releases and builds. Until then this tab has nothing to show, and Android’s update check may not work.'),
          h('div.toolbar', { style: { 'margin-top': '12px' } }, ui.button('See API Keys Status', { kind: 'ghost', small: true, icon: 'key', onClick: function () { ctx.go('api-keys'); } }))
        ] });
      }
      var rel = d.release, live = d.live && typeof d.live === 'object' ? d.live : null;
      var runs = arr(d.runs), commits = arr(d.commits);
      var failing = runs.filter(function (r) { return runTone(r).tone === 'bad'; }).length;
      return [
        d.tokenRejected ? ui.notice('The release service refused the server’s key — it expired or was removed. A developer needs to add a new one (API Keys Status → App releases access).', 'bad') : null,
        ui.stats([
          { label: 'Newest release', value: rel ? rel.tag || rel.name || '—' : 'None', info: 'The newest app version published for download.' },
          { label: 'Android version offered', value: live && live.version ? live.version : '—', sub: live && live.build ? 'build ' + fmt.num(live.build) : null, info: 'The version Android phones are told to update to.' },
          { label: 'Oldest version allowed', value: live && live.minBuild ? 'build ' + fmt.num(live.minBuild) : 'Any', info: 'Phones older than this must update before using the app. Change it in App Settings → App Updates.' },
          { label: 'Failed builds', value: fmt.num(failing), sub: 'of the last ' + fmt.num(runs.length), tone: failing ? 'warn' : null, info: 'Automatic builds and checks that failed recently. A developer usually fixes these.' }
        ]),
        ui.grid([
          ui.card({ title: 'What’s in the newest release', sub: rel ? rel.tag || '' : null, body: rel ? [
            rel.notes ? h('div.release-notes', rel.notes) : ui.muted('No release notes.'),
            arr(rel.assets).length ? h('ul.list', { style: { 'margin-top': '10px' } }, arr(rel.assets).map(function (a) { return h('li', VX.icon('download'), h('span.grow', extLink(a.url, a.name || 'file'))); })) : null
          ] : ui.emptyState('No release yet', 'The newest release appears here once one is published.') }),
          ui.card({ title: 'Recent changes', sub: 'Newest 10', body: commits.length ? h('ul.list.feed', commits.map(function (c) {
            return h('li', h('span.feed-time', c.at ? fmt.ago(c.at) : '—'), h('div.grow', h('div.cell-main', extLink(c.url, fmt.trunc(String(c.message || '—').split('\n')[0], 110))), h('div.cell-sub', c.author || '')));
          })) : ui.emptyState('No changes listed') })
        ], 2),
        ui.card({ title: 'Builds and checks', sub: 'The newest 20', pad: false, body: ui.dataTable({
          rows: runs, exportName: 'vinax-builds', search: 'Search builds…', rowId: function (r, i) { return String(r.url || i); },
          empty: { title: 'No builds yet', hint: 'Builds appear after the next change is published.' },
          columns: [
            { key: 'result', label: 'Result', sortVal: function (r) { return runTone(r).label; }, render: function (r) { var t = runTone(r); return ui.pill(t.label, t.tone); } },
            { key: 'name', label: 'Build', always: true, render: function (r) { return h('div', h('div.cell-main', extLink(r.url, r.name || '—')), r.title && r.title !== r.name ? h('div.cell-sub', fmt.trunc(r.title, 80)) : null); } },
            { key: 'started', label: 'Started', nowrap: true, render: function (r) { return ui.ago(r.started); } },
            { key: 'took', label: 'Took', align: 'right', sortVal: took, render: function (r) { var s = took(r); return s == null ? null : fmt.dur(s); } }
          ]
        }) })
      ];
    });
  }

  /* ----------------------------------------------------- API Keys Status */

  var GROUP_NAME = { Admin: 'This console', Data: 'Sign-in and privacy', Catalogue: 'Music sources', Database: 'Database', Cron: 'Background jobs', Push: 'Notifications', Releases: 'App releases', Edge: 'Website', Monitoring: 'Daily request meter', 'VinaX AI': 'AI assistant' };
  function renderKeys(host) {
    return ui.load(host, function () { return VX.api.get('/api/admin/envcheck', null, { fresh: true }); }, function (d) {
      var items = arr(d.items);
      if (!items.length) return ui.emptyState('No list returned', 'The server answered without its key list.');
      var groups = [], byGroup = {};
      items.forEach(function (it) { var g = it.group || 'Other'; if (!byGroup[g]) { byGroup[g] = []; groups.push(g); } byGroup[g].push(it); });
      var missing = items.filter(function (i) { return i.required && !i.set; });
      var opt = items.filter(function (i) { return !i.required; });
      return [
        missing.length ? ui.notice('Missing: ' + missing.map(function (i) { return i.label || i.name; }).join(', ') + '. Parts of the app stop working without these.', 'bad')
          : ui.notice('Every key the app needs is set.', 'ok'),
        ui.stats([
          { label: 'Needed keys', value: fmt.num(items.filter(function (i) { return i.required && i.set; }).length) + ' of ' + fmt.num(items.filter(function (i) { return i.required; }).length), sub: 'set', tone: missing.length ? 'bad' : 'ok', info: 'Keys the app cannot work without.' },
          { label: 'Optional keys', value: fmt.num(opt.filter(function (i) { return i.set; }).length) + ' of ' + fmt.num(opt.length), sub: 'set', info: 'Keys that switch on extra features, such as notifications or AI companies.' }
        ]),
        ui.grid(groups.map(function (g) {
          var list = byGroup[g];
          var bad = list.some(function (i) { return i.required && !i.set; });
          return ui.card({ title: GROUP_NAME[g] || g, tone: bad ? 'bad' : null, body: h('ul.list.key-status', list.map(function (i) {
            return h('li',
              h('div.key-state', i.set ? ui.pill('Set ✓', 'ok') : i.required ? ui.pill('Missing ✗', 'bad') : ui.pill('Not set')),
              h('div.grow',
                h('div.cell-main', i.label || i.name, i.required ? h('span.muted.small', ' · needed') : null),
                i.note ? h('div.cell-sub', i.note) : null,
                h('div.tech-name', i.name)));
          })) });
        })),
        h('details.dev-help', h('summary', 'How a developer adds a missing key'),
          h('p.muted.small', 'From the backend folder of the code, run the command below and paste the value when asked. It works on the next request; nothing needs redeploying.'),
          h('pre.json', 'npx wrangler secret put <NAME> --config worker/wrangler.toml'))
      ];
    });
  }
})();
