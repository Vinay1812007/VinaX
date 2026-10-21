/* VinaX console — Health page.
 * Is everything working? Live AI-key pings, per-lane success and database
 * freshness (/api/admin/health — spends a few model tokens, so it runs once
 * per visit and on a button press, never on auto-refresh), app errors and web
 * vitals (/api/admin/technical), the public endpoints and shell assets
 * (/api/admin/edge), scheduled jobs (/api/admin/cron), data quality
 * (/api/admin/dataquality), releases and CI (/api/admin/releases), the server
 * secrets checklist (/api/admin/envcheck) and the public status note + uptime
 * history (config key 'status-note', same-origin /api/status). */
(function () {
  'use strict';
  var VX = window.VX, h = VX.h, ui = VX.ui, fmt = VX.fmt;

  VX.page({
    id: 'health', title: 'Health', group: 'System', icon: 'pulse', noAuto: true,
    desc: 'Is everything working: AI keys, errors, endpoints, scheduled jobs, releases and server secrets.',
    tabs: [
      { id: 'status', label: 'System status', desc: 'Live check of every AI key, AI lane success over 24 hours and when the database last received data.', render: renderStatus },
      { id: 'errors', label: 'App errors', desc: 'Errors the app reported, which versions listeners run, and loading speed from real devices.', render: renderErrors },
      { id: 'edge', label: 'Endpoints', desc: 'The live web app shell, its scripts and styles, and every public endpoint, checked from the server.', render: renderEdge },
      { id: 'cron', label: 'Scheduled jobs', desc: 'Each scheduled job leaves a footprint when it runs; this shows when it last did.', render: renderCron },
      { id: 'data', label: 'Data quality', desc: 'How complete the newest analytics and AI records are, and how much error budget is left.', render: renderData },
      { id: 'releases', label: 'Releases', desc: 'The newest Android release, recent build runs and commits on main.', render: renderReleases },
      { id: 'env', label: 'Server secrets', desc: 'Which secrets and settings the Worker has. Names only — values are never shown.', render: renderEnv },
      { id: 'status-note', label: 'Status note', desc: 'The note on the public status page, and the uptime the status page reports.', render: renderStatusNote }
    ]
  });

  /* ------------------------------------------------------------ helpers */

  function extLink(url, text) {
    return /^https:\/\//i.test(String(url || '')) ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, text) : text;
  }
  function dbNotConnected() {
    return ui.empty('Database not connected', 'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the Worker, then run frontend/supabase/vinax-13.sql in the database SQL editor.');
  }
  function unavailableNotice(list, names) {
    list = (list || []).filter(Boolean);
    if (!list.length) return null;
    return ui.notice('Some parts could not be read from the database: ' + list.map(function (k) { return (names && names[k]) || k; }).join(', ') + '. The rest of this page is current.', 'warn');
  }
  function agoCell(iso) { return iso ? h('span', { title: fmt.dateTime(iso) }, fmt.ago(iso)) : h('span.muted', '—'); }

  /* --------------------------------------------------- System status tab */

  // One live check per visit: the result is reused for five minutes so the
  // top bar's refresh and tab switches do not spend model tokens again (the
  // route also allows only a few checks a minute).
  var healthCache = null;
  var HEALTH_TTL = 5 * 60 * 1000;

  function renderStatus(host, ctx) {
    var bar = h('div.toolbar');
    var body = h('div.page-body');
    host.appendChild(bar);
    host.appendChild(body);

    function paintBar() {
      VX.mount(bar,
        ui.button(healthCache ? 'Run checks again' : 'Run checks', { kind: 'primary', icon: 'refresh', onClick: run }),
        healthCache ? ui.muted('Checked ' + fmt.ago(healthCache.at) + ' · each check sends one tiny request to every AI provider') : ui.muted('Sends one tiny request to every AI provider.'));
    }
    function run() {
      return ui.load(body, function () { return VX.api.get('/api/admin/health', null, { fresh: true, timeout: 40000 }); }, function (d) {
        healthCache = { at: Date.now(), data: d };
        paintBar();
        return statusView(d, ctx);
      }).then(function (res) { if (res === null || (res && !res.ok)) paintBar(); });
    }
    paintBar();
    if (healthCache && Date.now() - healthCache.at < HEALTH_TTL) {
      VX.mount(body, statusView(healthCache.data, ctx));
      return Promise.resolve();
    }
    return run();
  }

  function providerLabel(row) {
    var k = String(row.key || '').split(' · ')[0];
    return k || row.provider || '—';
  }

  function statusView(d, ctx) {
    var ai = d.ai || d.providers || [];
    var db = d.supabase || d.database || {};
    var lanes = d.lanes || [];
    var configured = ai.filter(function (r) { return r.configured; });
    var working = configured.filter(function (r) { return r.ok; });
    var busy = lanes.filter(function (l) { return Number(l.calls) > 0; });
    var totalCalls = lanes.reduce(function (a, l) { return a + (Number(l.calls) || 0); }, 0);
    var dbTone = !db.configured ? 'bad' : !db.readable ? 'bad' : db.lastEventAt ? 'ok' : 'warn';

    var aiTable = ui.table({
      columns: [
        { key: 'provider', label: 'Provider', sortVal: providerLabel, render: function (r) { return h('strong', providerLabel(r)); } },
        { key: 'state', label: 'Key', sortVal: function (r) { return !r.configured ? 'Not set' : r.ok ? 'Working' : 'Failing'; },
          render: function (r) { return !r.configured ? ui.pill('Not set', 'warn') : r.ok ? ui.pill('Working', 'ok') : ui.pill('Failing', 'bad'); } },
        { key: 'model', label: 'Test model', render: function (r) { return r.model ? ui.mono(r.model) : null; } },
        { key: 'envInUse', label: 'Secret', sortVal: function (r) { return r.envInUse || r.env; }, render: function (r) {
          var name = r.envInUse || r.env;
          if (!name) return null;
          var old = r.envInUse && r.env && r.envInUse !== r.env && r.envInUse !== 'AI';
          return h('span', ui.mono(name), old ? [' ', ui.pill('old name', 'warn')] : null);
        } },
        { key: 'lanes', label: 'Lanes', sortVal: function (r) { return (r.lanes || []).length; }, render: function (r) {
          var l = r.lanes || [];
          return l.length ? h('span', { title: l.join(', ') }, fmt.plural(l.length, 'lane')) : null;
        } },
        { key: 'note', label: 'Result', render: function (r) {
          if (r.ok) return h('span.muted', r.status ? 'HTTP ' + r.status : 'OK');
          return r.note ? h('span', fmt.trunc(r.note, 80)) : null;
        } }
      ],
      rows: ai, exportName: 'vinax-ai-keys', search: false,
      empty: 'No AI providers reported', emptyHint: 'The Worker returned no provider list.',
      onRow: function (r) { openProvider(r); }
    });

    var laneRows = lanes.slice().sort(function (a, b) { return (Number(b.calls) || 0) - (Number(a.calls) || 0); });
    var laneTable = ui.table({
      columns: [
        { key: 'lane', label: 'Lane', render: function (r) { return ui.mono(r.lane); } },
        { key: 'provider', label: 'Provider' },
        { key: 'keySet', label: 'Key', render: function (r) { return r.keySet ? ui.pill('Set', 'ok') : ui.pill('Not set', 'warn'); }, sortVal: function (r) { return r.keySet ? 1 : 0; } },
        { key: 'calls', label: 'Calls', align: 'right', render: function (r) { return fmt.num(r.calls); } },
        { key: 'okPct', label: 'Success', align: 'right', render: function (r) {
          if (!Number(r.calls)) return h('span.muted', 'Idle');
          var tone = r.okPct >= 95 ? 'ok' : r.okPct >= 80 ? 'warn' : 'bad';
          return ui.status(tone, fmt.pct(r.okPct));
        } },
        { key: 'p50', label: 'Median', align: 'right', render: function (r) { return fmt.ms(r.p50); } },
        { key: 'p95', label: 'p95', align: 'right', render: function (r) { return fmt.ms(r.p95); } },
        { key: 'hops', label: 'Fallbacks', align: 'right', render: function (r) { return fmt.num(r.hops); } },
        { key: 'emptyStreams', label: 'Empty replies', align: 'right', render: function (r) { return fmt.num(r.emptyStreams); } },
        { key: 'authErrors', label: 'Key errors', align: 'right', render: function (r) { return Number(r.authErrors) > 0 ? ui.pill(fmt.num(r.authErrors), 'bad') : fmt.num(r.authErrors); } }
      ],
      rows: laneRows, exportName: 'vinax-ai-lanes', search: false, dense: true, pageSize: 20,
      empty: 'No lanes reported'
    });

    var dbProblem = !db.configured ? 'The database is not connected: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the Worker.'
      : db.error ? VX.errorText(db.error) + (db.upstreamStatus ? ' (HTTP ' + db.upstreamStatus + ')' : '')
        : null;
    return [
      dbProblem ? h('div', ui.notice(dbProblem, 'bad'), db.error === 'db_schema_missing' ? h('div.toolbar', { style: { 'margin-top': '8px' } }, ui.button('Open the fresh database checklist', { kind: 'ghost', small: true, onClick: function () { ctx.go('data', 'fresh'); } })) : null)
        : !db.lastEventAt ? ui.notice(db.note || 'The database is connected but has no analytics events yet — they arrive as soon as someone opens the app.', 'info') : null,
      ui.kpis([
        { label: 'AI keys working', value: fmt.num(working.length) + ' / ' + fmt.num(ai.length), sub: configured.length < ai.length ? fmt.num(ai.length - configured.length) + ' not set' : 'all keys set', tone: !configured.length ? 'bad' : working.length < configured.length ? 'warn' : 'ok' },
        { label: 'Database', value: !db.configured ? 'Not connected' : !db.readable ? 'Unreadable' : 'Connected', tone: dbTone === 'ok' ? 'ok' : dbTone },
        { label: 'Last data received', value: db.lastEventAt ? fmt.ago(db.lastEventAt) : '—', sub: db.lastEventAt ? fmt.dateTime(db.lastEventAt) : 'no event yet' },
        { label: 'AI calls · 24h', value: fmt.num(totalCalls), sub: fmt.plural(busy.length, 'busy lane') }
      ]),
      ui.grid([
        ui.card({ title: 'AI providers', sub: 'A 4-token test request with the model each provider’s lanes use. Click a row for details.', span: 'full', pad: false, body: aiTable }),
        ui.card({ title: 'AI lanes · last 24 hours', sub: 'Success excludes requests the app refused on purpose (limits, switches).', span: 'full', pad: false, body: [
          d.lanesReadable === false ? h('div', { style: { padding: '0 16px 10px' } }, ui.notice('The AI call log could not be read, so every lane shows as idle.', 'warn')) : null,
          !totalCalls && d.lanesReadable !== false ? h('div', { style: { padding: '0 16px 10px' } }, ui.notice('No AI calls in the last 24 hours. Lanes fill in as listeners use the DJ, VinaX AI and AI shelves.', 'info')) : null,
          laneTable
        ] })
      ])
    ];
  }

  function openProvider(r) {
    var dr = VX.drawer({ title: providerLabel(r) });
    VX.mount(dr.body,
      ui.dl([
        ['Key', !r.configured ? 'Not set' : r.ok ? 'Working' : 'Failing'],
        ['Secret name', r.env ? ui.mono(r.env) : '—'],
        ['Read from', r.envInUse ? ui.mono(r.envInUse) : 'Not set'],
        ['Test model', r.model ? ui.mono(r.model) : '—'],
        ['HTTP status', r.status != null ? String(r.status) : '—'],
        ['Result', r.note || (r.ok ? 'OK' : '—')]
      ]),
      r.envInUse && r.env && r.envInUse !== r.env && r.envInUse !== 'AI' ? ui.notice('This key is set under its previous name ' + r.envInUse + '. Set it as ' + r.env + ' and remove the old one.', 'warn') : null,
      h('h3', { style: { margin: '16px 0 6px', 'font-size': '14px' } }, 'Lanes'),
      (r.lanes || []).length ? h('p', (r.lanes || []).join(', ')) : ui.muted('None'),
      (r.media || []).length ? [h('h3', { style: { margin: '16px 0 6px', 'font-size': '14px' } }, 'Media models'), h('ul.list', r.media.map(function (m) { return h('li', ui.mono(m.id), h('span.grow', m.name || ''), ui.pill(m.kind || '—')); }))] : null,
      (r.tools || []).length ? [h('h3', { style: { margin: '16px 0 6px', 'font-size': '14px' } }, 'Tools'), h('ul.list', r.tools.map(function (t) { return h('li', h('span.grow', t.name || t.id), ui.muted(fmt.plural((t.models || []).length, 'model'))); }))] : null
    );
  }

  /* -------------------------------------------------------- App errors */

  var VITAL = {
    LCP: { label: 'Largest paint', good: 2500, poor: 4000, hint: 'How long until the main content shows' },
    INP: { label: 'Response to input', good: 200, poor: 500, hint: 'How long a tap takes to show a result' },
    CLS: { label: 'Layout shift', good: 0.1, poor: 0.25, hint: 'How much the page jumps while loading' }
  };

  function renderErrors(host, ctx) {
    var days = Number(ctx.params.days) || 7;
    var body = h('div.page-body');
    host.appendChild(h('div.toolbar',
      ui.daysPicker(days, function (d) { ctx.setParam('days', d); ctx.refresh(); }),
      h('span.grow'),
      ui.button('Clear all errors', { kind: 'ghost', icon: 'trash', onClick: function () {
        return VX.confirm({ title: 'Clear all app errors?', body: 'Deletes every error event from the database. Error counts start again from zero. This cannot be undone.', danger: true, confirmLabel: 'Clear errors' }).then(function (ok) {
          if (!ok) return null;
          return VX.api.post('/api/admin/maintenance', { action: 'clear_errors' }).then(function (res) {
            if (res.ok) { VX.toast('Errors cleared', 'ok'); ctx.refresh(); }
            else VX.toast('Could not clear errors: ' + res.message, 'bad');
          });
        });
      } })));
    host.appendChild(body);
    return ui.load(body, function () { return VX.api.get('/api/admin/technical', { days: days }); }, function (d) {
      if (d.configured === false) return dbNotConnected();
      var sm = d.summary || {};
      var chartDays = Math.max(1, Math.min(days, 30));
      var byDay = VX.fillDays(d.errorsByDay || [], chartDays, 'day', ['hits']);
      var errors = d.errors || [];
      var versions = d.versions || [];
      var vitals = d.vitals || [];
      var misses = d.lyricMisses || [];
      var errRate = Number(sm.plays_24h) > 0 ? Number(sm.errors_24h) / Number(sm.plays_24h) : null;

      return [
        unavailableNotice(d.unavailable, { versions: 'app versions', errors: 'error list', errorsByDay: 'errors per day', summary: 'summary', vitals: 'web vitals', lyricMisses: 'lyrics misses' }),
        ui.kpis([
          { label: 'Errors · 24h', value: fmt.num(sm.errors_24h), tone: Number(sm.errors_24h) > 0 ? 'warn' : null },
          { label: 'Plays · 24h', value: fmt.num(sm.plays_24h) },
          { label: 'Errors per play', value: errRate == null ? '—' : fmt.ratio(errRate, 1), sub: 'last 24 hours', hint: 'Errors divided by plays started in the last 24 hours' },
          { label: 'Active sessions', value: fmt.num(sm.active_sessions) },
          { label: 'App versions in use', value: fmt.num(sm.versions != null ? sm.versions : versions.length) }
        ]),
        ui.grid([
          ui.card({ title: 'Errors per day', sub: chartDays === 1 ? 'Today (UTC)' : 'Last ' + chartDays + ' days (UTC)', span: 2, body: ui.chart({ labels: byDay.labels, series: [{ name: 'Errors', values: byDay.values.hits, color: 'var(--c4)' }], type: 'bar', height: 200, empty: 'No errors in this period', emptyHint: 'Good news — the app reported no errors.' }) }),
          ui.card({ title: 'App versions in use', sub: 'Listener devices per version', body: versions.length ? ui.hbars(versions.slice().sort(function (a, b) { return (Number(b.users) || 0) - (Number(a.users) || 0); }).map(function (v) { return { label: (v.app_version || 'unknown') + ' · ' + (v.platform || '—'), value: v.users }; }), { limit: 8 }) : ui.empty('No devices yet', 'Versions appear as listeners open the app.') }),
          ui.card({ title: 'Top errors', sub: 'Last ' + fmt.plural(days, 'day') + ' · click a row for the full message', span: 'full', pad: false, body: ui.table({
            columns: [
              { key: 'error_kind', label: 'Kind', render: function (r) { return ui.pill(r.error_kind || 'error', 'bad'); } },
              { key: 'message', label: 'Message', render: function (r) { return h('span', { title: r.message || '' }, fmt.trunc(r.message || '—', 110)); } },
              { key: 'hits', label: 'Times', align: 'right', render: function (r) { return fmt.num(r.hits); } },
              { key: 'last_seen', label: 'Last seen', nowrap: true, render: function (r) { return agoCell(r.last_seen); } }
            ],
            rows: errors, sortKey: 'hits', exportName: 'vinax-errors',
            empty: 'No errors reported', emptyHint: 'Errors the app catches are listed here with how often they happened.',
            onRow: openError
          }) }),
          ui.card({ title: 'Loading speed on real devices', sub: '75th percentile from the web app · last ' + fmt.plural(days, 'day'), span: 2, body: vitalsView(vitals) }),
          ui.card({ title: 'Songs with no lyrics found', sub: 'Listeners asked for lyrics that no source had', body: ui.hbars(misses.map(function (m) { return { label: m.song_title || '—', sub: m.song_artist || null, value: m.hits }; }), { limit: 8, empty: 'No lyrics misses', emptyHint: 'Songs appear here when a listener opens lyrics that cannot be found.' }) })
        ])
      ];
    }, { skeleton: 6 });
  }

  function openError(r) {
    var dr = VX.drawer({ title: 'Error details' });
    VX.mount(dr.body,
      ui.dl([
        ['Kind', r.error_kind || '—'],
        ['Times', fmt.num(r.hits)],
        ['Last seen', r.last_seen ? fmt.dateTime(r.last_seen) + ' (' + fmt.ago(r.last_seen) + ')' : '—']
      ]),
      h('h3', { style: { margin: '16px 0 6px', 'font-size': '14px' } }, 'Message'),
      h('pre.json', r.message || '—'),
      h('div.toolbar', { style: { 'margin-top': '10px' } }, ui.button('Copy message', { kind: 'ghost', small: true, icon: 'copy', onClick: function () {
        try { return navigator.clipboard.writeText(String(r.message || '')).then(function () { VX.toast('Copied', 'ok'); }, function () { VX.toast('Could not copy', 'bad'); }); }
        catch (e) { VX.toast('Could not copy', 'bad'); return null; }
      } }))
    );
  }

  function vitalsView(vitals) {
    var rows = (vitals || []).filter(function (v) { return v && VITAL[v.metric]; });
    if (!rows.length || rows.every(function (v) { return !Number(v.count); })) {
      return ui.empty('No speed data yet', 'The web app reports loading speed as listeners open it.');
    }
    return h('div.grid.cols-3', rows.map(function (v) {
      var m = VITAL[v.metric];
      var total = (Number(v.good) || 0) + (Number(v.ni) || 0) + (Number(v.poor) || 0);
      var p = v.p75 == null ? null : Number(v.p75);
      var tone = p == null ? null : p <= m.good ? 'ok' : p <= m.poor ? 'warn' : 'bad';
      var shown = p == null ? '—' : v.metric === 'CLS' ? p.toFixed(2) : fmt.ms(p);
      return h('div', { title: m.hint },
        h('div.kpi-label', v.metric + ' · ' + m.label),
        h('div', { style: { margin: '4px 0 6px', display: 'flex', gap: '8px', 'align-items': 'center' } },
          h('strong', { style: { 'font-size': '20px' } }, shown),
          tone ? ui.pill(tone === 'ok' ? 'Good' : tone === 'warn' ? 'Needs work' : 'Poor', tone) : null),
        ui.meter(total ? (Number(v.good) || 0) / total : 0, 'ok'),
        h('p.muted.small', { style: { 'margin-top': '6px' } }, total ? fmt.ratio((Number(v.good) || 0) / total) + ' good · ' + fmt.num(v.ni) + ' need work · ' + fmt.num(v.poor) + ' poor' : 'No samples'));
    }));
  }

  /* ---------------------------------------------------------- Endpoints */

  function renderEdge(host, ctx) {
    var body = h('div.page-body');
    host.appendChild(h('div.toolbar', ui.button('Check again', { kind: 'primary', icon: 'refresh', onClick: function () { return load(); } }), ui.muted('About 25 requests to the live site · allowed a few times a minute')));
    host.appendChild(body);
    function load() {
      return ui.load(body, function () { return VX.api.get('/api/admin/edge', null, { fresh: true, timeout: 40000 }); }, function (d) {
        var shell = d.shell || {};
        var assets = d.assets || [];
        var eps = d.endpoints || [];
        var badAssets = assets.filter(function (a) { return !a.ok; }).length;
        var badEps = eps.filter(function (e) { return !e.ok; }).length;
        return [
          d.healthy ? ui.notice('All good — the app shell, its ' + fmt.plural(assets.length, 'file') + ' and ' + fmt.plural(eps.length, 'endpoint') + ' answered as expected.', 'ok')
            : ui.notice(fmt.plural(d.problems, 'problem') + ' found on ' + (d.origin || 'the live site') + '. Failing rows are listed first.', 'bad'),
          ui.kpis([
            { label: 'App shell', value: shell.ok ? 'OK' : shell.status ? 'HTTP ' + shell.status : 'No answer', sub: fmt.ms(shell.ms), tone: shell.ok ? 'ok' : 'bad' },
            { label: 'Build', value: shell.build || '—', sub: shell.cacheStatus ? 'cache ' + String(shell.cacheStatus).toLowerCase() : 'cache status unknown' },
            { label: 'Scripts & styles', value: fmt.num(assets.length - badAssets) + ' / ' + fmt.num(assets.length), sub: 'served correctly', tone: badAssets ? 'bad' : null },
            { label: 'Endpoints', value: fmt.num(eps.length - badEps) + ' / ' + fmt.num(eps.length), sub: 'answered as expected', tone: badEps ? 'bad' : null },
            { label: 'Checked', value: d.checkedAt ? fmt.time(d.checkedAt) : '—', sub: d.origin || null }
          ]),
          shell.error ? ui.notice('Shell: ' + shell.error, 'bad') : null,
          ui.grid([
            ui.card({ title: 'Public endpoints', sub: 'What the app calls on every visit', pad: false, body: ui.table({
              columns: [
                { key: 'ok', label: 'Result', sortVal: function (r) { return r.ok ? 1 : 0; }, render: function (r) { return r.ok ? ui.pill('OK', 'ok') : ui.pill('Failing', 'bad'); } },
                { key: 'name', label: 'Endpoint', render: function (r) { return h('div', h('div.cell-main', r.name || '—'), h('div.cell-sub', (r.method || 'GET') + ' ' + (r.path || ''))); } },
                { key: 'status', label: 'HTTP', align: 'right', render: function (r) { return r.status ? String(r.status) : 'none'; } },
                { key: 'ms', label: 'Time', align: 'right', render: function (r) { return fmt.ms(r.ms); } },
                { key: 'note', label: 'Note', render: function (r) { return r.note ? fmt.trunc(r.note, 60) : null; } }
              ],
              rows: eps.slice().sort(function (a, b) { return (a.ok ? 1 : 0) - (b.ok ? 1 : 0); }), exportName: 'vinax-endpoints', search: false,
              empty: 'No endpoints checked'
            }) }),
            ui.card({ title: 'Shell scripts and styles', sub: 'Each must be served as real JavaScript or CSS, not a web page', pad: false, body: ui.table({
              columns: [
                { key: 'ok', label: 'Result', sortVal: function (r) { return r.ok ? 1 : 0; }, render: function (r) { return r.ok ? ui.pill('OK', 'ok') : ui.pill('Broken', 'bad'); } },
                { key: 'path', label: 'File', render: function (r) { return h('div', h('div.cell-main', { title: r.path }, fmt.trunc(r.path, 48)), h('div.cell-sub', [r.kind || '—', r.contentType || 'no type', r.note].filter(Boolean).join(' · '))); } },
                { key: 'status', label: 'HTTP', align: 'right', render: function (r) { return r.status ? String(r.status) : 'none'; } },
                { key: 'ms', label: 'Time', align: 'right', render: function (r) { return fmt.ms(r.ms); } }
              ],
              rows: assets.slice().sort(function (a, b) { return (a.ok ? 1 : 0) - (b.ok ? 1 : 0); }), exportName: 'vinax-shell-assets', search: false,
              empty: 'No scripts or styles found', emptyHint: shell.ok ? 'The shell referenced no same-site files.' : 'The shell did not load, so its files could not be checked.'
            }) })
          ])
        ];
      }, { skeleton: 6 });
    }
    return load();
  }

  /* ----------------------------------------------------- Scheduled jobs */

  function jobState(j) {
    if (j.readable === false || (j.ok == null && j.lastAt && !j.neverRan)) return { tone: 'muted', label: 'Unknown', pill: null };
    if (!j.lastAt || j.neverRan) return { tone: 'info', label: 'Not run yet', pill: 'info' };
    if (j.ok) return { tone: 'ok', label: 'On time', pill: 'ok' };
    return { tone: 'bad', label: 'Overdue', pill: 'bad' };
  }
  function every(min) {
    min = Number(min);
    if (!min) return '—';
    return 'at least every ' + fmt.dur(min * 60);
  }

  function renderCron(host) {
    return ui.load(host, function () { return VX.api.get('/api/admin/cron'); }, function (d) {
      if (d.configured === false) return dbNotConnected();
      var jobs = d.jobs || [];
      var states = jobs.map(jobState);
      var overdue = states.filter(function (s) { return s.label === 'Overdue'; }).length;
      var never = states.filter(function (s) { return s.label === 'Not run yet'; }).length;
      var onTime = states.filter(function (s) { return s.label === 'On time'; }).length;
      return [
        jobs.length && never === jobs.length ? ui.notice('No job has run since the database was created. Each one shows “Not run yet” until its first scheduled run leaves a footprint.', 'info') : null,
        overdue ? ui.notice(fmt.plural(overdue, 'job is', 'jobs are') + ' overdue. Check the repository’s scheduled workflows and the CRON_SECRET secret.', 'bad') : null,
        unavailableNotice(d.unavailable),
        ui.kpis([
          { label: 'On time', value: fmt.num(onTime), tone: onTime && onTime === jobs.length ? 'ok' : null },
          { label: 'Overdue', value: fmt.num(overdue), tone: overdue ? 'bad' : null },
          { label: 'Not run yet', value: fmt.num(never) },
          { label: 'Checked', value: d.checkedAt ? fmt.time(d.checkedAt) : '—' }
        ]),
        ui.card({ title: 'Jobs', sub: 'Expected = how old the last run may get before the job counts as overdue', pad: false, body: ui.table({
          columns: [
            { key: 'label', label: 'Job', render: function (r) { return h('div', h('div.cell-main', r.label || r.id), r.note ? h('div.cell-sub', r.note) : null); } },
            { key: 'schedule', label: 'Schedule' },
            { key: 'state', label: 'Status', sortVal: function (r) { return jobState(r).label; }, render: function (r) { var s = jobState(r); return s.pill ? ui.pill(s.label, s.pill) : ui.pill(s.label); } },
            { key: 'lastAt', label: 'Last run', nowrap: true, render: function (r) { return r.lastAt ? agoCell(r.lastAt) : h('span.muted', r.readable === false ? 'Could not read' : 'Never'); } },
            { key: 'maxAgeMin', label: 'Expected', render: function (r) { return every(r.maxAgeMin); } }
          ],
          rows: jobs, exportName: 'vinax-jobs', search: false,
          empty: 'No jobs reported', emptyHint: 'The Worker returned no job list.'
        }) })
      ];
    });
  }

  /* -------------------------------------------------------- Data quality */

  var METRICS = [
    { key: 'originVerifiedPct', label: 'Plays from the real app', hint: 'Share of play events whose origin was verified' },
    { key: 'countryResolvedPct', label: 'Plays with a country', hint: 'Share of play events with a resolved country' },
    { key: 'aiOkPct', label: 'AI calls that succeeded', hint: 'Share of AI calls that returned ok (refusals excluded)' },
    { key: 'aiContentPct', label: 'AI calls that delivered content', hint: 'Succeeded and carried no error' }
  ];

  function pctTone(p) { return p == null ? null : p >= 95 ? 'ok' : p >= 80 ? 'warn' : 'bad'; }

  function renderData(host) {
    return ui.load(host, function () { return VX.api.get('/api/admin/dataquality'); }, function (d) {
      if (d.configured === false) return dbNotConnected();
      var m = d.metrics || {};
      var sampled = d.sampled || {};
      var slos = d.slos || [];
      var allNull = METRICS.every(function (x) { return m[x.key] == null; });
      return [
        unavailableNotice(d.unavailable, { events: 'play events', aiEvents: 'AI calls' }),
        ui.kpis([
          { label: 'Quality score', value: d.score == null ? '—' : fmt.pct(d.score), sub: 'mean of the four checks', tone: pctTone(d.score) },
          { label: 'Play events sampled', value: fmt.num(sampled.events), sub: 'newest, up to 5,000' },
          { label: 'AI calls sampled', value: fmt.num(sampled.aiEvents), sub: 'newest, refusals removed' }
        ]),
        ui.grid([
          ui.card({ title: 'Checks', sub: 'Over the newest samples', body: allNull
            ? ui.empty('Not enough data yet', 'These fill in as listeners play songs and use AI features.')
            : h('ul.list', METRICS.map(function (x) {
              var v = m[x.key];
              return h('li', { title: x.hint },
                h('div.grow', h('div.cell-main', x.label), h('div', { style: { 'margin-top': '6px' } }, ui.meter(v == null ? 0 : v / 100, pctTone(v)))),
                h('strong', { style: { 'min-width': '56px', 'text-align': 'right' } }, v == null ? '—' : fmt.pct(v, v % 1 ? 1 : 0)));
            })) }),
          ui.card({ title: 'Error budgets', sub: 'How much of each target’s allowed failure is used', body: !slos.length || slos.every(function (s) { return s.actualPct == null; })
            ? ui.empty('No AI calls yet', 'Budgets are measured once AI features are used.')
            : h('ul.list', slos.map(function (s) {
              var burn = s.budgetBurnedPct;
              var tone = burn == null ? null : burn < 50 ? 'ok' : burn < 100 ? 'warn' : 'bad';
              return h('li',
                h('div.grow',
                  h('div.cell-main', s.name || '—'),
                  h('div.cell-sub', 'Target ' + fmt.pct(s.targetPct) + ' · actual ' + (s.actualPct == null ? '—' : fmt.pct(s.actualPct, 1)) + (burn != null ? ' · ' + fmt.pct(burn) + ' of the budget used' : '')),
                  h('div', { style: { 'margin-top': '6px' } }, ui.meter(burn == null ? 0 : burn / 100, tone))),
                tone ? ui.pill(burn >= 100 ? 'Over budget' : burn >= 50 ? 'Watch' : 'Healthy', tone) : ui.pill('No data'));
            })) })
        ])
      ];
    });
  }

  /* ------------------------------------------------------------ Releases */

  function runTone(r) {
    if (r.status && r.status !== 'completed') return { tone: 'info', label: r.status === 'in_progress' ? 'Running' : 'Queued' };
    if (r.conclusion === 'success') return { tone: 'ok', label: 'Passed' };
    if (r.conclusion === 'failure' || r.conclusion === 'timed_out') return { tone: 'bad', label: r.conclusion === 'failure' ? 'Failed' : 'Timed out' };
    if (r.conclusion === 'cancelled' || r.conclusion === 'skipped') return { tone: null, label: r.conclusion === 'cancelled' ? 'Cancelled' : 'Skipped' };
    return { tone: 'warn', label: r.conclusion ? String(r.conclusion).replace(/_/g, ' ') : 'Unknown' };
  }

  function renderReleases(host, ctx) {
    return ui.load(host, function () { return VX.api.get('/api/admin/releases', null, { timeout: 30000 }); }, function (d) {
      if (d.configured === false) {
        return ui.card({ title: 'GITHUB_TOKEN not set', tone: 'warn', body: [
          h('p', 'Releases, build runs and commits are read from the code repository with a server-side token. The Worker secret GITHUB_TOKEN is not set, so this tab has nothing to show.'),
          h('p.muted', { style: { 'margin-top': '8px' } }, 'Set a read-only token as the Worker secret GITHUB_TOKEN (and GITHUB_REPO if the repository moved). The Android update check also uses it.'),
          h('div.toolbar', { style: { 'margin-top': '12px' } }, ui.button('Open server secrets', { kind: 'ghost', small: true, icon: 'key', onClick: function () { ctx.go('health', 'env'); } }))
        ] });
      }
      var rel = d.release;
      var live = d.live && typeof d.live === 'object' ? d.live : null;
      var runs = d.runs || [];
      var commits = d.commits || [];
      var failing = runs.filter(function (r) { return runTone(r).tone === 'bad'; }).length;
      return [
        d.tokenRejected ? ui.notice('The code repository refused GITHUB_TOKEN — it has expired or was revoked, so runs and commits below are empty. Create a new read-only token and set it as the Worker secret GITHUB_TOKEN.', 'bad') : null,
        ui.kpis([
          { label: 'Newest release', value: rel ? rel.tag || rel.name || '—' : 'None', sub: rel && rel.name && rel.name !== rel.tag ? rel.name : null },
          { label: 'Android build offered', value: live && live.build ? fmt.num(live.build) : '—', sub: live && live.version ? 'version ' + live.version : 'update check unavailable' },
          { label: 'Minimum build', value: live && live.minBuild ? fmt.num(live.minBuild) : 'None', sub: 'older builds must update' },
          { label: 'Failed runs', value: fmt.num(failing), sub: 'of the last ' + fmt.num(runs.length), tone: failing ? 'warn' : null }
        ]),
        ui.grid([
          ui.card({ title: 'Newest release', sub: rel ? rel.tag || '' : null, body: rel ? [
            rel.notes ? h('pre.json', { style: { 'max-height': '220px' } }, rel.notes) : ui.muted('No release notes.'),
            (rel.assets || []).length ? h('ul.list', { style: { 'margin-top': '10px' } }, rel.assets.map(function (a) {
              return h('li', VX.icon('download'), h('span.grow', extLink(a.url, a.name || 'file')));
            })) : null
          ] : ui.empty('No release yet', 'The newest tagged release appears here once one is published.') }),
          ui.card({ title: 'Recent commits on main', sub: 'Newest 10', body: commits.length ? h('ul.list.feed', commits.map(function (c) {
            return h('li',
              h('span.feed-time', c.at ? fmt.ago(c.at) : '—'),
              h('div.grow', h('div.cell-main', extLink(c.url, c.message || '—')), h('div.cell-sub', (c.author || '—') + ' · ', ui.mono(c.sha))));
          })) : ui.empty('No commits returned', 'The repository answered with no commits for main.') })
        ], 2),
        ui.grid([
          ui.card({ title: 'Build and deploy runs', sub: 'Newest 20 workflow runs', span: 'full', pad: false, body: ui.table({
            columns: [
              { key: 'result', label: 'Result', sortVal: function (r) { return runTone(r).label; }, render: function (r) { var t = runTone(r); return t.tone ? ui.pill(t.label, t.tone) : ui.pill(t.label); } },
              { key: 'name', label: 'Workflow', render: function (r) { return h('div', h('div.cell-main', extLink(r.url, r.name || '—')), r.title && r.title !== r.name ? h('div.cell-sub', fmt.trunc(r.title, 80)) : null); } },
              { key: 'branch', label: 'Branch', render: function (r) { return r.branch ? ui.mono(r.branch) : null; } },
              { key: 'sha', label: 'Commit', render: function (r) { return r.sha ? ui.mono(r.sha) : null; } },
              { key: 'event', label: 'Trigger' },
              { key: 'started', label: 'Started', nowrap: true, render: function (r) { return agoCell(r.started); } },
              { key: 'took', label: 'Took', align: 'right', sortVal: function (r) { return dur(r); }, render: function (r) { var s = dur(r); return s == null ? null : fmt.dur(s); } }
            ],
            rows: runs, exportName: 'vinax-runs', search: true,
            empty: 'No workflow runs', emptyHint: 'Runs appear after the next push or scheduled workflow.'
          }) })
        ])
      ];
    }, { skeleton: 6 });
  }
  function dur(r) {
    if (!r.started || !r.finished || r.status !== 'completed') return null;
    var s = (Date.parse(r.finished) - Date.parse(r.started)) / 1000;
    return isFinite(s) && s >= 0 ? s : null;
  }

  /* ------------------------------------------------------ Server secrets */

  function renderEnv(host) {
    return ui.load(host, function () { return VX.api.get('/api/admin/envcheck', null, { fresh: true }); }, function (d) {
      var items = d.items || [];
      var missing = d.missingRequired || [];
      var groups = [];
      var byGroup = {};
      items.forEach(function (it) {
        var g = it.group || 'Other';
        if (!byGroup[g]) { byGroup[g] = []; groups.push(g); }
        byGroup[g].push(it);
      });
      var req = items.filter(function (i) { return i.required; });
      var opt = items.filter(function (i) { return !i.required; });
      var oldNames = items.filter(function (i) { return i.usingFallback; });
      if (!items.length) return ui.empty('No checklist returned', 'The Worker answered without a secrets list.');
      return [
        missing.length ? ui.notice('Missing required secrets: ' + missing.join(', ') + '. Parts of the app stop working without them.', 'bad')
          : ui.notice('Every required secret is set.', 'ok'),
        oldNames.length ? ui.notice(fmt.plural(oldNames.length, 'key is', 'keys are') + ' set under an old name: ' + oldNames.map(function (i) { return i.fallback; }).join(', ') + '. Set the new name and remove the old one.', 'warn') : null,
        ui.kpis([
          { label: 'Required', value: fmt.num(req.length - req.filter(function (i) { return !i.set; }).length) + ' / ' + fmt.num(req.length), sub: 'set', tone: missing.length ? 'bad' : 'ok' },
          { label: 'Optional', value: fmt.num(opt.filter(function (i) { return i.set; }).length) + ' / ' + fmt.num(opt.length), sub: 'set' },
          { label: 'Old names', value: fmt.num(oldNames.length), tone: oldNames.length ? 'warn' : null },
          { label: 'Checked', value: d.checkedAt ? fmt.time(d.checkedAt) : '—' }
        ]),
        ui.grid(groups.map(function (g) {
          var list = byGroup[g];
          var bad = list.some(function (i) { return i.required && !i.set; });
          return ui.card({ title: g, tone: bad ? 'bad' : null, sub: fmt.num(list.filter(function (i) { return i.set; }).length) + ' of ' + fmt.plural(list.length, 'item') + ' set', body: h('ul.list', list.map(function (i) {
            var state = i.usingFallback ? ui.pill('Old name', 'warn') : i.set ? ui.pill('Set', 'ok') : i.required ? ui.pill('Missing', 'bad') : ui.pill('Not set');
            return h('li', { style: { 'align-items': 'flex-start' } },
              h('div', { style: { 'min-width': '78px' } }, state),
              h('div.grow',
                h('div', ui.mono(i.name), i.required ? [' ', ui.pill('Required', i.set ? 'info' : 'bad')] : null),
                i.note ? h('div.cell-sub', { style: { 'margin-top': '3px' } }, i.note) : null));
          })) });
        })),
        ui.card({ title: 'How to set a secret', body: [
          h('p', 'From the repository’s backend folder, run the command below and type the value at the prompt. It applies on the Worker’s next request; nothing needs redeploying.'),
          h('pre.json', { style: { 'margin-top': '8px' } }, 'cd backend\nnpx wrangler secret put <NAME> --config worker/wrangler.toml'),
          h('p.muted.small', { style: { 'margin-top': '8px' } }, 'ASSETS_HOST and GITHUB_REPO are plain settings in worker/wrangler.toml; HANDOFF is a key-value binding declared there too.')
        ] })
      ];
    }, { skeleton: 6 });
  }

  /* --------------------------------------------- Status note + history */

  function noteText(v) {
    if (typeof v === 'string') return v;
    if (v && typeof v === 'object' && typeof v.text === 'string') return v.text;
    return '';
  }

  function renderStatusNote(host) {
    var editor = h('div');
    var history = h('div.page-body');
    host.appendChild(editor);
    host.appendChild(history);

    function loadEditor() {
      return ui.load(editor, function () { return VX.config.get('status-note').then(function (r) { return r.ok ? { ok: true, data: r } : (r.res && !r.res.ok ? r.res : { ok: false, message: r.message || 'Could not read the status note.' }); }); }, function (r) {
        var current = noteText(r.value).trim();
        var input = ui.textarea({ rows: 3, maxlength: 280, placeholder: 'All clear — leave empty. Example: Search is slow while a music source recovers.', value: current });
        var count = h('span.muted.small', String(current.length) + ' / 280');
        input.addEventListener('input', function () { count.textContent = input.value.length + ' / 280'; });
        return ui.card({
          title: 'Status note',
          sub: current ? 'Published' + (r.updatedAt ? ' ' + fmt.ago(r.updatedAt) : '') + ' · shown on the public status page' : 'No note — the status page shows no message',
          actions: [current ? ui.pill('Showing', 'warn') : ui.pill('All clear', 'ok')],
          body: h('div.form',
            ui.field('Note for listeners', input, 'One plain sentence during an incident. Leave empty when everything works.'),
            h('div.toolbar',
              ui.button('Publish note', { kind: 'primary', icon: 'send', onClick: function () {
                var text = input.value.trim().slice(0, 280);
                if (!text) { VX.toast('Write a note first, or use “All clear”.', 'bad'); input.focus(); return null; }
                return VX.config.set('status-note', text).then(function (res) { if (res.ok) { loadEditor(); loadHistory(); } });
              } }),
              ui.button('All clear', { kind: 'ghost', icon: 'check', disabled: !current, onClick: function () {
                return VX.config.set('status-note', null).then(function (res) { if (res.ok) { loadEditor(); loadHistory(); } });
              } }),
              h('span.grow'), count))
        });
      });
    }

    function loadHistory() {
      return ui.load(history, function () { return VX.api.get('/api/status', null, { fresh: true, noAuthRedirect: true }); }, function (d) {
        var comps = d.components || [];
        var overall = d.overall || 'unknown';
        var anyData = comps.some(function (c) { return (c.days || []).length || c.checkedAt; });
        var incidents = [];
        comps.forEach(function (c) {
          (c.days || []).forEach(function (dd) {
            if (Number(dd.total) > 0 && Number(dd.up) < Number(dd.total)) incidents.push({ component: c.name || c.id, day: dd.day, up: Number(dd.up), total: Number(dd.total), pct: Number(dd.up) / Number(dd.total) * 100 });
          });
        });
        incidents.sort(function (a, b) { return a.day < b.day ? 1 : -1; });
        var oTone = overall === 'operational' ? 'ok' : overall === 'outage' ? 'bad' : null;
        return [
          ui.card({
            title: 'Public status page',
            sub: 'What /api/status reports right now · uptime over ' + fmt.plural(d.windowDays || 90, 'day'),
            actions: [oTone ? ui.pill(overall === 'operational' ? 'Operational' : 'Outage', oTone) : ui.pill('No recent data'), h('a.btn.ghost.sm', { href: '/status/', target: '_blank', rel: 'noopener noreferrer' }, 'Open status page')],
            pad: false,
            body: [
              !anyData ? h('div', { style: { padding: '0 16px 10px' } }, ui.notice('No uptime data yet. The status tick records a check of every component every 30 minutes.', 'info')) : null,
              d.note ? h('div', { style: { padding: '0 16px 10px' } }, ui.notice('Note shown: ' + noteText(d.note), 'warn')) : null,
              ui.table({
                columns: [
                  { key: 'name', label: 'Component', render: function (c) { return h('strong', c.name || c.id); } },
                  { key: 'status', label: 'Now', render: function (c) { return c.status === 'up' ? ui.pill('Up', 'ok') : c.status === 'down' ? ui.pill('Down', 'bad') : ui.pill('No recent data'); } },
                  { key: 'latencyMs', label: 'Response', align: 'right', render: function (c) { return fmt.ms(c.latencyMs); } },
                  { key: 'uptime90', label: 'Uptime', align: 'right', render: function (c) { return c.uptime90 == null ? '—' : fmt.pct(c.uptime90, c.uptime90 < 100 ? 2 : 0); } },
                  { key: 'trend', label: 'Daily uptime', sort: false, render: function (c) {
                    var vals = (c.days || []).slice(-30).map(function (x) { return Number(x.total) ? Number(x.up) / Number(x.total) * 100 : 0; });
                    if (!vals.length) return h('span.muted', '—');
                    var low = Math.min.apply(null, vals);
                    if (low >= 100) return h('span.muted', '100% every day');
                    return h('span', { style: { display: 'inline-flex', gap: '8px', 'align-items': 'center' } }, vals.length > 1 ? ui.spark(vals) : null, h('span.muted.small', 'lowest ' + fmt.pct(low, 1)));
                  } },
                  { key: 'checkedAt', label: 'Last check', nowrap: true, render: function (c) { return agoCell(c.checkedAt); } }
                ],
                rows: comps, exportName: 'vinax-status', search: false,
                empty: 'No components reported'
              })
            ]
          }),
          ui.card({ title: 'Status history', sub: 'Days a component was not fully up · newest first', pad: false, body: ui.table({
            columns: [
              { key: 'day', label: 'Day', render: function (r) { return fmt.day(r.day); }, sortVal: function (r) { return r.day; } },
              { key: 'component', label: 'Component' },
              { key: 'pct', label: 'Uptime', align: 'right', render: function (r) { return h('span.status.' + (r.pct >= 99 ? 'warn' : 'bad'), fmt.pct(r.pct, 1)); } },
              { key: 'checks', label: 'Checks up', align: 'right', sortVal: function (r) { return r.up; }, render: function (r) { return fmt.num(r.up) + ' of ' + fmt.num(r.total); } }
            ],
            rows: incidents, exportName: 'vinax-status-history', search: false, pageSize: 15,
            empty: anyData ? 'No incidents' : 'No history yet', emptyHint: anyData ? 'Every component passed every check in this window.' : 'Daily uptime builds up from the status tick.'
          }) })
        ];
      });
    }

    return Promise.all([loadEditor(), loadHistory()]);
  }
})();
