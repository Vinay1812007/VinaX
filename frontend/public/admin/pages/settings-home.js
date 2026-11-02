/* App Settings › Home Screen — banners, festival look, greeting, the top
 * message bar, the order of Home sections and the pop-up announcement.
 * Each section edits one stored setting through VX.settingsPage (kit/settings.js).
 * Stored shapes and who reads them: docs/admin-console.md → "Home Screen". */
(function () {
  'use strict';
  var VX = window.VX, h = VX.h, ui = VX.ui, fmt = VX.fmt, st = VX.st;
  var arr = VX.arr, obj = VX.obj;

  /* ---------------------------------------------------------- helpers */

  /** A short stable number from text (so a re-saved, unchanged message keeps its id). */
  function hash(text) {
    var x = 5381;
    for (var i = 0; i < text.length; i++) x = ((x * 33) ^ text.charCodeAt(i)) >>> 0;
    return x || 1;
  }
  var day = st.day;
  /** "YYYY-MM-DD" → the start / end of that day in the console's time zone (ISO). */
  function dayStart(d) { return d ? VX.time.fromInput(d + 'T00:00') : null; }
  function dayEnd(d) { return d ? VX.time.fromInput(d + 'T23:59') : null; }
  function fromIsoDay(v) { return v ? (/^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : VX.time.toDate(v)) : ''; }
  function datesText(start, end) {
    if (start && end) return 'from ' + fmt.day(start) + ' to ' + fmt.day(end);
    if (start) return 'from ' + fmt.day(start);
    if (end) return 'until ' + fmt.day(end);
    return 'with no end date';
  }
  function compact(o) { Object.keys(o).forEach(function (k) { if (o[k] === '' || o[k] == null) delete o[k]; }); return o; }

  /** Pages a banner, message or pop-up may open (the server keeps the same list). */
  var PAGES = [
    { value: '/charts', label: 'Charts' }, { value: '/discover', label: 'Discover' }, { value: '/explore', label: 'Explore' },
    { value: '/radio', label: 'Radio' }, { value: '/mixes', label: 'Mixes' }, { value: '/made-for-you', label: 'Made for you' },
    { value: '/weekly', label: 'Weekly mix' }, { value: '/vinaxai', label: 'VinaX AI' }, { value: '/library', label: 'Library' }, { value: '/search', label: 'Search' }
  ];
  var pageName = function (p) { var f = PAGES.filter(function (x) { return x.value === p; })[0]; return f ? f.label : null; };

  /**
   * "Where a tap goes" picker shared by the message bar and the pop-up.
   * link = { kind: none|page|song|album|playlist, path, label }. The stored value is the app path.
   */
  function linkFromPath(path, label) {
    path = path || '';
    if (!path || path === '/') return { kind: 'none', path: '', label: '' };
    var m = /^\/(song|album|playlist)\/(.+)$/.exec(path);
    if (m) return { kind: m[1], path: path, label: label || 'Chosen ' + m[1] };
    return { kind: 'page', path: pageName(path) ? path : '/charts', label: '' };
  }
  function linkPicker(link, onChange, title) {
    var host = h('div.link-pick');
    function draw() {
      var kinds = [{ value: 'none', label: 'Nothing (just the message)' }, { value: 'page', label: 'A page in the app' }, { value: 'song', label: 'A song' }, { value: 'album', label: 'An album' }, { value: 'playlist', label: 'A playlist' }];
      var parts = [ui.dropdown(title || 'Where a tap goes', kinds, link.kind, function (v) {
        link.kind = v; link.path = v === 'page' ? '/charts' : ''; link.label = ''; onChange(link); draw();
      })];
      if (link.kind === 'page') parts.push(ui.dropdown('Page', PAGES, link.path || '/charts', function (v) { link.path = v; onChange(link); }));
      if (link.kind === 'song' || link.kind === 'album' || link.kind === 'playlist') {
        if (link.path) parts.push(h('div.picked', VX.icon('check'), h('span', link.label || 'Chosen ' + link.kind), ui.button('Change', { kind: 'ghost', small: true, onClick: function () { link.path = ''; link.label = ''; onChange(link); draw(); } })));
        else parts.push(ui.musicPicker({ type: link.kind + 's', onPick: function (m) { link.path = '/' + link.kind + '/' + encodeURIComponent(m.id); link.label = m.title + (m.sub ? ' · ' + m.sub : ''); onChange(link); draw(); } }));
      }
      VX.mount(host, parts);
    }
    draw();
    return host;
  }
  function linkWords(path, label) {
    if (!path || path === '/') return '';
    if (pageName(path)) return ' Opens ' + pageName(path) + '.';
    var m = /^\/(song|album|playlist)\//.exec(path);
    return m ? ' Opens ' + (label || 'a ' + m[1]) + '.' : '';
  }

  /* ---------------------------------------------------------- banners */

  var LINK_TYPES = [
    { value: 'song', label: 'A song' }, { value: 'album', label: 'An album' }, { value: 'playlist', label: 'A playlist' },
    { value: 'artist', label: 'An artist' }, { value: 'charts', label: 'Charts' }, { value: 'page', label: 'A page in the app' }, { value: 'none', label: 'Nothing' }
  ];
  function bannerState(b) {
    if (b.enabled === false) return { text: 'Off', tone: null };
    var today = VX.time.today();
    if (b.start && today < b.start) return { text: 'Starts ' + fmt.day(b.start), tone: 'info' };
    if (b.end && today > b.end) return { text: 'Ended', tone: null };
    return { text: 'Live', tone: 'ok' };
  }
  function opensWords(b) {
    if (b.linkType === 'charts') return 'Opens Charts';
    if (b.linkType === 'page') return 'Opens ' + (pageName(b.linkId) || 'a page');
    if (b.linkType && b.linkId) return 'Opens ' + (b.linkLabel || 'the chosen ' + b.linkType);
    return 'Opens nothing';
  }
  function bannerForm(initial, onDone, isNew) {
    var b = st.clone(initial);
    var link = h('div');
    function drawLink() {
      var parts = [ui.dropdown('Opens', LINK_TYPES, b.linkType || 'none', function (v) {
        b.linkType = v === 'none' ? '' : v; b.linkId = v === 'page' ? '/charts' : ''; b.linkLabel = ''; drawLink();
      })];
      if (b.linkType === 'page') parts.push(ui.dropdown('Page', PAGES, b.linkId || '/charts', function (v) { b.linkId = v; }));
      if (['song', 'album', 'playlist', 'artist'].indexOf(b.linkType) >= 0) {
        if (b.linkId) parts.push(h('div.picked', VX.icon('check'), h('span', b.linkLabel || 'Chosen ' + b.linkType), ui.button('Change', { kind: 'ghost', small: true, onClick: function () { b.linkId = ''; b.linkLabel = ''; drawLink(); } })));
        else parts.push(ui.musicPicker({ type: b.linkType + 's', onPick: function (m) { b.linkId = m.id; b.linkLabel = m.title + (m.sub ? ' · ' + m.sub : ''); if (!b.img && m.image && /^https:/.test(m.image)) b.img = m.image; drawLink(); } }));
      }
      VX.mount(link, parts);
    }
    drawLink();
    var err = h('p.form-error', { role: 'alert' });
    var title = ui.input({ maxlength: 80, value: b.title || '', placeholder: 'e.g. New Telugu hits' });
    var sub = ui.input({ maxlength: 160, value: b.subtitle || '', placeholder: 'One short line (optional)' });
    VX.modal({
      title: isNew ? 'Add banner' : 'Edit banner', wide: true,
      body: [
        ui.field('Title', title, 'Up to 80 characters.'),
        ui.field('Subtitle', sub),
        (function () { var up = ui.imageUpload({ label: 'Picture (square)', value: b.img || null, aspect: 1, width: 400, purpose: 'banner', onChange: function (url) { b.img = url || ''; } }); var pv = up.querySelector('.img-preview'); if (pv) pv.style.maxWidth = '180px'; return up; })(),
        link,
        ui.dateRange({ start: b.start || '', end: b.end || '' }, function (v) { b.start = v.start; b.end = v.end; }),
        ui.switchRow('Show this banner', 'Off keeps it saved but hidden.', b.enabled !== false, function (on) { b.enabled = on; }),
        err
      ],
      actions: [
        { label: 'Cancel', kind: 'ghost' },
        { label: isNew ? 'Add banner' : 'Done', kind: 'primary', onClick: function (close) {
          b.title = title.value.trim(); b.subtitle = sub.value.trim();
          if (!b.title) { err.textContent = 'Give the banner a title.'; title.focus(); return; }
          if (['song', 'album', 'playlist', 'artist'].indexOf(b.linkType) >= 0 && !b.linkId) { err.textContent = 'Pick what the banner opens, or choose “Nothing”.'; return; }
          if (b.start && b.end && b.end < b.start) { err.textContent = 'The end date is before the start date.'; return; }
          close(); onDone(b);
        } }
      ]
    });
  }

  var bannersSection = {
    key: 'banners', title: 'Banners & Offers', wide: true,
    desc: 'Cards at the top of Home. Up to 10 can be live at once; people see one a day and can close it.',
    fromValue: function (v) {
      return { list: arr(v).map(function (b, i) {
        b = obj(b);
        return { id: b.id || 'b' + (i + 1) + '-' + hash(String(b.title || '')), title: b.title || '', subtitle: b.subtitle || '', img: b.img || '', linkType: b.linkType || '', linkId: b.linkId || '', linkLabel: b.linkLabel || '', start: day(b.start), end: day(b.end), enabled: b.enabled !== false };
      }) };
    },
    toValue: function (m) {
      if (!m.list.length) return null;
      return m.list.map(function (b) {
        var o = compact({ id: b.id, title: b.title, subtitle: b.subtitle, img: b.img, linkType: b.linkType, linkId: b.linkType === 'charts' ? '' : b.linkId, linkLabel: b.linkLabel, start: b.start, end: b.end });
        if (b.enabled === false) o.enabled = false;
        return o;
      });
    },
    validate: function (m) {
      var live = m.list.filter(function (b) { return bannerState(b).text === 'Live'; }).length;
      return live > 10 ? 'Only 10 banners can be live at once — switch some off or give them dates.' : null;
    },
    describe: function (v) {
      var list = arr(v);
      if (!list.length) return 'No banners';
      var live = list.filter(function (b) { return bannerState(obj(b)).text === 'Live'; }).length;
      return fmt.plural(list.length, 'banner') + ' (' + live + ' live): ' + list.slice(0, 3).map(function (b) { return '“' + (obj(b).title || '') + '”'; }).join(', ') + (list.length > 3 ? '…' : '');
    },
    render: function (m, set, api) {
      var host = h('div');
      function add(prefill) {
        if (m.list.length >= 20) { VX.toast('That is a lot of banners — delete an old one first.', 'bad'); return; }
        bannerForm(Object.assign({ id: 'b' + Date.now().toString(36), title: '', subtitle: '', img: '', linkType: 'song', linkId: '', linkLabel: '', start: '', end: '', enabled: true }, prefill || {}), function (b) { m.list.push(b); set(m); draw(); }, true);
      }
      function draw() {
        VX.mount(host,
          ui.sortable({
            items: m.list, label: 'Banners, drag to reorder', disabled: api.readOnly, empty: 'No banners yet. Add one to promote a song, album or playlist.',
            name: function (b) { return b.title; },
            onChange: function (list) { m.list = list; set(m); },
            render: function (b, i) {
              var s = bannerState(b);
              return h('div.banner-row',
                b.img && /^https:/.test(b.img) ? h('img.banner-thumb', { src: b.img, alt: '', referrerpolicy: 'no-referrer' }) : h('span.banner-thumb.empty', VX.icon('image')),
                h('div.banner-text', h('strong', b.title || 'Untitled'), h('span.muted.small', [b.subtitle, opensWords(b), b.start || b.end ? datesText(b.start, b.end) : null].filter(Boolean).join(' · '))),
                ui.pill(s.text, s.tone),
                api.readOnly ? null : ui.toggle('', b.enabled !== false, function (on) { b.enabled = on; set(m); draw(); }, { 'aria-label': 'Show “' + b.title + '”' }),
                api.readOnly ? null : ui.menu([
                  { label: 'Edit', icon: 'edit', onClick: function () { bannerForm(b, function (nb) { m.list[i] = nb; set(m); draw(); }); } },
                  { label: 'Duplicate', icon: 'copy', onClick: function () { var c = st.clone(b); c.id = 'b' + Date.now().toString(36); c.title = b.title + ' (copy)'; m.list.splice(i + 1, 0, c); set(m); draw(); } },
                  '-',
                  { label: 'Delete', icon: 'trash', danger: true, onClick: function () { VX.confirm({ title: 'Delete this banner?', body: '“' + b.title + '” is removed when you press Save & apply.', confirmLabel: 'Delete', danger: true }).then(function (ok) { if (ok) { m.list.splice(i, 1); set(m); draw(); } }); } }
                ], { label: 'Actions for “' + b.title + '”' }));
            }
          }),
          api.readOnly ? null : h('div.toolbar', ui.button('Add banner', { kind: 'primary', small: true, icon: 'plus', onClick: function () { add(); } })));
      }
      draw();
      // Arriving from Song Stats → "Add to banner": open the form with that song.
      var p = api.ctx && api.ctx.params;
      if (p && p.addSong && !api.readOnly && !host.dataset.prefilled) {
        host.dataset.prefilled = '1';
        setTimeout(function () { add({ title: p.songTitle || '', subtitle: p.songArtist || '', img: /^https:/.test(p.songImage || '') ? p.songImage : '', linkType: 'song', linkId: p.addSong, linkLabel: [p.songTitle, p.songArtist].filter(Boolean).join(' · ') }); }, 60);
      }
      return host;
    },
    preview: function (m) {
      var live = m.list.filter(function (b) { return bannerState(b).text === 'Live'; });
      var b = live[0];
      return ui.phone([
        h('div.pv-title', 'Good evening'),
        b ? h('div.pv-banner', b.img && /^https:/.test(b.img) ? h('img', { src: b.img, alt: '' }) : h('span.pv-banner-img'), h('div', h('strong', b.title), b.subtitle ? h('span', b.subtitle) : null), h('span.pv-x', '×')) : h('p.pv-muted', 'No banner live today.'),
        h('div.pv-shelf'), h('div.pv-shelf.short')
      ], { small: true, label: 'Preview of the banner on Home' });
    }
  };

  /* ---------------------------------------------------------- festival */

  var FESTS = arr(window.VX_FESTIVALS);
  var festName = function (id) { var f = FESTS.filter(function (x) { return x.id === id; })[0]; return f ? f.name : id; };
  var CHOICES = [
    { value: 'none', label: 'None (no festival look)' }, { value: 'diwali', label: 'Diwali' }, { value: 'sankranti', label: 'Sankranti' },
    { value: 'ugadi', label: 'Ugadi' }, { value: 'holi', label: 'Holi' }, { value: 'eid', label: 'Eid' }, { value: 'christmas', label: 'Christmas' },
    { value: 'newyear', label: 'New Year' }, { value: 'custom', label: 'Custom (any festival, your colour)' }
  ];
  var festivalSection = {
    key: 'festival', title: 'Festival Theme',
    desc: 'Dress the app up for a festival. Without a choice here, the app follows its own festival calendar.',
    fromValue: function (v) {
      v = obj(v);
      var id = v.id || '';
      var choice = v.mode === 'off' ? 'none' : v.mode === 'force' ? (v.color || !CHOICES.some(function (c) { return c.value === id; }) ? 'custom' : id) : 'diwali';
      return { choice: choice, customId: id || (FESTS[0] && FESTS[0].id) || 'diwali', color: v.color || '#f2a33a', start: fromIsoDay(v.start), end: fromIsoDay(v.end), enabled: v.enabled !== false, auto: !v.mode || v.mode === 'auto' };
    },
    toValue: function (m) {
      if (m.auto) return null;
      var o = m.choice === 'none' ? { mode: 'off' } : { mode: 'force', id: m.choice === 'custom' ? m.customId : m.choice };
      if (m.choice === 'custom') o.color = m.color;
      if (m.start) o.start = dayStart(m.start);
      if (m.end) o.end = dayEnd(m.end);
      if (!m.enabled) o.enabled = false;
      return o;
    },
    validate: function (m) { return m.start && m.end && m.end < m.start ? 'The end date is before the start date.' : null; },
    describe: function (v) {
      v = obj(v);
      if (!v.mode) return 'Follows the app’s festival calendar';
      var what = v.mode === 'off' ? 'No festival look' : festName(v.id) + ' look' + (v.color ? ' in your colour' : '');
      return what + (v.start || v.end ? ', ' + datesText(fromIsoDay(v.start), fromIsoDay(v.end)) : '') + (v.enabled === false ? ' (switched off)' : '');
    },
    render: function (m, set) {
      var custom = h('div.form-row');
      function drawCustom() {
        VX.mount(custom, m.choice === 'custom' && !m.auto ? [
          ui.dropdown('Festival', FESTS.map(function (f) { return { value: f.id, label: f.name }; }), m.customId, function (v) { m.customId = v; set(m); }),
          ui.colorPicker('Colour', m.color, function (c) { m.color = c; set(m); })
        ] : null);
      }
      var body = h('div.form-col');
      function draw() {
        VX.mount(body,
          ui.radios('What the app shows', [
            { value: 'auto', label: 'Follow the festival calendar', hint: 'The app picks the festival by date (built-in).' },
            { value: 'choose', label: 'Choose the look myself' }
          ], m.auto ? 'auto' : 'choose', function (v) { m.auto = v === 'auto'; set(m); draw(); }),
          m.auto ? null : [
            ui.dropdown('Festival look', CHOICES, m.choice, function (v) { m.choice = v; set(m); drawCustom(); }),
            custom,
            ui.dateRange({ start: m.start, end: m.end }, function (v) { m.start = v.start; m.end = v.end; set(m); }),
            ui.switchRow('Turn on', 'Off goes back to the festival calendar without losing your choice.', m.enabled, function (on) { m.enabled = on; set(m); })
          ]);
        drawCustom();
      }
      draw();
      return body;
    },
    preview: function (m) {
      var id = m.choice === 'custom' ? m.customId : m.choice;
      var f = FESTS.filter(function (x) { return x.id === id; })[0];
      if (m.auto) return h('p.muted.small', 'The app follows its calendar.');
      if (m.choice === 'none' || !f) return ui.phone([h('div.pv-title', 'Good evening'), h('p.pv-muted', 'No festival look.')], { small: true });
      var accent = m.choice === 'custom' ? m.color : f.accent;
      return ui.phone([
        f.ribbon ? h('div.pv-ribbon', { style: { background: m.choice === 'custom' ? m.color : f.ribbon } }) : null,
        h('div.pv-title', f.greeting || f.name),
        h('div.pv-chip', { style: { background: accent } }, 'Play'),
        h('p.pv-muted', f.fx || '')
      ], { small: true, label: 'Preview of the festival look' });
    }
  };

  /* ---------------------------------------------------------- greeting */

  var PARTS = [['morning', 'Morning (5 am – noon)'], ['afternoon', 'Afternoon (noon – 5 pm)'], ['evening', 'Evening (5 – 9 pm)'], ['night', 'Night (9 pm – 5 am)']];
  var greetingSection = {
    key: 'greeting', title: 'Home Greeting',
    desc: 'A short line under the Home title. You can write a different one for each part of the day.',
    fromValue: function (v) {
      v = obj(v);
      var legacy = v.text || '';
      return { enabled: v.enabled !== false, morning: v.morning != null ? v.morning : legacy, afternoon: v.afternoon != null ? v.afternoon : legacy, evening: v.evening != null ? v.evening : legacy, night: v.night != null ? v.night : legacy, withName: v.withName === true, start: v.start || '', end: v.end || '' };
    },
    toValue: function (m) {
      if (m.enabled && !m.withName && !(m.morning.trim() || m.afternoon.trim() || m.evening.trim() || m.night.trim())) return null;
      var o = compact({ morning: m.morning.trim(), afternoon: m.afternoon.trim(), evening: m.evening.trim(), night: m.night.trim(), start: m.start, end: m.end });
      if (m.withName) o.withName = true;
      if (!m.enabled) o.enabled = false;
      return o;
    },
    validate: function (m) { return m.enabled && !(m.morning.trim() || m.afternoon.trim() || m.evening.trim() || m.night.trim()) ? 'Write at least one greeting, or turn the greeting off.' : null; },
    describe: function (v) {
      v = obj(v);
      if (v.enabled === false) return 'Greeting off';
      var lines = PARTS.map(function (p) { return v[p[0]] || v.text; }).filter(Boolean);
      return lines.length ? '“' + fmt.trunc(lines[0], 60) + '”' + (lines.length > 1 ? ' and ' + (lines.length - 1) + ' more' : '') + (v.withName ? ', with first name' : '') : 'No greeting';
    },
    render: function (m, set) {
      return h('div.form-col',
        ui.switchRow('Show a greeting', 'Off shows no extra line.', m.enabled, function (on) { m.enabled = on; set(m); }),
        PARTS.map(function (p) { return st.text(m, p[0], set, { label: p[1], max: 160, placeholder: 'Leave empty to show nothing at this time' }); }),
        ui.checkbox('Start with the person’s first name (“Hi Asha! …”)', m.withName, function (on) { m.withName = on; set(m); }));
    },
    preview: function (m) {
      var hour = Number(VX.time.nowHm().slice(0, 2));
      var part = hour >= 5 && hour < 12 ? 'morning' : hour >= 12 && hour < 17 ? 'afternoon' : hour >= 17 && hour < 21 ? 'evening' : 'night';
      var line = m.enabled ? m[part] : '';
      return ui.phone([h('div.pv-title', 'Good ' + (part === 'night' ? 'evening' : part)), line ? h('p.pv-note', (m.withName ? 'Hi Asha! ' : '') + line) : h('p.pv-muted', 'Nothing shows right now (' + part + ').'), h('div.pv-shelf'), h('div.pv-shelf.short')], { small: true, label: 'Preview of the greeting now' });
    }
  };

  /* ---------------------------------------------------------- broadcast */

  var STYLES = [{ value: 'info', label: 'Info (blue)' }, { value: 'success', label: 'Good news (green)' }, { value: 'warning', label: 'Warning (amber)' }, { value: 'urgent', label: 'Urgent (red)' }];
  var sig = function (text, link, style) { return text + '|' + link + '|' + style; };
  var styleName = function (s) { return ({ info: 'info', success: 'good news', warning: 'warning', urgent: 'urgent' })[s] || 'info'; };
  var broadcastSection = {
    key: 'broadcast', title: 'Top Message Bar',
    desc: 'A message across the top of every page. Changing the message shows it again to everyone.',
    fromValue: function (v) {
      v = obj(v);
      return { origId: v.id || '', origSig: v.id ? sig(v.text || '', v.link || '', v.style || 'info') : '', text: v.text || '', style: v.style || 'info', link: linkFromPath(v.link, v.linkLabel), start: fromIsoDay(v.start), end: fromIsoDay(v.end), dismissible: v.dismissible !== false, enabled: v.enabled !== false };
    },
    toValue: function (m) {
      if (!m.text.trim()) return null;
      var link = m.link.kind === 'none' ? '' : m.link.path;
      var o = compact({ text: m.text.trim(), style: m.style === 'info' ? '' : m.style, link: link, linkLabel: link && m.link.kind !== 'page' ? m.link.label : '', start: dayStart(m.start), end: dayEnd(m.end) });
      // Same words, link and style keep the id (people who closed it are not asked again).
      var mine = sig(o.text, o.link || '', m.style);
      o.id = m.origId && m.origSig === mine ? m.origId : 'm' + hash(mine).toString(36);
      var ordered = { id: o.id };
      Object.keys(o).forEach(function (k) { if (k !== 'id') ordered[k] = o[k]; });
      o = ordered;
      if (!m.dismissible) o.dismissible = false;
      if (!m.enabled) o.enabled = false;
      return o;
    },
    validate: function (m) {
      if (m.start && m.end && m.end < m.start) return 'The end date is before the start date.';
      if (m.link.kind !== 'none' && m.link.kind !== 'page' && !m.link.path) return 'Pick what a tap opens, or choose “Nothing”.';
      return null;
    },
    describe: function (v) {
      v = obj(v);
      if (!v.text) return 'No message';
      return '“' + fmt.trunc(v.text, 70) + '” (' + styleName(v.style) + ')' + linkWords(v.link, v.linkLabel) + (v.enabled === false ? ' Switched off.' : '');
    },
    render: function (m, set) {
      return h('div.form-col',
        st.text(m, 'text', set, { label: 'Message', max: 240, multiline: true, rows: 2, placeholder: 'e.g. New Telugu songs every Friday!' }),
        ui.dropdown('Style', STYLES, m.style, function (v) { m.style = v; set(m); }),
        linkPicker(m.link, function () { set(m); }),
        ui.dateRange({ start: m.start, end: m.end }, function (v) { m.start = v.start; m.end = v.end; set(m); }),
        ui.switchRow('Can users close it?', 'Off keeps the bar up until its end date.', m.dismissible, function (on) { m.dismissible = on; set(m); }),
        ui.switchRow('Show the message', 'Off hides it without deleting it.', m.enabled, function (on) { m.enabled = on; set(m); }));
    },
    preview: function (m) {
      var colors = { info: '#3b82f6', success: '#22c55e', warning: '#f59e0b', urgent: '#ef4444' };
      return ui.phone([
        m.enabled && m.text.trim() ? h('div.pv-bar', { style: { 'border-left-color': colors[m.style] || colors.info } }, h('span', m.text.trim()), m.link.kind !== 'none' ? h('u', 'Open') : null, m.dismissible ? h('span.pv-x', '×') : null) : h('p.pv-muted', 'No message bar.'),
        h('div.pv-title', 'Good evening'), h('div.pv-shelf'), h('div.pv-shelf.short')
      ], { small: true, label: 'Preview of the message bar' });
    }
  };

  /* ---------------------------------------------------------- home layout */

  var SHELVES = [['quick', 'Quick picks'], ['personal', 'Made for you'], ['discovery', 'Fresh discoveries'], ['charts', 'Charts'], ['seasonal', 'Seasonal listening'], ['moods', 'Moods'], ['genres', 'Genres'], ['artists', 'Artists'], ['albums', 'Albums'], ['daypicks', 'For your day'], ['loved', 'Favorites'], ['feed', 'More to explore']];
  var shelfName = function (k) { var f = SHELVES.filter(function (s) { return s[0] === k; })[0]; return f ? f[1] : k; };
  var layoutSection = {
    key: 'home-layout', title: 'Home Layout',
    desc: 'The order of sections on Home, and which ones show. People can still reorder Home for themselves.',
    fromValue: function (v) {
      v = obj(v);
      var order = arr(v.order).filter(function (k) { return SHELVES.some(function (s) { return s[0] === k; }); });
      SHELVES.forEach(function (s) { if (order.indexOf(s[0]) < 0) order.push(s[0]); });
      var hidden = arr(v.hidden);
      return { title: v.title || '', description: v.description || '', items: order.map(function (k) { return { key: k, shown: hidden.indexOf(k) < 0 }; }) };
    },
    toValue: function (m) {
      var plain = !m.title && !m.description && m.items.every(function (it, i) { return it.shown && it.key === SHELVES[i][0]; });
      if (plain) return null;
      var o = { order: m.items.map(function (i) { return i.key; }), hidden: m.items.filter(function (i) { return !i.shown; }).map(function (i) { return i.key; }) };
      if (m.title) o.title = m.title;
      if (m.description) o.description = m.description;
      return o;
    },
    validate: function (m) { return m.items.every(function (i) { return !i.shown; }) ? 'Keep at least one section showing.' : null; },
    describe: function (v) {
      v = obj(v);
      var hidden = arr(v.hidden);
      return 'Starts with ' + arr(v.order).slice(0, 3).map(shelfName).join(', ') + (hidden.length ? '; hides ' + hidden.map(shelfName).join(', ') : '; everything shows');
    },
    render: function (m, set, api) {
      return ui.sortable({
        items: m.items, label: 'Home sections, drag to reorder', disabled: api.readOnly,
        name: function (i) { return shelfName(i.key); },
        onChange: function (items) { m.items = items; set(m); },
        render: function (i) {
          return h('div.shelf-row', h('span', shelfName(i.key)), ui.toggle(i.shown ? 'Shown' : 'Hidden', i.shown, function (on, cb) { i.shown = on; cb.parentNode.querySelector('.switch-label').textContent = on ? 'Shown' : 'Hidden'; set(m); }, { 'aria-label': 'Show ' + shelfName(i.key), disabled: api.readOnly }));
        }
      });
    }
  };

  /* ---------------------------------------------------------- announcement */

  var SHOW = [{ value: 'once', label: 'Once per user' }, { value: 'daily', label: 'Once a day' }, { value: 'always', label: 'Every time the app opens' }];
  var PLATFORMS = [{ value: 'android', label: 'Android app' }, { value: 'web', label: 'Website' }, { value: 'ios', label: 'iPhone' }];
  var announcementSection = {
    key: 'announcement', title: 'Pop-up Announcement',
    desc: 'A pop-up when people open the app. Changing it shows it again.',
    fromValue: function (v) {
      v = obj(v);
      return { original: v.title && !v.popup ? st.clone(v) : null, touched: false, title: v.title || '', body: v.body || '', button: v.button || '', link: linkFromPath(v.link, v.linkLabel), show: v.show || 'once', platforms: v.platforms ? arr(v.platforms) : ['android', 'web', 'ios'], start: fromIsoDay(v.start), end: fromIsoDay(v.end), enabled: v.enabled !== false, popup: v.popup === true || !v.title };
    },
    toValue: function (m) {
      if (m.original && !m.touched) return m.original;
      if (!m.title.trim()) return null;
      var link = m.link.kind === 'none' ? '' : m.link.path;
      var o = compact({ title: m.title.trim(), body: m.body.trim(), button: m.button.trim(), link: link || '/', linkLabel: link && m.link.kind !== 'page' ? m.link.label : '', show: m.show, start: dayStart(m.start), end: dayEnd(m.end) });
      o.popup = true;
      o.platforms = m.platforms.slice();
      if (!m.enabled) o.enabled = false;
      // The same message keeps its number (people who saw it are not asked again); a change shows it again.
      o.ts = hash([o.title, o.body, o.button, o.link, o.show].join('|'));
      return o;
    },
    validate: function (m) {
      if (!m.title.trim()) return null;
      if (!m.platforms.length) return 'Choose at least one platform.';
      if (m.start && m.end && m.end < m.start) return 'The end date is before the start date.';
      if (m.link.kind !== 'none' && m.link.kind !== 'page' && !m.link.path) return 'Pick what the button opens, or choose “Nothing”.';
      return null;
    },
    describe: function (v) {
      v = obj(v);
      if (!v.title) return 'No pop-up';
      if (!v.popup) return 'Notification “' + fmt.trunc(v.title, 60) + '” (sent from Send Notification)';
      var show = ({ once: 'once per user', daily: 'once a day', always: 'on every app open' })[v.show] || 'once per user';
      return '“' + fmt.trunc(v.title, 60) + '”, ' + show + (v.enabled === false ? ' (switched off)' : '');
    },
    render: function (m, set0) {
      var set = function (x) { m.touched = true; set0(x); };
      return h('div.form-col',
        m.popup ? null : ui.notice('The current announcement came from Send Notification. Saving here turns it into a pop-up.', 'info'),
        st.text(m, 'title', set, { label: 'Title', max: 120, placeholder: 'e.g. Listen Together is here' }),
        st.text(m, 'body', set, { label: 'Message', max: 300, multiline: true, rows: 3 }),
        st.text(m, 'button', set, { label: 'Button text', max: 30, placeholder: 'OK' }),
        linkPicker(m.link, function () { set(m); }, 'The button opens'),
        ui.dropdown('Show', SHOW, m.show, function (v) { m.show = v; set(m); }),
        ui.checks('Show on', PLATFORMS, m.platforms, function (vals) { m.platforms = vals; set(m); }, { row: true }),
        ui.dateRange({ start: m.start, end: m.end }, function (v) { m.start = v.start; m.end = v.end; set(m); }),
        ui.switchRow('Show the pop-up', 'Off keeps it saved but hidden.', m.enabled, function (on) { m.enabled = on; set(m); }));
    },
    preview: function (m) {
      return ui.phone([
        h('div.pv-title', 'Good evening'), h('div.pv-shelf'),
        m.title.trim() && m.enabled ? h('div.pv-pop', h('strong', m.title.trim()), m.body.trim() ? h('p', m.body.trim()) : null, h('div.pv-pop-btns', h('span', 'Not now'), h('b', m.button.trim() || 'OK'))) : h('p.pv-muted', 'No pop-up.')
      ], { small: true, label: 'Preview of the pop-up' });
    }
  };

  VX.settingsPage({
    id: 'app-settings/home-screen', title: 'Home Screen', icon: 'layout', order: 1,
    desc: 'What people see on the Home screen of the app: banners, the festival look, the greeting, messages and the order of sections.',
    sections: [bannersSection, festivalSection, greetingSection, broadcastSection, layoutSection, announcementSection]
  });
})();
