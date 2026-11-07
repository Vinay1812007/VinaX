/* VinaX console — Database (console rebuild).
 * Tabs:
 *   tables       every table with a friendly name, rows, size and how long rows are kept (/api/admin/database)
 *   jobs         background jobs: what each does, on/off, how often, last run, Run now (owner)
 *   changes      the Change log: who changed what and when, with filters (/api/admin/audit)
 *   maintenance  the one-time database update, and clean-up actions (owner)
 */
(function () {
  'use strict';
  var VX = window.VX, h = VX.h, ui = VX.ui, fmt = VX.fmt, arr = VX.arr, obj = VX.obj, num = VX.num;

  [
    { id: 'db-tables', title: 'Database Tables', icon: 'database', render: renderTables,
      desc: 'What the database holds, how big it is, and how long each kind of data is kept.',
      keywords: 'database tables storage size rows kept' },
    { id: 'scheduled-jobs', title: 'Scheduled Jobs', icon: 'calendar', render: renderJobs,
      desc: 'Work the server does by itself on a timer. Owners can switch a job off, change how often it runs, or run it now.',
      keywords: 'jobs cron timer schedule automatic' },
    { id: 'change-log', title: 'Change Log', icon: 'edit', render: renderChanges,
      desc: 'Every change an admin made in this console: who, what and when.',
      keywords: 'change log audit history who changed' },
    { id: 'db-maintenance', title: 'Database Maintenance', icon: 'wrench', render: renderMaintenance,
      desc: 'Keep the database up to date and tidy.',
      keywords: 'maintenance clean up update schema upgrade' }
  ].forEach(function (p, i) {
    VX.page(Object.assign({ group: 'System', order: i + 1 }, p));
  });

  function fetchDb() { return VX.api.get('/api/admin/database', null, { fresh: true }); }

  /* ------------------------------------------------------------- Tables */

  function renderTables(host, ctx) {
    return ui.load(host, fetchDb, function (d) {
      var gate = ui.gate(d, ctx);
      if (gate) return gate;
      var tables = arr(d.tables), missing = arr(d.missing);
      var schema = obj(d.schema);
      var behind = d.schemaWanted && (schema.version == null || num(schema.version) < num(d.schemaWanted));
      return [
        behind ? ui.notice(h('span', 'The database needs a one-time update. ', ui.button('How to update', { kind: 'ghost', small: true, onClick: function () { ctx.go('db-maintenance'); } })), 'warn') : null,
        ui.stats([
          { label: 'Total size', value: fmt.bytes(d.totalBytes), info: 'Space the whole database uses, including its search indexes. The free plan allows 500 MB.' },
          { label: 'Tables', value: fmt.num(tables.length) + (missing.length ? '' : ' ✓'), sub: missing.length ? fmt.plural(missing.length, 'missing') : 'all present', tone: missing.length ? 'bad' : 'ok', info: 'Each table holds one kind of data. All of them must exist for every page to work.' },
          { label: 'Database version', value: schema.version != null ? String(schema.version) : '—', sub: behind ? 'update to ' + d.schemaWanted + ' needed' : 'up to date', tone: behind ? 'warn' : null, info: 'Which version of the database layout is installed. The console needs version ' + (d.schemaWanted || 8) + '.' }
        ]),
        missing.length ? ui.notice('Missing tables: ' + missing.join(', ') + '. Run the database update on the Maintenance tab.', 'bad') : null,
        ui.card({ title: 'Tables', sub: 'Biggest first', pad: false, body: ui.dataTable({
          rows: tables, rowId: function (t) { return t.name; }, exportName: 'vinax-tables', search: 'Search tables…', sortKey: 'bytes', sortDir: 'desc', pageSize: 50,
          empty: 'No tables found',
          columns: [
            { key: 'label', label: 'Table', always: true, sortVal: function (t) { return t.label || t.name; }, render: function (t) {
              return h('div', h('div.cell-main', t.label || fmt.label(t.name)), h('div.tech-name', t.name), t.about ? h('div.cell-sub', t.about) : null);
            } },
            { key: 'rows', label: 'Rows', align: 'right', render: function (t) {
              return t.approximate ? h('span.approx', fmt.num(t.rows), ui.info('Approximate: for big tables the database gives a quick estimate instead of counting every row.', 'Rows')) : fmt.num(t.rows);
            } },
            { key: 'bytes', label: 'Size', align: 'right', render: function (t) { return fmt.bytes(t.bytes); } },
            { key: 'keptFor', label: 'Kept for', render: function (t) { return t.keptFor || 'Forever'; } }
          ]
        }) }),
        h('p.muted.small', 'Change how long data is kept in ', h('a', { href: '#/app-settings/privacy', onclick: function (e) { e.preventDefault(); ctx.go('app-settings/privacy'); } }, 'App Settings → Data & Privacy'), '.')
      ];
    });
  }

  /* ---------------------------------------------------- Scheduled jobs */

  function everyLabel(min) {
    if (min < 60) return 'Every ' + min + ' minutes';
    if (min === 60) return 'Every hour';
    if (min < 1440) return 'Every ' + (min / 60) + ' hours';
    return min === 1440 ? 'Once a day' : 'Every ' + (min / 1440) + ' days';
  }
  function renderJobs(host, ctx) {
    var owner = VX.can('owner');
    return ui.load(host, fetchDb, function (d) {
      var gate = ui.gate(d, ctx);
      if (gate) return gate;
      var jobs = arr(d.jobs);
      function save(j, patch, what) {
        return VX.api.post('/api/admin/database', Object.assign({ action: 'job_setting', job: j.job }, patch)).then(function (res) {
          if (res.ok) { Object.assign(j, patch); VX.toast(what + ' ✓', 'ok'); } else { VX.toast('Something went wrong — ' + res.message, 'bad'); ctx.refresh(); }
        });
      }
      function runNow(j) {
        return VX.confirm({ title: 'Run “' + j.label + '” now?', body: j.about + ' It runs once now; its timer is not changed.', confirmLabel: 'Run now' }).then(function (yes) {
          if (!yes) return;
          return VX.api.post('/api/admin/database', { action: 'run_job', job: j.job }, { timeout: 120000 }).then(function (res) {
            var r = obj(obj(res.data).result);
            VX.toast(res.ok ? (r.ok ? j.label + ' finished ✓' : j.label + ' ran but something failed — see Last run') : 'Something went wrong — ' + res.message, res.ok && r.ok ? 'ok' : 'bad');
            ctx.refresh();
          });
        });
      }
      var late = jobs.filter(function (j) { return j.overdue; }).length;
      var failed = jobs.filter(function (j) { return j.ok === false; }).length;
      return [
        ui.readOnlyNote('owner'),
        d.jobsReadable === false ? ui.notice('The list of past runs could not be read, so “Last run” may be empty.', 'warn') : null,
        ui.stats([
          { label: 'Jobs switched on', value: fmt.num(jobs.filter(function (j) { return j.enabled; }).length) + ' of ' + fmt.num(jobs.length), info: 'Background jobs that run on their own timer.' },
          { label: 'Running late', value: fmt.num(late), tone: late ? 'warn' : 'ok', info: 'Jobs that have not run for much longer than their timer says. Usually the server’s timer is not set up or a job keeps failing.' },
          { label: 'Last run failed', value: fmt.num(failed), tone: failed ? 'bad' : 'ok', info: 'Jobs whose most recent run hit a problem.' }
        ]),
        h('div.job-list', jobs.map(function (j) {
          var toggle = ui.toggle('', j.enabled, function (on) { return save(j, { enabled: on }, j.label + (on ? ' switched on' : ' switched off')); }, { 'aria-label': 'Run ' + j.label + ' automatically', disabled: !owner });
          var choices = arr(j.choices).length ? arr(j.choices) : [j.every];
          var sched = ui.dropdown('How often', choices.map(function (m) { return { value: m, label: everyLabel(m) + (m === j.defaultEvery ? ' (normal)' : '') }; }), j.every, function (v) { save(j, { every: Number(v) }, j.label + ': ' + everyLabel(Number(v)).toLowerCase()); }, { disabled: !owner });
          var last = j.neverRan ? h('span.muted', 'Not run yet') : h('span', j.ok === true ? ui.pill('✓ Worked', 'ok') : j.ok === false ? ui.pill('✗ Failed', 'bad') : ui.pill('Still running'), ' ', ui.ago(j.lastAt));
          var problem = j.ok === false && j.summary && j.summary.error ? h('p.small.job-problem', 'What went wrong: ' + fmt.trunc(String(j.summary.error), 160)) : null;
          return ui.card({ title: j.label, sub: j.about, tone: j.overdue ? 'warn' : null,
            actions: [h('label.job-switch', h('span.muted.small', j.enabled ? 'On' : 'Off'), toggle)],
            body: h('div.job-body',
              h('div.job-grid', sched, h('div.dd', h('span.dd-label', 'Last run'), last), j.overdue ? h('div.dd', h('span.dd-label', 'Timing'), ui.pill('Running late', 'warn')) : null),
              problem,
              owner ? h('div.toolbar', ui.button('Run now', { kind: 'ghost', small: true, icon: 'play', onClick: function () { return runNow(j); } })) : null) });
        }))
      ];
    });
  }

  /* -------------------------------------------------------- Change log */

  var ACTION_NAMES = {
    settings: 'Changed an app setting', 'feedback-status': 'Updated feedback', 'feedback-delete': 'Deleted feedback', 'feedback-delete-resolved': 'Deleted resolved feedback',
    'push-send': 'Sent a notification', 'push-retract': 'Took back a notification', 'push-schedule': 'Scheduled a notification', 'push-draft': 'Saved a notification draft',
    'listener-delete': 'Deleted a user’s data', 'user-block': 'Blocked a user', 'user-unblock': 'Unblocked a user', 'device-signout': 'Signed out a device',
    'room-end': 'Closed a Listen Together room', 'room-end-all': 'Closed every Listen Together room',
    'content-block': 'Blocked music', 'content-unblock': 'Unblocked music', block: 'Blocked music', unblock: 'Unblocked music',
    'experiment-save': 'Saved an A/B test', 'experiment-delete': 'Deleted an A/B test',
    'db-purge-events': 'Cleaned up old activity', 'db-sweep-rooms': 'Closed empty rooms', 'db-retire-push': 'Forgot silent phones',
    'job-run': 'Ran a job by hand', 'job-setting': 'Changed a scheduled job', 'errors-clear': 'Cleared app errors', 'error-status': 'Set an error’s status',
    'admin-invite': 'Invited an admin', 'admin-role': 'Changed an admin’s role', 'admin-remove': 'Removed an admin', 'admin-signin': 'Signed in', 'admin-signin-refused': 'Sign-in refused (not an admin)',
    'media-upload': 'Uploaded a picture', 'robots-publish': 'Updated which bots may read the site'
  };
  function actionName(a) { return ACTION_NAMES[a] || fmt.label(a || 'change'); }

  function renderChanges(host, ctx) {
    var p = ctx.params;
    var state = { actor: p.actor || '', action: p.action || '', from: p.from || '', to: p.to || '', offset: Number(p.offset) || 0, limit: Number(p.limit) || 50 };
    var body = h('div');
    host.appendChild(body);
    function setState(patch) {
      Object.assign(state, patch);
      ['actor', 'action', 'from', 'to'].forEach(function (k) { ctx.setParam(k, state[k]); });
      ctx.setParam('offset', state.offset ? String(state.offset) : '');
      return load();
    }
    function open(r) {
      var dr = VX.drawer({ title: actionName(r.action) });
      VX.mount(dr.body,
        ui.dl([
          ['When', fmt.full(r.at)],
          ['Who', r.actor === 'owner' ? 'Owner (recovery password)' : r.actor],
          ['What', r.summary || '—'],
          ['Item', r.target || '—']
        ]),
        r.before != null ? [h('h4.subhead', 'Before'), ui.value(r.before)] : null,
        r.after != null ? [h('h4.subhead', 'After'), ui.value(r.after)] : null);
    }
    function load() {
      var params = { limit: state.limit, offset: state.offset };
      ['actor', 'action', 'from', 'to'].forEach(function (k) { if (state[k]) params[k] = state[k]; });
      return ui.load(body, function () { return VX.api.get('/api/admin/audit', params, { fresh: true }); }, function (d) {
        var gate = ui.gate(d, ctx);
        if (gate) return gate;
        var actors = arr(d.actors), actions = arr(d.actions);
        var filters = [
          ui.dropdown('Admin', [{ value: '', label: 'Every admin' }].concat(actors.map(function (a) { return { value: a, label: a === 'owner' ? 'Owner (recovery password)' : a }; })), state.actor, function (v) { setState({ actor: v, offset: 0 }); }, { inline: true }),
          ui.dropdown('Action', [{ value: '', label: 'Every action' }].concat(actions.map(function (a) { return { value: a, label: actionName(a) }; })), state.action, function (v) { setState({ action: v, offset: 0 }); }, { inline: true }),
          h('label.dd.inline.date-filter', h('span.dd-label', 'From'), ui.datePicker('From', state.from, function (v) { setState({ from: v, offset: 0 }); }, { bare: true, max: state.to || null })),
          h('label.dd.inline.date-filter', h('span.dd-label', 'To'), ui.datePicker('To', state.to, function (v) { setState({ to: v, offset: 0 }); }, { bare: true, min: state.from || null })),
          state.actor || state.action || state.from || state.to ? ui.button('Clear filters', { kind: 'ghost', small: true, onClick: function () { return setState({ actor: '', action: '', from: '', to: '', offset: 0 }); } }) : null
        ].filter(Boolean);
        return ui.card({ title: 'Change log', sub: fmt.plural(d.total, 'change') + (state.actor || state.action || state.from || state.to ? ' match these filters' : ' in total'), pad: false, body: ui.dataTable({
          rows: arr(d.rows), rowId: function (r) { return String(r.id); }, exportName: 'vinax-change-log', filters: filters, onRow: open,
          server: {
            total: d.total, offset: state.offset, limit: state.limit,
            onPage: function (o) { setState({ offset: o }); },
            onPageSize: function (n) { state.limit = n; ctx.setParam('limit', String(n)); setState({ offset: 0 }); }
          },
          empty: state.actor || state.action || state.from || state.to ? { title: 'No changes match these filters', hint: 'Clear the filters to see everything.' } : { title: 'No changes yet', hint: 'Every change made in this console appears here.' },
          columns: [
            { key: 'at', label: 'When', nowrap: true, sort: false, render: function (r) { return ui.ago(r.at); } },
            { key: 'actor', label: 'Who', sort: false, render: function (r) { return r.actor === 'owner' ? 'Owner (recovery password)' : r.actor; } },
            { key: 'action', label: 'What', sort: false, csv: function (r) { return actionName(r.action); }, render: function (r) { return h('div', h('div.cell-main', actionName(r.action)), r.summary ? h('div.cell-sub', fmt.trunc(r.summary, 120)) : null); } },
            { key: 'target', label: 'Item', sort: false, render: function (r) { return r.target ? fmt.trunc(r.target, 40) : null; } }
          ]
        }) });
      });
    }
    return load();
  }

  /* -------------------------------------------------------- Maintenance */

  function updateCard(d) {
    var schema = obj(d.schema), want = num(d.schemaWanted) || 8;
    var cur = schema.version != null ? num(schema.version) : null;
    var behind = cur == null || cur < want;
    return ui.card({ title: 'Database update', tone: behind ? 'warn' : null,
      sub: behind ? 'Installed version: ' + (cur == null ? 'unknown' : cur) + ' · the console needs version ' + want : 'Up to date — version ' + cur + (schema.appliedAt ? ', installed ' + fmt.ago(schema.appliedAt) : ''),
      body: behind ? [
        h('p', 'The new console counts only people signed in with Google and keeps admins, error statuses and scheduled notifications. That needs a one-time update to the database. It adds what is missing and never deletes data.'),
        h('ol.steps',
          h('li', 'Open your Supabase project (the “vinax” project) and choose ', h('strong', 'SQL Editor'), '.'),
          h('li', 'Open the file ', ui.mono('backend/supabase/schema.sql'), ' from the VinaX code, copy all of it and paste it into a new query.'),
          h('li', 'Press ', h('strong', 'Run'), '. It finishes with “VinaX schema version ' + want + ' applied”.'),
          h('li', 'Come back here and refresh. This card turns green.')),
        h('p.muted.small', 'If the code repository has the SUPABASE_DB_URL secret set, the Schema workflow does this by itself whenever the change is merged.')
      ] : h('p.muted', 'Nothing to do. Updates appear here when a new version of the console needs one.') });
  }

  function renderMaintenance(host, ctx) {
    var owner = VX.can('owner');
    return ui.load(host, fetchDb, function (d) {
      var gate = ui.gate(d, ctx);
      if (gate) return gate;
      var ret = obj(d.retention);
      var keep = num(ret.eventsDays) || 180;
      function post(req, label, done) {
        return VX.api.post('/api/admin/database', req, { timeout: 90000 }).then(function (res) {
          VX.toast(res.ok ? label + ' — ' + done(obj(res.data)) + ' ✓' : 'Something went wrong — ' + res.message, res.ok ? 'ok' : 'bad');
          if (res.ok) ctx.refresh();
        });
      }
      var purgeDays = keep;
      var purgeChoices = [30, 90, 180, 365].concat(keep && [30, 90, 180, 365].indexOf(keep) < 0 ? [keep] : []).sort(function (a, b) { return a - b; });
      var silentDays = 180;
      function action(title, explain, controls, button) {
        return ui.card({ title: title, body: h('div.form', h('p.muted', explain), controls, owner ? h('div.actions', button) : null) });
      }
      return [
        updateCard(d),
        ui.readOnlyNote('owner'),
        ui.grid([
          action('Clean up old data now', 'Removes play history and activity older than the period you choose, and data past its Data & Privacy period. This also runs by itself every hour.',
            ui.dropdown('Delete activity older than', purgeChoices.map(function (n) { return { value: n, label: (n % 365 === 0 ? n / 365 + ' year' + (n === 365 ? '' : 's') : n + ' days') + (n === keep ? ' (your Data & Privacy setting)' : '') }; }), keep, function (v) { purgeDays = Number(v); }, { disabled: !owner }),
            ui.button('Clean up now', { kind: 'danger', icon: 'trash', onClick: function () {
              return VX.confirm({ title: 'Delete activity older than ' + fmt.plural(purgeDays, 'day') + '?', body: 'Plays, searches and other activity older than that are deleted for good, and Music Stats for that time go with them. Users, feedback and settings are not touched.', danger: true, typed: true, confirmLabel: 'Delete old activity' }).then(function (yes) {
                if (yes) return post({ action: 'purge_events', days: purgeDays }, 'Clean-up', function (r) { return fmt.plural(r.deleted, 'row') + ' removed'; });
              });
            } })),
          action('Rebuild statistics', 'Re-works the “played together” links behind recommendations from the last 30 days. Normally this happens every night. It can take a minute.', null,
            ui.button('Rebuild now', { kind: 'ghost', icon: 'refresh', onClick: function () {
              return VX.confirm({ title: 'Rebuild statistics now?', body: 'Recommendations keep working while it runs.', confirmLabel: 'Rebuild' }).then(function (yes) {
                if (!yes) return;
                return VX.api.post('/api/admin/personal', { action: 'colisten' }, { timeout: 120000 }).then(function (res) {
                  VX.toast(res.ok ? 'Statistics rebuilt — ' + fmt.plural(obj(res.data).pairs, 'link') + ' ✓' : 'Something went wrong — ' + res.message, res.ok ? 'ok' : 'bad');
                });
              });
            } })),
          action('Close empty Listen Together rooms', 'Closes rooms nobody used for six hours and removes members who left a day ago. Happens by itself every hour.', null,
            ui.button('Close empty rooms', { kind: 'ghost', icon: 'refresh', onClick: function () {
              return VX.confirm({ title: 'Close empty rooms now?', body: 'Rooms people are using stay open.', confirmLabel: 'Close empty rooms' }).then(function (yes) {
                if (yes) return post({ action: 'sweep_rooms' }, 'Rooms', function (r) { return fmt.plural(r.rooms, 'room') + ' closed'; });
              });
            } })),
          action('Forget phones that stopped responding', 'Stops sending notifications to phones and browsers that have not opened the app for a while. They come back on their own the next time the app opens.',
            ui.dropdown('Silent for', [{ value: 90, label: '90 days' }, { value: 180, label: '180 days' }, { value: 365, label: '1 year' }], 180, function (v) { silentDays = Number(v); }, { disabled: !owner }),
            ui.button('Forget silent phones', { kind: 'ghost', icon: 'bell', onClick: function () {
              return VX.confirm({ title: 'Forget phones silent for ' + fmt.plural(silentDays, 'day') + '?', body: 'They stop getting notifications until the app is opened on them again.', confirmLabel: 'Forget them' }).then(function (yes) {
                if (yes) return post({ action: 'retire_push', days: silentDays }, 'Phones', function (r) { return fmt.plural(r.retired, 'phone') + ' forgotten'; });
              });
            } }))
        ], 2)
      ];
    });
  }
})();
