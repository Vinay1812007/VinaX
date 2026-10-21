/* VinaX console — Database page.
 * Row counts and freshness per table plus housekeeping deletes
 * (/api/admin/tables, POST /api/admin/maintenance purge_events / trim_ai),
 * the read-only table browser (/api/admin/query — whitelisted tables and
 * columns, one equality filter, newest first, at most 500 rows), the audit
 * trail of console writes (/api/admin/audit), and a fresh-database checklist
 * that says which tables and functions exist and which SQL file to run. */
(function () {
  'use strict';
  var VX = window.VX, h = VX.h, ui = VX.ui, fmt = VX.fmt;

  VX.page({
    id: 'data', title: 'Database', group: 'System', icon: 'database', noAuto: true,
    desc: 'Tables, a safe read-only browser, the audit trail of console changes, and the fresh database checklist.',
    tabs: [
      { id: 'tables', label: 'Tables', desc: 'How many rows each table holds, how many arrived in the last 24 hours, and when the newest one landed.', render: renderTables },
      { id: 'query', label: 'Browse data', desc: 'Read-only: pick a table, a time window and an optional filter. Private columns (tokens, device ids, push endpoints) are never returned.', render: renderQuery },
      { id: 'audit', label: 'Audit trail', desc: 'Every change made from this console: what, when and to which setting.', render: renderAudit },
      { id: 'fresh', label: 'Fresh database', desc: 'After a reset: which tables and functions exist, what is still empty, and what to run if something is missing.', render: renderFresh }
    ]
  });

  var SQL_SCHEMA = 'frontend/supabase/vinax-13.sql';
  var SQL_WIPE = 'frontend/supabase/vinax-wipe.sql';
  var SQL_RESET = 'frontend/supabase/vinax-13-reset.sql';

  function dbNotConnected() {
    return ui.empty('Database not connected', 'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the Worker, then run ' + SQL_SCHEMA + ' in the database SQL editor.');
  }
  function isMissing(t) { return t.readable === false && (t.error === 'not_found' || t.error === 'db_schema_missing'); }
  function tableState(t) {
    if (isMissing(t)) return { label: 'Missing', tone: 'bad' };
    if (t.readable === false) return { label: 'Unreadable', tone: 'warn' };
    if (!Number(t.total)) return { label: 'Empty', tone: null };
    return { label: 'OK', tone: 'ok' };
  }
  function statePill(s) { return s.tone ? ui.pill(s.label, s.tone) : ui.pill(s.label); }

  /* --------------------------------------------------------------- Tables */

  function renderTables(host, ctx) {
    var body = h('div.page-body');
    host.appendChild(body);
    return ui.load(body, function () { return VX.api.get('/api/admin/tables'); }, function (d) {
      if (d.configured === false) return dbNotConnected();
      var tables = d.tables || [];
      var missing = tables.filter(isMissing);
      var unreadable = tables.filter(function (t) { return t.readable === false && !isMissing(t); });
      var withRows = tables.filter(function (t) { return Number(t.total) > 0; });
      var day = tables.reduce(function (a, t) { return a + (Number(t.last24h) || 0); }, 0);
      var empty = tables.length && !withRows.length;
      return [
        missing.length ? ui.notice(fmt.plural(missing.length, 'table is', 'tables are') + ' missing: ' + missing.map(function (t) { return t.name; }).join(', ') + '. Run ' + SQL_SCHEMA + ' in the database SQL editor — it creates only what is missing and deletes nothing.', 'bad') : null,
        empty && !missing.length ? ui.notice('Every table exists and is empty — a freshly reset database. Rows arrive as listeners open the app.', 'info') : null,
        ui.kpis([
          { label: 'Total rows', value: fmt.num(d.totalRows), sub: d.totalRows == null ? 'some tables could not be counted' : 'across ' + fmt.plural(tables.length, 'table') },
          { label: 'Rows · last 24h', value: fmt.num(day), sub: 'new or updated' },
          { label: 'Tables with data', value: fmt.num(withRows.length) + ' / ' + fmt.num(tables.length) },
          { label: 'Problems', value: fmt.num(missing.length + unreadable.length), sub: missing.length ? fmt.num(missing.length) + ' missing' : unreadable.length ? fmt.num(unreadable.length) + ' unreadable' : 'none', tone: missing.length ? 'bad' : unreadable.length ? 'warn' : null }
        ]),
        ui.card({ title: 'Tables', sub: d.checkedAt ? 'Counted ' + fmt.ago(d.checkedAt) : null, pad: false,
          actions: missing.length ? [ui.button('What to run', { kind: 'ghost', small: true, onClick: function () { ctx.go('data', 'fresh'); } })] : null,
          body: ui.table({
            columns: [
              { key: 'name', label: 'Table', render: function (t) { return h('div', h('div.cell-main', ui.mono(t.name)), t.note ? h('div.cell-sub', t.note) : null); } },
              { key: 'state', label: 'Status', sortVal: function (t) { return tableState(t).label; }, render: function (t) { return statePill(tableState(t)); } },
              { key: 'total', label: 'Rows', align: 'right', render: function (t) { return fmt.num(t.total); } },
              { key: 'last24h', label: 'Last 24h', align: 'right', render: function (t) { return fmt.num(t.last24h); } },
              { key: 'newestAt', label: 'Newest row', nowrap: true, render: function (t) { return t.newestAt ? h('span', { title: fmt.dateTime(t.newestAt) }, fmt.ago(t.newestAt)) : null; } }
            ],
            rows: tables, sortKey: 'total', exportName: 'vinax-tables', search: false, pageSize: 30,
            empty: 'No tables reported'
          }) }),
        housekeeping(ctx)
      ];
    }, { skeleton: 8 });
  }

  function housekeeping(ctx) {
    var evDays = ui.input({ type: 'number', min: 1, max: 3650, value: '90', style: { width: '110px' } });
    var aiDays = ui.input({ type: 'number', min: 1, max: 3650, value: '14', style: { width: '110px' } });
    function days(inp) { var n = Math.floor(Number(inp.value)); return n >= 1 && n <= 3650 ? n : null; }
    function run(action, inp, what) {
      var n = days(inp);
      if (!n) { inp.classList.add('invalid'); VX.toast('Enter a number of days from 1 to 3650', 'bad'); inp.focus(); return null; }
      inp.classList.remove('invalid');
      return VX.confirm({ title: 'Delete ' + what + ' older than ' + fmt.plural(n, 'day') + '?', body: 'Rows older than ' + fmt.plural(n, 'day') + ' are deleted permanently. Charts that look further back lose that history.', danger: true, confirmLabel: 'Delete', typed: 'DELETE' }).then(function (ok) {
        if (!ok) return null;
        return VX.api.post('/api/admin/maintenance', { action: action, days: n }).then(function (res) {
          if (res.ok) { VX.toast('Old ' + what + ' deleted', 'ok'); ctx.refresh(); }
          else VX.toast('Could not delete: ' + res.message, 'bad');
        });
      });
    }
    return ui.card({ title: 'Housekeeping', sub: 'Free space by deleting old rows. Both ask you to type DELETE first.', body: h('div.grid.cols-2',
      h('div.form',
        ui.field('Analytics events older than (days)', evDays, 'Plays, searches, errors and vitals in vinax_events.'),
        h('div', ui.button('Delete old events', { kind: 'danger', icon: 'trash', onClick: function () { return run('purge_events', evDays, 'analytics events'); } }))),
      h('div.form',
        ui.field('AI call log older than (days)', aiDays, 'Rows in vinax_ai_events. AI cost and success reports lose the deleted history.'),
        h('div', ui.button('Trim AI log', { kind: 'danger', icon: 'trash', onClick: function () { return run('trim_ai', aiDays, 'AI call log rows'); } }))))
    });
  }

  /* ------------------------------------------------------------ Browse data */

  // Mirror of QUERYABLE in backend/worker/functions/api/admin/query.ts — the
  // server is the authority; this only fills the pickers before a query runs.
  var QUERYABLE = {
    vinax_events: { label: 'Analytics events', columns: ['created_at', 'type', 'platform', 'app_version', 'country', 'city', 'region', 'language', 'song_id', 'song_title', 'song_artist', 'message'] },
    vinax_ai_events: { label: 'AI calls', columns: ['created_at', 'feature', 'model', 'ok', 'status', 'error', 'client', 'latency_ms'] },
    vinax_feedback: { label: 'Feedback and audit rows', columns: ['created_at', 'id', 'type', 'status', 'name', 'message', 'platform', 'app_version', 'country', 'city'] },
    vinax_users: { label: 'Listener devices', columns: ['last_seen', 'first_seen', 'name', 'username', 'platform', 'country', 'city', 'is_playing'] },
    vinax_rooms: { label: 'Listen Together rooms', columns: ['updated_at', 'code', 'host_name', 'song', 'playing'] },
    vinax_experiments: { label: 'Experiments', columns: ['created_at', 'key', 'name', 'active', 'variants'] },
    vinax_blocklist: { label: 'Blocklist', columns: ['created_at', 'song_id', 'song_title', 'reason'] },
    vinax_config: { label: 'Published settings', columns: ['updated_at', 'key', 'value'] },
    vinax_seo_urls: { label: 'Sitemap URLs', columns: ['added_at', 'type', 'key', 'title', 'slug', 'lang'] }
  };
  var WINDOWS = [{ value: 1, label: 'Last hour' }, { value: 24, label: 'Last 24 hours' }, { value: 168, label: 'Last 7 days' }, { value: 720, label: 'Last 30 days' }, { value: 2160, label: 'Last 90 days' }];
  var LIMITS = [50, 100, 200, 500];
  var SAFE_VAL = /^[\w .:@/#+-]{1,120}$/;
  var QUERY_ERRORS = {
    unknown_table: 'That table cannot be browsed.',
    unknown_column: 'That column cannot be filtered on.',
    bad_value: 'The filter value has characters the browser does not allow.'
  };
  var hidden = {}; // table → { column: true } hidden by the owner (kept for the session)

  function isTs(col) { return /(_at|_seen)$/.test(col); }
  function cell(v, col) {
    if (v == null || v === '') return null;
    if (typeof v === 'boolean') return v ? 'yes' : 'no';
    if (typeof v === 'object') { var j = JSON.stringify(v); return h('code.mono', { title: j.length > 80 ? j.slice(0, 2000) : null }, fmt.trunc(j, 80)); }
    if (isTs(col)) return h('span', { title: String(v) }, fmt.dateTime(v));
    var s = String(v);
    return s.length > 90 ? h('span', { title: s.slice(0, 2000) }, fmt.trunc(s, 90)) : s;
  }

  function renderQuery(host, ctx) {
    var p = ctx.params;
    var table = QUERYABLE[p.table] ? p.table : 'vinax_events';
    var hours = Number(p.hours) || 24;
    var limit = LIMITS.indexOf(Number(p.limit)) >= 0 ? Number(p.limit) : 200;
    var col = p.col && QUERYABLE[table].columns.indexOf(p.col) >= 0 ? p.col : '';
    var val = p.val || '';

    var tSel = ui.select(Object.keys(QUERYABLE).map(function (k) { return { value: k, label: QUERYABLE[k].label }; }), table, { title: 'Database table' });
    var wSel = ui.select(WINDOWS, hours);
    var cSel = h('select.input');
    var vInp = ui.input({ placeholder: 'e.g. play', value: val, maxlength: 120, autocomplete: 'off' });
    var lSel = ui.select(LIMITS.map(function (n) { return { value: n, label: fmt.num(n) + ' rows' }; }), limit);
    function fillCols() {
      VX.clear(cSel);
      cSel.appendChild(h('option', { value: '' }, 'No filter'));
      QUERYABLE[tSel.value].columns.forEach(function (c) { cSel.appendChild(h('option', { value: c, selected: c === col }, c)); });
      vInp.disabled = !cSel.value;
    }
    fillCols();
    tSel.addEventListener('change', function () { col = ''; vInp.value = ''; fillCols(); });
    cSel.addEventListener('change', function () { vInp.disabled = !cSel.value; if (cSel.value) vInp.focus(); });
    vInp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); runBtn.click(); } });

    var result = h('div');
    var runBtn = ui.button('Run', { kind: 'primary', icon: 'play', onClick: function () { return run(); } });
    host.appendChild(ui.card({ title: 'Query', sub: 'Newest rows first. Equality filter on one column.', body: h('div.form', { style: { 'max-width': 'none' } },
      h('div.form-row',
        ui.field('Table', tSel),
        ui.field('Time window', wSel),
        ui.field('Filter column', cSel),
        ui.field('Equals', vInp),
        ui.field('Limit', lSel)),
      h('div.toolbar', runBtn, ui.muted('Read-only — nothing here can change data. Filter values may use letters, digits, spaces and . : @ / # + -'))) }));
    host.appendChild(result);

    function run() {
      var q = { table: tSel.value, hours: Number(wSel.value), limit: Number(lSel.value) };
      var c = cSel.value, v = vInp.value.trim();
      vInp.classList.remove('invalid');
      if (c) {
        if (!v) { vInp.classList.add('invalid'); VX.toast('Enter a value for the filter, or choose “No filter”.', 'bad'); vInp.focus(); return null; }
        if (!SAFE_VAL.test(v)) { vInp.classList.add('invalid'); VX.toast(QUERY_ERRORS.bad_value, 'bad'); vInp.focus(); return null; }
        q.col = c; q.val = v;
      }
      ctx.setParam('table', q.table); ctx.setParam('hours', q.hours); ctx.setParam('limit', q.limit); ctx.setParam('col', q.col || ''); ctx.setParam('val', q.val || '');
      return ui.load(result, function () {
        return VX.api.get('/api/admin/query', q, { fresh: true }).then(function (res) {
          return !res.ok && QUERY_ERRORS[res.error] ? Object.assign({}, res, { message: QUERY_ERRORS[res.error] }) : res;
        });
      }, function (d) {
        if (d.configured === false) return dbNotConnected();
        return resultView(d, q);
      });
    }

    function resultView(d, q) {
      var rows = Array.isArray(d.rows) ? d.rows : [];
      var cols = Array.isArray(d.columns) && d.columns.length ? d.columns
        : (QUERYABLE[q.table] ? QUERYABLE[q.table].columns : rows[0] ? Object.keys(rows[0]) : []);
      var hid = hidden[q.table] || (hidden[q.table] = {});
      var tableHost = h('div');
      function draw() {
        var shown = cols.filter(function (c) { return !hid[c]; });
        VX.mount(tableHost, ui.table({
          columns: shown.map(function (c) {
            return { key: c, label: c, nowrap: isTs(c), render: function (r) { return cell(r[c], c); }, sortVal: function (r) { var v = r[c]; return v != null && typeof v === 'object' ? JSON.stringify(v) : v; } };
          }),
          rows: rows, exportName: 'vinax-' + q.table, search: true, pageSize: 50, dense: true,
          empty: 'No rows', emptyHint: 'Nothing in ' + q.table + ' matches this window' + (q.col ? ' and filter' : '') + '. Try a longer window.'
        }));
      }
      var picker = h('div.toolbar', { style: { padding: '0 16px 8px' } }, h('span.muted.small', 'Columns:'), cols.map(function (c) {
        var t = ui.toggle(c, !hid[c], function (on) { hid[c] = !on; draw(); }, { 'aria-label': 'Show column ' + c }); t.classList.add('compact'); return t;
      }));
      draw();
      var win = WINDOWS.filter(function (w) { return w.value === q.hours; })[0];
      return ui.card({
        title: fmt.plural(rows.length, 'row') + ' from ' + q.table,
        sub: (win ? win.label : 'Last ' + fmt.plural(q.hours, 'hour')) + (q.col ? ' · ' + q.col + ' = “' + q.val + '”' : '') + ' · newest first',
        pad: false,
        body: [
          d.truncated ? h('div', { style: { padding: '0 16px 10px' } }, ui.notice('Showing the newest ' + fmt.num(rows.length) + ' rows only. Shorten the window or add a filter to see the rest.', 'warn')) : null,
          rows.length ? picker : null,
          tableHost
        ]
      });
    }

    return run();
  }

  /* ------------------------------------------------------------ Audit trail */

  var KIND = {
    config: 'Setting', 'rec-config': 'Recommendation tuning', 'site-mode': 'Site mode', 'site-mode-change': 'Site mode',
    announcement: 'Announcement', 'song-push': 'Song push', 'push-send': 'Push sent', 'notify-retract': 'Push withdrawn',
    'user-delete': 'Delete listener', maintenance: 'Housekeeping', 'experiment-save': 'Experiment saved',
    'experiment-toggle': 'Experiment switched', 'experiment-delete': 'Experiment deleted', 'trends-import': 'Trends import',
    'trends-review': 'Trends review', 'trends-run': 'Trends run', 'trends-withdraw': 'Trends withdrawn'
  };
  function kindLabel(k) { return KIND[k] || (k ? String(k).replace(/[-_]/g, ' ') : '—'); }
  function auditText(r) {
    if (r.kind === 'site-mode' && typeof r.text === 'string' && r.text.indexOf('|') >= 0) {
      var i = r.text.indexOf('|');
      var note = r.text.slice(i + 1);
      return 'Site set to ' + r.text.slice(0, i) + (note ? ' — “' + note + '”' : '');
    }
    return r.text || '—';
  }

  function renderAudit(host) {
    return ui.load(host, function () { return VX.api.get('/api/admin/audit'); }, function (d) {
      if (d.configured === false) return dbNotConnected();
      var items = (d.items || []).filter(Boolean);
      return ui.card({ title: 'Console changes', sub: 'Newest 30 · one shared owner password, so every row is the owner', pad: false, body: ui.table({
        columns: [
          { key: 'at', label: 'When', nowrap: true, render: function (r) { return r.at ? h('span', { title: fmt.dateTime(r.at) }, fmt.ago(r.at)) : null; } },
          { key: 'kind', label: 'Action', sortVal: function (r) { return kindLabel(r.kind); }, render: function (r) { return ui.pill(kindLabel(r.kind), r.kind === 'config' ? 'info' : /delete|maintenance|retract|withdraw/.test(String(r.kind)) ? 'warn' : null); } },
          { key: 'text', label: 'What changed', sortVal: auditText, render: function (r) { return fmt.trunc(auditText(r), 110); } },
          { key: 'target', label: 'Target', render: function (r) { return r.target != null && r.target !== '' ? ui.mono(typeof r.target === 'object' ? JSON.stringify(r.target) : r.target) : null; } }
        ],
        rows: items, sortKey: 'at', exportName: 'vinax-audit', search: true,
        empty: 'No console changes yet', emptyHint: 'Publishing a setting, switching the site mode, sending a push or deleting data adds a row here.',
        onRow: openAudit
      }) });
    });
  }

  function openAudit(r) {
    var dr = VX.drawer({ title: kindLabel(r.kind) });
    var hasBefore = Object.prototype.hasOwnProperty.call(r, 'before');
    var hasAfter = Object.prototype.hasOwnProperty.call(r, 'after');
    VX.mount(dr.body,
      ui.dl([
        ['When', r.at ? fmt.dateTime(r.at) + ' (' + fmt.ago(r.at) + ')' : '—'],
        ['Action', kindLabel(r.kind)],
        ['What changed', auditText(r)],
        r.target != null ? ['Target', typeof r.target === 'object' ? JSON.stringify(r.target) : String(r.target)] : null,
        r.actor ? ['By', r.actor + (r.actorVia ? ' (' + r.actorVia + ')' : '')] : null,
        r.requestId ? ['Request id', ui.mono(r.requestId)] : null
      ]),
      hasBefore ? [h('h3', { style: { margin: '16px 0 6px', 'font-size': '14px' } }, 'Before'), r.before == null ? ui.muted('Not set') : ui.json(r.before)] : null,
      hasAfter ? [h('h3', { style: { margin: '16px 0 6px', 'font-size': '14px' } }, 'After'), r.after == null ? ui.muted('Cleared') : ui.json(r.after)] : null,
      hasBefore || hasAfter ? h('p.muted.small', { style: { 'margin-top': '10px' } }, 'Secrets are redacted and large values are reduced to a size and fingerprint.') : null
    );
  }

  /* -------------------------------------------------------- Fresh database */

  // Parts of /api/admin/technical that come from SQL functions created by
  // the schema file; when one is missing the part is listed as unavailable.
  var RPC_PARTS = { versions: 'vinax_versions()', errors: 'vinax_errors()', errorsByDay: 'vinax_errors_by_day()', summary: 'vinax_tech_summary()' };

  function renderFresh(host, ctx) {
    return ui.load(host, function () {
      return Promise.all([VX.api.get('/api/admin/tables'), VX.api.get('/api/admin/technical', { days: 1 })]).then(function (rs) {
        if (!rs[0].ok) return rs[0];
        return { ok: true, status: 200, data: { tables: rs[0].data || {}, tech: rs[1].ok ? rs[1].data || {} : null, techRes: rs[1] } };
      });
    }, function (d) {
      var tdata = d.tables;
      var connected = tdata.configured !== false;
      var tables = tdata.tables || [];
      var byName = {};
      tables.forEach(function (t) { byName[t.name] = t; });
      var missing = tables.filter(isMissing);
      var unreadable = tables.filter(function (t) { return t.readable === false && !isMissing(t); });
      var tech = d.tech;
      var rpcMissing = tech && tech.configured !== false ? (tech.unavailable || []).filter(function (k) { return RPC_PARTS[k]; }) : [];
      var events = byName.vinax_events, config = byName.vinax_config, accounts = byName.vinax_accounts;
      var hasEvents = events && Number(events.total) > 0;
      var hasConfig = config && Number(config.total) > 0;
      var hasAccounts = accounts && Number(accounts.total) > 0;
      var schemaOk = connected && !missing.length && !rpcMissing.length && !(tech === null);

      function step(done, tone, title, text, action) {
        return h('li', { style: { 'align-items': 'flex-start' } },
          h('div', { style: { 'min-width': '112px' } }, done === true ? ui.pill('Done', 'ok') : done === false ? ui.pill(tone === 'bad' ? 'Action needed' : 'Waiting', tone || null) : done === 'note' ? ui.pill('Reminder', 'info') : ui.pill('Unknown', 'warn')),
          h('div.grow', h('div.cell-main', title), h('div.cell-sub', { style: { 'margin-top': '3px' } }, text)),
          action || null);
      }

      var steps = h('ul.list', [
        step(connected, 'bad', 'Database connected', connected ? 'The Worker reaches the database with its service key.' : 'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the Worker.',
          connected ? null : ui.button('Server secrets', { kind: 'ghost', small: true, onClick: function () { ctx.go('health', 'env'); } })),
        step(connected ? !missing.length && !unreadable.length : false, 'bad', 'Every table exists',
          !connected ? 'Waiting for the connection.' : missing.length ? 'Missing: ' + missing.map(function (t) { return t.name; }).join(', ') + '. Run ' + SQL_SCHEMA + '.' : unreadable.length ? 'Could not read: ' + unreadable.map(function (t) { return t.name; }).join(', ') + '. Try again in a minute.' : fmt.plural(tables.length, 'table') + ' checked.'),
        step(!connected ? false : tech === null ? null : !rpcMissing.length, 'bad', 'Analytics functions exist',
          !connected ? 'Waiting for the connection.' : tech === null ? 'Could not check: ' + (d.techRes && d.techRes.message ? d.techRes.message : 'the errors report did not answer') + '.' : rpcMissing.length ? 'Missing: ' + rpcMissing.map(function (k) { return RPC_PARTS[k]; }).join(', ') + '. Run ' + SQL_SCHEMA + '.' : 'The report functions answer.'),
        step(connected ? !!hasEvents : false, null, 'First data arriving', hasEvents ? fmt.plural(events.total, 'analytics event') + ' so far, newest ' + fmt.ago(events.newestAt) + '.' : 'Fills in as soon as someone opens the app. Nothing needs importing.'),
        step(connected ? !!hasAccounts : false, null, 'First sign-ins', hasAccounts ? fmt.plural(accounts.total, 'account') + ' signed in again.' : 'Everyone signs in again after a reset; accounts appear here as they do.'),
        step(connected ? !!hasConfig : false, null, 'Console settings published again', hasConfig ? fmt.plural(config.total, 'setting') + ' published.' : 'A reset deletes every published setting (AI controls, flags, banners, notes). Restore them from a backup file.',
          hasConfig ? null : ui.button('Backup & restore', { kind: 'ghost', small: true, onClick: function () { ctx.go('settings', 'backup'); } })),
        step('note', null, 'Scheduled jobs', 'Jobs show “Not run yet” until their first run. Run the Trending headlines workflow once by hand to fill Trending now.',
          ui.button('Scheduled jobs', { kind: 'ghost', small: true, onClick: function () { ctx.go('health', 'cron'); } }))
      ]);

      return [
        !connected ? ui.notice('The database is not connected, so nothing below can be checked yet.', 'bad')
          : schemaOk ? ui.notice('The schema is complete. Empty tables are normal after a reset — they fill in as listeners use the app.', 'ok')
            : missing.length || rpcMissing.length ? ui.notice('Part of the schema is missing. Run ' + SQL_SCHEMA + ' (steps below). It is safe to run again: it creates what is missing and deletes nothing.', 'bad') : null,
        ui.grid([
          ui.card({ title: 'Checklist', sub: 'After a database reset', body: steps }),
          ui.card({ title: 'If a table or function is missing', sub: 'The console reports this as “A database table or function is missing”', body: [
            h('ol', { style: { margin: '0', 'padding-left': '20px', display: 'grid', gap: '6px' } },
              h('li', 'Open the database dashboard → SQL editor → New query.'),
              h('li', 'Paste the whole of ', ui.mono(SQL_SCHEMA), ' and press Run.'),
              h('li', 'Come back here and press Refresh.')),
            ui.notice('Safe to run any number of times: every statement is “create if not exists”, so nothing is deleted.', 'ok'),
            h('h3', { style: { margin: '16px 0 6px', 'font-size': '14px' } }, 'To wipe everything and start again'),
            h('ol', { style: { margin: '0', 'padding-left': '20px', display: 'grid', gap: '6px' } },
              h('li', 'Download a settings backup first (Settings → Backup & restore).'),
              h('li', 'Run ', ui.mono(SQL_WIPE), ' — it permanently deletes every vinax_ table, function and the status page history.'),
              h('li', 'Then run ', ui.mono(SQL_SCHEMA), ' to create everything again. ', ui.mono(SQL_RESET), ' does both in one paste.'),
              h('li', 'Restore the backup, then run the Trending headlines workflow once.')),
            ui.notice('Wiping cannot be undone: accounts, synced libraries, analytics, feedback and the audit trail are gone for good. The Worker secrets stay the same.', 'bad')
          ] })
        ]),
        connected ? ui.card({ title: 'Tables after the reset', sub: 'Which exist and which are still empty', pad: false, body: ui.table({
          columns: [
            { key: 'name', label: 'Table', render: function (t) { return ui.mono(t.name); } },
            { key: 'state', label: 'Status', sortVal: function (t) { return tableState(t).label; }, render: function (t) { return statePill(tableState(t)); } },
            { key: 'total', label: 'Rows', align: 'right', render: function (t) { return fmt.num(t.total); } },
            { key: 'note', label: 'Holds', render: function (t) { return t.note ? h('span.muted', t.note) : null; } }
          ],
          rows: tables, exportName: 'vinax-schema-check', search: false, pageSize: 30, dense: true,
          empty: 'No tables reported'
        }) }) : null
      ];
    }, { skeleton: 8 });
  }
})();
