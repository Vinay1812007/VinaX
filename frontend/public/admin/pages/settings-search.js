/* App Settings › Search & Music Sources — search synonyms, the music sources
   and their priority, and the order of languages on Home.
   Stored keys: search-synonyms { typed: meant }, catalog-sources
   { "<source>": false, _order: [...] }, language-order { order, hidden }. */
(function () {
  'use strict';
  var VX = window.VX, h = VX.h, ui = VX.ui, fmt = VX.fmt;

  var SOURCES = [
    { id: 'local-catalog', label: 'VinaX music server (website)', desc: 'The website’s own way to reach the music catalogue. Fastest for people on the website.' },
    { id: 'sirimilla', label: 'VinaX music server (shared)', desc: 'The same catalogue at its full address. The Android app always uses this one; the website uses it as a backup.' }
  ];
  var SOURCE_NAME = {};
  SOURCES.forEach(function (s) { SOURCE_NAME[s.id] = s.label; });
  // The languages the app offers on Home, in its own default order.
  var LANGUAGES = ['hindi', 'telugu', 'tamil', 'english', 'punjabi', 'kannada', 'malayalam', 'bengali', 'marathi', 'bhojpuri', 'gujarati', 'urdu'];
  var lang = function (l) { return VX.langName(l); };

  /* --------------------------------------------------------------- synonyms */
  var synonyms = {
    key: 'search-synonyms', title: 'Search Synonyms',
    desc: 'When people type the word on the left, the app also searches for the word on the right.',
    fromValue: function (v) {
      var o = VX.obj(v);
      return { rows: Object.keys(o).filter(function (k) { return typeof o[k] === 'string'; }).map(function (k) { return { from: k, to: o[k] }; }) };
    },
    toValue: function (m) {
      if (!m.rows.length) return null;
      var out = {};
      m.rows.forEach(function (r) { var f = r.from.trim().toLowerCase(), t = r.to.trim(); if (f && t) out[f] = t; });
      return Object.keys(out).length ? out : null;
    },
    describe: function (v) {
      var keys = Object.keys(VX.obj(v));
      if (!keys.length) return 'No synonyms';
      return fmt.plural(keys.length, 'synonym') + ': ' + keys.slice(0, 3).map(function (k) { return k + ' → ' + VX.obj(v)[k]; }).join(', ') + (keys.length > 3 ? '…' : '');
    },
    render: function (m, set, api) {
      var from = ui.input({ placeholder: 'bday', maxlength: 60, 'aria-label': 'When people type' });
      var to = ui.input({ placeholder: 'birthday', maxlength: 80, 'aria-label': 'Also search for' });
      var err = h('p.form-error', { role: 'alert' });
      function add() {
        var f = from.value.trim().toLowerCase(), t = to.value.trim();
        if (!f || !t) { err.textContent = 'Fill in both words.'; return; }
        if (f === t.toLowerCase()) { err.textContent = 'The two words are the same.'; return; }
        if (m.rows.length >= 200) { err.textContent = 'You can have up to 200 synonyms.'; return; }
        m.rows = m.rows.filter(function (r) { return r.from.toLowerCase() !== f; });
        m.rows.unshift({ from: f, to: t });
        set(m); api.rerender();
      }
      [from, to].forEach(function (i) { i.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); add(); } }); });
      return [
        h('div.b-syn-add',
          ui.field('When people type', from),
          h('span.b-syn-arrow', { 'aria-hidden': 'true' }, '↔'),
          ui.field('Also search for', to),
          ui.button('Add', { kind: 'primary', icon: 'plus', onClick: add })),
        err,
        m.rows.length ? h('ul.b-syn-list', m.rows.map(function (r, i) {
          return h('li.b-syn-row',
            h('span.chip', h('span.chip-text', h('span', r.from))),
            h('span.b-syn-arrow', { 'aria-hidden': 'true' }, '↔'),
            h('span.chip', h('span.chip-text', h('span', r.to))),
            h('span.grow'),
            ui.button('', { kind: 'ghost', small: true, icon: 'trash', ariaLabel: 'Delete ' + r.from + ' to ' + r.to, title: 'Delete', onClick: function () { m.rows.splice(i, 1); set(m); api.rerender(); } }));
        })) : h('p.muted.small', 'No synonyms yet. Add the first pair above.')
      ];
    }
  };

  /* ---------------------------------------------------------- music sources */
  var sources = {
    key: 'catalog-sources', title: 'Music Sources',
    desc: 'Where the app finds songs. Drag to choose which source is tried first; switch one off to skip it.',
    fromValue: function (v) {
      var o = VX.obj(v);
      var order = VX.arr(o._order).filter(function (id) { return SOURCE_NAME[id]; });
      SOURCES.forEach(function (s) { if (order.indexOf(s.id) < 0) order.push(s.id); });
      var off = {};
      SOURCES.forEach(function (s) { off[s.id] = o[s.id] === false; });
      return { order: order, off: off };
    },
    toValue: function (m) {
      var out = {};
      var anyOff = false;
      SOURCES.forEach(function (s) { if (m.off[s.id]) { out[s.id] = false; anyOff = true; } });
      var reordered = m.order.join(',') !== SOURCES.map(function (s) { return s.id; }).join(',');
      if (!anyOff && !reordered) return null;
      if (reordered) out._order = m.order.slice();
      return out;
    },
    validate: function (m) {
      return m.order.every(function (id) { return m.off[id]; }) ? 'Keep at least one source on, or the app cannot find any music.' : null;
    },
    describe: function (v) {
      var m = sources.fromValue(v);
      var on = m.order.filter(function (id) { return !m.off[id]; });
      if (!v) return 'Every source on, in the built-in order';
      return 'Tried in this order: ' + on.map(function (id) { return SOURCE_NAME[id]; }).join(', ') + (on.length < m.order.length ? ' (others off)' : '');
    },
    render: function (m, set, api) {
      return [
        ui.sortable({
          items: m.order, label: 'Music sources, first is tried first', disabled: api.readOnly,
          name: function (id) { return SOURCE_NAME[id]; },
          render: function (id) {
            var s = SOURCES.filter(function (x) { return x.id === id; })[0];
            return ui.switchRow(s.label, s.desc, !m.off[id], function (on) { m.off[id] = !on; set(m); api.rerender(); }, { dim: m.off[id] });
          },
          onChange: function (next) { m.order = next; set(m); }
        }),
        h('p.muted.small', 'If every source fails, the app quietly tries the others too, so music keeps playing.')
      ];
    }
  };

  /* --------------------------------------------------------- language order */
  var languages = {
    key: 'language-order', title: 'Language Order',
    desc: 'The order of languages people can pick on Home. Hide a language to take it off Home.',
    fromValue: function (v) {
      var order = Array.isArray(v) ? v : VX.arr(VX.obj(v).order);
      order = order.filter(function (l) { return LANGUAGES.indexOf(l) >= 0; });
      LANGUAGES.forEach(function (l) { if (order.indexOf(l) < 0) order.push(l); });
      var hidden = Array.isArray(v) ? [] : VX.arr(VX.obj(v).hidden).filter(function (l) { return LANGUAGES.indexOf(l) >= 0; });
      return { order: order, hidden: hidden };
    },
    toValue: function (m) {
      var builtIn = m.order.join(',') === LANGUAGES.join(',') && !m.hidden.length;
      return builtIn ? null : { order: m.order.slice(), hidden: m.hidden.slice() };
    },
    validate: function (m) { return m.hidden.length >= m.order.length ? 'Keep at least one language on Home.' : null; },
    describe: function (v) {
      if (!v) return 'Built-in order';
      var m = languages.fromValue(v);
      var shown = m.order.filter(function (l) { return m.hidden.indexOf(l) < 0; });
      return shown.slice(0, 5).map(lang).join(', ') + (shown.length > 5 ? '…' : '') + (m.hidden.length ? ' · hidden: ' + m.hidden.map(lang).join(', ') : '');
    },
    render: function (m, set, api) {
      return ui.sortable({
        items: m.order, label: 'Languages, first is shown first', disabled: api.readOnly,
        name: lang,
        render: function (l) {
          var shown = m.hidden.indexOf(l) < 0;
          return h('div.b-lang-row' + (shown ? '' : '.dim'),
            h('strong', lang(l)),
            ui.toggle(shown ? 'Shown' : 'Hidden', shown, function (on) {
              m.hidden = m.hidden.filter(function (x) { return x !== l; });
              if (!on) m.hidden.push(l);
              set(m); api.rerender();
            }, { 'aria-label': 'Show ' + lang(l) + ' on Home' }));
        },
        onChange: function (next) { m.order = next; set(m); }
      });
    },
    preview: function (m) {
      var shown = m.order.filter(function (l) { return m.hidden.indexOf(l) < 0; });
      return ui.phone([
        h('div.b-home-title', 'Pick a language'),
        h('div.b-lang-chips', shown.slice(0, 10).map(function (l) { return h('span', lang(l)); }))
      ], { small: true });
    }
  };

  VX.settingsPage({
    id: 'app-settings/search', title: 'Search & Music Sources', icon: 'search', order: 6,
    desc: 'Teach search new words, choose where music comes from, and order the languages on Home.',
    sections: [synonyms, sources, languages]
  });
})();
