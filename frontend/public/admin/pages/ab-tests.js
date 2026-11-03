/* VinaX console — A/B Tests (console rebuild).
 *
 * Try two or more versions of something in the app and keep the one that
 * works better. The app picks each person's version on their own phone (the
 * server never learns who saw which), so "users per version" is an estimate
 * from how many people used the app this week.
 * Routes: GET/POST /api/admin/experiments; app versions from /api/admin/overview.
 */
(function () {
  'use strict';
  var VX = window.VX, h = VX.h, ui = VX.ui, fmt = VX.fmt;
  var arr = VX.arr, obj = VX.obj, num = VX.num;

  /**
   * What the app can test today. Each slot is read by the app under exactly
   * this key, with these version names; anything else needs an app update.
   */
  var SLOTS = [
    { key: 'home-shelf-order', label: 'Order of the Home screen', about: 'Does showing the discovery shelves (trending near you, new in your languages) first make people play more?',
      versions: [{ name: 'control', label: 'As today' }, { name: 'discovery-first', label: 'Discovery shelves first' }] },
    { key: 'rec-next-songs', label: 'Next-song picks', about: 'How closely the songs that play next should follow each person’s taste.',
      versions: [{ name: 'control', label: 'As today' }, { name: 'taste-0.15', label: 'A little less like their taste' }, { name: 'taste-0.18', label: 'A little more like their taste' }] },
    { key: 'custom', label: 'Something new (needs an app update)', about: 'A test the app does not read yet. Set it up now; a developer connects it in the next app update.', versions: null }
  ];
  var STATUS = { draft: ['Draft', null], running: ['Running', 'ok'], paused: ['Paused', 'warn'], finished: ['Finished', 'info'] };
  var PLATFORMS = [{ value: 'all', label: 'All platforms' }, { value: 'android', label: 'Android' }, { value: 'web', label: 'Web' }, { value: 'ios', label: 'iOS' }];

  /** Keys of the tests that exist now (a slot holds one test at a time). */
  var knownKeys = {};
  function slotOf(key) { return SLOTS.filter(function (s) { return s.key === key; })[0] || null; }
  function versionLabel(key, name) {
    var s = slotOf(key);
    var v = s && s.versions ? s.versions.filter(function (x) { return x.name === name; })[0] : null;
    return v ? v.label : name;
  }
  function statusPill(s) { var x = STATUS[s] || STATUS.draft; return ui.pill(x[0], x[1]); }
  function letter(i) { return 'Version ' + String.fromCharCode(65 + i); }
  function slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'test'; }
  function audienceText(a) {
    a = obj(a);
    var p = PLATFORMS.filter(function (x) { return x.value === (a.platform || 'all'); })[0];
    return (p ? p.label : 'All platforms') + (a.minVersion ? ', app ' + a.minVersion + ' or newer' : '') + ' · ' + fmt.num(a.percent == null ? 100 : a.percent) + '% of users';
  }

  /* -------------------------------------------------- the step-by-step form */

  function openWizard(ctx, existing, versions, onSaved) {
    var e = existing || {};
    var slotKey = e.key ? (slotOf(e.key) ? e.key : 'custom') : 'home-shelf-order';
    var st = {
      slot: slotKey,
      key: e.key && !slotOf(e.key) && !e._dup ? e.key : null,
      name: e.name || '',
      description: e.description || '',
      variants: arr(e.variants).map(function (v) { return { name: v.name, pct: num(v.pct) }; }),
      platform: obj(e.audience).platform || 'all',
      minVersion: obj(e.audience).minVersion || '',
      percent: obj(e.audience).percent == null ? 100 : num(obj(e.audience).percent)
    };
    if (!st.variants.length) resetVersions();
    var step = 0;
    var body = h('div.wizard');
    var stepsEl = h('ol.wizard-steps');
    var m;

    function resetVersions() {
      var s = slotOf(st.slot);
      var names = s && s.versions ? s.versions.map(function (v) { return v.name; }) : ['control', 'new'];
      var even = Math.floor(100 / names.length);
      st.variants = names.map(function (n, i) { return { name: n, pct: i === names.length - 1 ? 100 - even * (names.length - 1) : even }; });
    }
    function total() { return st.variants.reduce(function (a, v) { return a + num(v.pct); }, 0); }
    function problem() {
      if (step === 0 && !st.name.trim()) return 'Give the test a name.';
      if (step === 1) {
        if (st.variants.length < 2) return 'A test needs at least two versions.';
        if (total() !== 100) return 'The versions must add up to 100%. Now they add up to ' + total() + '%.';
        var seen = {};
        for (var i = 0; i < st.variants.length; i++) {
          var n = String(st.variants[i].name || '').trim();
          if (!n) return 'Give every version a name.';
          if (seen[n]) return 'Two versions have the same name.';
          seen[n] = true;
        }
      }
      return null;
    }

    function drawSteps() {
      VX.mount(stepsEl, ['What', 'Versions', 'Who', 'Review'].map(function (t, i) {
        return h('li' + (i === step ? '.on' : i < step ? '.done' : ''), { 'aria-current': i === step ? 'step' : null }, h('span.wz-num', i < step ? '✓' : String(i + 1)), h('span', t));
      }));
    }

    function stepWhat() {
      var s = slotOf(st.slot);
      var name = ui.input({ maxlength: 60, value: st.name, placeholder: 'e.g. Discovery first on Home' });
      name.addEventListener('input', function () { st.name = name.value; });
      var about = ui.textarea({ rows: 3, maxlength: 300, placeholder: 'What do you hope to learn?' });
      about.value = st.description;
      about.addEventListener('input', function () { st.description = about.value; });
      return [
        ui.dropdown('What are you testing?', SLOTS.map(function (x) { return { value: x.key, label: x.label }; }), st.slot, function (v) { st.slot = v; resetVersions(); draw(); }),
        s ? h('p.muted.small', s.about) : null,
        ui.field('Name', name),
        ui.field('What are you testing? (in your words)', about, 'Shown on this page so everyone knows what the test is for.')
      ];
    }

    function stepVersions() {
      var s = slotOf(st.slot);
      var fixed = !!(s && s.versions);
      var sum = h('p.sum-check');
      function drawSum() {
        var t = total();
        sum.className = 'sum-check ' + (t === 100 ? 'ok' : 'bad');
        sum.textContent = t === 100 ? 'Adds up to 100% ✓' : 'Adds up to ' + t + '% — it must be exactly 100%';
      }
      var rows = st.variants.map(function (v, i) {
        var label;
        if (fixed) label = h('strong', letter(i) + ': ' + versionLabel(st.slot, v.name));
        else {
          var inp = ui.input({ maxlength: 24, value: v.name, 'aria-label': letter(i) + ' name' });
          inp.addEventListener('input', function () { v.name = inp.value.trim().slice(0, 24); });
          label = h('div.vrow-name', h('span.muted.small', letter(i)), inp);
        }
        return h('div.vrow',
          label,
          ui.slider({ label: 'Share of people in the test', min: 0, max: 100, step: 5, value: num(v.pct), format: function (x) { return x + '%'; }, onChange: function (x) { v.pct = x; drawSum(); } }),
          !fixed && st.variants.length > 2 ? ui.button('Remove', { kind: 'ghost', small: true, icon: 'trash', onClick: function () { st.variants.splice(i, 1); draw(); } }) : null);
      });
      drawSum();
      return [
        h('p.muted', fixed ? 'These are the versions the app knows for this test. Slide to choose how many people see each one.' : 'Name each version (the developer uses these names) and choose how many people see each one.'),
        h('div.vrows', rows),
        h('div.toolbar',
          sum, h('span.grow'),
          ui.button('Split evenly', { kind: 'ghost', small: true, onClick: function () { var n = st.variants.length, even = Math.floor(100 / n); st.variants.forEach(function (v, i) { v.pct = i === n - 1 ? 100 - even * (n - 1) : even; }); draw(); } }),
          !fixed && st.variants.length < 6 ? ui.button('Add a version', { kind: 'ghost', small: true, icon: 'plus', onClick: function () { st.variants.push({ name: 'version-' + (st.variants.length + 1), pct: 0 }); draw(); } }) : null)
      ];
    }

    function stepWho() {
      var opts = [{ value: '', label: 'Any version' }].concat(versions.filter(function (v) { return st.platform === 'all' || v.platform === st.platform; }).map(function (v) { return { value: v.version, label: v.version + ' or newer' }; }).filter(function (o, i, all) { return all.findIndex(function (x) { return x.value === o.value; }) === i; }));
      return [
        ui.dropdown('Platform', PLATFORMS, st.platform, function (v) { st.platform = v; draw(); }),
        ui.dropdown('App version', opts, st.minVersion, function (v) { st.minVersion = v; }),
        ui.slider({ label: 'Share of all users in the test', min: 5, max: 100, step: 5, value: st.percent, format: function (x) { return x + '%'; }, onChange: function (x) { st.percent = x; },
          hint: 'Everyone else keeps the app as it is today. Raising this later adds people without moving anyone already in.' })
      ];
    }

    function stepReview() {
      var s = slotOf(st.slot);
      return [
        ui.dl([
          ['Name', st.name || '—'],
          ['Testing', s ? s.label : 'Custom'],
          ['About', st.description || '—'],
          ['Versions', h('ul.plain', st.variants.map(function (v, i) { return h('li', letter(i) + ': ' + versionLabel(st.slot, v.name) + ' — ' + v.pct + '%'); }))],
          ['Who', audienceText({ platform: st.platform, minVersion: st.minVersion, percent: st.percent })]
        ]),
        existing && existing.key && existing.status === 'running' ? null : ui.notice('Starting makes it live in the app within a few minutes.', 'info'),
        st.slot !== 'custom' && knownKeys[st.slot] && (!existing || existing._dup || existing.key !== st.slot) ? ui.notice('There can be one test of “' + (s ? s.label : '') + '” at a time. Saving replaces any earlier one.', 'warn') : null
      ];
    }

    var err = h('p.form-error', { role: 'alert' });
    var foot = h('div.save-bar');
    function draw() {
      drawSteps();
      err.textContent = '';
      var content = [stepWhat, stepVersions, stepWho, stepReview][step]();
      VX.mount(body, stepsEl, h('div.wizard-body', content), err, foot);
      VX.mount(foot,
        step > 0 ? ui.button('Back', { kind: 'ghost', onClick: function () { step -= 1; draw(); } }) : ui.button('Cancel', { kind: 'ghost', onClick: function () { m.close(); } }),
        h('span.grow'),
        step < 3 ? ui.button('Next', { kind: 'primary', onClick: function () { var p = problem(); if (p) { err.textContent = p; return; } step += 1; draw(); } }) : [
          ui.button('Save as draft', { kind: 'ghost', onClick: function () { return save('draft'); } }),
          ui.button(existing && existing.status === 'running' ? 'Save changes' : 'Start test', { kind: 'primary', icon: 'play', onClick: function () { return save(existing && existing.status === 'paused' ? 'paused' : 'running'); } })
        ]);
    }
    function save(status) {
      var key = st.slot === 'custom' ? (st.key || slug(st.name) + '-' + VX.rid().slice(0, 6)) : st.slot;
      var b = { action: 'save', key: key, name: st.name.trim(), description: st.description.trim(), variants: st.variants, audience: { platform: st.platform, minVersion: st.minVersion || null, percent: st.percent }, status: status };
      return VX.api.post('/api/admin/experiments', b).then(function (res) {
        if (!res.ok) { err.textContent = 'Something went wrong — ' + res.message; return; }
        m.close();
        VX.toast(status === 'running' ? 'Test started ✓' : 'Saved ✓', 'ok');
        onSaved();
      });
    }
    m = VX.modal({ title: existing && existing.key && !existing._dup ? 'Edit A/B test' : 'New A/B test', wide: true, body: body });
    draw();
  }

  /* ------------------------------------------------------------- the list */

  function render(host, ctx) {
    var versions = [];
    return ui.load(host, function () {
      return Promise.all([VX.api.get('/api/admin/experiments'), VX.api.get('/api/admin/overview')]).then(function (r) {
        if (r[1].ok) versions = arr(obj(r[1].data).versions).map(function (v) { return { platform: v.platform || 'web', version: v.appVersion || v.version }; }).filter(function (v) { return v.version && v.version !== 'unknown'; });
        return r[0];
      });
    }, function (d) {
      var gate = ui.gate(d, ctx);
      if (gate) return gate;
      var rows = arr(d.rows);
      knownKeys = {};
      rows.forEach(function (r) { knownKeys[r.key] = true; });
      var active = d.activeUsers == null ? null : num(d.activeUsers);
      var canEdit = VX.can('edit');
      function post(b, msg) {
        return VX.api.post('/api/admin/experiments', b).then(function (res) {
          if (!res.ok) { VX.toast('Something went wrong — ' + res.message, 'bad'); return false; }
          VX.toast(msg, 'ok'); ctx.refresh(); return true;
        });
      }
      function perVersion(r, v) {
        if (active == null) return null;
        var a = obj(r.audience);
        return Math.round(active * (a.percent == null ? 100 : num(a.percent)) / 100 * num(v.pct) / 100);
      }
      function endTest(r) {
        var pick = arr(r.variants)[0] ? arr(r.variants)[0].name : null;
        VX.modal({
          title: 'End “' + (r.name || r.key) + '”', body: [
            h('p', 'Everyone goes back to the app as it is today. Pick the version that did best so the team knows what to keep.'),
            ui.radios('Winner', arr(r.variants).map(function (v, i) { return { value: v.name, label: letter(i) + ': ' + versionLabel(r.key, v.name) }; }).concat([{ value: '', label: 'No clear winner' }]), pick, function (v) { pick = v; })
          ],
          actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'End test', kind: 'danger', onClick: function (close) {
            return post({ action: 'status', key: r.key, status: 'finished', winner: pick || null }, 'Test ended ✓').then(function (ok) { if (ok) close(); });
          } }]
        });
      }
      var newBtn = canEdit ? ui.button('New test', { kind: 'primary', icon: 'plus', onClick: function () { openWizard(ctx, null, versions, ctx.refresh); } }) : null;
      var running = rows.filter(function (r) { return r.status === 'running'; });
      var inTests = running.reduce(function (a, r) { return a + (active == null ? 0 : Math.round(active * (obj(r.audience).percent == null ? 100 : num(obj(r.audience).percent)) / 100)); }, 0);
      var table = ui.dataTable({
        rows: rows, rowId: function (r) { return r.key; }, exportName: 'vinax-ab-tests', search: rows.length > 8 ? 'Search tests…' : false,
        empty: { title: 'No A/B tests yet', hint: 'Try two versions of something in the app and see which one people like more.', action: newBtn ? { label: 'New test', icon: 'plus', onClick: function () { openWizard(ctx, null, versions, ctx.refresh); } } : null },
        columns: [
          { key: 'name', label: 'Test', sortVal: function (r) { return r.name || r.key; }, render: function (r) { return h('div', h('div.cell-main', r.name || versionLabel(r.key, r.key)), h('div.cell-sub', r.description || (slotOf(r.key) ? slotOf(r.key).label : '')), h('div.cell-sub', audienceText(r.audience))); } },
          { key: 'status', label: 'Status', render: function (r) { return h('div', statusPill(r.status), r.status === 'finished' && r.winner ? h('div.cell-sub', 'Winner: ' + versionLabel(r.key, r.winner)) : null); } },
          { key: 'startedAt', label: 'Started', render: function (r) { return r.startedAt ? ui.ago(r.startedAt) : h('span.muted', 'Not started'); } },
          { key: 'variants', label: 'Users per version', sort: false, render: function (r) {
            return h('ul.plain.small', arr(r.variants).map(function (v, i) { var n = perVersion(r, v); return h('li', letter(i) + ' · ' + v.pct + '%' + (n == null ? '' : ' · about ' + fmt.num(n))); }));
          }, csv: function (r) { return arr(r.variants).map(function (v) { return v.name + ' ' + v.pct + '%'; }).join(', '); } },
          { key: 'running', label: 'Running', sort: false, render: function (r) {
            var t = ui.toggle('', r.status === 'running', function (on) {
              t.input.disabled = true;
              post({ action: 'status', key: r.key, status: on ? 'running' : 'paused' }, on ? 'Test running ✓' : 'Test paused ✓');
            }, { 'aria-label': (r.status === 'running' ? 'Pause ' : 'Start ') + (r.name || r.key), disabled: !canEdit || r.status === 'finished' });
            return t;
          } }
        ],
        rowMenu: function (r) {
          return [
            { label: 'Edit', icon: 'edit', hidden: !canEdit || r.status === 'finished', onClick: function () { openWizard(ctx, r, versions, ctx.refresh); } },
            { label: 'Pause', icon: 'close', hidden: !canEdit || r.status !== 'running', onClick: function () { post({ action: 'status', key: r.key, status: 'paused' }, 'Test paused ✓'); } },
            { label: r.status === 'draft' ? 'Start' : 'Resume', icon: 'play', hidden: !canEdit || (r.status !== 'paused' && r.status !== 'draft'), onClick: function () { post({ action: 'status', key: r.key, status: 'running' }, 'Test running ✓'); } },
            { label: 'End & pick winner', icon: 'check', hidden: !canEdit || r.status === 'finished' || r.status === 'draft', onClick: function () { endTest(r); } },
            { label: 'Duplicate', icon: 'copy', hidden: !canEdit, onClick: function () { openWizard(ctx, Object.assign({}, r, { name: (r.name || r.key) + ' (copy)', status: 'draft', winner: null, _dup: true }), versions, ctx.refresh); } },
            '-',
            { label: 'Delete', icon: 'trash', danger: true, hidden: !canEdit, onClick: function () {
              VX.confirm({ title: 'Delete “' + (r.name || r.key) + '”?', body: r.status === 'running' ? 'The test is running. Deleting it puts everyone back on the app as it is today. This cannot be undone.' : 'This cannot be undone.', confirmLabel: 'Delete', danger: true, typed: r.status === 'running' ? true : undefined }).then(function (ok) {
                if (ok) post({ action: 'delete', key: r.key }, 'Deleted ✓');
              });
            } }
          ];
        }
      });
      return [
        ui.readOnlyNote(),
        ui.stats([
          { label: 'Running', value: fmt.num(running.length), info: 'Tests live in the app right now.' },
          { label: 'People in tests', value: active == null ? '—' : 'about ' + fmt.num(inTests), info: 'An estimate: people who used the app in the last 7 days × the share each running test includes. The app picks each person’s version on their phone, so exact numbers are not known.' },
          { label: 'Drafts', value: fmt.num(rows.filter(function (r) { return r.status === 'draft'; }).length), info: 'Tests set up but not started.' },
          { label: 'Finished', value: fmt.num(rows.filter(function (r) { return r.status === 'finished'; }).length), info: 'Tests that ended, with the winning version if one was picked.' }
        ]),
        ui.card({ title: 'Tests', actions: newBtn ? [newBtn] : null, pad: false, body: table })
      ];
    });
  }

  VX.page({
    id: 'ab-tests', title: 'A/B Tests', group: 'Engage', icon: 'flask', order: 2,
    desc: 'Try two versions of something in the app and see which one works better.',
    keywords: 'experiment split test variant',
    render: render
  });
})();
