/* VinaX console — the App Settings framework (version 8 rebuild).
 *
 * Every App Settings page is a list of sections; each section edits ONE
 * stored setting (a row in `settings`, written by POST /api/admin/settings).
 * The framework gives every section the same behaviour:
 *
 *   - a status chip: "Live in app" (changed and saved), "Using app's built-in
 *     setting" (never changed) or "Unsaved changes";
 *   - a bottom bar: Save & apply · Cancel changes · Reset to built-in setting,
 *     Save asks "Users will see this change within 1 minute. Continue?";
 *   - a "Change history" panel: the last 20 changes, who and when, in plain
 *     words, each with "Restore this version";
 *   - an optional live preview beside the form (a phone mock-up);
 *   - read-only controls for viewers; a warning before leaving with unsaved
 *     changes.
 *
 * A page:
 *   VX.settingsPage({
 *     id: 'app-settings/home-screen', title: 'Home Screen', icon: 'layout', order: 1,
 *     desc: 'One sentence.',
 *     sections: [{
 *       key: 'greeting', title: 'Home Greeting', desc: 'One sentence.',
 *       fromValue(stored | null) → model,      // what the form edits (deep-cloned)
 *       toValue(model) → value | null,         // what is saved (null clears = built-in)
 *       validate(model) → 'problem' | null,    // blocks Save with the message
 *       describe(value | null) → 'plain words',// used by the history list
 *       render(model, set, api) → node,        // build the form once; call set(model) after each edit
 *       preview(model) → node,                 // optional, redrawn on every set()
 *       wide: true                             // optional, full-width card
 *     }]
 *   });
 * api = { readOnly, rerender(), ctx, stored, values (every stored setting) }.
 */
(function () {
  'use strict';
  var VX = window.VX, h = VX.h, ui = VX.ui, fmt = VX.fmt;

  var clone = function (v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); };
  var same = function (a, b) { return JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b); };

  /** Who changed it, in words. */
  function who(by) { return !by || by === 'owner' ? 'the owner' : by; }

  function section(def, all, ctx, registerDirty) {
    var stored = all.values[def.key] === undefined ? null : all.values[def.key];
    var updated = all.updated[def.key] || null;
    var readOnly = !VX.can('edit');
    var model = clone(def.fromValue(clone(stored)));
    var chipHost = h('span.chip-host');
    var errHost = h('p.form-error', { role: 'alert' });
    var previewHost = def.preview ? h('div.preview-col') : null;
    var formHost = h('div.form-col');
    var metaLine = h('p.muted.small.section-meta');

    var saveBtn = ui.button('Save & apply', { kind: 'primary', icon: 'check', disabled: true, onClick: save });
    var cancelBtn = ui.button('Cancel changes', { kind: 'ghost', disabled: true, onClick: cancel });
    var resetBtn = ui.button('Reset to built-in setting', { kind: 'ghost', icon: 'refresh', disabled: readOnly || stored === null, onClick: reset });

    function value() { try { return def.toValue(clone(model)); } catch (e) { return stored; } }
    function dirty() { return !same(value(), stored); }
    function sync() {
      var d = dirty();
      VX.mount(chipHost, ui.statusChip(d ? 'unsaved' : stored !== null ? 'live' : 'builtin'));
      saveBtn.disabled = readOnly || !d;
      cancelBtn.disabled = !d;
      resetBtn.disabled = readOnly || (stored === null && !d);
      var problem = d && def.validate ? def.validate(clone(model)) : null;
      errHost.textContent = problem || '';
      card.classList.toggle('is-dirty', d);
      metaLine.textContent = stored !== null && updated ? 'Last changed ' + fmt.ago(updated.at) + ' by ' + who(updated.by) + '.' : 'Never changed — the app uses its built-in setting.';
      if (previewHost) {
        var p = null;
        try { p = def.preview(clone(model)); } catch (e) { p = h('p.muted', 'Preview unavailable'); }
        VX.mount(previewHost, h('div.preview-label.muted.small', 'Preview'), p);
      }
    }
    function set(next) { if (next !== undefined) model = next; sync(); }
    var api = {
      get readOnly() { return readOnly; },
      ctx: ctx,
      get stored() { return stored; },
      values: all.values,
      rerender: function () { draw(); }
    };
    function draw() {
      var node;
      try { node = def.render(model, set, api); } catch (e) { console.error(e); node = ui.error('This section could not start: ' + (e && e.message)); }
      VX.mount(formHost, readOnly ? h('fieldset.ro', { disabled: true }, node) : node);
      sync();
    }

    function post(v, what) {
      return VX.api.post('/api/admin/settings', { key: def.key, value: v }).then(function (res) {
        if (!res.ok) { VX.toast('Something went wrong — ' + (res.message || 'try again'), 'bad'); return false; }
        stored = v === null ? null : clone(res.data && res.data.value !== undefined ? res.data.value : v);
        updated = { at: (res.data && res.data.updatedAt) || new Date().toISOString(), by: (VX.me && VX.me.email) || 'owner' };
        all.values[def.key] = stored; all.updated[def.key] = updated;
        model = clone(def.fromValue(clone(stored)));
        draw();
        historyLoaded = false;
        if (historyEl.open) loadHistory();
        VX.toast(what, 'ok');
        return true;
      });
    }
    function save() {
      var problem = def.validate ? def.validate(clone(model)) : null;
      if (problem) { errHost.textContent = problem; VX.toast(problem, 'bad'); return; }
      return VX.confirm({ title: 'Save & apply?', body: 'Users will see this change within 1 minute. Continue?', confirmLabel: 'Save & apply' }).then(function (ok) {
        if (ok) return post(value(), 'Saved ✓');
      });
    }
    function cancel() { model = clone(def.fromValue(clone(stored))); draw(); }
    function reset() {
      return VX.confirm({ title: 'Reset to built-in setting?', body: 'Your version of “' + def.title + '” is removed and the app goes back to its own setting within 1 minute. You can restore it later from Change history.', confirmLabel: 'Reset', danger: true }).then(function (ok) {
        if (ok) return post(null, 'Reset to built-in setting ✓');
      });
    }

    // Change history: the last 20 changes, each restorable.
    var historyList = h('div.history-host');
    var historyLoaded = false;
    function loadHistory() {
      historyLoaded = true;
      return ui.load(historyList, function () { return VX.api.get('/api/admin/settings', { key: def.key }, { fresh: true }); }, function (d) {
        var rows = VX.arr(d.history).slice(0, 20);
        if (!rows.length) return h('p.muted.small', 'No changes yet.');
        return h('ol.history', rows.map(function (r, i) {
          var text;
          try { text = def.describe ? def.describe(r.value === undefined ? null : r.value) : fmt.summary(r.value); } catch (e) { text = fmt.summary(r.value); }
          return h('li',
            h('div.history-main',
              h('div', h('strong', r.value === null ? 'Reset to built-in setting' : text || 'Changed'), i === 0 ? h('span.pill.ok', 'Current') : null),
              h('div.muted.small', 'By ' + who(r.by) + ' · ', ui.ago(r.at))),
            i === 0 || readOnly ? null : ui.button('Restore this version', { kind: 'ghost', small: true, icon: 'refresh', onClick: function () {
              model = clone(def.fromValue(clone(r.value)));
              draw();
              VX.toast('Loaded into the form — press Save & apply to make it live.', 'ok');
              card.scrollIntoView && card.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } }));
        }));
      }, { skeleton: 3 });
    }
    var historyEl = h('details.history-panel', h('summary', VX.icon('chevron'), 'Change history'), historyList);
    historyEl.addEventListener('toggle', function () { if (historyEl.open && !historyLoaded) loadHistory(); });

    var card = h('section.card.setting-card' + (def.wide ? '.span-full' : ''), { id: 'setting-' + def.key },
      h('div.card-head',
        h('div.card-titles', h('h3', def.title), def.desc ? h('p.card-sub', def.desc) : null),
        h('div.card-actions', chipHost)),
      h('div.card-body',
        h('div.setting-body' + (previewHost ? '.with-preview' : ''), formHost, previewHost),
        errHost,
        h('div.save-bar', saveBtn, cancelBtn, h('span.grow'), resetBtn),
        metaLine,
        historyEl));
    draw();
    registerDirty(function () { return dirty() ? def.title : null; });
    return card;
  }

  /** Register an App Settings page. */
  VX.settingsPage = function (page) {
    VX.page({
      id: page.id, title: page.title, group: 'App Settings', icon: page.icon || 'settings', order: page.order, desc: page.desc, noAuto: true,
      keywords: (page.sections || []).map(function (s) { return s.title; }).join(' '),
      sections: (page.sections || []).map(function (s) { return { key: s.key, title: s.title }; }),
      render: function (host, ctx) {
        var checks = [];
        if (ctx.onLeave) ctx.onLeave(function () {
          var names = checks.map(function (f) { return f(); }).filter(Boolean);
          return names.length ? 'You have unsaved changes in ' + names.join(', ') + '. Leave without saving?' : null;
        });
        return ui.load(host, function () { return VX.api.get('/api/admin/settings', null, { fresh: true }); }, function (d) {
          var gate = ui.gate(d, ctx);
          if (gate) return gate;
          var all = { values: VX.obj(d.values), updated: VX.obj(d.updated) };
          var cards = (page.sections || []).map(function (s) { return section(s, all, ctx, function (f) { checks.push(f); }); });
          var jump = page.sections.length > 2 ? h('nav.section-jump', { 'aria-label': 'On this page' }, page.sections.map(function (s) {
            return h('a', { href: '#setting-' + s.key, onclick: function (e) { e.preventDefault(); var el = document.getElementById('setting-' + s.key); if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, s.title);
          })) : null;
          // Deep link: #/app-settings/x?section=key scrolls to that setting.
          var want = ctx.params && ctx.params.section;
          if (want) setTimeout(function () { var el = document.getElementById('setting-' + want); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' }); }, 50);
          return [ui.readOnlyNote(), jump, h('div.settings-stack', cards)];
        });
      }
    });
  };

  /* -------- small helpers settings pages share -------- */

  VX.st = {
    clone: clone,
    same: same,
    /** A text field bound to model[key]. o = { label, hint, max, multiline, placeholder } */
    text: function (model, key, set, o) {
      o = o || {};
      var inp = o.multiline ? ui.textarea({ rows: o.rows || 3, maxlength: o.max, placeholder: o.placeholder }) : ui.input({ maxlength: o.max, placeholder: o.placeholder });
      inp.value = model[key] == null ? '' : String(model[key]);
      var counter = o.max ? h('span.counter.muted.small', inp.value.length + ' / ' + o.max) : null;
      inp.addEventListener('input', function () { model[key] = inp.value; if (counter) counter.textContent = inp.value.length + ' / ' + o.max; set(model); });
      return ui.field(o.label, inp, o.hint || counter ? h('span', o.hint || '', counter ? [' ', counter] : null) : null);
    },
    /** A switch bound to model[key]. */
    toggle: function (model, key, set, title, desc) {
      return ui.switchRow(title, desc, !!model[key], function (on) { model[key] = on; set(model); });
    },
    /** Keep a "YYYY-MM-DD" or ''. */
    day: function (v) { var m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v || '')); return m ? m[1] : ''; }
  };
})();
