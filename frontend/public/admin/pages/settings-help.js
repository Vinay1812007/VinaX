/* App Settings › Help Center — the questions and answers shown in the app's
   Help & Feedback page, before the built-in ones.
   Stored key: support-faq [{ q, a, category, enabled }] (at most 30). */
(function () {
  'use strict';
  var VX = window.VX, h = VX.h, ui = VX.ui, fmt = VX.fmt;

  var CATEGORIES = ['General', 'Playing music', 'Account & sign-in', 'Downloads & offline', 'Listen Together', 'Problems & fixes'];
  var MAX = 30;
  var uid = 0;
  var key = function () { uid += 1; return 'q' + uid; };
  // Which questions are expanded, kept across redraws of the list.
  var open = {};

  var faq = {
    key: 'support-faq', title: 'Questions & Answers',
    desc: 'Your questions appear first in the app’s Help page, grouped by category. Switch one off to hide it without deleting it.',
    wide: true,
    fromValue: function (v) {
      return {
        items: VX.arr(v).map(VX.obj).filter(function (x) { return typeof x.q === 'string'; }).map(function (x) {
          return { _k: key(), q: x.q, a: typeof x.a === 'string' ? x.a : '', category: CATEGORIES.indexOf(x.category) >= 0 ? x.category : 'General', enabled: x.enabled !== false };
        })
      };
    },
    toValue: function (m) {
      if (!m.items.length) return null;
      return m.items.map(function (x) { return { q: x.q.trim(), a: x.a.trim(), category: x.category, enabled: !!x.enabled }; });
    },
    validate: function (m) {
      for (var i = 0; i < m.items.length; i++) {
        var x = m.items[i];
        if (!x.q.trim() || !x.a.trim()) return 'Question ' + (i + 1) + ' needs both a question and an answer.';
      }
      return null;
    },
    describe: function (v) {
      var list = VX.arr(v);
      if (!list.length) return 'No questions';
      var on = list.filter(function (x) { return VX.obj(x).enabled !== false; }).length;
      return fmt.plural(list.length, 'question') + (on < list.length ? ' (' + fmt.num(on) + ' shown)' : '');
    },
    render: function (m, set, api) {
      function item(x, i) {
        var qInput = ui.input({ maxlength: 160, placeholder: 'How do I download a song?', value: x.q });
        var aInput = ui.textarea({ rows: 3, maxlength: 1200, placeholder: 'Open the song, then tap Download…' });
        aInput.value = x.a;
        var title = h('span.b-faq-q', x.q || 'New question');
        qInput.addEventListener('input', function () { x.q = qInput.value; title.textContent = x.q || 'New question'; set(m); });
        aInput.addEventListener('input', function () { x.a = aInput.value; set(m); });
        var det = h('details.b-faq-item' + (x.enabled ? '' : '.off'), { open: !!open[x._k] || (!x.q && !x.a) },
          h('summary',
            VX.icon('chevron'),
            title,
            ui.pill(x.category),
            x.enabled ? null : ui.pill('Hidden', 'warn')),
          h('div.b-faq-body',
            ui.field('Question', qInput),
            ui.field('Answer', aInput, 'Plain words work best. Up to 1,200 characters.'),
            h('div.b-faq-tools',
              ui.dropdown('Category', CATEGORIES, x.category, function (v) { x.category = v; set(m); api.rerender(); }),
              ui.toggle(x.enabled ? 'Shown in the app' : 'Hidden', x.enabled, function (on) { x.enabled = on; set(m); api.rerender(); }, { 'aria-label': 'Show this question in the app' }),
              h('span.grow'),
              ui.button('Delete', { kind: 'ghost', small: true, icon: 'trash', onClick: function () {
                return VX.confirm({ title: 'Delete this question?', body: '“' + (x.q || 'New question') + '” is removed from the list. It only disappears from the app after Save & apply.', confirmLabel: 'Delete', danger: true }).then(function (ok) {
                  if (!ok) return;
                  m.items = m.items.filter(function (y) { return y !== x; }); set(m); api.rerender();
                });
              } }))));
        det.addEventListener('toggle', function () { open[x._k] = det.open; });
        return det;
      }
      return [
        ui.sortable({
          items: m.items, label: 'Questions, drag to reorder', disabled: api.readOnly,
          empty: 'No questions yet. The app shows only its built-in help until you add some.',
          name: function (x) { return x.q || 'new question'; },
          render: item,
          onChange: function (next) { m.items = next; set(m); }
        }),
        h('div.toolbar',
          ui.button('Add question', { kind: 'primary', icon: 'plus', disabled: m.items.length >= MAX || api.readOnly, onClick: function () {
            m.items.push({ _k: key(), q: '', a: '', category: 'General', enabled: true }); set(m); api.rerender();
          } }),
          h('span.muted.small', fmt.num(m.items.length) + ' of ' + MAX + ' questions'))
      ];
    },
    preview: function (m) {
      var shown = m.items.filter(function (x) { return x.enabled && x.q.trim(); });
      var groups = [];
      shown.forEach(function (x) { if (groups.indexOf(x.category) < 0) groups.push(x.category); });
      return ui.phone([
        h('div.b-home-title', 'Help & feedback'),
        shown.length ? groups.map(function (g) {
          return h('div.b-faq-group',
            h('div.b-faq-cat', g),
            shown.filter(function (x) { return x.category === g; }).map(function (x) {
              return h('details.b-faq-prev', h('summary', x.q), h('p', x.a));
            }));
        }) : h('p.b-muted', 'Only the built-in help is shown.')
      ]);
    }
  };

  VX.settingsPage({
    id: 'app-settings/help-center', title: 'Help Center', icon: 'help', order: 7,
    desc: 'Answer common questions inside the app, so people find help without writing to you.',
    sections: [faq]
  });
})();
