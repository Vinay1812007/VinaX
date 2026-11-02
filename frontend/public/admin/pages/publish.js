/* VinaX console — Publish page.
 * The published settings (GET /api/admin/settings → keys, values, updated;
 * GET ?key= → one key with its history; POST { key, value } writes, value
 * null clears). Every key is edited with a form — switches, dropdowns,
 * reorderable lists — never raw JSON. A key the console does not know yet
 * gets a form built from the shape of its current value. */
(function () {
  'use strict';
  var VX = window.VX, h = VX.h, ui = VX.ui, fmt = VX.fmt, arr = VX.arr, obj = VX.obj, num = VX.num;

  VX.page({
    id: 'publish', title: 'Publish', group: 'Content', icon: 'layout', noAuto: true,
    desc: 'Settings the app reads live: banners, greeting, Home layout, announcement, feature switches, site mode and more.',
    render: render
  });

  /* ------------------------------------------------------- vocabularies */
  // Mirrors of what the app and the Worker accept; anything else is dropped
  // on the way out (backend/worker/functions/_lib/clientConfig.ts).
  var SHELVES = [
    { id: 'quick', label: 'Quick picks' }, { id: 'personal', label: 'Made for you' }, { id: 'discovery', label: 'Fresh discoveries' },
    { id: 'charts', label: 'Charts' }, { id: 'seasonal', label: 'Seasonal listening' }, { id: 'moods', label: 'Moods' },
    { id: 'genres', label: 'Genres' }, { id: 'artists', label: 'Artists' }, { id: 'albums', label: 'Albums' },
    { id: 'daypicks', label: 'For your day' }, { id: 'loved', label: 'Favorites' }, { id: 'feed', label: 'More to explore' }
  ];
  var LANGUAGES = ['hindi', 'telugu', 'tamil', 'english', 'punjabi', 'kannada', 'malayalam', 'bengali', 'marathi', 'bhojpuri', 'gujarati', 'urdu'];
  var SOURCES = [
    { id: 'local-catalog', label: 'VinaX Catalog', note: 'The website’s own catalogue route (/api/cat).' },
    { id: 'sirimilla', label: 'VinaX Catalog (remote)', note: 'The absolute address: the Android app’s only source and the website’s fallback.' }
  ];
  var LINK_TYPES = [{ value: '', label: 'Nothing (not tappable)' }, { value: 'song', label: 'A song' }, { value: 'album', label: 'An album' }, { value: 'playlist', label: 'A playlist' }, { value: 'artist', label: 'An artist' }];
  var EMBED_MODELS = [
    { value: 'cloudflare:@cf/baai/bge-m3', label: 'Cloudflare · BGE-M3 (default)' },
    { value: 'gemini:gemini-embedding-001', label: 'Gemini · Embedding 001' },
    { value: 'gemini:gemini-embedding-2', label: 'Gemini · Embedding 2' }
  ];
  var WEIGHTS = [
    { key: 'tasteFit', label: 'Taste fit', d: 0.3 }, { key: 'artist', label: 'Favourite artists', d: 0.22 }, { key: 'language', label: 'Language', d: 0.14 },
    { key: 'colisten', label: 'Co-listening', d: 0.14 }, { key: 'source', label: 'Source', d: 0.1 }, { key: 'agreement', label: 'Agreement', d: 0.08 },
    { key: 'hour', label: 'Time of day', d: 0.06 }, { key: 'freshness', label: 'Freshness', d: 0.05 }, { key: 'community', label: 'Community', d: 0.04 },
    { key: 'exposure', label: 'Exposure', d: 1 }, { key: 'skips', label: 'Skips', d: 0.2 }, { key: 'novelty', label: 'Novelty', d: 0.1 }
  ];
  var SLUG = /^[a-z][a-z0-9_-]{0,39}$/;

  /* ---------------------------------------------------------- helpers */
  var str = function (v) { return v == null ? '' : String(v); };
  var cap = function (s) { s = str(s); return s.charAt(0).toUpperCase() + s.slice(1); };
  var pad2 = function (n) { return (n < 10 ? '0' : '') + n; };
  function dateInput(value, label) { return ui.input({ type: 'date', value: str(value).slice(0, 10), 'aria-label': label }); }
  function textVal(inp) { var v = inp.value.trim(); return v || undefined; }
  function clean(o) { Object.keys(o).forEach(function (k) { if (o[k] === undefined || o[k] === '') delete o[k]; }); return o; }
  function hourLabel(hr) { var am = hr < 12 ? 'AM' : 'PM', h12 = hr % 12 === 0 ? 12 : hr % 12; return pad2(hr) + ':00 (' + h12 + ' ' + am + ')'; }
  function shelfLabel(id) { var s = SHELVES.filter(function (x) { return x.id === id; })[0]; return s ? s.label : id; }
  function festivals() { return arr(window.VX_FESTIVALS).filter(function (f) { return f && f.id; }); }
  function festivalName(id) { var f = festivals().filter(function (x) { return x.id === id; })[0]; return f ? f.name : id; }
  /** ISO → the value a datetime-local input shows (the owner's local time). */
  function toLocalInput(iso) {
    var d = iso ? new Date(iso) : null;
    if (!d || isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + 'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }
  function span(ms) {
    var m = Math.round(Math.abs(ms) / 60000);
    if (m < 60) return fmt.plural(m, 'minute');
    var hr = Math.round(m / 6) / 10;
    if (hr < 48) return fmt.plural(hr, 'hour');
    return fmt.plural(Math.round(hr / 2.4) / 10, 'day');
  }
  /** A dropdown of preset numbers that keeps an unusual current value selectable. */
  function presetSelect(presets, current, label, aria) {
    var opts = presets.slice();
    if (current != null && !opts.some(function (p) { return p.value === current; })) opts.push({ value: current, label: label(current) });
    opts.sort(function (a, b) { return a.value - b.value; });
    return ui.select(opts.map(function (p) { return { value: p.value, label: p.label || label(p.value) }; }), current, { 'aria-label': aria });
  }
  function iconBtn(iconName, label, onClick, disabled) {
    return ui.button('', { kind: 'ghost', small: true, icon: iconName, ariaLabel: label, title: label, disabled: disabled, onClick: onClick });
  }
  /** Bind a control to item[field]: the item is the row's state, so reordering never loses typing. */
  function bind(control, item, field, parse) {
    var ev = control.tagName === 'SELECT' || control.type === 'date' || control.type === 'datetime-local' ? 'change' : 'input';
    control.addEventListener(ev, function () { item[field] = parse ? parse(control.value) : control.value; });
    return control;
  }

  /**
   * A list of rows the owner can add to, remove from and reorder.
   * o = { items, max, noun, addLabel, empty: [title, hint], blank() → item,
   *       row(item, index) → element, title?(item, index) → text, reorder }
   * Returns { el, items } — read the items after the owner is done.
   */
  function itemList(o) {
    var items = o.items;
    var list = h('div.item-list');
    var addBtn = ui.button(o.addLabel || 'Add', { kind: 'ghost', small: true, icon: 'plus', onClick: function () {
      if (items.length >= o.max) return;
      items.push(o.blank()); draw();
      var last = list.lastElementChild; var f = last && last.querySelector('input, textarea, select');
      if (f) f.focus();
    } });
    var count = h('span.muted.small');
    function move(i, d) { var j = i + d; if (j < 0 || j >= items.length) return; var t = items[i]; items[i] = items[j]; items[j] = t; draw(); }
    function draw() {
      VX.clear(list);
      items.forEach(function (item, i) {
        var title = o.title ? o.title(item, i) : (o.noun || 'Item') + ' ' + (i + 1);
        list.appendChild(h('div.item-card',
          h('div.item-head',
            h('span.item-index', String(i + 1)),
            h('span.item-title', title),
            o.badge ? o.badge(item) : null,
            h('span.grow'),
            o.reorder !== false ? [iconBtn('up', 'Move up', function () { move(i, -1); }, i === 0), iconBtn('down', 'Move down', function () { move(i, 1); }, i === items.length - 1)] : null,
            iconBtn('trash', 'Remove ' + (o.noun || 'item').toLowerCase() + ' ' + (i + 1), function () { items.splice(i, 1); draw(); })),
          h('div.item-body', o.row(item, i))));
      });
      if (!items.length) list.appendChild(ui.empty(o.empty[0], o.empty[1]));
      addBtn.disabled = items.length >= o.max;
      count.textContent = fmt.num(items.length) + ' of ' + fmt.num(o.max);
      list.dispatchEvent(new Event('change', { bubbles: true }));
    }
    draw();
    return { el: h('div.stack', list, h('div.actions', addBtn, count)), items: items, redraw: draw };
  }

  /** Chips with a remove button, plus an input that adds on Enter. */
  function tagInput(o) {
    var values = arr(o.values).map(String);
    var chips = h('div.tag-list');
    var input = ui.input({ placeholder: o.placeholder || 'Type and press Enter', 'aria-label': o.label, spellcheck: 'false' });
    var err = h('p.field-hint');
    function draw() {
      VX.clear(chips);
      values.forEach(function (v, i) {
        chips.appendChild(h('span.tag', h('span', v), h('button', { type: 'button', 'aria-label': 'Remove ' + v, title: 'Remove', onclick: function () { values.splice(i, 1); draw(); } }, VX.icon('close'))));
      });
      if (!values.length) chips.appendChild(h('span.muted.small', o.emptyText || 'None yet.'));
      chips.dispatchEvent(new Event('change', { bubbles: true }));
    }
    function add() {
      var parts = input.value.split(/[\s,]+/).map(function (t) { return t.trim(); }).filter(Boolean);
      err.textContent = '';
      for (var i = 0; i < parts.length; i++) {
        if (values.length >= o.max) { err.textContent = 'At most ' + o.max + '.'; break; }
        if (o.pattern && !o.pattern.test(parts[i])) { err.textContent = '“' + parts[i] + '” does not look right. ' + (o.patternHint || ''); continue; }
        if (values.indexOf(parts[i]) < 0) values.push(parts[i]);
      }
      input.value = ''; draw();
    }
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } });
    draw();
    return { el: h('div.tag-input', chips, h('div.tag-add', input, ui.button('Add', { kind: 'ghost', small: true, icon: 'plus', onClick: add })), err),
      // Text still in the box counts too (without clearing it: this runs while the owner types).
      read: function () {
        var out = values.slice();
        input.value.split(/[\s,]+/).forEach(function (t) { t = t.trim(); if (t && out.indexOf(t) < 0 && out.length < o.max && (!o.pattern || o.pattern.test(t))) out.push(t); });
        return out;
      } };
  }

  /** A fixed set of entries the owner can reorder; extra(item) adds controls to a row. */
  function orderList(items, opts) {
    var list = h('div.order-list');
    function move(i, d) { var j = i + d; if (j < 0 || j >= items.length) return; var t = items[i]; items[i] = items[j]; items[j] = t; draw(); }
    function draw() {
      VX.clear(list);
      var locked = opts.locked && opts.locked();
      items.forEach(function (it, i) {
        list.appendChild(h('div.order-row' + (opts.dim && opts.dim(it) ? '.dim' : ''),
          h('span.item-index', String(i + 1)),
          h('span.order-label', opts.label(it)),
          opts.extra ? opts.extra(it, draw) : null,
          h('span.order-moves', iconBtn('up', 'Move ' + opts.label(it) + ' up', function () { move(i, -1); }, locked || i === 0), iconBtn('down', 'Move ' + opts.label(it) + ' down', function () { move(i, 1); }, locked || i === items.length - 1))));
      });
      list.dispatchEvent(new Event('change', { bubbles: true }));
    }
    draw();
    return { el: list, items: items, redraw: draw };
  }

  /* ------------------------------------------------------------- forms */
  // Each form: build(value) → { el, read() → value | throws Error(message), ready?, danger? }.
  var FORMS = {
    banners: function (value) {
      var today = new Date().toISOString().slice(0, 10);
      var items = arr(value).map(function (b) {
        b = obj(b);
        var lt = ['song', 'album', 'playlist', 'artist'].indexOf(str(b.linkType)) >= 0 ? str(b.linkType) : '';
        return { id: str(b.id) || 'bn-' + VX.rid().slice(0, 6), title: str(b.title), subtitle: str(b.subtitle), linkType: lt, linkId: lt ? str(b.linkId) : '', img: str(b.img), start: str(b.start).slice(0, 10), end: str(b.end).slice(0, 10) };
      });
      function state(b) {
        if (b.end && today > b.end) return ui.pill('Ended', 'bad');
        if (b.start && today < b.start) return ui.pill('Scheduled', 'info');
        return ui.pill('Live', 'ok');
      }
      var l = itemList({
        items: items, max: 10, noun: 'Banner', addLabel: 'Add banner', empty: ['No banners', 'Add one — Home shows up to ten live banners.'],
        title: function (b, i) { return b.title || 'Banner ' + (i + 1); }, badge: state,
        blank: function () { return { id: 'bn-' + VX.rid().slice(0, 6), title: '', subtitle: '', linkType: '', linkId: '', img: '', start: '', end: '' }; },
        row: function (b, i) {
          var n = ' (banner ' + (i + 1) + ')';
          var linkId = bind(ui.input({ value: b.linkId, maxlength: 80, placeholder: 'Id from the catalogue', 'aria-label': 'Link id' + n }), b, 'linkId');
          var idField = ui.field(b.linkType ? cap(b.linkType) + ' id' : 'Id', linkId, 'Find it on the Catalog page.');
          idField.hidden = !b.linkType;
          var type = bind(ui.select(LINK_TYPES, b.linkType, { 'aria-label': 'Opens' + n }), b, 'linkType');
          type.addEventListener('change', function () { idField.hidden = !type.value; VX.$('.field-label', idField).textContent = type.value ? cap(type.value) + ' id' : 'Id'; });
          return h('div.form.wide',
            h('div.form-row',
              ui.field('Title', bind(ui.input({ value: b.title, maxlength: 80, placeholder: 'Diwali hits', 'aria-label': 'Title' + n }), b, 'title')),
              ui.field('Subtitle', bind(ui.input({ value: b.subtitle, maxlength: 120, placeholder: 'Optional', 'aria-label': 'Subtitle' + n }), b, 'subtitle'))),
            h('div.form-row', ui.field('Tapping it opens', type), idField),
            ui.field('Image', bind(ui.input({ type: 'url', value: b.img, maxlength: 500, placeholder: 'https://…', 'aria-label': 'Image' + n }), b, 'img'), 'Optional. An https:// address; wide images look best.'),
            h('div.form-row',
              ui.field('Show from', bind(dateInput(b.start, 'Show from' + n), b, 'start'), 'Empty = right away'),
              ui.field('Show until', bind(dateInput(b.end, 'Show until' + n), b, 'end'), 'Empty = no end')));
        }
      });
      return { el: h('div.form.wide', l.el),
        read: function () {
          return items.map(function (b, i) {
            if (!b.title.trim()) throw new Error('Banner ' + (i + 1) + ' needs a title.');
            var img = b.img.trim();
            if (img && !/^https:\/\//.test(img)) throw new Error('Banner ' + (i + 1) + ': the image must be an https:// address.');
            if (b.linkType && !b.linkId.trim()) throw new Error('Banner ' + (i + 1) + ': enter the ' + b.linkType + ' id, or choose “Nothing”.');
            if (b.start && b.end && b.end < b.start) throw new Error('Banner ' + (i + 1) + ': “Show until” is before “Show from”.');
            return clean({ id: b.id, title: b.title.trim(), subtitle: b.subtitle.trim() || undefined, linkType: b.linkType || undefined, linkId: b.linkType ? b.linkId.trim() : undefined, img: img || undefined, start: b.start || undefined, end: b.end || undefined });
          });
        } };
    },

    festival: function (value) {
      var v = obj(value);
      var all = festivals();
      var mode = v.mode === 'force' || v.mode === 'on' ? 'force' : v.mode === 'off' ? 'off' : 'auto';
      var pick = ui.select([{ value: '', label: all.length ? 'Choose a festival…' : 'No festival calendar loaded' }].concat(all.map(function (f) { return { value: f.id, label: f.name + (f.when ? ' · ' + f.when : '') }; })), str(v.id), { 'aria-label': 'Festival' });
      var preview = h('div');
      var start = dateInput(v.start, 'From'), end = dateInput(v.end, 'Until');
      function drawPreview() {
        var f = all.filter(function (x) { return x.id === pick.value; })[0];
        VX.mount(preview, f ? h('div.fest-preview', h('div.fest-ribbon', { style: { background: f.ribbon || f.accent || 'var(--accent)' } }),
          h('div.fest-text', h('strong', f.name), h('span.muted.small', [f.when, f.fx].filter(Boolean).join(' · ')), f.blurb ? h('span.small', f.blurb) : null)) : null);
      }
      pick.addEventListener('change', drawPreview);
      var pickField = ui.field('Festival', pick);
      var forceHost = h('div.stack', pickField, preview);
      function sync() { forceHost.hidden = mode !== 'force'; }
      var seg = ui.segmented([{ value: 'auto', label: 'Follow the calendar' }, { value: 'force', label: 'Show a festival now' }, { value: 'off', label: 'No festival skins' }], mode, function (m) { mode = m; sync(); seg.dispatchEvent(new Event('change', { bubbles: true })); }, 'Festival mode');
      drawPreview(); sync();
      return { el: h('div.form',
        ui.field('Mode', seg, 'The calendar skins the app on each festival’s dates. Show one now to preview or extend it; turn skins off to keep the plain look.'),
        forceHost,
        h('div.form-row', ui.field('From', start, 'Optional'), ui.field('Until', end, 'Optional — the override stops applying after this day'))),
        read: function () {
          if (mode === 'force' && !pick.value) throw new Error('Choose the festival to show.');
          if (start.value && end.value && end.value < start.value) throw new Error('“Until” is before “From”.');
          return clean({ mode: mode, id: mode === 'force' ? pick.value : undefined, start: textVal(start), end: textVal(end) });
        } };
    },

    greeting: function (value) {
      var v = obj(value);
      var text = ui.input({ value: str(v.text), maxlength: 160, placeholder: 'Good evening — new Telugu releases are in.' });
      var start = dateInput(v.start, 'Start date'), end = dateInput(v.end, 'End date');
      return { el: h('div.form', ui.field('Text', text, 'Up to 160 characters, shown under the Home title.'), h('div.form-row', ui.field('From', start, 'Optional'), ui.field('Until', end, 'Optional'))),
        read: function () { if (!text.value.trim()) throw new Error('The greeting needs a text.'); return clean({ text: text.value.trim(), start: textVal(start), end: textVal(end) }); } };
    },

    broadcast: function (value) {
      var v = obj(value);
      var id = ui.input({ value: str(v.id) || 'b-' + VX.stamp(), maxlength: 40, readOnly: true, 'aria-label': 'Message tag' });
      var text = ui.textarea({ value: str(v.text), rows: 2, maxlength: 240 });
      var link = ui.input({ value: str(v.link), maxlength: 200, placeholder: '/charts' });
      var start = dateInput(v.start, 'Start date'), end = dateInput(v.end, 'End date');
      var renew = ui.button('Show again to everyone', { kind: 'ghost', small: true, icon: 'refresh', onClick: function () { id.value = 'b-' + VX.stamp() + '-' + VX.rid().slice(0, 4); id.dispatchEvent(new Event('input', { bubbles: true })); VX.toast('New tag — publish to show the bar again', 'ok'); } });
      return { el: h('div.form', ui.field('Message', text, 'Up to 240 characters.'), ui.field('Link', link, 'Optional; a page on the site, starting with /.'), h('div.form-row', ui.field('From', start, 'Optional'), ui.field('Until', end, 'Optional')),
        ui.field('Message tag', h('div.inline-control', id, renew), 'Listeners who dismissed this tag do not see the bar again. A new tag shows it to everyone.')),
        read: function () {
          if (!text.value.trim()) throw new Error('The broadcast needs a message.');
          if (link.value.trim() && link.value.trim().charAt(0) !== '/') throw new Error('The link must be a site path starting with /.');
          return clean({ id: id.value.trim() || 'b-' + VX.stamp(), text: text.value.trim(), link: textVal(link), start: textVal(start), end: textVal(end) });
        } };
    },

    'home-layout': function (value) {
      var v = obj(value);
      var known = SHELVES.map(function (s) { return s.id; });
      var order = arr(v.order).filter(function (k) { return known.indexOf(k) >= 0; });
      var hidden = arr(v.hidden).filter(function (k) { return known.indexOf(k) >= 0; });
      var items = order.concat(known.filter(function (k) { return order.indexOf(k) < 0; })).map(function (k) { return { id: k, shown: hidden.indexOf(k) < 0 }; });
      var title = ui.input({ value: str(v.title), maxlength: 60, placeholder: 'Leave empty for the app’s own title' });
      var desc = ui.input({ value: str(v.description), maxlength: 160, placeholder: 'Optional line under the title' });
      var fixed = ui.toggle('Use a fixed shelf order', order.length > 0, function () { list.redraw(); });
      var list = orderList(items, {
        label: function (it) { return shelfLabel(it.id); },
        locked: function () { return !fixed.input.checked; },
        dim: function (it) { return !it.shown; },
        extra: function (it, redraw) { return ui.toggle(it.shown ? 'Shown' : 'Hidden', it.shown, function (on) { it.shown = on; redraw(); }, { 'aria-label': shelfLabel(it.id) + ' shown' }); }
      });
      return { el: h('div.form',
        h('div.form-row', ui.field('Title', title), ui.field('Description', desc)),
        h('div.stack', fixed, h('p.field-hint', 'Off: each listener’s Home orders itself (time of day, taste, the AI Home). On: every listener gets the order below, unless they arranged Home themselves.')),
        ui.field('Shelves', list.el, 'A hidden shelf disappears for every listener. At least one shelf stays shown.')),
        read: function () {
          var hid = items.filter(function (it) { return !it.shown; }).map(function (it) { return it.id; });
          if (hid.length >= items.length) throw new Error('Keep at least one shelf shown.');
          return { title: title.value.trim(), description: desc.value.trim(), order: fixed.input.checked ? items.map(function (it) { return it.id; }) : [], hidden: hid };
        } };
    },

    announcement: function (value) {
      var v = obj(value);
      var title = ui.input({ value: str(v.title), maxlength: 120 });
      var body = ui.textarea({ value: str(v.body), rows: 3, maxlength: 300 });
      var link = ui.input({ value: str(v.link) || '/', maxlength: 200 });
      return { el: h('div.form', ui.notice('The Android app shows this once as a notification when it opens. Publishing stamps a new time, so everyone sees it again.', 'info'), ui.field('Title', title), ui.field('Body', body, 'Up to 300 characters.'), ui.field('Link', link, 'A page on the site, starting with /.')),
        read: function () {
          if (!title.value.trim()) throw new Error('The announcement needs a title.');
          var l = link.value.trim() || '/';
          if (l.charAt(0) !== '/') throw new Error('The link must be a site path starting with /.');
          return { title: title.value.trim(), body: body.value.trim(), link: l, ts: Date.now() };
        } };
    },

    'support-faq': function (value) {
      var items = arr(value).map(function (x) { x = obj(x); return { q: str(x.q), a: str(x.a) }; });
      var l = itemList({
        items: items, max: 30, noun: 'Question', addLabel: 'Add question', empty: ['No questions', 'The Help center shows its built-in answers until you add some.'],
        title: function (it, i) { return it.q ? fmt.trunc(it.q, 70) : 'Question ' + (i + 1); },
        blank: function () { return { q: '', a: '' }; },
        row: function (it, i) {
          return h('div.form.wide',
            ui.field('Question', bind(ui.input({ value: it.q, maxlength: 160, placeholder: 'How do I download songs?', 'aria-label': 'Question ' + (i + 1) }), it, 'q')),
            ui.field('Answer', bind(ui.textarea({ value: it.a, rows: 3, maxlength: 1200, 'aria-label': 'Answer ' + (i + 1) }), it, 'a'), 'Up to 1200 characters.'));
        }
      });
      return { el: h('div.form.wide', l.el),
        read: function () {
          return items.map(function (it, i) {
            if (!it.q.trim() || !it.a.trim()) throw new Error('Question ' + (i + 1) + ' needs both a question and an answer.');
            return { q: it.q.trim(), a: it.a.trim() };
          });
        } };
    },

    flags: function (value) {
      var v = obj(value);
      var KNOWN = [
        { key: 'listenTogether', label: 'Listen Together', note: 'Off hides the entries in the app.' }
      ];
      var keys = KNOWN.map(function (k) { return k.key; });
      Object.keys(v).forEach(function (k) { if (keys.indexOf(k) < 0 && typeof v[k] === 'boolean') { KNOWN.push({ key: k, label: k, note: 'Added earlier.' }); keys.push(k); } });
      var toggles = {};
      var list = h('ul.list', KNOWN.map(function (k) {
        var t = ui.toggle(k.label, v[k.key] !== false, null, { 'aria-label': k.label });
        toggles[k.key] = t;
        return h('li', t, h('span.grow.muted.small', k.note));
      }));
      return { el: h('div.form.wide', ui.notice('A switch that is on means the feature works as built. Off turns it off for every listener within a minute.', 'info'), list),
        read: function () { var out = {}; Object.keys(toggles).forEach(function (k) { out[k] = toggles[k].input.checked; }); return out; } };
    },

    // VinaX AI: the switch, testers, web search and the per-model switches
    // and picker order. The model list comes from /api/admin/ai; entries for
    // ids it no longer lists are kept as they were.
    'vinax-ai': function (value) {
      var v = obj(value);
      var enabled = ui.toggle('Open to every signed-in listener', v.enabled === true, null, { 'aria-label': 'VinaX AI on for everyone' });
      var testers = tagInput({ values: arr(v.testers), max: 50, label: 'Add tester account id', placeholder: 'Account id, then Enter', emptyText: 'No testers.' });
      var search = ui.toggle('Web search', v.search !== false, null, { 'aria-label': 'Web search' });
      var before = obj(v.models);
      var rows = {};
      var modelsHost = h('div', ui.loading('Loading the models…'));
      var ready = VX.api.get('/api/admin/ai', null, { fresh: true }).then(function (res) {
        if (!res.ok) { VX.mount(modelsHost, ui.notice('The model list could not load (' + res.message + '). Model switches are kept as they are.', 'warn')); return; }
        var models = arr(obj(res.data).models);
        if (!models.length) { VX.mount(modelsHost, ui.muted('No models reported.')); return; }
        VX.mount(modelsHost, h('ul.list', models.map(function (m) {
          var o = obj(before[m.id]);
          var on = ui.toggle(m.name, o.enabled !== false, null, { 'aria-label': m.name + ' on' });
          var order = ui.input({ type: 'number', step: '1', value: typeof o.order === 'number' ? String(o.order) : '', placeholder: 'Auto', 'aria-label': m.name + ' order', style: { width: '6.5em' } });
          rows[m.id] = { on: on, order: order };
          return h('li', on, h('span.grow.muted.small', m.provider + ' · ' + (m.group ? m.group : 'Auto only')), m.group ? h('label.inline-label', h('span.muted.small', 'Position'), order) : null);
        })));
      });
      return {
        ready: ready,
        el: h('div.form.wide',
          ui.notice('Off keeps VinaX AI closed to everyone except the testers below. Changes reach every server within a minute.', 'info'),
          enabled,
          ui.field('Testers', testers.el, 'Account ids that may use VinaX AI while it is off (the account= part of a listener’s profile address). Up to 50.'),
          search,
          ui.field('Models', modelsHost, 'A model switched off leaves the picker and every Auto ladder. Position sorts a model inside its picker group: lower first; empty keeps the built-in order.')),
        read: function () {
          var ids = testers.read();
          var models = {};
          Object.keys(before).forEach(function (id) { if (!rows[id]) models[id] = before[id]; });
          Object.keys(rows).forEach(function (id) {
            var r = rows[id];
            var entry = {};
            if (!r.on.input.checked) entry.enabled = false;
            var raw = r.order.value.trim();
            if (raw) {
              var n = Number(raw);
              if (!isFinite(n)) throw new Error('Position must be a number.');
              entry.order = n;
            }
            if (Object.keys(entry).length) models[id] = entry;
          });
          var out = { enabled: enabled.input.checked, testers: ids, search: search.input.checked };
          if (Object.keys(models).length) out.models = models;
          return out;
        }
      };
    },

    'personal-config': function (value) {
      var v = obj(value), w = obj(v.weights);
      var enabled = ui.toggle('Personal engine on', v.enabled !== false, null, { 'aria-label': 'Personal engine on' });
      var composer = ui.toggle('Let the language model shape Home and playlists', v.composer !== false, null, { 'aria-label': 'Composer' });
      var current = str(v.embedModel) || EMBED_MODELS[0].value;
      var preset = EMBED_MODELS.some(function (m) { return m.value === current; });
      var model = ui.select(EMBED_MODELS.concat([{ value: '__custom', label: 'Another model…' }]), preset ? current : '__custom', { 'aria-label': 'Embedding model' });
      var custom = ui.input({ value: preset ? '' : current, placeholder: 'cloudflare:@cf/… or gemini:…', spellcheck: 'false', 'aria-label': 'Custom embedding model' });
      var warn = ui.notice('Changing the embedding model starts a new space: songs are embedded again from scratch, and taste models rebuild as listeners play.', 'warn');
      var customField;
      function syncModel() { if (customField) customField.hidden = model.value !== '__custom'; var val = model.value === '__custom' ? custom.value.trim() : model.value; warn.hidden = val === (str(v.embedModel) || EMBED_MODELS[0].value); }
      customField = ui.field('Model id', custom, 'provider:model, e.g. cloudflare:@cf/baai/bge-m3');
      model.addEventListener('change', syncModel); custom.addEventListener('input', syncModel); syncModel();
      var sliders = {};
      var rows = WEIGHTS.map(function (wt) {
        var cur = typeof w[wt.key] === 'number' && isFinite(w[wt.key]) ? Math.min(wt.d * 2, Math.max(wt.d / 2, w[wt.key])) : wt.d;
        var range = h('input.range', { type: 'range', min: String(wt.d / 2), max: String(wt.d * 2), step: String(wt.d / 100), value: String(cur), 'aria-label': wt.label + ' weight' });
        var out = h('span.range-val');
        var reset = iconBtn('refresh', 'Reset ' + wt.label + ' to default', function () { range.value = String(wt.d); show(); range.dispatchEvent(new Event('input', { bubbles: true })); });
        function show() { var x = Number(range.value); out.textContent = (Math.round(x * 1000) / 1000) + ' · ' + Math.round(x / wt.d * 100) + '%'; out.classList.toggle('changed', Math.abs(x - wt.d) > wt.d / 200); }
        range.addEventListener('input', show); show();
        // The slider snaps to its step; an untouched slider keeps the stored number exactly.
        sliders[wt.key] = { el: range, start: range.value, orig: cur };
        return h('div.weight-row', h('span.weight-label', wt.label), range, out, reset);
      });
      return { el: h('div.form.wide',
        enabled, composer,
        h('div.form-row', ui.field('Embedding model', model), customField), warn,
        ui.field('Weights', h('div.weight-list', rows), 'Each weight can move between half and double its default (100%). Higher means that signal counts more when ranking songs.')),
        read: function () {
          var m = model.value === '__custom' ? custom.value.trim() : model.value;
          if (!/^(cloudflare|gemini):[A-Za-z0-9@/._-]{2,80}$/.test(m)) throw new Error('The model id must look like cloudflare:@cf/… or gemini:….');
          var weights = {};
          WEIGHTS.forEach(function (wt) { var sl = sliders[wt.key]; var x = sl.el.value === sl.start ? sl.orig : Math.round(Number(sl.el.value) * 1e4) / 1e4; if (Math.abs(x - wt.d) > wt.d / 200) weights[wt.key] = x; });
          var o = { enabled: enabled.input.checked, composer: composer.input.checked, embedModel: m };
          if (Object.keys(weights).length) o.weights = weights;
          return o;
        } };
    },

    // Music AI (1.4): the kill switch for every music AI route, Up Next's AI
    // order, the AI-built Home, and song generation (a feature flag, off until
    // set) with its daily quota per device. docs/ai.md#music-ai.
    'ai-music': function (value) {
      var v = obj(value);
      var g = obj(v.generate);
      var rerank = ui.toggle('AI order for Up Next', v.rerank !== false, null, { 'aria-label': 'AI order for Up Next' });
      var home = ui.toggle('AI-built Home', v.home !== false, null, { 'aria-label': 'AI-built Home' });
      var gen = ui.toggle('Song generation', g.enabled === true, null, { 'aria-label': 'Song generation' });
      var cur = typeof g.dailyQuota === 'number' ? Math.round(g.dailyQuota) : 5;
      var quota = presetSelect([1, 2, 3, 5, 10, 20, 50].map(function (n) { return { value: n }; }), cur, function (n) { return fmt.plural(n, 'song'); }, 'Songs per device per day');
      var subs = h('div.sub-settings', rerank, home, gen, ui.field('Songs per device per day', quota, 'Each device may make at most this many songs a day.'));
      var all = ui.toggle('Music AI on', v.enabled !== false, function (on) { subs.classList.toggle('dim', !on); }, { 'aria-label': 'Music AI on' });
      subs.classList.toggle('dim', v.enabled === false);
      return {
        el: h('div.form.wide',
          ui.notice('Music AI on is the kill switch: off stops every music AI feature and the app plays its own picks. Song generation stays off until switched on here, and also needs the Worker’s Gemini key (GEMINI_API_KEY), the same one VinaX AI uses. Changes reach every server within a minute.', 'info'),
          all, subs),
        read: function () {
          var n = Number(quota.value);
          if (!isFinite(n) || n < 1 || n > 50) throw new Error('Songs per day must be between 1 and 50.');
          return { enabled: all.input.checked, rerank: rerank.input.checked, home: home.input.checked, generate: { enabled: gen.input.checked, dailyQuota: Math.round(n) } };
        }
      };
    },

    'min-version': function (value) {
      var v = obj(value);
      var build = ui.input({ type: 'number', min: 1, step: 1, value: str(v.build), placeholder: 'e.g. 142', style: { 'max-width': '180px' } });
      return { el: h('div.form', ui.field('Minimum Android build', build, 'Builds below this number must update before they can play. Use “Reset to default” to lift it.')),
        read: function () { var n = Math.floor(num(build.value)); if (n < 1) throw new Error('Enter a build number above 0.'); return { build: n }; } };
    },

    'site-mode': function (value) {
      var v = obj(value);
      var mode = v.mode === 'maintenance' ? 'maintenance' : 'live';
      var note = ui.textarea({ value: str(v.note), rows: 2, maxlength: 200, placeholder: 'VinaX is getting a quick tune-up.' });
      var warn = ui.notice('Maintenance puts every listener behind a gate within a minute: no browsing, no search, no playback except what is already downloaded. Use it only while something is really broken.', 'bad');
      warn.hidden = mode !== 'maintenance';
      var seg = ui.segmented([{ value: 'live', label: 'Live' }, { value: 'maintenance', label: 'Maintenance' }], mode, function (m) { mode = m; warn.hidden = m !== 'maintenance'; seg.dispatchEvent(new Event('change', { bubbles: true })); }, 'Site mode');
      return { el: h('div.form', ui.field('Mode', seg, 'Live: the app works normally. Maintenance: everyone sees the gate.'), warn, ui.field('Note', note, 'Shown on the gate while in maintenance.')),
        read: function () { return clean({ mode: mode, note: textVal(note) }); }, danger: function () { return mode === 'maintenance'; } };
    },

    'maintenance-window': function (value) {
      var v = obj(value);
      var start = ui.input({ type: 'datetime-local', value: toLocalInput(v.start), 'aria-label': 'Starts' });
      var end = ui.input({ type: 'datetime-local', value: toLocalInput(v.end), 'aria-label': 'Ends' });
      var note = ui.textarea({ value: str(v.note), rows: 2, maxlength: 200, placeholder: 'Planned database upgrade — back by 03:00.' });
      var status = h('div');
      function describe() {
        var s = Date.parse(start.value), e = Date.parse(end.value), now = Date.now();
        if (isNaN(s) || isNaN(e)) return VX.mount(status, ui.muted('Pick a start and an end.'));
        if (e <= s) return VX.mount(status, ui.notice('The end must be after the start.', 'bad'));
        var line = now > e ? 'This window has ended.' : now >= s ? 'Active now — listeners see the gate for ' + span(e - now) + ' more.' : 'Starts in ' + span(s - now) + ' and lasts ' + span(e - s) + '.';
        VX.mount(status, ui.notice(line, now >= s && now <= e ? 'warn' : 'info'));
      }
      start.addEventListener('change', describe); end.addEventListener('change', describe); describe();
      return { el: h('div.form', h('div.form-row', ui.field('Starts', start, 'Your local time'), ui.field('Ends', end, 'Your local time')), status, ui.field('Note', note, 'Shown on the gate during the window.')),
        read: function () {
          var s = Date.parse(start.value), e = Date.parse(end.value);
          if (isNaN(s) || isNaN(e)) throw new Error('Pick both a start and an end.');
          if (e <= s) throw new Error('The end must be after the start.');
          return clean({ start: new Date(s).toISOString(), end: new Date(e).toISOString(), note: textVal(note) });
        } };
    },

    'status-note': function (value) {
      var v = obj(value);
      var text = ui.textarea({ value: str(v.text), rows: 3, maxlength: 400, placeholder: 'We are looking into slow searches since 18:00 IST.' });
      return { el: h('div.form', ui.field('Note', text, 'Shown at the top of status.vinaxmusic.online. Use “Reset to default” to remove it.')),
        read: function () { if (!text.value.trim()) throw new Error('Type a note, or use Reset to default to remove it.'); return { text: text.value.trim() }; } };
    },

    retention: function (value) {
      var v = obj(value);
      var cur = Math.floor(num(v.eventsDays)) || 180;
      var days = presetSelect([30, 60, 90, 180, 365, 730, 1095, 3650].map(function (n) { return { value: n }; }), cur, function (n) {
        return n === 180 ? '180 days (default)' : n % 365 === 0 ? fmt.plural(n / 365, 'year') : fmt.plural(n, 'day');
      }, 'Keep usage events for');
      return { el: h('div.form', ui.field('Keep usage events for', days, 'Housekeeping deletes older events every hour. Analytics read at most 90 days.')),
        read: function () { var n = Math.floor(num(days.value)); if (n < 7 || n > 3650) throw new Error('Choose between 7 and 3650 days.'); return { eventsDays: n }; } };
    },

    push: function (value) {
      var v = obj(value);
      var hours = []; for (var i = 0; i < 24; i++) hours.push({ value: i, label: hourLabel(i) });
      var gap = presetSelect([0, 1, 2, 4, 6, 8, 12, 20, 24, 48, 72, 168].map(function (n) { return { value: n }; }), v.minGapHours != null ? Math.floor(num(v.minGapHours)) : 20, function (n) {
        return n === 0 ? 'No limit' : n === 168 ? '1 week' : n % 24 === 0 ? fmt.plural(n / 24, 'day') : fmt.plural(n, 'hour');
      }, 'Hours between pushes');
      var qs = ui.select(hours, v.quietStart != null ? Math.floor(num(v.quietStart)) : 22, { 'aria-label': 'Quiet hours start' });
      var qe = ui.select(hours, v.quietEnd != null ? Math.floor(num(v.quietEnd)) : 8, { 'aria-label': 'Quiet hours end' });
      return { el: h('div.form', ui.field('Minimum time between pushes to one device', gap),
        h('div.form-row', ui.field('Quiet hours start', qs, 'Device local time'), ui.field('Quiet hours end', qe, 'Pushes wait until this hour'))),
        read: function () { return { minGapHours: Math.max(0, Math.min(168, Math.floor(num(gap.value)))), quietStart: Math.floor(num(qs.value)), quietEnd: Math.floor(num(qe.value)) }; } };
    },

    'search-synonyms': function (value) {
      var v = obj(value);
      var items = Object.keys(v).map(function (k) { return { from: k, to: str(v[k]) }; });
      var l = itemList({
        items: items, max: 200, noun: 'Synonym', addLabel: 'Add synonym', reorder: false, empty: ['No synonyms', 'Add common misspellings or nicknames, e.g. “arjit” → “Arijit Singh”.'],
        title: function (it, i) { return it.from ? '“' + it.from + '” → “' + (it.to || '…') + '”' : 'Synonym ' + (i + 1); },
        blank: function () { return { from: '', to: '' }; },
        row: function (it, i) {
          return h('div.form-row',
            ui.field('When someone types', bind(ui.input({ value: it.from, maxlength: 60, placeholder: 'arjit', 'aria-label': 'Typed ' + (i + 1) }), it, 'from')),
            ui.field('Search for', bind(ui.input({ value: it.to, maxlength: 80, placeholder: 'Arijit Singh', 'aria-label': 'Meant ' + (i + 1) }), it, 'to')));
        }
      });
      return { el: h('div.form.wide', l.el),
        read: function () {
          var out = {};
          items.forEach(function (it, i) {
            var f = it.from.trim().toLowerCase(), t = it.to.trim();
            if (!f || !t) throw new Error('Synonym ' + (i + 1) + ' needs both words.');
            if (f === t.toLowerCase()) throw new Error('Synonym ' + (i + 1) + ' maps a word to itself.');
            if (out[f]) throw new Error('“' + f + '” is listed twice.');
            out[f] = t;
          });
          return out;
        } };
    },

    'catalog-sources': function (value) {
      var v = obj(value);
      var list = SOURCES.slice();
      Object.keys(v).forEach(function (k) { if (SLUG.test(k) && !list.some(function (s) { return s.id === k; })) list.push({ id: k, label: k, note: 'Set earlier.' }); });
      var toggles = {};
      var warn = ui.notice('Every source is off. The app ignores that and keeps them all on, so at least one stays reachable.', 'warn');
      function sync() { warn.hidden = Object.keys(toggles).some(function (k) { return toggles[k].input.checked; }); }
      var ul = h('ul.list', list.map(function (s) {
        var t = ui.toggle(s.label, v[s.id] !== false, sync, { 'aria-label': s.label });
        toggles[s.id] = t;
        return h('li', t, h('span.grow.muted.small', s.note), ui.mono(s.id));
      }));
      sync();
      return { el: h('div.form.wide', ui.notice('Switching a source off takes it out of every listener’s catalogue within a minute. The Health page checks each one.', 'info'), ul, warn),
        read: function () { var out = {}; Object.keys(toggles).forEach(function (k) { out[k] = toggles[k].input.checked; }); return out; } };
    },

    'language-order': function (value) {
      var cur = arr(value).filter(function (x) { return typeof x === 'string' && SLUG.test(x); });
      var all = cur.concat(LANGUAGES.filter(function (l) { return cur.indexOf(l) < 0; }));
      var items = all.map(function (l) { return { id: l }; });
      var list = orderList(items, { label: function (it) { return cap(it.id); } });
      return { el: h('div.form', ui.field('Languages', list.el, 'Home offers the language chips in this order (a listener’s pinned languages come first). The first ten are shown.')),
        read: function () { return items.map(function (it) { return it.id; }).slice(0, 20); } };
    }
  };

  /**
   * A form for a key without a dedicated one, built from its current value:
   * switches for true/false, number and text boxes, chips for lists of words,
   * and a section per nested group.
   */
  function autoForm(value) {
    function build(v, label, depth) {
      if (typeof v === 'boolean') { var t = ui.toggle(label, v); return { el: t, read: function () { return t.input.checked; } }; }
      if (typeof v === 'number') { var n = ui.input({ type: 'number', value: String(v), step: 'any' }); return { el: ui.field(label, n), read: function () { var x = Number(n.value); if (!isFinite(x)) throw new Error(label + ' must be a number.'); return x; } }; }
      if (typeof v === 'string') { var s = v.length > 80 ? ui.textarea({ value: v, rows: 3 }) : ui.input({ value: v }); return { el: ui.field(label, s), read: function () { return s.value; } }; }
      if (Array.isArray(v) && v.every(function (x) { return typeof x === 'string' || typeof x === 'number'; })) {
        var tg = tagInput({ values: v, max: 500, label: label });
        var numeric = v.length && v.every(function (x) { return typeof x === 'number'; });
        return { el: ui.field(label, tg.el), read: function () { return tg.read().map(function (x) { return numeric ? Number(x) : x; }); } };
      }
      if (v && typeof v === 'object' && !Array.isArray(v) && depth < 4) {
        var parts = Object.keys(v).map(function (k) { return { k: k, f: build(v[k], humanize(k), depth + 1) }; });
        var el = h(depth ? 'fieldset.auto-group' : 'div.form.wide', depth ? h('legend', label) : null, parts.map(function (p) { return p.f.el; }));
        return { el: el, read: function () { var o = {}; parts.forEach(function (p) { o[p.k] = p.f.read(); }); return o; } };
      }
      return { el: ui.field(label, h('div.muted.small', fmt.summary(v))), read: function () { return v; } };
    }
    if (value === undefined || value === null) return null;
    return build(value, 'Value', 0);
  }
  function humanize(k) { return cap(String(k).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').toLowerCase()); }

  /** One readable line for a stored value, for the history list. */
  function describe(key, v) {
    if (v === null || v === undefined) return 'Reset to default';
    var o = obj(v);
    switch (key) {
      case 'banners': return arr(v).length ? fmt.plural(arr(v).length, 'banner') + ': ' + arr(v).map(function (b) { return obj(b).title; }).filter(Boolean).join(', ') : 'No banners';
      case 'festival': return o.mode === 'force' || o.mode === 'on' ? 'Showing ' + festivalName(o.id) : o.mode === 'off' ? 'No festival skins' : 'Following the calendar';
      case 'greeting': case 'status-note': return '“' + str(o.text) + '”';
      case 'broadcast': return '“' + str(o.text) + '”' + (o.link ? ' → ' + o.link : '');
      case 'announcement': return '“' + str(o.title) + '”';
      case 'home-layout': return (arr(o.order).length ? 'Fixed order, ' + arr(o.order).slice(0, 3).map(shelfLabel).join(', ') + '…' : 'Order chosen by the app') + ' · ' + (arr(o.hidden).length ? fmt.num(arr(o.hidden).length) + ' hidden' : 'nothing hidden');
      case 'support-faq': return fmt.plural(arr(v).length, 'question');
      case 'flags': return Object.keys(o).map(function (k) { return humanize(k) + ' ' + (o[k] ? 'on' : 'off'); }).join(' · ') || 'No switches';
      case 'vinax-ai': return (o.enabled ? 'Open to everyone' : 'Testers only') + ' · ' + fmt.plural(arr(o.testers).length, 'tester') + ' · web search ' + (o.search === false ? 'off' : 'on');
      case 'personal-config': return (o.enabled === false ? 'Off' : 'On') + ' · composer ' + (o.composer === false ? 'off' : 'on') + ' · ' + fmt.plural(Object.keys(obj(o.weights)).length, 'weight') + ' changed';
      case 'ai-music': return o.enabled === false ? 'Music AI off' : 'Music AI on · song generation ' + (obj(o.generate).enabled ? 'on (' + fmt.num(obj(o.generate).dailyQuota || 5) + ' a day)' : 'off');
      case 'min-version': return 'Build ' + fmt.num(o.build);
      case 'site-mode': return o.mode === 'maintenance' ? 'Maintenance' + (o.note ? ': ' + o.note : '') : 'Live';
      case 'maintenance-window': return fmt.dateTime(o.start) + ' – ' + fmt.dateTime(o.end);
      case 'retention': return 'Keep events ' + fmt.plural(o.eventsDays, 'day');
      case 'push': return 'At most one per ' + fmt.plural(o.minGapHours, 'hour') + ' · quiet ' + pad2(num(o.quietStart)) + ':00–' + pad2(num(o.quietEnd)) + ':00';
      case 'search-synonyms': return fmt.plural(Object.keys(o).length, 'synonym');
      case 'catalog-sources': var off = Object.keys(o).filter(function (k) { return o[k] === false; }); return off.length ? fmt.num(off.length) + ' off: ' + off.join(', ') : 'Every source on';
      case 'language-order': return arr(v).slice(0, 5).map(cap).join(', ') + (arr(v).length > 5 ? '…' : '');
      default: return fmt.summary(v);
    }
  }

  /* ----------------------------------------------------------- page */
  function render(host, ctx) {
    return ui.load(host, function () { return VX.api.get('/api/admin/settings', null, { fresh: true }); }, function (d) {
      var gate = ui.gate(d, ctx);
      if (gate) return gate;
      var keys = arr(d.keys).filter(function (k) { return k && k.key; });
      if (!keys.length) return ui.empty('No setting keys reported', 'The Worker answered without its settings vocabulary.');
      var values = obj(d.values), updated = obj(d.updated);
      var current = keys.some(function (k) { return k.key === ctx.params.key; }) ? ctx.params.key : keys[0].key;
      var listHost = h('div');
      var editorHost = h('div.stack');
      var dirty = false;
      function isSet(k) { return values[k] !== undefined && values[k] !== null; }
      function drawList() {
        var groups = [];
        var byGroup = {};
        keys.forEach(function (k) { var g = k.group || 'Other'; if (!byGroup[g]) { byGroup[g] = []; groups.push(g); } byGroup[g].push(k); });
        var setCount = keys.filter(function (k) { return isSet(k.key); }).length;
        // Phones get a grouped dropdown instead of the long list.
        var picker = h('select.input', { 'aria-label': 'Setting' }, groups.map(function (g) {
          return h('optgroup', { label: g }, byGroup[g].map(function (k) { return h('option', { value: k.key, selected: k.key === current }, (k.title || k.key) + (isSet(k.key) ? ' · published' : ' · default')); }));
        }));
        picker.addEventListener('change', function () { choose(picker.value); picker.value = current; });
        function choose(key) {
          if (key === current) return;
          var go = function () { current = key; ctx.setParam('key', key); drawList(); drawEditor(); };
          if (!dirty) return go();
          return VX.confirm({ title: 'Discard unsaved changes?', body: 'Your edits to this setting have not been published.', danger: true, confirmLabel: 'Discard' }).then(function (yes) { if (yes) go(); });
        }
        VX.mount(listHost, h('div.key-picker', ui.field('Setting', picker, fmt.num(setCount) + ' of ' + fmt.num(keys.length) + ' settings published')), h('div.key-card', ui.card({ pad: false, body: h('div.key-nav',
          h('div.key-summary', h('strong', fmt.num(setCount)), ' of ' + fmt.num(keys.length) + ' settings published'),
          groups.map(function (g) {
            return [h('div.key-group', g), h('ul.key-list', byGroup[g].map(function (k) {
              var set = isSet(k.key);
              return h('li', h('button', { type: 'button', 'aria-current': String(k.key === current), onclick: function () { return choose(k.key); } },
                h('span.key-dot' + (set ? '.on' : ''), { 'aria-hidden': 'true' }),
                h('span.key-text', h('span.key-title', k.title || k.key), h('span.key-sub', set ? (obj(updated[k.key]).at ? 'Updated ' + fmt.ago(updated[k.key].at) : 'Live') : 'App default'))));
            }))];
          })) })));
      }
      function drawEditor(override) {
        var spec = keys.filter(function (k) { return k.key === current; })[0] || { key: current };
        var value = override !== undefined ? override : values[current];
        var up = obj(updated[current]);
        var form = FORMS[spec.key] ? FORMS[spec.key](value) : autoForm(value);
        var err = h('p.form-error', { role: 'alert' });
        var state = h('span.save-state');
        var baseline = null;
        var snap = function () { try { return JSON.stringify(form.read(), function (k, x) { return k === 'ts' ? undefined : x; }); } catch (e) { return '!' + e.message; } };
        dirty = override !== undefined;
        function refresh() {
          if (!form) return;
          if (baseline === null) baseline = snap();
          dirty = override !== undefined || snap() !== baseline;
          state.textContent = dirty ? 'Unsaved changes' : 'No changes';
          state.className = 'save-state' + (dirty ? ' dirty' : '');
          discard.disabled = !dirty;
        }
        var discard = ui.button('Discard changes', { kind: 'ghost', disabled: true, onClick: function () { dirty = false; drawEditor(); } });
        var formHost = h('div.form-host', form ? form.el : ui.empty('Nothing to edit yet', 'This setting is new to the console and has no value yet. Update the console to edit it.'));
        ['input', 'change', 'click'].forEach(function (ev) { formHost.addEventListener(ev, function () { setTimeout(refresh, 0); }); });
        function save() {
          var v;
          try { v = form.read(); } catch (e) { err.textContent = e.message; return Promise.resolve(); }
          err.textContent = '';
          var go = function () {
            return VX.api.post('/api/admin/settings', { key: spec.key, value: v }).then(function (res) {
              if (!res.ok) { err.textContent = res.error === 'unknown_key' ? 'The server does not know this setting.' : res.error === 'too_large' ? 'This is too large to publish (60 KB limit).' : res.message; return; }
              values[spec.key] = v; updated[spec.key] = { at: new Date().toISOString(), by: 'owner' };
              dirty = false;
              VX.toast('Published', 'ok'); drawList(); drawEditor();
            });
          };
          if (form.danger && form.danger()) {
            return VX.confirm({ title: 'Put the site in maintenance?', body: 'Every listener sees the gate within a minute and cannot browse or play until you set the mode back to Live.', danger: true, typed: 'MAINTENANCE', confirmLabel: 'Switch to maintenance' }).then(function (yes) { if (yes) return go(); });
          }
          return go();
        }
        function clear() {
          return VX.confirm({ title: 'Reset ' + (spec.title || spec.key) + ' to default?', body: 'The published value is removed and the app goes back to its built-in behaviour for this setting.', danger: true, confirmLabel: 'Reset' }).then(function (yes) {
            if (!yes) return;
            return VX.api.post('/api/admin/settings', { key: spec.key, value: null }).then(function (res) {
              if (!res.ok) { err.textContent = res.message; return; }
              delete values[spec.key]; delete updated[spec.key];
              dirty = false;
              VX.toast('Reset to default', 'ok'); drawList(); drawEditor();
            });
          });
        }
        var history = h('div');
        ui.load(history, function () { return VX.api.get('/api/admin/settings', { key: spec.key }, { fresh: true }); }, function (hd) {
          var rows = arr(hd.history);
          if (!rows.length) return ui.empty('No history yet', 'Every publish and reset of this setting is listed here.');
          return h('ul.list.history', rows.slice(0, 20).map(function (r) {
            var cleared = r.value === null || r.value === undefined;
            return h('li', h('span.feed-time', fmt.ago(r.at)), h('div.grow', h('div.cell-main', fmt.trunc(describe(spec.key, r.value), 120)), h('div.cell-sub', 'by ' + (r.by || 'owner') + ' · ' + fmt.dateTime(r.at))),
              !cleared && form ? ui.button('Load', { kind: 'ghost', small: true, icon: 'refresh', title: 'Load this version into the form', onClick: function () { drawEditor(r.value); VX.toast('Loaded into the form — press Publish to apply', 'ok'); } }) : null);
          }));
        }, { skeleton: 3 });
        var set = isSet(spec.key);
        VX.mount(editorHost,
          ui.card({
            title: spec.title || spec.key, sub: spec.note,
            actions: [set ? ui.pill('Published', 'ok') : ui.pill('App default')],
            body: h('div.stack',
              h('div.muted.small', up.at ? 'Last published ' + fmt.ago(up.at) + ' by ' + (up.by || 'owner') + ' · ' + fmt.dateTime(up.at) : 'Not published — the app uses its built-in behaviour.', override !== undefined ? [' ', ui.pill('Loaded from history, not published yet', 'warn')] : null),
              formHost, err,
              form ? h('div.save-bar',
                ui.button('Publish', { kind: 'primary', icon: 'upload', onClick: save }),
                discard,
                state,
                h('span.grow'),
                set ? ui.button('Reset to default', { kind: 'ghost', small: true, icon: 'trash', onClick: clear }) : null) : null)
          }),
          ui.card({ title: 'History', sub: 'The last 20 changes to this setting', body: history }));
        if (form) { refresh(); if (form.ready) form.ready.then(function () { baseline = null; refresh(); }); }
      }
      drawList(); drawEditor();
      return h('div.publish', listHost, editorHost);
    }, { skeleton: 8 });
  }
})();
