/* VinaX console — Database page.
 * GET /api/admin/database: schema version, tables, counts, scheduled jobs;
 * GET /api/admin/audit: the audit trail; POST maintenance actions
 * (purge_events, sweep_rooms, retire_push, run_job). */
(function () {
  'use strict';
  var VX = window.VX, h = VX.h, ui = VX.ui, fmt = VX.fmt, arr = VX.arr, obj = VX.obj, num = VX.num;

  VX.page({
    id: 'database', title: 'Database', group: 'System', icon: 'database', noAuto: true,
    desc: 'The database behind the console: schema, tables, scheduled jobs, the audit trail and maintenance.',
    tabs: [
      { id: 'tables', label: 'Tables', desc: 'Schema version, every table with its size, and the row counts.', render: renderTables },
      { id: 'jobs', label: 'Scheduled jobs', desc: 'The Worker’s timed jobs: when each last ran, whether it is overdue, and a button to run one now.', render: renderJobs },
      { id: 'audit', label: 'Audit trail', desc: 'Every change made from this console, with the value before and after.', render: renderAudit },
      { id: 'maintenance', label: 'Maintenance', desc: 'Purge old usage events, sweep stale rooms, retire silent push devices.', render: renderMaintenance }
    ]
  });

  function fetchDb(fresh) { return VX.api.get('/api/admin/database', null, { fresh: !!fresh, timeout: 30000 }); }
  function schemaCard(d) {
    var s = obj(d.schema);
    var missing = arr(d.missing);
    return [
      d.reachable === false ? ui.notice('The database did not answer. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the Worker, and the project’s status.', 'bad') : null,
      missing.length ? ui.notice('Missing tables: ' + missing.join(', ') + '. Paste backend/supabase/schema.sql into the SQL editor and run it again.', 'bad') : null,
      !missing.length && d.reachable !== false && !s.version ? ui.notice('No schema version found — the database answered but schema.sql has not been applied.', 'warn') : null,
      ui.kpis([
        { label: 'Schema version', value: s.version != null ? fmt.num(s.version) : '—', sub: s.appliedAt ? 'applied ' + fmt.ago(s.appliedAt) : null, tone: s.version ? 'ok' : 'warn' },
        { label: 'Tables', value: fmt.num(arr(d.tables).length), sub: missing.length ? fmt.plural(missing.length, 'missing') : 'all present', tone: missing.length ? 'bad' : null },
        { label: 'Usage events', value: fmt.compact(obj(d.counts).events), sub: 'kept ' + fmt.plural(obj(d.retention).eventsDays || 180, 'day') },
        { label: 'Database size', value: fmt.bytes(arr(d.tables).reduce(function (a, t) { return a + num(t.bytes); }, 0)) }
      ])
    ];
  }

  /* -------------------------------------------------------------- Tables */
  function renderTables(host, ctx) {
    return ui.load(host, function () { return fetchDb(false); }, function (d) {
      var gate = ui.gate(d, ctx);
      if (gate) return gate;
      var tables = arr(d.tables);
      var counts = obj(d.counts);
      var rows = tables.map(function (t) { return { name: t.name, rows: counts[t.name] != null ? counts[t.name] : t.rows, estimate: counts[t.name] == null, bytes: t.bytes }; });
      return [
        schemaCard(d),
        ui.card({ title: 'Tables', sub: 'Counts marked ~ are the planner’s estimate (the big tables)', pad: false, body: ui.table({
          columns: [
            { key: 'name', label: 'Table', render: function (r) { return ui.mono(r.name); } },
            { key: 'rows', label: 'Rows', align: 'right', render: function (r) { return (r.estimate ? '~' : '') + fmt.num(r.rows); } },
            { key: 'bytes', label: 'Size', align: 'right', render: function (r) { return fmt.bytes(r.bytes); } }
          ],
          rows: rows, exportName: 'vinax-tables', search: false, dense: true, pageSize: 40, sortKey: 'bytes', sortDir: 'desc',
          empty: 'No tables reported', emptyHint: 'Apply schema.sql, then refresh.'
        }) })
      ];
    }, { skeleton: 6 });
  }

  /* ---------------------------------------------------------------- Jobs */
  function renderJobs(host, ctx) {
    var body = h('div');
    host.appendChild(body);
    function run(job) {
      return VX.api.post('/api/admin/database', { action: 'run_job', job: job }, { timeout: 60000 }).then(function (res) {
        VX.toast(res.ok ? job + ' ran' : res.message, res.ok ? 'ok' : 'bad');
        return load();
      });
    }
    function load() {
      return ui.load(body, function () { return fetchDb(true); }, function (d) {
        var gate = ui.gate(d, ctx);
        if (gate) return gate;
        var jobs = arr(d.jobs);
        var overdue = jobs.filter(function (j) { return j.overdue; }).length;
        return [
          overdue ? ui.notice(fmt.plural(overdue, 'job is', 'jobs are') + ' overdue. The Worker’s Cron Trigger fires every 30 minutes; check the Worker’s deploy and its logs.', 'warn') : jobs.length ? ui.notice('Every job ran on time.', 'ok') : null,
          ui.card({ title: 'Jobs', sub: 'Run by the Worker’s Cron Trigger; results are recorded in job_runs', pad: false, body: ui.table({
            columns: [
              { key: 'job', label: 'Job', render: function (r) { return ui.mono(r.job); } },
              { key: 'schedule', label: 'Schedule' },
              { key: 'lastAt', label: 'Last run', render: function (r) { return r.lastAt ? ui.ago(r.lastAt) : h('span.muted', 'Not run yet'); } },
              { key: 'ok', label: 'Result', sortVal: function (r) { return r.ok === true ? 2 : r.ok === false ? 0 : 1; }, render: function (r) { return r.ok === true ? ui.pill('OK', 'ok') : r.ok === false ? ui.pill('Failed', 'bad') : ui.pill('Unknown'); } },
              { key: 'overdue', label: 'Timing', sortVal: function (r) { return r.overdue ? 1 : 0; }, render: function (r) { return r.overdue ? ui.pill('Overdue', 'warn') : r.lastAt ? ui.pill('On time', 'ok') : null; } },
              { key: 'summary', label: 'Summary', sort: false, render: function (r) { var s = r.summary; return s == null ? null : typeof s === 'object' ? ui.mono(fmt.trunc(JSON.stringify(s), 90)) : fmt.trunc(String(s), 90); } },
              { key: 'act', label: '', sort: false, render: function (r) { return ui.button('Run now', { kind: 'ghost', small: true, icon: 'play', onClick: function () { return run(r.job); } }); } }
            ],
            rows: jobs, exportName: false, search: false, empty: 'No jobs reported', emptyHint: 'Jobs appear once the Worker with the Cron Trigger is deployed.'
          }) })
        ];
      }, { skeleton: 4 });
    }
    return load();
  }

  /* --------------------------------------------------------------- Audit */
  function renderAudit(host, ctx) {
    var state = { action: ctx.params.action || '' };
    var body = h('div');
    var filter = ui.input({ type: 'search', placeholder: 'Filter by action (e.g. settings)', value: state.action, 'aria-label': 'Action filter', maxlength: 40 });
    filter.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); state.action = filter.value.trim(); ctx.setParam('action', state.action); load(); } });
    host.appendChild(h('div.toolbar', h('div.search-box', VX.icon('search'), filter), ui.button('Filter', { kind: 'ghost', small: true, onClick: function () { state.action = filter.value.trim(); ctx.setParam('action', state.action); return load(); } })));
    host.appendChild(body);
    function open(r) {
      var dr = VX.drawer({ title: r.action || 'Change' });
      VX.mount(dr.body,
        ui.dl([
          ['When', r.at ? fmt.dateTime(r.at) : '—'],
          ['Who', r.actor || 'owner'],
          ['Action', r.action ? ui.mono(r.action) : '—'],
          ['Target', r.target ? ui.mono(r.target) : '—'],
          ['Summary', r.summary || '—'],
          ['Request id', r.requestId ? ui.mono(r.requestId) : '—']
        ]),
        r.before !== undefined && r.before !== null ? [h('h3.subhead', { style: { 'margin-top': '14px' } }, 'Before'), ui.json(r.before)] : null,
        r.after !== undefined && r.after !== null ? [h('h3.subhead', { style: { 'margin-top': '14px' } }, 'After'), ui.json(r.after)] : null);
    }
    function load() {
      var params = { limit: 200 };
      if (state.action) params.action = state.action;
      return ui.load(body, function () { return VX.api.get('/api/admin/audit', params, { fresh: true }); }, function (d) {
        var gate = ui.gate(d, ctx);
        if (gate) return gate;
        var rows = arr(d.rows);
        return ui.card({ title: 'Audit trail', sub: fmt.plural(rows.length, 'entry', 'entries') + (state.action ? ' for “' + state.action + '”' : ' · newest 200'), pad: false, body: ui.table({
          columns: [
            { key: 'at', label: 'When', nowrap: true, render: function (r) { return ui.ago(r.at); } },
            { key: 'action', label: 'Action', render: function (r) { return ui.mono(r.action || '—'); } },
            { key: 'target', label: 'Target', render: function (r) { return r.target ? ui.mono(fmt.trunc(r.target, 40)) : null; } },
            { key: 'summary', label: 'Summary', render: function (r) { return fmt.trunc(r.summary || '', 120); } },
            { key: 'actor', label: 'Who' },
            { key: 'diff', label: 'Values', sort: false, render: function (r) { return (r.before != null || r.after != null) ? ui.pill('before / after', 'info') : null; } }
          ],
          rows: rows, exportName: 'vinax-audit', search: rows.length > 8, pageSize: 50, sortKey: 'at', sortDir: 'desc',
          empty: 'No entries yet', emptyHint: 'Every change made from the console lands here.', onRow: open
        }) });
      }, { skeleton: 6 });
    }
    return load();
  }

  /* --------------------------------------------------------- Maintenance */
  function renderMaintenance(host, ctx) {
    return ui.load(host, function () { return fetchDb(false); }, function (d) {
      var gate = ui.gate(d, ctx);
      if (gate) return gate;
      var ret = obj(d.retention);
      var keep = num(ret.eventsDays) || 180;
      var days = ui.input({ type: 'number', min: 7, max: 3650, step: 1, value: String(keep), style: { 'max-width': '140px' }, 'aria-label': 'Keep days' });
      var retireDays = ui.input({ type: 'number', min: 7, max: 3650, step: 1, value: '180', style: { 'max-width': '140px' }, 'aria-label': 'Silent for days' });
      var out = h('div.receipt');
      function post(bodyReq, label) {
        return VX.api.post('/api/admin/database', bodyReq, { timeout: 60000 }).then(function (res) {
          var r = obj(res.data);
          VX.mount(out, ui.notice(res.ok ? label + ': ' + (r.deleted != null ? fmt.plural(r.deleted, 'row') + ' removed' : r.result != null ? (typeof r.result === 'object' ? JSON.stringify(r.result) : String(r.result)) : 'done') : res.message, res.ok ? 'ok' : 'bad'));
        });
      }
      return [
        schemaCard(d),
        ui.grid([
          ui.card({ title: 'Purge usage events', sub: 'Housekeeping does this every hour with the retention setting; this runs it now with the number you type', body: h('div.form',
            ui.field('Delete events older than (days)', days, 'The retention setting is ' + fmt.plural(keep, 'day') + '. Listener rows, accounts and feedback are never touched.'),
            h('div.actions', ui.button('Purge now', { kind: 'danger', icon: 'trash', onClick: function () {
              var n = Math.max(7, Math.min(3650, Math.floor(num(days.value)) || keep));
              return VX.confirm({ title: 'Purge events older than ' + fmt.plural(n, 'day') + '?', body: 'Those usage events are deleted for good; analytics for that period go with them.', danger: true, typed: 'PURGE', confirmLabel: 'Purge' }).then(function (yes) { if (yes) return post({ action: 'purge_events', days: n }, 'Purge'); });
            } }), ui.button('Change retention', { kind: 'ghost', icon: 'settings', onClick: function () { ctx.go('publish', null, { key: 'retention' }); } }))) }),
          ui.card({ title: 'Sweep rooms', sub: 'Rooms idle for six hours and members unseen for a day', body: h('div.form', h('div.actions', ui.button('Sweep now', { kind: 'ghost', icon: 'refresh', onClick: function () { return post({ action: 'sweep_rooms' }, 'Sweep'); } }))) }),
          ui.card({ title: 'Retire push devices', sub: 'Switch off browsers and phones that have not opened the app in a while', body: h('div.form',
            ui.field('Silent for (days)', retireDays),
            h('div.actions', ui.button('Retire now', { kind: 'ghost', icon: 'bell', onClick: function () {
              var n = Math.max(7, Math.min(3650, Math.floor(num(retireDays.value)) || 180));
              return VX.confirm({ title: 'Retire devices silent for ' + fmt.plural(n, 'day') + '?', body: 'They stop receiving pushes until the app registers them again.', confirmLabel: 'Retire' }).then(function (yes) { if (yes) return post({ action: 'retire_push', days: n }, 'Retire'); });
            } }))) })
        ], 3),
        out
      ];
    }, { skeleton: 6 });
  }
})();
