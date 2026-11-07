/* VinaX console — shared controls (console rebuild).
 *
 * Loaded right after core.js. Everything a page needs so the admin never
 * types a technical value: info tooltips, stat cards, "⋯" menus, radios,
 * checkboxes, sliders, chips, drag-to-reorder lists, search pickers (users,
 * songs, albums, playlists), date/time pickers in the console's time zone,
 * colour and image pickers, a phone preview, status chips, a full data table
 * (columns menu, rows per page, bulk actions, row menus, CSV/Excel export,
 * server paging) and friendly empty states.
 *
 * Rules every control follows: text is always text (VX.h), every control has
 * a visible label or aria-label, keyboard works, and nothing throws on empty
 * input. See docs/admin-console.md → "Controls".
 */
(function () {
  'use strict';
  var VX = window.VX, h = VX.h, ui = VX.ui, fmt = VX.fmt, icon = VX.icon;

  /* ------------------------------------------------------------ who am I */

  /** The signed-in admin: { email, name, picture, role: viewer|editor|owner, via }. Set by app.js. */
  VX.me = VX.me || null;
  var RANK = { viewer: 0, editor: 1, owner: 2 };
  /** VX.can('edit') — editor or owner; VX.can('owner') — owner only. */
  VX.can = function (what) {
    var role = (VX.me && VX.me.role) || 'viewer';
    var need = what === 'owner' ? 'owner' : what === 'view' ? 'viewer' : 'editor';
    return RANK[role] >= RANK[need];
  };
  /** A small notice for viewers explaining why controls are locked. */
  ui.readOnlyNote = function (what) {
    return VX.can(what || 'edit') ? null : ui.notice(what === 'owner'
      ? 'Only an Owner can change this. You can look at everything here.'
      : 'You have view-only access. Ask an Owner for the Editor role to make changes.', 'info');
  };

  /** Copy text and say so. */
  VX.copy = function (text, what) {
    var done = function () { VX.toast((what || 'Copied') + ' ✓', 'ok'); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(String(text)).then(done, function () { VX.toast('Could not copy — select and copy by hand.', 'bad'); });
    } catch (e) {}
    VX.toast('Could not copy — select and copy by hand.', 'bad');
    return Promise.resolve();
  };

  /** Friendly names for platforms and languages. */
  VX.platformName = function (p) { return ({ android: 'Android', web: 'Web', ios: 'iOS' })[String(p || 'web').toLowerCase()] || fmt.label(p || 'web'); };
  /* Schema 13: the kind of device — an app, or a browser on a system. The
   * same keys as the database's _device_key(). */
  var DEVICE_NAMES = { 'android-app': 'Android app', 'ios-app': 'iOS app', 'android-web': 'Android web', 'ios-web': 'iPhone web', 'ipados-web': 'iPad web', 'macos-web': 'Mac web', 'windows-web': 'Windows web', 'linux-web': 'Linux web', 'chromeos-web': 'ChromeOS web', 'other-web': 'Other web' };
  VX.DEVICES = Object.keys(DEVICE_NAMES);
  VX.deviceKey = function (platform, os) {
    var p = String(platform || 'web').toLowerCase();
    if (p === 'android') return 'android-app';
    if (p === 'ios') return 'ios-app';
    return DEVICE_NAMES[os + '-web'] ? os + '-web' : 'other-web';
  };
  VX.deviceName = function (key) { return DEVICE_NAMES[key] || VX.platformName(key); };
  /** The platform (android | ios | web) a device key belongs to; a plain platform stays itself. */
  VX.devicePlatform = function (key) { return key === 'android-app' ? 'android' : key === 'ios-app' ? 'ios' : /-web$/.test(String(key || '')) ? 'web' : key || ''; };
  /** "Android app", "Mac web · Chrome" — for a row or device with platform / os / browser / device. */
  VX.deviceText = function (d) {
    d = d || {};
    var key = d.device || VX.deviceKey(d.platform, d.os);
    return VX.deviceName(key) + (/-web$/.test(key) && d.browser ? ' · ' + d.browser : '');
  };
  /** Listening time: "45 min", "3 h 12 min", "under a minute". */
  VX.listenText = function (sec) {
    var v = Math.max(0, Math.round(Number(sec) || 0));
    if (!v) return '0 min';
    if (v < 60) return 'under a minute';
    var m = Math.round(v / 60);
    if (m < 60) return m + ' min';
    var hrs = Math.floor(m / 60), min = m % 60;
    return fmt.num(hrs) + ' h' + (min ? ' ' + min + ' min' : '');
  };
  var LANGS = { te: 'Telugu', telugu: 'Telugu', hi: 'Hindi', hindi: 'Hindi', ta: 'Tamil', tamil: 'Tamil', kn: 'Kannada', kannada: 'Kannada', ml: 'Malayalam', malayalam: 'Malayalam', en: 'English', english: 'English', pa: 'Punjabi', punjabi: 'Punjabi', bn: 'Bengali', bengali: 'Bengali', mr: 'Marathi', marathi: 'Marathi', gu: 'Gujarati', gujarati: 'Gujarati', ur: 'Urdu', urdu: 'Urdu', bhojpuri: 'Bhojpuri', bho: 'Bhojpuri', unknown: 'Not known' };
  VX.langName = function (l) { if (!l) return 'Not known'; var k = String(l).toLowerCase(); return LANGS[k] || LANGS[k.split('-')[0]] || fmt.label(l); };

  /* ------------------------------------------------------------ tooltips */

  /** ⓘ button with a plain-English explanation (hover, focus or tap). */
  ui.info = function (text, label) {
    var tip = h('span.tip', { role: 'tooltip' }, text);
    var b = h('button.info-btn', { type: 'button', 'aria-label': (label ? label + ': ' : 'What is this? ') + text, onclick: function (e) { e.stopPropagation(); b.classList.toggle('open'); } }, h('span', { 'aria-hidden': 'true' }, 'i'), tip);
    b.addEventListener('blur', function () { b.classList.remove('open'); });
    return b;
  };

  /* ---------------------------------------------------------- stat cards */

  /**
   * Stat cards. items = [{ label, value, info (required: what it counts),
   *   delta (number % change), deltaLabel ('vs last week'), inverse (down is good),
   *   sub, tone, spark: [n], onClick, loading }]
   */
  ui.stats = function (items) {
    return h('div.kpis.stats', items.filter(Boolean).map(function (k) {
      var delta = null;
      if (k.delta != null && isFinite(k.delta)) {
        var d = Math.round(k.delta);
        var good = k.inverse ? d < 0 : d > 0;
        delta = h('span.delta' + (d === 0 ? '' : good ? '.up' : '.down'), (d > 0 ? '▲ ' : d < 0 ? '▼ ' : '') + Math.abs(d) + '%' + (k.deltaLabel ? ' ' + k.deltaLabel : ''));
      }
      var tag = k.onClick ? 'button' : 'div';
      var card = h(tag + '.kpi.stat' + (k.tone ? '.tone-' + k.tone : '') + (k.onClick ? '.clickable' : ''), k.onClick ? { type: 'button', onclick: k.onClick, title: 'Open details' } : {},
        h('div.kpi-label', h('span', k.label)),
        h('div.kpi-value', k.loading ? h('span.sk-line', { style: { width: '60%', display: 'inline-block' } }) : (k.value == null || k.value === '' ? '—' : k.value)),
        h('div.kpi-foot', delta, k.sub ? h('span.kpi-sub', k.sub) : null),
        k.spark && k.spark.length > 1 && k.spark.some(function (v) { return Number(v) > 0; }) ? ui.spark(k.spark) : null);
      // The ⓘ sits beside the card so it is not a button inside a button.
      return h('div.stat-wrap', card, k.info ? h('span.stat-info', ui.info(k.info, k.label)) : null);
    }));
  };
  /** Percent change from prev to cur, or null when there is nothing to compare. */
  VX.change = function (cur, prev) { cur = Number(cur) || 0; prev = Number(prev) || 0; if (!prev) return cur ? null : null; return ((cur - prev) / prev) * 100; };

  /* ---------------------------------------------------------- "⋯" menus */

  var openMenu = null;
  function closeMenus() { if (openMenu) { openMenu.close(); openMenu = null; } }
  document.addEventListener('click', function (e) { if (openMenu && !openMenu.root.contains(e.target)) closeMenus(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && openMenu) { var b = openMenu.btn; closeMenus(); if (b) b.focus(); } }, true);

  /**
   * Action menu. items = [{ label, icon, onClick, danger, disabled, hidden }, '-' for a divider].
   * o = { label: 'Actions for X', text: optional button text, icon: 'more' }
   */
  ui.menu = function (items, o) {
    o = o || {};
    var list = h('div.menu-pop', { role: 'menu', hidden: true });
    var btn = h('button' + (o.text ? '.btn.ghost.sm' : '.icon-btn.more-btn'), { type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': o.label || 'More actions', title: o.label || 'More actions' },
      o.text ? [o.icon ? icon(o.icon) : null, h('span', o.text), icon('down')] : h('span.dots', { 'aria-hidden': 'true' }, '⋯'));
    var root = h('div.menu', btn, list);
    var me = {
      root: root, btn: btn,
      close: function () { list.hidden = true; btn.setAttribute('aria-expanded', 'false'); root.classList.remove('open'); }
    };
    function build() {
      VX.clear(list);
      (typeof items === 'function' ? items() : items).filter(function (it) { return it && !it.hidden; }).forEach(function (it) {
        if (it === '-') { list.appendChild(h('div.menu-sep', { role: 'separator' })); return; }
        list.appendChild(h('button.menu-item' + (it.danger ? '.danger' : ''), { type: 'button', role: 'menuitem', disabled: it.disabled, title: it.title, onclick: function (e) {
          e.stopPropagation(); closeMenus(); if (it.onClick) it.onClick(e);
        } }, it.icon ? icon(it.icon) : h('span.ic'), h('span', it.label)));
      });
    }
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (!list.hidden) { closeMenus(); return; }
      closeMenus(); build();
      list.hidden = false; btn.setAttribute('aria-expanded', 'true'); root.classList.add('open');
      openMenu = me;
      // Keep the pop-up inside the window.
      var r = btn.getBoundingClientRect ? btn.getBoundingClientRect() : null;
      list.classList.toggle('up', !!(r && window.innerHeight && r.bottom + 260 > window.innerHeight && r.top > 260));
      list.classList.toggle('left', !!(r && window.innerWidth && r.right < 240));
      var first = list.querySelector('.menu-item:not([disabled])'); if (first) first.focus();
    });
    list.addEventListener('keydown', function (e) {
      var all = VX.$$('.menu-item:not([disabled])', list), i = all.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); (all[i + 1] || all[0]).focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); (all[i - 1] || all[all.length - 1]).focus(); }
      else if (e.key === 'Tab') closeMenus();
    });
    return root;
  };

  /* ------------------------------------------------- choice controls */

  /** Dropdown with a label. options = [{ value, label }] | ['a', 'b']; onChange(value). */
  ui.dropdown = function (label, options, value, onChange, o) {
    o = o || {};
    var sel = ui.select(options, value, { 'aria-label': label, disabled: o.disabled });
    sel.addEventListener('change', function () { onChange(sel.value); });
    if (o.bare) return sel;
    return h('label.dd' + (o.inline ? '.inline' : ''), h('span.dd-label', label), sel);
  };

  /** Radio group. options = [{ value, label, hint }]. Returns element with .value(). */
  ui.radios = function (label, options, value, onChange, o) {
    o = o || {};
    var name = ui.id('r');
    var cur = value;
    var wrap = h('fieldset.radios' + (o.cards ? '.cards' : '') + (o.row ? '.row' : ''), { disabled: o.disabled }, h('legend', label),
      options.map(function (opt) {
        var inp = h('input', { type: 'radio', name: name, value: String(opt.value), checked: String(opt.value) === String(value) });
        inp.addEventListener('change', function () { if (inp.checked) { cur = opt.value; onChange(opt.value); } });
        return h('label.radio', inp, h('span.radio-text', h('span.radio-label', opt.label), opt.hint ? h('span.radio-hint', opt.hint) : null));
      }));
    wrap.value = function () { return cur; };
    return wrap;
  };

  /** Checkbox group. options = [{ value, label }]; values = [..]; onChange(newValues). */
  ui.checks = function (label, options, values, onChange, o) {
    o = o || {};
    var set = (values || []).map(String);
    return h('fieldset.checks' + (o.row ? '.row' : ''), { disabled: o.disabled }, h('legend', label),
      options.map(function (opt) {
        var inp = h('input', { type: 'checkbox', value: String(opt.value), checked: set.indexOf(String(opt.value)) >= 0 });
        inp.addEventListener('change', function () {
          var v = String(opt.value);
          set = set.filter(function (x) { return x !== v; });
          if (inp.checked) set.push(v);
          onChange(options.map(function (x) { return String(x.value); }).filter(function (x) { return set.indexOf(x) >= 0; }));
        });
        return h('label.check', inp, h('span', opt.label));
      }));
  };

  /** A single checkbox. */
  ui.checkbox = function (label, checked, onChange, o) {
    var inp = h('input', { type: 'checkbox', checked: !!checked, disabled: o && o.disabled });
    inp.addEventListener('change', function () { onChange(inp.checked); });
    return h('label.check.single', inp, h('span', label));
  };

  /**
   * Slider. o = { label, min, max, step, value, format(v) → text, onChange(v), hint, marks: [leftText, rightText] }
   */
  ui.slider = function (o) {
    var out = h('output.range-val', o.format ? o.format(o.value) : String(o.value));
    var inp = h('input.range', { type: 'range', min: o.min, max: o.max, step: o.step || 1, value: o.value, 'aria-label': o.label, disabled: o.disabled });
    inp.addEventListener('input', function () { var v = Number(inp.value); out.textContent = o.format ? o.format(v) : String(v); if (o.onChange) o.onChange(v); });
    return h('div.slider',
      h('div.slider-top', h('span.slider-label', o.label), out),
      inp,
      o.marks ? h('div.slider-marks', h('span', o.marks[0]), h('span', o.marks[1])) : null,
      o.hint ? h('p.field-hint', o.hint) : null);
  };

  /** Toggle row: a switch with a bold title and a one-line plain description. */
  ui.switchRow = function (title, desc, checked, onChange, o) {
    o = o || {};
    var t = ui.toggle('', checked, onChange, { 'aria-label': title, disabled: o.disabled });
    return h('div.switch-row' + (o.dim ? '.dim' : ''), h('div.switch-text', h('strong', title), desc ? h('p.muted', desc) : null), t);
  };

  /* ------------------------------------------------------------- chips */

  /** Removable chips. items = [{ id, label, img, sub }]; onRemove(id). */
  ui.chips = function (items, onRemove, o) {
    o = o || {};
    if (!items.length) return h('p.muted.small', o.empty || 'None yet.');
    return h('ul.chip-list', items.map(function (it) {
      return h('li.chip',
        it.img !== undefined ? ui.media(it.img, null, null, true).firstChild : null,
        h('span.chip-text', h('span', it.label), it.sub ? h('span.chip-sub', it.sub) : null),
        onRemove && !o.disabled ? h('button.chip-x', { type: 'button', 'aria-label': 'Remove ' + it.label, onclick: function () { onRemove(it.id); } }, icon('close')) : null);
    }));
  };

  /* ---------------------------------------------------- drag to reorder */

  /**
   * Reorderable list: drag with the handle, or use the ↑ ↓ buttons (keyboard).
   * o = { items, key(item) → id, render(item, index) → node, onChange(newItems), disabled, label }
   */
  ui.sortable = function (o) {
    var items = (o.items || []).slice();
    var list = h('ol.sortable', { 'aria-label': o.label || 'Drag to reorder' });
    var dragFrom = null;
    function move(from, to) {
      if (to < 0 || to >= items.length || from === to) return;
      var it = items.splice(from, 1)[0];
      items.splice(to, 0, it);
      draw();
      if (o.onChange) o.onChange(items.slice());
      var btns = VX.$$('.sort-row', list)[to]; if (btns) { var f = btns.querySelector('.sort-handle'); if (f) f.focus(); }
    }
    function draw() {
      VX.clear(list);
      if (!items.length) { list.appendChild(h('li.sort-empty.muted', o.empty || 'Nothing here yet.')); return; }
      items.forEach(function (it, i) {
        var handle = h('button.sort-handle', { type: 'button', 'aria-label': 'Move ' + (o.name ? o.name(it) : 'item ' + (i + 1)) + '. Use arrow keys.', title: 'Drag to reorder', disabled: o.disabled }, h('span', { 'aria-hidden': 'true' }, '⠿'));
        handle.addEventListener('keydown', function (e) {
          if (e.key === 'ArrowUp') { e.preventDefault(); move(i, i - 1); }
          else if (e.key === 'ArrowDown') { e.preventDefault(); move(i, i + 1); }
        });
        var li = h('li.sort-row', { draggable: o.disabled ? null : 'true' },
          handle,
          h('span.sort-pos', String(i + 1)),
          h('div.sort-body', o.render(it, i)),
          o.disabled ? null : h('span.sort-moves',
            h('button.icon-btn.sm', { type: 'button', 'aria-label': 'Move up', title: 'Move up', disabled: i === 0, onclick: function () { move(i, i - 1); } }, icon('up')),
            h('button.icon-btn.sm', { type: 'button', 'aria-label': 'Move down', title: 'Move down', disabled: i === items.length - 1, onclick: function () { move(i, i + 1); } }, icon('down'))));
        li.addEventListener('dragstart', function (e) { dragFrom = i; li.classList.add('dragging'); try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); } catch (x) {} });
        li.addEventListener('dragend', function () { li.classList.remove('dragging'); dragFrom = null; VX.$$('.drop-before', list).forEach(function (x) { x.classList.remove('drop-before'); }); });
        li.addEventListener('dragover', function (e) { if (dragFrom === null) return; e.preventDefault(); li.classList.add('drop-before'); });
        li.addEventListener('dragleave', function () { li.classList.remove('drop-before'); });
        li.addEventListener('drop', function (e) { e.preventDefault(); li.classList.remove('drop-before'); if (dragFrom !== null) move(dragFrom, i); });
        list.appendChild(li);
      });
    }
    draw();
    list.set = function (next) { items = (next || []).slice(); draw(); };
    return list;
  };

  /* ------------------------------------------------------ search picker */

  /**
   * Search-as-you-type picker. o = {
   *   label, placeholder, search(q) → Promise<items>, render(item) → node,
   *   onPick(item), minChars (2), empty: 'No matches'
   * }
   */
  ui.picker = function (o) {
    var listId = ui.id('pk');
    var inp = h('input.input', { type: 'search', placeholder: o.placeholder || 'Type to search…', 'aria-label': o.label || 'Search', role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-controls': listId, autocomplete: 'off', disabled: o.disabled });
    var list = h('ul.picker-list', { id: listId, role: 'listbox', hidden: true });
    var timer = null, seq = 0, shown = [], sel = -1;
    function close() { list.hidden = true; inp.setAttribute('aria-expanded', 'false'); }
    function pick(it) { close(); inp.value = ''; if (o.onPick) o.onPick(it); }
    function draw(state) {
      VX.clear(list);
      list.hidden = false; inp.setAttribute('aria-expanded', 'true');
      if (state) { list.appendChild(h('li.picker-state.muted', state)); return; }
      if (!shown.length) { list.appendChild(h('li.picker-state.muted', o.empty || 'No matches')); return; }
      shown.forEach(function (it, i) {
        list.appendChild(h('li.picker-opt', { role: 'option', 'aria-selected': String(i === sel), onmousedown: function (e) { e.preventDefault(); pick(it); } }, o.render(it)));
      });
    }
    inp.addEventListener('input', function () {
      clearTimeout(timer);
      var q = inp.value.trim();
      if (q.length < (o.minChars == null ? 2 : o.minChars)) { close(); return; }
      timer = setTimeout(function () {
        var my = ++seq;
        draw('Searching…');
        Promise.resolve(o.search(q)).then(function (items) {
          if (my !== seq) return;
          shown = (items || []).slice(0, 12); sel = shown.length ? 0 : -1; draw();
        }, function () { if (my === seq) draw('Search failed — try again.'); });
      }, 250);
    });
    inp.addEventListener('keydown', function (e) {
      if (list.hidden) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, shown.length - 1); draw(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); draw(); }
      else if (e.key === 'Enter' && shown[sel]) { e.preventDefault(); pick(shown[sel]); }
      else if (e.key === 'Escape') { e.stopPropagation(); close(); }
    });
    inp.addEventListener('blur', function () { setTimeout(close, 150); });
    return h('div.picker', o.label && !o.hideLabel ? h('label.field-label', { for: inp.id = ui.id('pki') }, o.label) : null, h('div.picker-box', icon('search'), inp), list);
  };

  /** Find signed-in users by name or email → [{ id, name, email, picture }]. */
  VX.findUsers = function (q) {
    return VX.api.get('/api/admin/listeners', { q: q, limit: 12 }).then(function (res) {
      return VX.arr(res.data && res.data.rows).filter(function (r) { return r.id || r.accountId; }).map(function (r) {
        return { id: r.id || r.accountId, name: r.name || null, email: r.email || null, picture: r.picture || null };
      });
    });
  };
  /** Picker for a signed-in user (photo, name, email). */
  ui.userPicker = function (o) {
    return ui.picker(Object.assign({ placeholder: 'Search by name or email…', label: 'Find a user', search: VX.findUsers,
      render: function (u) { return ui.media(u.picture, u.name || u.email || 'User', u.name ? u.email : null, true); } }, o));
  };

  /** Find music in the catalogue. type: songs | albums | artists | playlists → [{ id, title, sub, image, type }]. */
  VX.findMusic = function (q, type) {
    var t = type || 'songs';
    // The route takes type=songs|albums|artists|playlists (kind=song|album kept for old callers).
    return VX.api.get('/api/admin/catalog-search', { q: q, type: t, kind: t === 'albums' ? 'album' : 'song', limit: 12 }).then(function (res) {
      var d = res.data || {};
      var rows = VX.arr(d.items || d.results || d.rows || d.data);
      return rows.map(function (r) {
        return {
          id: String(r.id || r.songId || ''), type: type || 'songs',
          title: r.title || r.name || 'Untitled',
          sub: r.artist || r.subtitle || r.primaryArtists || r.description || null,
          image: r.image || r.img || null,
          preview: r.preview || r.previewUrl || null,
          raw: r
        };
      }).filter(function (r) { return r.id; });
    });
  };
  /** Picker for a song / album / playlist / artist. o.type = 'songs' | 'albums' | 'playlists' | 'artists'. */
  ui.musicPicker = function (o) {
    var type = o.type || 'songs';
    var noun = { songs: 'song', albums: 'album', playlists: 'playlist', artists: 'artist' }[type] || 'item';
    return ui.picker(Object.assign({ placeholder: 'Search for a ' + noun + '…', label: 'Find a ' + noun,
      search: function (q) { return VX.findMusic(q, type); },
      render: function (m) { return ui.media(m.image, m.title, m.sub, type === 'artists'); } }, o));
  };

  /* ------------------------------------------------ dates and times */

  function parts(d) {
    var f = new Intl.DateTimeFormat('en-CA', { timeZone: VX.tz(), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
    var o = {};
    f.formatToParts(d).forEach(function (p) { o[p.type] = p.value; });
    if (o.hour === '24') o.hour = '00';
    return o;
  }
  /** Offset in minutes of the console time zone at a moment. */
  function tzOffset(ms) {
    var p = parts(new Date(ms));
    var asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
    return Math.round((asUtc - Math.floor(ms / 60000) * 60000) / 60000);
  }
  VX.time = {
    /** ISO → "YYYY-MM-DDTHH:MM" in the console time zone (for datetime-local inputs). */
    toInput: function (iso) { if (!iso) return ''; var d = new Date(iso); if (isNaN(d)) return ''; var p = parts(d); return p.year + '-' + p.month + '-' + p.day + 'T' + p.hour + ':' + p.minute; },
    /** "YYYY-MM-DDTHH:MM" in the console time zone → ISO (UTC). */
    fromInput: function (v) {
      var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(v || ''));
      if (!m) return null;
      var guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
      var ms = guess - tzOffset(guess) * 60000;
      ms = guess - tzOffset(ms) * 60000; // second pass settles DST edges
      return new Date(ms).toISOString();
    },
    /** Today's date "YYYY-MM-DD" in the console time zone. */
    today: function () { var p = parts(new Date()); return p.year + '-' + p.month + '-' + p.day; },
    /** ISO or date → "YYYY-MM-DD" in the console time zone. */
    toDate: function (iso) { if (!iso) return ''; if (/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) return String(iso); var d = new Date(iso); if (isNaN(d)) return ''; var p = parts(d); return p.year + '-' + p.month + '-' + p.day; },
    /** "HH:MM" now in the console time zone. */
    nowHm: function () { var p = parts(new Date()); return p.hour + ':' + p.minute; }
  };

  /** Date picker (calendar). value "YYYY-MM-DD" | ''; onChange("YYYY-MM-DD" | ''). */
  ui.datePicker = function (label, value, onChange, o) {
    o = o || {};
    var inp = h('input.input', { type: 'date', value: value || '', min: o.min, max: o.max, 'aria-label': label, disabled: o.disabled });
    inp.addEventListener('change', function () { onChange(inp.value || ''); });
    return o.bare ? inp : ui.field(label, inp, o.hint);
  };
  /** Time picker. value "HH:MM"; onChange("HH:MM"). */
  ui.timePicker = function (label, value, onChange, o) {
    o = o || {};
    var inp = h('input.input', { type: 'time', value: value || '', step: 60, 'aria-label': label, disabled: o.disabled });
    inp.addEventListener('change', function () { onChange(inp.value || ''); });
    return o.bare ? inp : ui.field(label + ' (' + VX.tzShort() + ')', inp, o.hint);
  };
  /** Date and time picker in the console time zone. value ISO | null; onChange(ISO | null). */
  ui.dateTimePicker = function (label, value, onChange, o) {
    o = o || {};
    var inp = h('input.input', { type: 'datetime-local', value: VX.time.toInput(value), 'aria-label': label, disabled: o.disabled, min: o.min ? VX.time.toInput(o.min) : null });
    inp.addEventListener('change', function () { onChange(VX.time.fromInput(inp.value)); });
    return o.bare ? inp : ui.field(label + ' (' + VX.tzShort() + ')', inp, o.hint);
  };
  /** Start and end date pickers side by side. value = { start, end } as "YYYY-MM-DD". */
  ui.dateRange = function (value, onChange, o) {
    o = o || {};
    var v = { start: (value && value.start) || '', end: (value && value.end) || '' };
    return h('div.form-row.date-range',
      ui.datePicker(o.startLabel || 'Starts on', v.start, function (x) { v.start = x; onChange({ start: v.start, end: v.end }); }, { disabled: o.disabled, hint: o.startHint || 'Leave empty to start now' }),
      ui.datePicker(o.endLabel || 'Ends on', v.end, function (x) { v.end = x; onChange({ start: v.start, end: v.end }); }, { disabled: o.disabled, min: v.start || null, hint: o.endHint || 'Leave empty to keep it on' }));
  };

  /** Colour picker. value "#rrggbb". */
  ui.colorPicker = function (label, value, onChange, o) {
    var inp = h('input.color', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(value || '') ? value : '#f2a33a', 'aria-label': label, disabled: o && o.disabled });
    var code = h('span.muted.small', inp.value);
    inp.addEventListener('input', function () { code.textContent = inp.value; onChange(inp.value); });
    return h('label.color-field', h('span.dd-label', label), h('span.color-box', inp, code));
  };

  /* --------------------------------------------------------- pictures */

  /**
   * Image upload with a crop preview. The picture is cropped to `aspect`
   * (width / height) and resized in the browser, then stored by the server.
   * o = { label, value: url | null, aspect: 2, width: 1200, purpose: 'banner', onChange(url | null), disabled }
   */
  ui.imageUpload = function (o) {
    var aspect = o.aspect || 2, W = o.width || 1200;
    var cur = o.value || null;
    var preview = h('div.img-preview', { style: { 'aspect-ratio': String(aspect) } });
    var status = h('p.field-hint');
    var file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true });
    function show() {
      VX.clear(preview);
      if (cur && /^https:\/\//.test(cur)) preview.appendChild(h('img', { src: cur, alt: 'Chosen picture', referrerpolicy: 'no-referrer' }));
      else preview.appendChild(h('span.muted', 'No picture yet'));
    }
    function crop(img, offsetPct) {
      var c = document.createElement('canvas');
      var Hh = Math.round(W / aspect);
      c.width = W; c.height = Hh;
      var sw = img.naturalWidth, sh = img.naturalHeight;
      var srcAspect = sw / sh;
      var cw, ch, cx, cy;
      if (srcAspect > aspect) { ch = sh; cw = sh * aspect; cy = 0; cx = (sw - cw) * offsetPct; }
      else { cw = sw; ch = sw / aspect; cx = 0; cy = (sh - ch) * offsetPct; }
      var g = c.getContext && c.getContext('2d');
      if (!g) return null;
      g.drawImage(img, cx, cy, cw, ch, 0, 0, W, Hh);
      return c.toDataURL('image/jpeg', 0.85);
    }
    function upload(dataUrl) {
      status.textContent = 'Uploading…';
      return VX.api.post('/api/admin/upload', { data: dataUrl, purpose: o.purpose || 'other' }, { timeout: 40000 }).then(function (res) {
        if (!res.ok || !res.data || !res.data.url) { status.textContent = res.message || 'Upload failed — try again.'; VX.toast('Picture upload failed — ' + (res.message || 'try again'), 'bad'); return; }
        cur = res.data.url; show(); status.textContent = 'Picture saved ✓'; o.onChange(cur);
      });
    }
    file.addEventListener('change', function () {
      var f = file.files && file.files[0];
      file.value = '';
      if (!f) return;
      if (!/^image\/(png|jpeg|webp)$/.test(f.type)) { status.textContent = 'Choose a PNG, JPG or WebP picture.'; return; }
      if (f.size > 15 * 1024 * 1024) { status.textContent = 'That picture is over 15 MB. Choose a smaller one.'; return; }
      var url = URL.createObjectURL(f);
      var img = new Image();
      img.onload = function () {
        var pos = 0.5;
        var canvasPreview = h('img.crop-img', { alt: 'Crop preview' });
        var redraw = function () { var d = crop(img, pos); if (d) canvasPreview.src = d; };
        redraw();
        var m = VX.modal({
          title: 'Crop the picture', wide: true,
          body: [
            h('p.muted', 'This is exactly how it will look. Slide to choose which part shows.'),
            h('div.crop-frame', { style: { 'aspect-ratio': String(aspect) } }, canvasPreview),
            ui.slider({ label: 'Position', min: 0, max: 100, value: 50, format: function (v) { return v < 34 ? 'Start' : v > 66 ? 'End' : 'Middle'; }, onChange: function (v) { pos = v / 100; redraw(); } })
          ],
          onClose: function () { URL.revokeObjectURL(url); },
          actions: [
            { label: 'Cancel', kind: 'ghost' },
            { label: 'Use this picture', kind: 'primary', onClick: function (close) { var d = crop(img, pos); close(); if (d) upload(d); } }
          ]
        });
        void m;
      };
      img.onerror = function () { URL.revokeObjectURL(url); status.textContent = 'That file could not be opened as a picture.'; };
      img.src = url;
    });
    show();
    return h('div.img-upload',
      h('span.field-label', o.label || 'Picture'),
      preview,
      h('div.toolbar',
        file,
        ui.button(cur ? 'Change picture' : 'Upload picture', { kind: 'ghost', small: true, icon: 'upload', disabled: o.disabled, onClick: function () { file.click(); } }),
        cur ? ui.button('Remove', { kind: 'ghost', small: true, icon: 'trash', disabled: o.disabled, onClick: function () { cur = null; show(); status.textContent = ''; o.onChange(null); } }) : null),
      status);
  };

  /* ---------------------------------------------------------- previews */

  /** A phone frame for live previews. */
  ui.phone = function (children, o) {
    o = o || {};
    return h('div.phone' + (o.small ? '.small' : ''), { role: 'img', 'aria-label': o.label || 'Preview on a phone' },
      h('div.phone-notch', { 'aria-hidden': 'true' }),
      h('div.phone-screen', children));
  };

  /** Settings status chip: 'live' | 'builtin' | 'unsaved'. */
  ui.statusChip = function (state) {
    if (state === 'unsaved') return h('span.status-chip.unsaved', h('span.dot', { 'aria-hidden': 'true' }), 'Unsaved changes');
    if (state === 'live') return h('span.status-chip.live', h('span.dot', { 'aria-hidden': 'true' }), 'Live in app');
    return h('span.status-chip.builtin', h('span.dot', { 'aria-hidden': 'true' }), "Using app's built-in setting");
  };

  /* ------------------------------------------------------ empty states */

  function illustration() {
    var s = VX.svg;
    return s('svg', { class: 'empty-art', viewBox: '0 0 120 80', 'aria-hidden': 'true' },
      s('rect', { x: 18, y: 18, width: 84, height: 50, rx: 8, class: 'ea-card' }),
      s('rect', { x: 28, y: 30, width: 40, height: 6, rx: 3, class: 'ea-line' }),
      s('rect', { x: 28, y: 42, width: 60, height: 6, rx: 3, class: 'ea-line soft' }),
      s('rect', { x: 28, y: 54, width: 30, height: 6, rx: 3, class: 'ea-line soft' }),
      s('circle', { cx: 92, cy: 20, r: 10, class: 'ea-dot' }),
      s('path', { d: 'M88 20l3 3 5-6', class: 'ea-tick' }));
  }
  /** Friendly empty state: a sentence, a small picture and an optional button { label, onClick, icon }. */
  ui.emptyState = function (title, hint, action) {
    return h('div.state.empty.friendly', illustration(), h('strong', title || 'Nothing here yet'), hint ? h('p', hint) : null,
      action ? (action.nodeType ? action : ui.button(action.label, { kind: 'primary', small: true, icon: action.icon, onClick: action.onClick })) : null);
  };
  // Every page's empty state gets the picture.
  ui.empty = function (title, hint, action) { return ui.emptyState(title, hint, action); };

  /** A card-shaped loading skeleton. */
  ui.loadingCards = function (n) {
    var out = [];
    for (var i = 0; i < (n || 4); i++) out.push(h('div.kpi.stat.sk-card', { 'aria-hidden': 'true' }, h('div.sk-line', { style: { width: '50%' } }), h('div.sk-line.big', { style: { width: '70%' } })));
    return h('div', h('div.kpis', out), ui.skeleton(5));
  };
  // Loading states are skeletons by default (never a blank screen).
  var baseLoad = ui.load;
  ui.load = function (host, fetcher, render, o) { return baseLoad(host, fetcher, render, Object.assign({ skeleton: 5 }, o)); };

  /* ------------------------------------------------------- Excel export */

  function xmlEsc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  /** Excel workbook (SpreadsheetML 2003 — opens in Excel, Numbers and Sheets). */
  VX.download.xls = function (name, rows, columns) {
    rows = rows || [];
    var cols = columns || (rows[0] ? Object.keys(rows[0]).map(function (k) { return { key: k, label: k }; }) : []);
    var cell = function (v) {
      if (v == null) return '<Cell><Data ss:Type="String"></Data></Cell>';
      if (typeof v === 'object') v = fmt.summary(v);
      var n = typeof v === 'number' && isFinite(v);
      var str = String(v);
      if (!n && /^[=+\-@]/.test(str)) str = "'" + str;
      return '<Cell><Data ss:Type="' + (n ? 'Number' : 'String') + '">' + xmlEsc(str) + '</Data></Cell>';
    };
    var lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<?mso-application progid="Excel.Sheet"?>',
      '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">',
      '<Worksheet ss:Name="VinaX"><Table>',
      '<Row>' + cols.map(function (c) { return cell(c.label || c.key); }).join('') + '</Row>'];
    rows.forEach(function (r) { lines.push('<Row>' + cols.map(function (c) { return cell(c.csv ? c.csv(r) : r[c.key]); }).join('') + '</Row>'); });
    lines.push('</Table></Worksheet></Workbook>');
    VX.download.blob(name.replace(/\.xls$/, '') + '.xls', new Blob([lines.join('\n')], { type: 'application/vnd.ms-excel' }));
  };
  /** "Export" dropdown: CSV / Excel. getRows() → rows; columns as for VX.download.csv. */
  ui.exportMenu = function (name, getRows, columns) {
    return ui.menu([
      { label: 'Download CSV', icon: 'download', onClick: function () { VX.download.csv(name + '-' + VX.stamp(), getRows(), columns); } },
      { label: 'Download Excel', icon: 'download', onClick: function () { VX.download.xls(name + '-' + VX.stamp(), getRows(), columns); } }
    ], { text: 'Export', icon: 'download', label: 'Export these rows' });
  };

  /* -------------------------------------------------------------- table */

  /**
   * The console's table. o = {
   *   columns: [{ key, label, render(row), sortVal(row), csv(row), align: 'right', sort: false,
   *               hidden: true (starts hidden in the Columns menu), always: true (cannot hide) }],
   *   rows, rowId(row) → id,
   *   search: 'placeholder' | false, filters: [nodes]  (dropdowns shown in the toolbar),
   *   rowMenu(row) → menu items  (adds the "⋯" column),
   *   bulk: [{ label, icon, danger, onClick(selectedRows) }]  (adds checkboxes + "With selected" dropdown),
   *   exportName: 'file' | false, pageSize: 25, pageSizes: [25, 50, 100],
   *   empty: { title, hint, action } | 'text', onRow(row),
   *   server: { total, offset, limit, onPage(offset), onPageSize(limit), sortKey, sortDir, onSort(key, dir), exportAll() → Promise<rows> }
   *            (rows are one page from the server; search is the caller's)
   * }
   * Returns the element; el.update(rows) redraws.
   */
  ui.dataTable = function (o) {
    var rows = o.rows || [];
    var server = o.server || null;
    var allCols = o.columns.slice();
    var hidden = {};
    allCols.forEach(function (c) { if (c.hidden) hidden[c.key] = true; });
    var sortKey = server ? server.sortKey || null : (o.sortKey || null), dir = server ? server.sortDir || 'desc' : (o.sortDir || 'desc');
    var q = '', page = 0, size = server ? server.limit : (o.pageSize || 25);
    var selected = {};
    var idOf = o.rowId || function (r, i) { return r.id != null ? String(r.id) : String(i); };
    // Phones (<= 720 px, css/phone.css): each row becomes a card, the first
    // column its title (or the column marked `primary: true`), the others
    // label + value. `cards: false` keeps a sideways-scrolling table instead.
    var wrap = h('div.tbl-wrap.dt' + (o.cards === false ? '.no-cards' : ''));
    var bodyHost = h('div.tbl-scroll');
    var pager = h('div.tbl-pager');
    var info = h('span.tbl-info.muted');

    function cols() { return allCols.filter(function (c) { return !hidden[c.key]; }); }
    function val(r, c) { return c.sortVal ? c.sortVal(r) : r[c.key]; }
    function filtered() {
      if (server) return rows;
      var list = rows;
      if (q) list = list.filter(function (r) { return allCols.some(function (c) { var v = val(r, c); return v != null && typeof v !== 'object' && String(v).toLowerCase().indexOf(q) >= 0; }); });
      if (sortKey) {
        var c = allCols.filter(function (x) { return x.key === sortKey; })[0];
        if (c) list = list.slice().sort(function (a, b) {
          var x = val(a, c), y = val(b, c);
          if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
          var nx = Number(x), ny = Number(y);
          var r = (!isNaN(nx) && !isNaN(ny) && x !== '' && y !== '') ? nx - ny : String(x).localeCompare(String(y));
          return dir === 'asc' ? r : -r;
        });
      }
      return list;
    }
    function selectedRows() { return rows.filter(function (r, i) { return selected[idOf(r, i)]; }); }

    // Toolbar
    var tools = [];
    if (o.search !== false && !server) tools.push(ui.search(typeof o.search === 'string' ? o.search : 'Search…', function (v) { q = v.toLowerCase(); page = 0; draw(); }));
    if (o.filters) tools = tools.concat(o.filters);
    var bulkHost = h('span.bulk-host');
    var colMenu = ui.menu(function () {
      return allCols.filter(function (c) { return c.label && !c.always; }).map(function (c) {
        return { label: (hidden[c.key] ? '☐  ' : '☑  ') + c.label, onClick: function () { hidden[c.key] = !hidden[c.key]; draw(); } };
      });
    }, { text: 'Columns', icon: 'layout', label: 'Show or hide columns' });
    var exportCols = function () { return cols().filter(function (c) { return c.label; }).map(function (c) { return { key: c.key, label: c.label, csv: c.csv || c.sortVal || null }; }); };
    var exp = o.exportName === false ? null : ui.menu([
      { label: 'Download CSV', icon: 'download', onClick: function () { exportRows().then(function (r) { VX.download.csv((o.exportName || 'vinax') + '-' + VX.stamp(), r, exportCols()); }); } },
      { label: 'Download Excel', icon: 'download', onClick: function () { exportRows().then(function (r) { VX.download.xls((o.exportName || 'vinax') + '-' + VX.stamp(), r, exportCols()); }); } }
    ], { text: 'Export', icon: 'download', label: 'Export these rows' });
    function exportRows() {
      var sel = selectedRows();
      if (sel.length) return Promise.resolve(sel);
      if (server && server.exportAll) return Promise.resolve(server.exportAll()).then(function (r) { return r || rows; });
      return Promise.resolve(filtered());
    }
    var sizes = o.pageSizes || [25, 50, 100];
    var sizeSel = ui.dropdown('Rows per page', sizes.map(function (n) { return { value: n, label: String(n) }; }), size, function (v) {
      size = Number(v); page = 0;
      if (server && server.onPageSize) server.onPageSize(size); else draw();
    }, { inline: true });
    var bar = h('div.tbl-bar', tools, bulkHost, h('span.grow'), colMenu, exp);
    var foot = h('div.tbl-foot', info, h('span.grow'), sizeSel, pager);

    function drawBulk() {
      VX.clear(bulkHost);
      if (!o.bulk) return;
      var n = selectedRows().length;
      if (!n) return;
      bulkHost.appendChild(h('span.bulk-count', fmt.plural(n, 'selected', 'selected')));
      bulkHost.appendChild(ui.menu(o.bulk.map(function (b) {
        return { label: b.label, icon: b.icon, danger: b.danger, onClick: function () { b.onClick(selectedRows()); } };
      }), { text: 'With selected', label: 'Actions for the selected rows' }));
      bulkHost.appendChild(ui.button('Clear', { kind: 'ghost', small: true, onClick: function () { selected = {}; draw(); } }));
    }

    function draw() {
      var list = filtered();
      var total = server ? Number(server.total) || 0 : list.length;
      var pages = Math.max(1, Math.ceil(total / size));
      if (!server && page >= pages) page = pages - 1;
      var cur = server ? Math.floor((server.offset || 0) / size) : page;
      var slice = server ? list : list.slice(page * size, page * size + size);
      drawBulk();
      if (!rows.length) {
        var e = o.empty || {};
        VX.mount(bodyHost, typeof e === 'string' ? ui.emptyState(e) : ui.emptyState(e.title || 'Nothing here yet', e.hint, e.action));
        info.textContent = ''; VX.clear(pager); foot.hidden = true;
        return;
      }
      foot.hidden = false;
      var cs = cols();
      var allChecked = slice.length && slice.every(function (r) { return selected[idOf(r, rows.indexOf(r))]; });
      var head = [];
      if (o.bulk) {
        var all = h('input', { type: 'checkbox', 'aria-label': 'Select all rows on this page', checked: !!allChecked });
        all.addEventListener('change', function () { slice.forEach(function (r) { var id = idOf(r, rows.indexOf(r)); if (all.checked) selected[id] = true; else delete selected[id]; }); draw(); });
        head.push(h('th.check-col', { scope: 'col' }, all));
      }
      cs.forEach(function (c) {
        var sortable = c.sort !== false && c.label;
        var ariaSort = sortKey === c.key ? (dir === 'asc' ? 'ascending' : 'descending') : null;
        head.push(h('th' + (c.align ? '.' + c.align : ''), { scope: 'col', 'aria-sort': ariaSort, style: c.width ? { width: c.width } : null },
          sortable ? h('button.th-sort', { type: 'button', onclick: function () {
            if (sortKey === c.key) dir = dir === 'asc' ? 'desc' : 'asc'; else { sortKey = c.key; dir = c.align === 'right' ? 'desc' : 'asc'; }
            if (server && server.onSort) server.onSort(sortKey, dir); else draw();
          } }, c.label, h('span.sort-ind', { 'aria-hidden': 'true' }, sortKey === c.key ? (dir === 'asc' ? '↑' : '↓') : '')) : (c.label || h('span.sr-only', 'Actions'))));
      });
      if (o.rowMenu) head.push(h('th.menu-col', { scope: 'col' }, h('span.sr-only', 'Actions')));
      var tbody = h('tbody', slice.map(function (r) {
        var id = idOf(r, rows.indexOf(r));
        var cells = [];
        if (o.bulk) {
          var cb = h('input', { type: 'checkbox', 'aria-label': 'Select row', checked: !!selected[id] });
          cb.addEventListener('change', function () { if (cb.checked) selected[id] = true; else delete selected[id]; tr.classList.toggle('selected', cb.checked); drawBulk(); });
          cells.push(h('td.check-col', cb));
        }
        var primary = cs.filter(function (c) { return c.primary; })[0] || cs[0];
        cs.forEach(function (c) {
          var v = c.render ? c.render(r) : r[c.key];
          cells.push(h('td' + (c.align ? '.' + c.align : '') + (c.nowrap ? '.nowrap' : '') + (c === primary ? '.cell-primary' : ''), { 'data-label': c.label || '' }, v == null || v === '' ? h('span.muted', '—') : v));
        });
        if (o.rowMenu) cells.push(h('td.menu-col', ui.menu(o.rowMenu(r), { label: 'Actions' })));
        var tr = h('tr' + (o.onRow ? '.clickable' : '') + (selected[id] ? '.selected' : ''), cells);
        if (o.onRow) {
          tr.tabIndex = 0;
          tr.addEventListener('click', function (e) { if (e.target.closest('button, a, input, select, label, .menu')) return; o.onRow(r, e); });
          tr.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target === tr) o.onRow(r, e); });
        }
        return tr;
      }));
      VX.mount(bodyHost, slice.length ? h('table.tbl', h('thead', h('tr', head)), tbody) : ui.emptyState('No rows match “' + q + '”', 'Try a different search.'));
      var from = total ? cur * size + 1 : 0, to = Math.min(total, cur * size + slice.length);
      info.textContent = total ? 'Showing ' + fmt.num(from) + '–' + fmt.num(to) + ' of ' + fmt.num(total) : '';
      VX.clear(pager);
      if (pages > 1) {
        pager.appendChild(ui.button('Previous', { kind: 'ghost', small: true, disabled: cur === 0, onClick: function () { if (server) server.onPage(Math.max(0, (cur - 1) * size)); else { page--; draw(); } } }));
        pager.appendChild(h('span.muted', 'Page ' + fmt.num(cur + 1) + ' of ' + fmt.num(pages)));
        pager.appendChild(ui.button('Next', { kind: 'ghost', small: true, disabled: cur >= pages - 1, onClick: function () { if (server) server.onPage((cur + 1) * size); else { page++; draw(); } } }));
      }
    }
    wrap.appendChild(bar);
    wrap.appendChild(bodyHost);
    wrap.appendChild(foot);
    wrap.update = function (r) { rows = r || []; selected = {}; draw(); };
    wrap.selected = selectedRows;
    draw();
    return wrap;
  };
  // Older pages call ui.table: give them the new table too.
  ui.table = ui.dataTable;

  /* ----------------------------------------------- "Needs your attention" */

  /** Attention list. items = [{ id, level: bad|warn|info, text, action: { label, onClick } }]. Dismissed ids are hidden until tomorrow. */
  ui.attention = function (items) {
    var KEY = 'vinax_admin_dismissed';
    var today = VX.time.today();
    var dismissed = {};
    try { var raw = JSON.parse(localStorage.getItem(KEY) || '{}'); if (raw.day === today) dismissed = raw.ids || {}; } catch (e) {}
    var list = h('ul.attention-list');
    function draw() {
      VX.clear(list);
      var shown = items.filter(function (it) { return !dismissed[it.id || it.text]; });
      if (!shown.length) { list.appendChild(h('li.attention-ok', icon('check'), h('span', 'All good — nothing needs you right now.'))); return; }
      shown.forEach(function (it) {
        list.appendChild(h('li.attention-item.' + (it.level || 'info'),
          icon(it.level === 'bad' ? 'alert' : it.level === 'warn' ? 'alert' : 'info'),
          h('span.attention-text', it.text),
          it.action ? ui.button(it.action.label, { kind: 'ghost', small: true, onClick: it.action.onClick }) : null,
          ui.menu([{ label: 'Dismiss for today', icon: 'close', onClick: function () {
            dismissed[it.id || it.text] = true;
            try { localStorage.setItem(KEY, JSON.stringify({ day: today, ids: dismissed })); } catch (e) {}
            draw();
          } }], { label: 'More for this alert' })));
      });
    }
    draw();
    return list;
  };

  /* ------------------------------------------------------ page helpers */

  /** Section heading with an optional ⓘ. */
  ui.heading = function (text, infoText) { return h('h3.subhead', text, infoText ? ui.info(infoText, text) : null); };

  /** Friendly "Page not found". */
  ui.notFound = function (onHome) {
    return h('div.not-found', ui.emptyState('Page not found', 'This address does not match any page in the console. It may have moved.', { label: 'Go to Dashboard', icon: 'grid', onClick: onHome }));
  };

  /** Days for the global date range: the page reads ctx.range. */
  VX.RANGES = [
    { value: '1', label: 'Today', days: 1 },
    { value: '7', label: 'Last 7 days', days: 7 },
    { value: '30', label: 'Last 30 days', days: 30 },
    { value: '90', label: 'Last 90 days', days: 90 },
    { value: 'custom', label: 'Custom…' }
  ];
})();
