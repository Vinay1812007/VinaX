/* VinaX console — Settings page.
 * Owner switches published through the config store (VX.config →
 * /api/admin/appconfig): feature kill-switches ('flags'), the maintenance
 * scheduler ('maintenance-window'), the minimum Android build ('min-version');
 * the live site switch (public /api/site-mode + POST /api/admin/maintenance
 * { action: 'site_mode', mode, note }); a backup / restore of every config
 * key; and the owner runbook (static how-tos plus the 'runbook' notes key). */
(function () {
  'use strict';
  var VX = window.VX, h = VX.h, ui = VX.ui, fmt = VX.fmt;

  VX.page({
    id: 'settings', title: 'Settings', group: 'System', icon: 'settings', noAuto: true,
    desc: 'Feature switches, maintenance mode, the minimum app version, settings backup and the owner runbook.',
    tabs: [
      { id: 'flags', label: 'Feature switches', desc: 'Turn app features off for everyone. Everything is on unless switched off here.', render: renderFlags },
      { id: 'maintenance', label: 'Maintenance', desc: 'Put the app into maintenance now, or schedule a window that starts and ends by itself.', render: renderMaintenance },
      { id: 'versions', label: 'App versions', desc: 'Force old Android builds to update, and the update notes that ship with the app.', render: renderVersions },
      { id: 'backup', label: 'Backup & restore', desc: 'Download every published setting as one file, or restore one after a mistake or a database reset.', render: renderBackup },
      { id: 'runbook', label: 'Runbook', desc: 'How to do the rare owner jobs, plus your own notes.', render: renderRunbook }
    ]
  });

  /* ------------------------------------------------------------ helpers */

  /** VX.config.get(key) as a VX.api-shaped result for ui.load. */
  function cfgLoad(key) {
    return VX.config.get(key).then(function (r) {
      if (r.ok) return { ok: true, status: 200, data: r };
      if (r.res && !r.res.ok) return r.res;
      return { ok: false, status: 200, error: 'db_unconfigured', message: r.message || VX.errorText('db_unconfigured') };
    });
  }
  function isObj(v) { return v != null && typeof v === 'object' && !Array.isArray(v); }
  function heading(text) { return h('h3', { style: { margin: '16px 0 6px', 'font-size': '14px' } }, text); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  /** ISO → value for <input type="datetime-local"> in the browser's zone. */
  function toLocalInput(iso) {
    var d = iso ? new Date(iso) : null;
    if (!d || isNaN(d)) return '';
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + 'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }
  function fromLocalInput(v) { if (!v) return null; var d = new Date(v); return isNaN(d) ? null : d.toISOString(); }
  function zoneName() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'your time zone'; } catch (e) { return 'your time zone'; } }

  /* ----------------------------------------------------- Feature switches */

  // Only these keys are read by the app (frontend/src: flagOn / useFeatureEnabled).
  var KNOWN_FLAGS = [
    { key: 'codeRun', label: 'Run and preview code in VinaX AI', note: 'Off hides the Run and Open buttons under code the assistant writes, and shows HTML as plain code.' },
    { key: 'listenTogether', label: 'Listen Together', note: 'Off hides the Listen Together entry in the Library.' },
    { key: 'aiHome', label: 'AI-designed Home shelves', note: 'Off hides the “Designed for you” shelves on Home and stops their AI requests.' }
  ];

  function renderFlags(host, ctx) {
    return ui.load(host, function () { return cfgLoad('flags'); }, function (r) {
      var stored = isObj(r.value) ? r.value : {};
      var known = {};
      KNOWN_FLAGS.forEach(function (f) { known[f.key] = true; });
      var draft = {};
      KNOWN_FLAGS.forEach(function (f) { draft[f.key] = stored[f.key] !== false; });
      var extras = Object.keys(stored).filter(function (k) { return !known[k]; });
      var dropped = {};
      var changes = h('span.muted.small');
      function changed() {
        var n = KNOWN_FLAGS.filter(function (f) { return draft[f.key] !== (stored[f.key] !== false); }).length + Object.keys(dropped).length;
        changes.textContent = n ? fmt.plural(n, 'unpublished change') : 'No unpublished changes';
        return n;
      }
      changed();
      var offCount = KNOWN_FLAGS.filter(function (f) { return stored[f.key] === false; }).length;

      return [
        offCount ? ui.notice(fmt.plural(offCount, 'feature is', 'features are') + ' switched off for every listener.', 'warn') : null,
        ui.card({
          title: 'Features',
          sub: r.updatedAt ? 'Published ' + fmt.ago(r.updatedAt) + ' · the app picks changes up within about a minute' : 'Nothing published — every feature is on',
          body: [
            h('ul.list', KNOWN_FLAGS.map(function (f) {
              var sw = ui.toggle('', draft[f.key], function (on) { draft[f.key] = on; state.textContent = on ? 'On' : 'Off'; changed(); }, { 'aria-label': f.label });
              var state = h('span.small', { style: { 'min-width': '24px' } }, draft[f.key] ? 'On' : 'Off');
              return h('li', { style: { 'align-items': 'flex-start' } },
                h('div.grow', h('div.cell-main', f.label), h('div.cell-sub', { style: { 'margin-top': '3px' } }, f.note), h('div.cell-sub', ui.mono(f.key))),
                state, sw);
            })),
            extras.length ? [heading('Stored switches the app does not read'), h('ul.list', extras.map(function (k) {
              var rm = ui.button('Remove', { kind: 'ghost', small: true, icon: 'trash', onClick: function () { dropped[k] = true; li.style.opacity = '.45'; rm.disabled = true; changed(); } });
              var li = h('li', ui.mono(k), h('span.grow', ui.muted(String(stored[k]) + ' · nothing in the app reads this switch, so it can be removed')), rm);
              return li;
            }))] : null,
            h('div.toolbar', { style: { 'margin-top': '14px' } },
              ui.button('Publish', { kind: 'primary', icon: 'send', onClick: function () {
                if (!changed()) { VX.toast('Nothing to publish', 'ok'); return null; }
                var value = {};
                extras.forEach(function (k) { if (!dropped[k] && typeof stored[k] === 'boolean') value[k] = stored[k]; });
                KNOWN_FLAGS.forEach(function (f) { value[f.key] = !!draft[f.key]; });
                return VX.config.set('flags', value).then(function (res) { if (res.ok) ctx.refresh(); });
              } }),
              ui.button('Turn everything on', { kind: 'ghost', disabled: !r.updatedAt && !extras.length, onClick: function () {
                return VX.confirm({ title: 'Turn every feature on?', body: 'Clears the published switches. Every feature goes back to on for all listeners.', confirmLabel: 'Turn on' }).then(function (ok) {
                  if (!ok) return null;
                  return VX.config.set('flags', null).then(function (res) { if (res.ok) ctx.refresh(); });
                });
              } }),
              h('span.grow'), changes)
          ]
        })
      ];
    });
  }

  /* ------------------------------------------------------------ Maintenance */

  function renderMaintenance(host, ctx) {
    var modeHost = h('div');
    var winHost = h('div');
    host.appendChild(modeHost);
    host.appendChild(winHost);

    function loadMode() {
      return ui.load(modeHost, function () { return VX.api.get('/api/site-mode', null, { fresh: true, noAuthRedirect: true }); }, function (d) {
        var mode = d.mode === 'maintenance' ? 'maintenance' : 'live';
        var note = ui.textarea({ rows: 2, maxlength: 200, placeholder: 'Back in 30 minutes — we are upgrading the database.', value: d.note || '' });
        function post(nextMode, label) {
          var body = { action: 'site_mode', mode: nextMode, note: note.value.trim().slice(0, 200) };
          return VX.api.post('/api/admin/maintenance', body).then(function (res) {
            if (res.ok && res.data && res.data.ok !== false) { VX.toast(label, 'ok'); loadMode(); }
            else VX.toast('Could not change the site mode: ' + (res.message || 'the database write failed'), 'bad');
            return res;
          });
        }
        var actions;
        if (d.scheduled) {
          actions = [ui.notice('A scheduled maintenance window is running, so the switch below is ignored until it ends. To end it early, clear the window.', 'warn')];
        } else if (mode === 'live') {
          actions = [h('div.toolbar',
            ui.button('Switch to maintenance', { kind: 'danger', icon: 'alert', onClick: function () {
              return VX.confirm({ title: 'Put the app into maintenance?', body: 'Every listener sees the maintenance screen within about a minute, with the message above. Music stops working until you go live again.', danger: true, confirmLabel: 'Switch to maintenance' }).then(function (ok) {
                return ok ? post('maintenance', 'The app is in maintenance mode') : null;
              });
            } }),
            ui.button('Save message', { kind: 'ghost', onClick: function () { return post('live', 'Message saved — the app stays live'); } }))];
        } else {
          actions = [h('div.toolbar',
            ui.button('Go live', { kind: 'primary', icon: 'play', onClick: function () {
              return VX.confirm({ title: 'Go live?', body: 'Listeners leave the maintenance screen within about a minute.', confirmLabel: 'Go live' }).then(function (ok) {
                return ok ? post('live', 'The app is live again') : null;
              });
            } }),
            ui.button('Update message', { kind: 'ghost', onClick: function () { return post('maintenance', 'Message updated — still in maintenance'); } }))];
        }
        return ui.card({
          title: 'Site mode',
          tone: mode === 'maintenance' ? 'bad' : null,
          actions: [mode === 'maintenance' ? ui.pill(d.scheduled ? 'Maintenance · scheduled' : 'Maintenance', 'bad') : ui.pill('Live', 'ok')],
          sub: mode === 'maintenance' ? 'Listeners see the maintenance screen. This console keeps working.' : 'The app is open to everyone.',
          body: h('div.form',
            ui.field('Message listeners see', note, d.scheduled ? 'This is the scheduled window’s note; edit it in the scheduler below.' : 'Up to 200 characters. Saved with the switch.'),
            actions)
        });
      });
    }

    function loadWindow() {
      return ui.load(winHost, function () { return cfgLoad('maintenance-window'); }, function (r) {
        var w = isObj(r.value) ? r.value : null;
        var s = w ? Date.parse(w.start) : NaN, e = w ? Date.parse(w.end) : NaN, now = Date.now();
        var valid = w && !isNaN(s) && !isNaN(e) && e > s;
        var state = !w ? null : !valid ? { label: 'Invalid', tone: 'warn', text: 'The stored window has no valid start and end, so it is ignored.' }
          : now < s ? { label: 'Scheduled', tone: 'info', text: 'Starts ' + fmt.dateTime(w.start) + ' (' + fmt.ago(w.start) + ') · ends ' + fmt.dateTime(w.end) + '.' }
            : now <= e ? { label: 'Running now', tone: 'bad', text: 'Maintenance until ' + fmt.dateTime(w.end) + ' (' + fmt.ago(w.end) + ').' }
              : { label: 'Finished', tone: null, text: 'Ended ' + fmt.dateTime(w.end) + '. It no longer does anything; clear it or schedule a new one.' };
        var startIn = ui.input({ type: 'datetime-local', value: w ? toLocalInput(w.start) : '' });
        var endIn = ui.input({ type: 'datetime-local', value: w ? toLocalInput(w.end) : '' });
        var noteIn = ui.input({ maxlength: 200, placeholder: 'Back at 3 am — upgrading the database.', value: w && typeof w.note === 'string' ? w.note : '' });
        return ui.card({
          title: 'Scheduled maintenance',
          sub: 'The app switches to maintenance at the start and back to live at the end, with nobody awake.',
          actions: state ? [state.tone ? ui.pill(state.label, state.tone) : ui.pill(state.label)] : [ui.pill('None')],
          body: h('div.form',
            state ? ui.notice(state.text, state.tone === 'bad' ? 'warn' : 'info') : null,
            h('div.form-row',
              ui.field('Starts', startIn),
              ui.field('Ends', endIn)),
            h('p.muted.small', { style: { 'margin-top': '-6px' } }, 'Times are in ' + zoneName() + '.'),
            ui.field('Note shown to listeners', noteIn),
            h('div.toolbar',
              ui.button(w ? 'Save window' : 'Schedule', { kind: 'primary', icon: 'check', onClick: function () {
                var st = fromLocalInput(startIn.value), en = fromLocalInput(endIn.value);
                [startIn, endIn].forEach(function (i) { i.classList.remove('invalid'); });
                if (!st) { startIn.classList.add('invalid'); VX.toast('Pick a start time', 'bad'); return null; }
                if (!en) { endIn.classList.add('invalid'); VX.toast('Pick an end time', 'bad'); return null; }
                if (Date.parse(en) <= Date.parse(st)) { endIn.classList.add('invalid'); VX.toast('The end must be after the start', 'bad'); return null; }
                if (Date.parse(en) <= Date.now()) { endIn.classList.add('invalid'); VX.toast('The end is in the past', 'bad'); return null; }
                var value = { start: st, end: en, note: noteIn.value.trim().slice(0, 200) };
                return VX.config.set('maintenance-window', value).then(function (res) { if (res.ok) { loadWindow(); loadMode(); } });
              } }),
              w ? ui.button(state && state.label === 'Running now' ? 'End window now' : 'Clear window', { kind: 'ghost', icon: 'trash', onClick: function () {
                var running = state && state.label === 'Running now';
                return VX.confirm({ title: running ? 'End the window now?' : 'Clear the scheduled window?', body: running ? 'The app goes back to whatever the site mode switch says (normally live) within about a minute.' : 'The window is removed and will not start.', danger: running, confirmLabel: running ? 'End now' : 'Clear' }).then(function (ok) {
                  if (!ok) return null;
                  return VX.config.set('maintenance-window', null).then(function (res) { if (res.ok) { loadWindow(); loadMode(); } });
                });
              } }) : null))
        });
      });
    }

    return Promise.all([loadMode(), loadWindow()]);
  }

  /* ----------------------------------------------------------- App versions */

  function semverCmp(a, b) {
    var x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
    for (var i = 0; i < Math.max(x.length, y.length); i++) { var d = (x[i] || 0) - (y[i] || 0); if (d) return d; }
    return 0;
  }

  function renderVersions(host, ctx) {
    var minHost = h('div');
    var notesHost = h('div');
    host.appendChild(minHost);
    host.appendChild(notesHost);

    function loadMin() {
      var verP = VX.api.get('/api/version', null, { fresh: true, noAuthRedirect: true });
      return ui.load(minHost, function () { return cfgLoad('min-version'); }, function (r) {
        var mv = isObj(r.value) ? r.value : null;
        var cur = mv && Number.isInteger(mv.build) && mv.build > 0 ? mv.build : null;
        var latest = { build: null, version: null };
        var latestLine = h('span.muted', 'Checking the newest release…');
        var buildIn = ui.input({ type: 'number', min: 1, step: 1, inputmode: 'numeric', placeholder: 'e.g. 5140', value: cur ? String(cur) : '', style: { width: '180px' } });
        var reasonIn = ui.input({ maxlength: 160, placeholder: 'Why listeners must update (kept for the audit trail)', value: mv && typeof mv.reason === 'string' ? mv.reason : '' });
        verP.then(function (res) {
          var d = res.data || {};
          if (res.ok && Number(d.build) > 0) {
            latest.build = Number(d.build); latest.version = d.version || null;
            VX.mount(latestLine, 'Newest release: ', h('strong', 'build ' + fmt.num(d.build)), d.version ? ' (version ' + d.version + ')' : '');
          } else {
            VX.mount(latestLine, res.error === 'not_configured' ? 'The newest release is unknown: the Worker secret GITHUB_TOKEN is not set.' : 'The newest release could not be read' + (res.error ? ' (' + String(res.error).replace(/_/g, ' ') + ')' : '') + '.');
          }
        });
        return ui.card({
          title: 'Minimum Android build',
          sub: 'Builds below this lose “Update later” and must update to keep using the app. Use it for security fixes or breaking changes only.',
          actions: [cur ? ui.pill('Builds below ' + fmt.num(cur) + ' must update', 'warn') : ui.pill('No minimum')],
          body: h('div.form',
            h('p', latestLine),
            mv && mv.setAt ? h('p.muted.small', 'Set ' + fmt.dateTime(mv.setAt) + (mv.reason ? ' · ' + mv.reason : '')) : null,
            h('div.form-row',
              ui.field('Minimum build number', buildIn),
              ui.field('Reason', reasonIn)),
            h('p.muted.small', { style: { 'margin-top': '-6px' } }, 'The build number is the Android versionCode, shown as “build” on each release.'),
            h('div.toolbar',
              ui.button('Publish minimum', { kind: 'primary', icon: 'send', onClick: function () {
                var b = Number(buildIn.value);
                buildIn.classList.remove('invalid');
                if (!Number.isInteger(b) || b < 1) { buildIn.classList.add('invalid'); VX.toast('Enter a whole build number above 0', 'bad'); buildIn.focus(); return null; }
                if (latest.build && b > latest.build) { buildIn.classList.add('invalid'); VX.toast('Build ' + fmt.num(b) + ' is newer than the newest release (' + fmt.num(latest.build) + '): every listener would be stuck.', 'bad'); return null; }
                return VX.confirm({ title: 'Force builds below ' + fmt.num(b) + ' to update?', body: 'Listeners on an older Android build can no longer skip the update. Web listeners are not affected.', danger: true, confirmLabel: 'Publish' }).then(function (ok) {
                  if (!ok) return null;
                  return VX.config.set('min-version', { build: b, reason: reasonIn.value.trim().slice(0, 160), setAt: new Date().toISOString() }).then(function (res) { if (res.ok) loadMin(); });
                });
              } }),
              cur ? ui.button('Remove minimum', { kind: 'ghost', onClick: function () {
                return VX.config.set('min-version', null).then(function (res) { if (res.ok) loadMin(); });
              } }) : null))
        });
      });
    }

    function loadNotes() {
      return ui.load(notesHost, function () {
        return VX.api.get('/changelog.json', null, { fresh: true, noAuthRedirect: true }).then(function (res) {
          return res.status === 404 ? { ok: true, status: 200, data: { missing: true } } : res;
        });
      }, function (d) {
        if (d && d.missing) return ui.card({ title: 'Update notes in the app', body: ui.empty('Not on this host yet', 'changelog.json is written by the production build, so the notes appear here after the next deploy.') });
        var rel = (d && Array.isArray(d.releases) ? d.releases : []).filter(function (r) { return r && r.version; });
        rel.sort(function (a, b) { return semverCmp(b.version, a.version); });
        return ui.card({
          title: 'Update notes in the app',
          sub: rel.length ? fmt.plural(rel.length, 'release') + ' · newest ' + rel[0].version + (d.generatedAt ? ' · built ' + fmt.ago(d.generatedAt) : '') : null,
          body: rel.length ? h('div.page-body', rel.slice(0, 6).map(function (r) {
            return h('div',
              h('div', h('strong', 'v' + r.version), r.title ? h('span.muted', ' · ' + r.title) : null),
              h('ul.list', (r.changes || []).slice(0, 12).map(function (c) {
                return h('li', { style: { 'align-items': 'flex-start' } }, ui.pill(c.type || 'change', c.type === 'fix' ? 'warn' : c.type === 'new' ? 'ok' : null), h('span.grow', c.text || '—'));
              })));
          })) : ui.empty('No update notes', 'Notes come from the app’s changelog when it is built.')
        });
      });
    }

    return Promise.all([loadMin(), loadNotes()]);
  }

  /* -------------------------------------------------------- Backup & restore */

  function size(v) { return v == null ? 0 : JSON.stringify(v).length; }
  function same(a, b) { return JSON.stringify(a == null ? null : a) === JSON.stringify(b == null ? null : b); }

  function renderBackup(host, ctx) {
    return ui.load(host, function () {
      return VX.config.all().then(function (r) {
        return r.ok ? { ok: true, status: 200, data: r } : { ok: false, status: 0, error: 'read_failed', message: r.message || 'Could not read the published settings.' };
      });
    }, function (all) {
      var values = all.values || {};
      var keys = VX.config.keys || Object.keys(values);
      var setKeys = keys.filter(function (k) { return values[k] != null; });
      var restoreHost = h('div');

      var listCard = ui.card({
        title: 'Published settings',
        sub: fmt.num(setKeys.length) + ' of ' + fmt.plural(keys.length, 'key') + ' published',
        actions: [ui.button('Download backup', { kind: 'primary', small: true, icon: 'download', disabled: !setKeys.length, onClick: function () {
          var config = {};
          setKeys.forEach(function (k) { config[k] = values[k]; });
          VX.download.json('vinax-config-' + VX.stamp(), { exportedAt: new Date().toISOString(), config: config });
          VX.toast('Backup downloaded — ' + fmt.plural(setKeys.length, 'key'), 'ok');
        } })],
        pad: false,
        body: [
          (all.failed || []).length ? h('div', { style: { padding: '0 16px 10px' } }, ui.notice('Could not read: ' + all.failed.join(', ') + '. They are left out of the backup.', 'warn')) : null,
          !setKeys.length ? h('div', { style: { padding: '0 16px 10px' } }, ui.notice('Nothing is published yet — every setting uses the app’s default. After a database reset, restore a backup file below.', 'info')) : null,
          ui.table({
            columns: [
              { key: 'key', label: 'Key', render: function (r) { return ui.mono(r.key); } },
              { key: 'state', label: 'Status', render: function (r) { return r.failed ? ui.pill('Unreadable', 'warn') : r.set ? ui.pill('Published', 'ok') : ui.pill('Default'); } },
              { key: 'updated', label: 'Updated', nowrap: true, render: function (r) { return r.updated ? h('span', { title: fmt.dateTime(r.updated) }, fmt.ago(r.updated)) : null; } },
              { key: 'size', label: 'Size', align: 'right', render: function (r) { return r.set ? fmt.bytes(r.size) : null; } }
            ],
            rows: keys.map(function (k) { return { key: k, set: values[k] != null, failed: (all.failed || []).indexOf(k) >= 0, updated: (all.updatedAt || {})[k] || null, size: size(values[k]) }; }),
            exportName: false, search: false, pageSize: 30, dense: true,
            onRow: function (r) { if (r.set) { var dr = VX.drawer({ title: r.key }); VX.mount(dr.body, ui.json(values[r.key])); } }
          })
        ]
      });

      var file = h('input', { type: 'file', accept: 'application/json,.json', class: 'input' });
      file.addEventListener('change', function () {
        var f = file.files && file.files[0];
        if (!f) return;
        if (f.size > 5 * 1024 * 1024) { VX.mount(restoreHost, ui.notice('That file is too large to be a settings backup.', 'bad')); return; }
        var reader = new FileReader();
        reader.onload = function () { VX.mount(restoreHost, preview(String(reader.result || ''), values, all, keys, ctx)); };
        reader.onerror = function () { VX.mount(restoreHost, ui.notice('Could not read that file.', 'bad')); };
        reader.readAsText(f);
      });
      var restoreCard = ui.card({
        title: 'Restore from a backup',
        sub: 'Pick a backup file. You see every difference first and choose which keys to publish.',
        body: [h('div.form', ui.field('Backup file', file, 'A .json file downloaded from this page (older console backups work too).')), restoreHost]
      });

      return [listCard, restoreCard];
    });
  }

  function preview(text, current, all, keys, ctx) {
    var j;
    try { j = JSON.parse(text); } catch (e) { return ui.notice('That is not a JSON file.', 'bad'); }
    var src = isObj(j) && isObj(j.config) ? j.config : isObj(j) && isObj(j.keys) ? j.keys : isObj(j) ? j : null;
    if (!src) return ui.notice('This file does not contain settings.', 'bad');
    delete src.exportedAt;
    var allowed = {};
    keys.forEach(function (k) { allowed[k] = true; });
    var fileKeys = Object.keys(src);
    var skipped = fileKeys.filter(function (k) { return !allowed[k]; });
    var rows = fileKeys.filter(function (k) { return allowed[k]; }).map(function (k) {
      var unknown = (all.failed || []).indexOf(k) >= 0;
      var cur = current[k], next = src[k];
      var change = unknown ? 'Current unknown' : same(cur, next) ? 'Unchanged' : next == null ? 'Clear' : cur == null ? 'New' : 'Changed';
      return { key: k, cur: cur, next: next, change: change, pick: change === 'New' || change === 'Changed' || change === 'Clear' };
    });
    if (!rows.length) return ui.notice('No known settings in this file' + (skipped.length ? ' (skipped: ' + skipped.join(', ') + ')' : '') + '.', 'warn');
    var countEl = h('span.muted.small');
    function count() { var n = rows.filter(function (r) { return r.pick; }).length; countEl.textContent = fmt.plural(n, 'key') + ' selected'; return n; }
    count();
    var tone = { Changed: 'warn', New: 'info', Clear: 'bad', Unchanged: null, 'Current unknown': 'warn' };
    var results = h('div');
    var list = h('ul.list', rows.map(function (r) {
      var cb = h('input', { type: 'checkbox', checked: r.pick, disabled: r.change === 'Unchanged', 'aria-label': 'Restore ' + r.key });
      cb.addEventListener('change', function () { r.pick = cb.checked; count(); });
      return h('li',
        cb,
        h('div.grow', h('div', ui.mono(r.key)), h('div.cell-sub', r.change === 'Unchanged' ? 'Same as published' : r.change === 'Clear' ? 'The backup has no value — publishing clears it' : fmt.bytes(size(r.cur)) + ' → ' + fmt.bytes(size(r.next)))),
        tone[r.change] ? ui.pill(r.change, tone[r.change]) : ui.pill(r.change),
        ui.button('Compare', { kind: 'ghost', small: true, onClick: function () { compare(r); } }));
    }));
    return h('div.page-body', { style: { 'margin-top': '14px' } },
      ui.notice((isObj(j) && j.exportedAt ? 'Backup from ' + fmt.dateTime(j.exportedAt) + '. ' : '') + fmt.plural(rows.length, 'setting') + ' in the file' + (skipped.length ? '; skipped (not a console setting): ' + skipped.join(', ') : '') + '.', 'info'),
      list,
      h('div.toolbar',
        ui.button('Publish selected', { kind: 'danger', icon: 'upload', onClick: function () {
          var picked = rows.filter(function (r) { return r.pick; });
          if (!picked.length) { VX.toast('Select at least one key', 'bad'); return null; }
          return VX.confirm({ title: 'Publish ' + fmt.plural(picked.length, 'setting') + '?', body: 'Overwrites the live value of: ' + picked.map(function (r) { return r.key; }).join(', ') + '. Listeners get the restored values within about a minute.', danger: true, confirmLabel: 'Publish' }).then(function (ok) {
            if (!ok) return null;
            var out = [];
            return picked.reduce(function (p, r) {
              return p.then(function () {
                return VX.config.set(r.key, r.next == null ? null : r.next, { silent: true }).then(function (res) { out.push({ key: r.key, ok: res.ok, msg: res.ok ? '' : (res.data && res.data.reason) || res.message }); });
              });
            }, Promise.resolve()).then(function () {
              var bad = out.filter(function (x) { return !x.ok; });
              VX.toast(bad.length ? fmt.plural(bad.length, 'key') + ' failed — see the list' : 'Restored ' + fmt.plural(out.length, 'key'), bad.length ? 'bad' : 'ok');
              VX.mount(results, ui.card({ title: 'Restore result', body: h('ul.list', out.map(function (x) {
                return h('li', x.ok ? ui.pill('Published', 'ok') : ui.pill('Failed', 'bad'), ui.mono(x.key), h('span.grow.muted', x.msg || ''));
              })), actions: [ui.button('Reload settings', { kind: 'ghost', small: true, icon: 'refresh', onClick: function () { ctx.refresh(); } })] }));
            });
          });
        } }),
        h('span.grow'), countEl),
      results);
  }

  function compare(r) {
    var dr = VX.drawer({ title: 'Compare ' + r.key });
    VX.mount(dr.body,
      heading('Published now'), r.cur == null ? ui.muted('Not set — the app uses its default') : ui.json(r.cur),
      heading('In the backup'), r.next == null ? ui.muted('No value — publishing clears the key') : ui.json(r.next));
  }

  /* --------------------------------------------------------------- Runbook */

  var HOWTOS = [
    { title: 'Change the owner password', steps: [
      ['From the repository’s backend folder run ', 'npx wrangler secret put ADMIN_LOGIN_PASSWORD --config worker/wrangler.toml', ' and type the new password at the prompt.'],
      ['Everyone signed in to this console, including you, is signed out at their next request. Sign in again with the new password.'],
      ['Fifteen wrong passwords from one address within ten minutes lock that address out for ten minutes — even the right password is refused until then.']
    ] },
    { title: 'Reset the database', danger: true, steps: [
      ['Download a settings backup first (Backup & restore tab).'],
      ['Database dashboard → SQL editor → paste ', 'frontend/supabase/vinax-wipe.sql', ' → Run. This permanently deletes every vinax_ table and function and the status history.'],
      ['Then paste ', 'frontend/supabase/vinax-13.sql', ' → Run to create everything again (', 'frontend/supabase/vinax-13-reset.sql', ' does both in one paste).'],
      ['Restore the backup, run the Trending headlines workflow once, and check Database → Fresh database. Listeners sign in again; the Worker’s secrets do not change.']
    ] },
    { title: 'A table or function is missing', steps: [
      ['The console says “A database table or function is missing”. Run ', 'frontend/supabase/vinax-13.sql', ' in the SQL editor.'],
      ['It is idempotent: it creates only what is missing and deletes nothing, so running it again is always safe.']
    ] },
    { title: 'Deploy', steps: [
      ['The web app deploys by itself on every push to main.'],
      ['The Worker (all /api routes, this console’s data) deploys with the Deploy Worker workflow when a push to main touches backend/, or when you run it by hand. Read its log: it reports success without deploying when the CLOUDFLARE_API_TOKEN workflow secret is missing.'],
      ['By hand, from a machine signed in to the hosting account: ', 'cd backend && npm run deploy', '.'],
      ['Is the Worker current? Send POST /api/curate with an empty JSON body: a 404, a 405 or the app’s web page means the deployed Worker is older than the code. /api/version describes the Android release, not the Worker.'],
      ['Roll back: promote the previous deployment of the web app, and roll the Worker back in its version history — they are separate.']
    ] },
    { title: 'Where secrets live', steps: [
      ['Server secrets are Worker secrets: ', 'npx wrangler secret put <NAME> --config worker/wrangler.toml', ' sets one, ', 'npx wrangler secret list --config worker/wrangler.toml', ' lists the names. Health → Server secrets shows what is set.'],
      ['Plain settings (ASSETS_HOST, GITHUB_REPO) and the HANDOFF key-value binding are in backend/worker/wrangler.toml.'],
      ['Workflow secrets in the code repository: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID (deploys), CRON_SECRET (same value as the Worker’s), and the four Android signing secrets.'],
      ['For local development, put NAME=value lines in backend/worker/.dev.vars (never committed). The web app itself has no secrets.']
    ] },
    { title: 'Take the app offline for a while', steps: [
      ['Settings → Maintenance → Switch to maintenance, or schedule a window. Listeners see the maintenance screen within about a minute; this console keeps working.'],
      ['Go live from the same tab. A scheduled window ends by itself.']
    ] }
  ];

  function stepNode(parts) {
    // Odd positions are commands / paths, shown as code.
    return h('li', parts.map(function (p, i) { return i % 2 ? ui.mono(p) : p; }));
  }

  function renderRunbook(host, ctx) {
    var notesHost = h('div');
    host.appendChild(ui.grid(HOWTOS.map(function (t) {
      return ui.card({ title: t.title, tone: t.danger ? 'warn' : null, actions: t.danger ? [ui.pill('Destructive', 'bad')] : null,
        body: h('ol', { style: { margin: '0', 'padding-left': '20px', display: 'grid', gap: '8px', 'line-height': '1.5' } }, t.steps.map(stepNode)) });
    })));
    host.appendChild(notesHost);

    function loadNotes() {
      return ui.load(notesHost, function () { return cfgLoad('runbook'); }, function (r) {
        var notes = Array.isArray(r.value) ? r.value.filter(function (n) { return isObj(n) && (n.title || n.body); }) : [];
        var idx = -1;
        var titleIn = ui.input({ maxlength: 120, placeholder: 'e.g. Android app stuck on “Updating…”' });
        var bodyIn = ui.textarea({ rows: 6, maxlength: 8000, placeholder: 'Steps…' });
        var formTitle = h('h3', { style: { 'font-size': '14px' } }, 'Add a note');
        function save(next, msg) {
          return VX.config.set('runbook', next.length ? next : null, { silent: true }).then(function (res) {
            if (res.ok) { VX.toast(msg, 'ok'); loadNotes(); }
            else VX.toast('Could not save: ' + res.message, 'bad');
            return res;
          });
        }
        var cancel = ui.button('Cancel', { kind: 'ghost', onClick: function () { idx = -1; titleIn.value = ''; bodyIn.value = ''; formTitle.textContent = 'Add a note'; cancel.hidden = true; } });
        cancel.hidden = true;
        return ui.card({
          title: 'Your notes',
          sub: notes.length ? fmt.plural(notes.length, 'note') + ' · visible only in this console' : 'Private notes for whoever runs VinaX. Visible only in this console.',
          body: [
            notes.length ? h('div.editor-list', notes.map(function (n, i) {
              return h('div.editor-row',
                h('div', { style: { 'min-width': '0' } },
                  h('strong', n.title || 'Untitled'),
                  n.updatedAt ? h('span.muted.small', ' · ' + fmt.ago(n.updatedAt)) : null,
                  h('div', { style: { 'white-space': 'pre-wrap', 'margin-top': '6px', 'overflow-wrap': 'anywhere' } }, n.body || '')),
                h('div.toolbar',
                  ui.button('', { kind: 'ghost', small: true, icon: 'edit', ariaLabel: 'Edit ' + (n.title || 'note'), onClick: function () {
                    idx = i; titleIn.value = n.title || ''; bodyIn.value = n.body || ''; formTitle.textContent = 'Edit note'; cancel.hidden = false; titleIn.focus();
                  } }),
                  ui.button('', { kind: 'ghost', small: true, icon: 'trash', ariaLabel: 'Delete ' + (n.title || 'note'), onClick: function () {
                    return VX.confirm({ title: 'Delete “' + (n.title || 'this note') + '”?', body: 'The note is removed for everyone who uses this console.', danger: true, confirmLabel: 'Delete' }).then(function (ok) {
                      if (!ok) return null;
                      return save(notes.filter(function (_, j) { return j !== i; }), 'Note deleted');
                    });
                  } })));
            })) : ui.empty('No notes yet', 'Write down anything you had to work out the hard way.'),
            h('div.form', { style: { 'margin-top': '16px' } },
              formTitle,
              ui.field('Title', titleIn),
              ui.field('Steps', bodyIn),
              h('div.toolbar',
                ui.button('Save note', { kind: 'primary', icon: 'check', onClick: function () {
                  var t = titleIn.value.trim().slice(0, 120), b = bodyIn.value.trim().slice(0, 8000);
                  if (!t || !b) { VX.toast('A note needs a title and steps', 'bad'); (t ? bodyIn : titleIn).focus(); return null; }
                  var note = { title: t, body: b, updatedAt: new Date().toISOString() };
                  var next = notes.slice();
                  if (idx >= 0) next[idx] = note; else next.unshift(note);
                  return save(next, idx >= 0 ? 'Note updated' : 'Note saved');
                } }),
                cancel))
          ]
        });
      });
    }
    return loadNotes();
  }
})();
