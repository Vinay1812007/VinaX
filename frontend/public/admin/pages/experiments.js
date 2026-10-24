/* VinaX console — Experiments page.
 * A/B experiments (GET /api/admin/experiments; POST save / delete). Devices
 * assign themselves a variant from the key and their id, so the server only
 * publishes the list. */
(function () {
  'use strict';
  var VX = window.VX, h = VX.h, ui = VX.ui, fmt = VX.fmt, arr = VX.arr, num = VX.num;

  VX.page({
    id: 'experiments', title: 'Experiments', group: 'Intelligence', icon: 'target', noAuto: true,
    desc: 'A/B experiments the app reads: a key, its variants and their traffic shares. Assignment happens on the device.',
    render: render
  });

  function render(host, ctx) {
    var body = h('div');
    host.appendChild(h('div.toolbar', ui.button('New experiment', { kind: 'primary', icon: 'plus', onClick: function () { editor(null, load); } })));
    host.appendChild(body);
    function load() {
      return ui.load(body, function () { return VX.api.get('/api/admin/experiments', null, { fresh: true }); }, function (d) {
        var gate = ui.gate(d, ctx);
        if (gate) return gate;
        var rows = arr(d.rows);
        var active = rows.filter(function (r) { return r.active; }).length;
        return [
          ui.kpis([
            { label: 'Experiments', value: fmt.num(rows.length) },
            { label: 'Running', value: fmt.num(active), tone: active ? 'ok' : null }
          ]),
          ui.card({ title: 'Experiments', pad: false, body: ui.table({
            columns: [
              { key: 'key', label: 'Key', render: function (r) { return h('div', h('div.cell-main', ui.mono(r.key)), r.name ? h('div.cell-sub', r.name) : null); } },
              { key: 'active', label: 'State', sortVal: function (r) { return r.active ? 1 : 0; }, render: function (r) { return r.active ? ui.pill('Running', 'ok') : ui.pill('Off'); } },
              { key: 'variants', label: 'Variants', sort: false, render: function (r) {
                var vs = arr(r.variants);
                var total = vs.reduce(function (a, v) { return a + num(v.pct); }, 0);
                return h('div.chips', vs.map(function (v) { return ui.pill((v.name || '?') + ' ' + fmt.num(v.pct) + '%', 'info'); }), total < 100 ? ui.pill(fmt.num(100 - total) + '% not enrolled') : null);
              } },
              { key: 'updatedAt', label: 'Updated', render: function (r) { return ui.ago(r.updatedAt || r.createdAt); } },
              { key: 'act', label: '', sort: false, render: function (r) {
                return h('div.actions',
                  ui.button('Edit', { kind: 'ghost', small: true, icon: 'edit', onClick: function () { editor(r, load); } }),
                  ui.button(r.active ? 'Stop' : 'Start', { kind: 'ghost', small: true, onClick: function () { return save({ key: r.key, name: r.name, variants: arr(r.variants), active: !r.active }, load); } }),
                  ui.button('', { kind: 'ghost', small: true, icon: 'trash', ariaLabel: 'Delete ' + r.key, onClick: function () {
                    return VX.confirm({ title: 'Delete ' + r.key + '?', body: 'Devices stop seeing it on their next fetch; variants they already picked are forgotten.', danger: true, confirmLabel: 'Delete' }).then(function (yes) {
                      if (!yes) return;
                      return VX.api.post('/api/admin/experiments', { action: 'delete', key: r.key }).then(function (res) { VX.toast(res.ok ? 'Deleted' : res.message, res.ok ? 'ok' : 'bad'); if (res.ok) return load(); });
                    });
                  } }));
              } }
            ],
            rows: rows, exportName: 'vinax-experiments', search: false, empty: 'No experiments', emptyHint: 'Create one to split listeners into variants the app can read.'
          }) })
        ];
      }, { skeleton: 4 });
    }
    return load();
  }

  function save(exp, reload) {
    return VX.api.post('/api/admin/experiments', { action: 'save', key: exp.key, name: exp.name || null, variants: exp.variants, active: !!exp.active }).then(function (res) {
      VX.toast(res.ok ? 'Saved' : res.message, res.ok ? 'ok' : 'bad');
      if (res.ok && reload) return reload();
      return res;
    });
  }

  function editor(existing, reload) {
    var isNew = !existing;
    var key = ui.input({ value: existing ? existing.key : '', placeholder: 'home-shelf-order', maxlength: 40, readOnly: !isNew, pattern: '[a-z0-9-]{1,40}' });
    var name = ui.input({ value: existing && existing.name ? existing.name : '', placeholder: 'What is being tested', maxlength: 80 });
    var active = ui.toggle('Running', existing ? !!existing.active : false);
    var rows = (existing ? arr(existing.variants) : [{ name: 'control', pct: 50 }, { name: 'variant', pct: 50 }]).map(function (v) { return { name: v.name || '', pct: num(v.pct) }; });
    var list = h('div.editor-list');
    var total = h('p.field-hint');
    var err = h('p.login-err', { role: 'alert' });
    function draw() {
      VX.clear(list);
      rows.forEach(function (v, i) {
        var n = ui.input({ value: v.name, placeholder: 'variant name', maxlength: 24, 'aria-label': 'Variant ' + (i + 1) + ' name' });
        var p = ui.input({ type: 'number', min: 0, max: 100, step: 1, value: String(v.pct), 'aria-label': 'Variant ' + (i + 1) + ' percent', style: { 'max-width': '90px' } });
        n.addEventListener('input', function () { v.name = n.value.trim().slice(0, 24); });
        p.addEventListener('input', function () { v.pct = Math.max(0, Math.min(100, Math.floor(num(p.value)))); sum(); });
        list.appendChild(h('div.editor-row', h('div.form-row', n, p), ui.button('', { kind: 'ghost', small: true, icon: 'trash', ariaLabel: 'Remove variant', disabled: rows.length <= 1, onClick: function () { rows.splice(i, 1); draw(); } })));
      });
      sum();
    }
    function sum() {
      var t = rows.reduce(function (a, v) { return a + num(v.pct); }, 0);
      total.textContent = 'Total ' + fmt.num(t) + '% of listeners enrolled' + (t > 100 ? ' — over 100%, lower a share' : t < 100 ? ' · ' + fmt.num(100 - t) + '% see the default' : '');
      total.style.color = t > 100 ? 'var(--bad)' : '';
    }
    draw();
    VX.modal({
      title: isNew ? 'New experiment' : 'Edit ' + existing.key,
      body: h('div.form', { style: { 'max-width': 'none' } },
        ui.field('Key', key, 'Lower-case letters, digits and dashes. The app reads it by this key; it cannot change later.'),
        ui.field('Name', name, 'For you — what the experiment tests.'),
        h('div', h('span.field-label', 'Variants'), list, h('div.actions', { style: { 'margin-top': '8px' } }, ui.button('Add variant', { kind: 'ghost', small: true, icon: 'plus', disabled: rows.length >= 6, onClick: function () { if (rows.length < 6) { rows.push({ name: '', pct: 0 }); draw(); } } })), total),
        active, err),
      actions: [
        { label: 'Cancel', kind: 'ghost', onClick: function (close) { close(); } },
        { label: isNew ? 'Create' : 'Save', kind: 'primary', onClick: function (close) {
          var k = key.value.trim().toLowerCase();
          if (!/^[a-z0-9-]{1,40}$/.test(k)) { err.textContent = 'The key needs 1–40 lower-case letters, digits or dashes.'; key.focus(); return; }
          var vs = rows.map(function (v) { return { name: v.name.trim(), pct: num(v.pct) }; }).filter(function (v) { return v.name && v.pct > 0; });
          if (!vs.length) { err.textContent = 'Add at least one variant with a name and a share above 0.'; return; }
          var t = vs.reduce(function (a, v) { return a + v.pct; }, 0);
          if (t > 100) { err.textContent = 'Shares add up to ' + fmt.num(t) + '%; lower one so they stay within 100%.'; return; }
          var names = {};
          for (var i = 0; i < vs.length; i++) { if (names[vs[i].name]) { err.textContent = 'Two variants share the name “' + vs[i].name + '”.'; return; } names[vs[i].name] = true; }
          return save({ key: k, name: name.value.trim(), variants: vs, active: active.input.checked }, reload).then(function (res) { if (res && res.ok !== false) close(); });
        } }
      ]
    });
  }
})();
