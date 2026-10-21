/* VinaX console — Home & promotion page.
 * Everything the owner publishes onto listeners' Home, each one a remote
 * config key written through /api/admin/appconfig (VX.config): 'banners'
 * (Banner[] with optional YYYY-MM-DD start/end, shown live/scheduled/ended
 * against the UTC date the server filters by), 'festival' ({mode:'auto'|
 * 'off'|'force', id?} over the calendar in /admin/festivals.js →
 * window.VX_FESTIVALS), 'greeting' ({text≤160, start?, end?}), 'home-layout'
 * ({title≤60, description≤160, order[], hidden[]≤12}), 'support-faq'
 * ({q≤160, a≤1200}[] ≤30) and 'broadcast' ({id≤40, text≤240, link?, start?,
 * end?}). Every editor has a live preview, Publish, and Clear (value null —
 * the app falls back to its default). */
(function () {
  'use strict';

  /** Black or white text, whichever reads better on a festival accent colour. */
  function inkOn(color) {
    var m = String(color || '').match(/(\d+)[ ,]+(\d+)[ ,]+(\d+)/);
    var hex = String(color || '').match(/^#([0-9a-f]{6})$/i);
    var rgb = m ? [+m[1], +m[2], +m[3]] : hex ? [0, 2, 4].map(function (k) { return parseInt(hex[1].slice(k, k + 2), 16); }) : null;
    if (!rgb) return '#000';
    var L = rgb.map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    var lum = 0.2126 * L[0] + 0.7152 * L[1] + 0.0722 * L[2];
    return (lum + 0.05) / 0.05 >= 1.05 / (lum + 0.05) ? '#000' : '#fff';
  }
  var VX = window.VX, h = VX.h, ui = VX.ui, fmt = VX.fmt;

  VX.page({
    id: 'home', title: 'Home & promotion', group: 'Content', icon: 'layout', noAuto: true,
    desc: 'What every listener sees on Home: banners, festival themes, the greeting, the shelf layout, help answers and announcements.',
    tabs: [
      { id: 'banners', label: 'Banners & offers', desc: 'Promo banners on Home, each with an optional start and end date.', render: renderBanners },
      { id: 'festival', label: 'Festival themes', desc: 'Festival skins follow the calendar automatically. Force one, or switch them off.', render: renderFestival },
      { id: 'greeting', label: 'Home greeting', desc: 'One line at the top of Home for everyone, for as long as you choose.', render: renderGreeting },
      { id: 'layout', label: 'Home layout', desc: 'The default order of Home shelves, and shelves turned off for everyone.', render: renderLayout },
      { id: 'faq', label: 'Help center FAQ', desc: 'Questions and answers at the top of Help & feedback in the app.', render: renderFaq },
      { id: 'announce', label: 'Announcement', desc: 'A dismissible message bar shown to every listener inside the app.', render: renderAnnounce }
    ]
  });

  /* -------------------------------------------------------- helpers */

  /** VX.config.get as a ui.load fetcher: { ok, data: { value, updatedAt } } or an error result. */
  function cfgLoad(key) {
    return VX.config.get(key).then(function (r) {
      if (r.ok) return { ok: true, status: 200, data: r };
      var failed = r.res && !r.res.ok;
      return { ok: false, status: failed ? r.res.status : 503, error: failed ? r.res.error : 'db_unconfigured', message: r.message || 'Could not read the setting.' };
    });
  }
  function publishedLine(cfg, what) {
    return cfg.value == null ? (what || 'Nothing published') + ' — the app uses its default.' : 'Published' + (cfg.updatedAt ? ' ' + fmt.ago(cfg.updatedAt) : '') + '.';
  }
  function publish(key, value, ctx) {
    return VX.config.set(key, value).then(function (res) { if (res.ok) ctx.refresh(); return res; });
  }
  function clearBtn(key, label, body, ctx, disabled, icon) {
    return ui.button(label, { kind: 'ghost', icon: icon || 'trash', disabled: disabled, onClick: function () {
      return VX.confirm({ title: label + '?', body: body, danger: true, confirmLabel: label }).then(function (yes) {
        if (!yes) return null;
        return publish(key, null, ctx);
      });
    } });
  }
  function counter(input, max) {
    var el = h('span.field-hint');
    var upd = function () { var n = input.value.length; el.textContent = n + ' / ' + max; el.style.color = n > max ? 'var(--bad)' : ''; };
    input.addEventListener('input', upd);
    upd();
    return el;
  }
  /** Field with a live "n / max" counter under the control. */
  function cfield(label, input, max) { var f = ui.field(label, input); f.appendChild(counter(input, max)); return f; }
  function todayUtc() { return new Date().toISOString().slice(0, 10); }
  function isoToLocal(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }
  function localToIso(v) {
    if (!v) return '';
    var d = new Date(v);
    return isNaN(d) ? '' : d.toISOString();
  }
  /** Status of an ISO start/end window right now. */
  function windowStatus(start, end) {
    var now = Date.now();
    var s = start ? Date.parse(start) : NaN, e = end ? Date.parse(end) : NaN;
    if (!isNaN(s) && now < s) return { tone: 'info', label: 'Scheduled', detail: 'starts ' + fmt.dateTime(start) };
    if (!isNaN(e) && now > e) return { tone: null, label: 'Ended', detail: 'ended ' + fmt.dateTime(end) };
    return { tone: 'ok', label: 'Live now', detail: !isNaN(e) ? 'until ' + fmt.dateTime(end) : 'until you clear it' };
  }
  function windowProblem(startIso, endIso) {
    if (startIso && endIso && Date.parse(endIso) <= Date.parse(startIso)) return 'The end is before the start.';
    if (endIso && Date.parse(endIso) < Date.now()) return 'That end time has already passed — nobody would see it.';
    return '';
  }
  function dtField(label, iso) { return ui.field(label, ui.input({ type: 'datetime-local', value: isoToLocal(iso) })); }
  function control(field) { return field.querySelector('input, textarea, select'); }

  /* -------------------------------------------------------- banners */

  var LINK_TYPES = [{ value: '', label: 'No link' }, { value: 'song', label: 'Song' }, { value: 'album', label: 'Album' }, { value: 'playlist', label: 'Playlist' }, { value: 'artist', label: 'Artist' }];
  var IMG_MAX = 200 * 1024;

  function bannerStatus(b) {
    var t = todayUtc();
    if (b.start && t < b.start) return { tone: 'info', label: 'Scheduled' };
    if (b.end && t > b.end) return { tone: null, label: 'Ended' };
    return { tone: 'ok', label: 'Live now' };
  }

  function renderBanners(host, ctx) {
    var body = h('div.page-body');
    host.appendChild(body);
    return ui.load(body, function () { return cfgLoad('banners'); }, function (cfg) {
      var saved = Array.isArray(cfg.value) ? cfg.value.filter(function (b) { return b && typeof b === 'object'; }) : [];
      var editing = -1;
      var draft = { title: '', subtitle: '', linkType: '', linkId: '', start: '', end: '', img: '' };

      var title = ui.input({ maxlength: '80', placeholder: 'e.g. Diwali mixes are here' });
      var sub = ui.input({ maxlength: '120', placeholder: 'Optional second line' });
      var linkType = ui.select(LINK_TYPES, '');
      var linkId = ui.input({ maxlength: '64', placeholder: 'Id from Catalog lookup' });
      var start = ui.input({ type: 'date' });
      var end = ui.input({ type: 'date' });
      var file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif' });
      var imgInfo = h('span.field-hint');
      var preview = h('div.preview-box');
      var problem = h('div');
      var formTitle = h('span', 'New banner');
      var cancelEdit = ui.button('Cancel edit', { kind: 'ghost', onClick: function () { load(-1); } });

      function readForm() {
        draft.title = title.value; draft.subtitle = sub.value; draft.linkType = linkType.value; draft.linkId = linkId.value;
        draft.start = start.value; draft.end = end.value;
      }
      function drawPreview() {
        readForm();
        imgRow.hidden = !draft.img && !imgInfo.textContent;
        var pic = draft.img ? h('img.thumb', { src: draft.img, alt: '', style: { width: '40px', height: '40px' } }) : h('span.thumb', { 'aria-hidden': 'true', style: { width: '40px', height: '40px' } });
        var st = bannerStatus(draft);
        VX.mount(preview,
          h('div.media', pic, h('div.grow', h('div.cell-main', draft.title.trim() || 'Your banner title'), draft.subtitle.trim() ? h('div.cell-sub', draft.subtitle.trim()) : null),
            draft.linkType && draft.linkId.trim() ? h('span.muted.small', 'Opens /' + draft.linkType + '/' + draft.linkId.trim()) : null),
          h('p.field-hint', 'Status when published: ', ui.pill(st.label, st.tone)));
        var p = '';
        if (draft.start && draft.end && draft.end < draft.start) p = 'The end date is before the start date.';
        else if (draft.end && draft.end < todayUtc()) p = 'That end date has already passed — nobody would see this banner.';
        else if (draft.linkType && !draft.linkId.trim()) p = 'Add the id of the ' + draft.linkType + ' to open, or choose “No link”.';
        VX.mount(problem, p ? ui.notice(p, 'bad') : null);
        return p;
      }
      [title, sub, linkId, start, end].forEach(function (el) { el.addEventListener('input', drawPreview); });
      linkType.addEventListener('change', drawPreview);
      file.addEventListener('change', function () {
        var f = file.files && file.files[0];
        if (!f) return;
        shrinkImage(f, 160).then(function (url) {
          if (url.length > IMG_MAX) { imgInfo.textContent = 'Still too large after shrinking (' + fmt.bytes(url.length) + '). Use a simpler image.'; drawPreview(); return; }
          draft.img = url;
          imgInfo.textContent = 'Shrunk to ' + fmt.bytes(url.length) + ' — stored inside the published setting.';
          drawPreview();
        }, function () { imgInfo.textContent = 'That file could not be read as an image.'; drawPreview(); });
      });
      var removeImg = ui.button('Remove image', { kind: 'ghost', small: true, onClick: function () { draft.img = ''; file.value = ''; imgInfo.textContent = ''; drawPreview(); } });
      var imgRow = h('div.actions', imgInfo, removeImg);

      function load(i) {
        editing = i;
        var b = i >= 0 ? saved[i] : {};
        title.value = b.title || ''; sub.value = b.subtitle || ''; linkType.value = b.linkType || ''; linkId.value = b.linkId || '';
        start.value = b.start || ''; end.value = b.end || ''; draft.img = b.img || ''; file.value = ''; imgInfo.textContent = '';
        formTitle.textContent = i >= 0 ? 'Edit banner' : 'New banner';
        cancelEdit.hidden = i < 0;
        drawPreview();
        if (i >= 0) title.focus();
      }

      function build() {
        readForm();
        var b = { id: editing >= 0 && saved[editing].id ? saved[editing].id : 'bn' + Date.now().toString(36), title: draft.title.trim() };
        if (draft.subtitle.trim()) b.subtitle = draft.subtitle.trim();
        if (draft.linkType && draft.linkId.trim()) { b.linkType = draft.linkType; b.linkId = draft.linkId.trim(); }
        if (draft.start) b.start = draft.start;
        if (draft.end) b.end = draft.end;
        if (draft.img) b.img = draft.img;
        return b;
      }

      var liveCount = saved.filter(function (b) { return bannerStatus(b).label === 'Live now' && b.title; }).length;
      load(-1);
      return [
        liveCount > 10 ? ui.notice(fmt.num(liveCount) + ' banners are live; the app shows at most 10 of them (rotating one per day).', 'warn') : null,
        ui.grid([
          ui.card({ title: formTitle, sub: 'The app shows one live banner at a time on Home (rotating daily when several are live). Listeners can dismiss it.',
            body: h('div.form',
              cfield('Title', title, 80),
              ui.field('Subtitle', sub),
              h('div.form-row', ui.field('Opens', linkType), ui.field('Link id', linkId)),
              h('div.form-row', ui.field('Start date (optional)', start, 'UTC date'), ui.field('End date (optional)', end, 'Last day shown')),
              ui.field('Small image (optional)', file, 'Shown at 40 × 40 px. Shrunk in the browser before publishing.'),
              imgRow,
              problem,
              h('div.actions',
                ui.button('Publish banner', { kind: 'primary', icon: 'check', onClick: function () {
                  if (!title.value.trim()) { title.classList.add('invalid'); title.focus(); VX.toast('A banner needs a title', 'bad'); return null; }
                  title.classList.remove('invalid');
                  if (drawPreview()) return null;
                  var next = saved.slice();
                  if (editing >= 0) next[editing] = build(); else next.unshift(build());
                  return publish('banners', next, ctx);
                } }),
                cancelEdit)) }),
          ui.card({ title: 'Preview', sub: 'How it sits on Home', body: preview })
        ], 2),
        ui.card({ title: 'Published banners', sub: publishedLine(cfg, 'No banners'), pad: false,
          actions: [clearBtn('banners', 'Remove all banners', 'Every banner disappears from Home within about 5 minutes.', ctx, cfg.value == null)],
          body: ui.table({
            columns: [
              { key: 'title', label: 'Banner', render: function (b) { return bannerCell(b); } },
              { key: 'link', label: 'Opens', sortVal: function (b) { return b.linkType ? b.linkType + ' ' + b.linkId : ''; }, render: function (b) { return b.linkType && b.linkId ? h('span', cap(b.linkType) + ' ', ui.mono(b.linkId)) : h('span.muted', 'No link'); } },
              { key: 'start', label: 'Schedule', render: function (b) { return (b.start ? fmt.day(b.start) : 'Now') + ' → ' + (b.end ? fmt.day(b.end) : 'no end'); } },
              { key: 'status', label: 'Status', sortVal: function (b) { return bannerStatus(b).label; }, render: function (b) { var s = bannerStatus(b); return ui.pill(s.label, s.tone); } },
              { key: 'act', label: '', sort: false, render: function (b) {
                var i = saved.indexOf(b);
                return h('div.actions',
                  ui.button('Edit', { kind: 'ghost', small: true, icon: 'edit', onClick: function () { load(i); } }),
                  ui.button('Delete', { kind: 'ghost', small: true, icon: 'trash', onClick: function () {
                    return VX.confirm({ title: 'Delete this banner?', body: '“' + (b.title || '') + '” is removed from Home within about 5 minutes.', danger: true, confirmLabel: 'Delete' }).then(function (yes) {
                      if (!yes) return null;
                      var next = saved.filter(function (x) { return x !== b; });
                      return publish('banners', next.length ? next : null, ctx);
                    });
                  } }));
              } }
            ],
            rows: saved, exportName: false, search: false,
            empty: 'No banners published', emptyHint: 'Compose one above. It shows on Home within about 5 minutes.'
          }) })
      ];
    }, { skeleton: 6 });
  }

  function bannerCell(b) {
    var img = typeof b.img === 'string' && /^(data:image\/(png|jpeg|webp|gif);|https:\/\/)/.test(b.img) ? b.img : null;
    return h('div.media', img ? h('img.thumb', { src: img, alt: '' }) : h('span.thumb', { 'aria-hidden': 'true' }),
      h('div', h('div.cell-main', b.title || 'Untitled'), b.subtitle ? h('div.cell-sub', b.subtitle) : null));
  }

  /** Read an image file and redraw it at most `max` px wide/tall → data URL. */
  function shrinkImage(file, max) {
    return new Promise(function (resolve, reject) {
      if (!/^image\//.test(file.type)) { reject(new Error('not an image')); return; }
      var reader = new FileReader();
      reader.onerror = reject;
      reader.onload = function () {
        var img = new Image();
        img.onerror = reject;
        img.onload = function () {
          var scale = Math.min(1, max / Math.max(img.width || 1, img.height || 1));
          var c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(img.width * scale)); c.height = Math.max(1, Math.round(img.height * scale));
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          var url = c.toDataURL('image/webp', 0.85);
          if (url.indexOf('data:image/webp') !== 0) url = c.toDataURL('image/png');
          resolve(url);
        };
        img.src = String(reader.result);
      };
      reader.readAsDataURL(file);
    });
  }

  /* ------------------------------------------------------- festival */

  var FESTS = window.VX_FESTIVALS || [];
  function mmdd(d) { return (d.getMonth() + 1) * 100 + d.getDate(); }
  function festById(id) { return FESTS.filter(function (f) { return f.id === id; })[0] || null; }
  /** The festival the calendar puts on today (same rule as the app: local date inside a window). */
  function festToday() {
    var v = mmdd(new Date());
    for (var i = 0; i < FESTS.length; i++) {
      var w = FESTS[i].win || [];
      for (var j = 0; j < w.length; j++) if (v >= w[j][0] && v <= w[j][1]) return FESTS[i];
    }
    return null;
  }
  /** Next calendar festival after today → { fest, date }. */
  function festNext() {
    var now = new Date(), v = mmdd(now), best = null;
    FESTS.forEach(function (f) {
      (f.win || []).forEach(function (w) {
        var startV = w[0];
        var year = now.getFullYear() + (startV > v ? 0 : 1);
        var date = new Date(year, Math.floor(startV / 100) - 1, startV % 100);
        if (!best || date < best.date) best = { fest: f, date: date };
      });
    });
    return best;
  }

  /** Days until a festival's next window starts (0 = on today, Infinity = force-only). */
  function festDaysAway(f) {
    var now = new Date(), v = mmdd(now), best = Infinity;
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    (f.win || []).forEach(function (w) {
      if (v >= w[0] && v <= w[1]) { best = 0; return; }
      var date = new Date(now.getFullYear() + (w[0] > v ? 0 : 1), Math.floor(w[0] / 100) - 1, w[0] % 100);
      best = Math.min(best, Math.round((date - today) / 86400000));
    });
    return best;
  }

  function festThumb(f, size) {
    return f && f.image ? h('img.thumb', { src: f.image, alt: '', style: { width: size + 'px', height: size + 'px', 'object-position': f.imagePosition || 'center' } }) : h('span.thumb', { 'aria-hidden': 'true' });
  }

  function renderFestival(host, ctx) {
    var body = h('div.page-body');
    host.appendChild(body);
    if (!FESTS.length) { VX.mount(body, ui.error('The festival calendar (/admin/festivals.js) did not load. Reload the console.')); return null; }
    return ui.load(body, function () { return cfgLoad('festival'); }, function (cfg) {
      var v = cfg.value && typeof cfg.value === 'object' ? cfg.value : null;
      var mode = v && (v.mode === 'off' || v.mode === 'force') ? v.mode : 'auto';
      var forced = mode === 'force' ? festById(String(v.id || '')) : null;
      var today = festToday();
      var next = festNext();
      var effective = mode === 'off' ? null : mode === 'force' ? forced : today;
      var q = String(ctx.params.q || '').toLowerCase();
      var gridHost = h('div');

      function set(value, label) {
        return VX.config.set('festival', value, { silent: true }).then(function (res) {
          if (res.ok) { VX.toast(label + ' — listeners update within about a minute', 'ok'); ctx.refresh(); }
          else VX.toast('Could not save: ' + res.message, 'bad');
          return res;
        });
      }

      function drawGrid(filter) {
        var list = FESTS.filter(function (f) { return !filter || (f.name + ' ' + f.when + ' ' + f.id).toLowerCase().indexOf(filter) >= 0; })
          .map(function (f, i) { return { f: f, i: i, d: forced && forced.id === f.id ? -1 : festDaysAway(f) }; })
          .sort(function (a, b) { return a.d - b.d || a.i - b.i; }).map(function (x) { return x.f; });
        VX.mount(gridHost, list.length ? ui.grid(list.map(function (f) {
          var isForced = forced && forced.id === f.id, isToday = today && today.id === f.id, isNext = next && next.fest.id === f.id;
          return ui.card({
            title: f.name, sub: f.when, tone: isForced ? 'warn' : null,
            body: h('div.page-body', { style: { gap: '10px' } },
              h('div', {
                role: 'img', 'aria-label': f.name + ' theme preview',
                style: { height: '64px', 'border-radius': '10px', 'background-color': f.canvas || '#111', 'background-image': f.image ? 'linear-gradient(180deg, rgba(5,7,15,.05), rgba(5,7,15,.7)), url("' + String(f.image).replace(/"/g, '%22') + '")' : null, 'background-size': 'cover', 'background-position': f.imagePosition || 'center', position: 'relative', border: '1px solid var(--border)' }
              }, h('span', { style: { position: 'absolute', right: '10px', bottom: '8px', padding: '3px 10px', 'border-radius': '99px', background: f.accent || 'var(--accent)', color: inkOn(f.accent), 'font-size': '11px', 'font-weight': '800' } }, 'Play')),
              h('div.actions',
                isForced ? ui.pill('Forced now', 'warn') : null,
                isToday ? ui.pill(mode === 'auto' ? 'On today' : 'Calendar: today', 'ok') : null,
                isNext ? ui.pill('Next · ' + fmt.date(next.date.toISOString()), 'info') : null,
                f.forceOnly ? ui.pill('Force only') : null,
                h('span.grow'),
                (f.colors || []).slice(0, 4).map(function (c) { return h('span.swatch', { title: c, style: { background: c, width: '14px', height: '14px', 'border-radius': '4px', display: 'inline-block' } }); })),
              f.fx ? h('p.field-hint', f.fx) : null,
              h('div.actions', isForced
                ? ui.button('Back to calendar', { kind: 'ghost', small: true, onClick: function () { return set({ mode: 'auto' }, 'Following the calendar'); } })
                : ui.button('Force now', { kind: 'ghost', small: true, icon: 'play', onClick: function () {
                  return VX.confirm({ title: 'Force ' + f.name + '?', body: 'Every listener wears this festival’s theme — splash, colours and effects — until you switch back to the calendar.', confirmLabel: 'Force theme' }).then(function (yes) { return yes ? set({ mode: 'force', id: f.id }, 'Forced ' + f.name) : null; });
                } })))
          });
        }), 3) : ui.empty('No festival matches “' + filter + '”'));
      }
      drawGrid(q);

      var statusText = mode === 'off' ? 'Festival themes are off for everyone.'
        : mode === 'force' ? (forced ? 'Forced: ' + forced.name + ' (ignores the calendar).' : 'Forced to an unknown festival id “' + String(v.id || '') + '” — the app shows the default theme.')
        : today ? 'Following the calendar: ' + today.name + ' is on today.' : 'Following the calendar: no festival today.';

      return [
        ui.card({ title: 'Now showing', sub: publishedLine(cfg, 'Calendar mode'),
          actions: [cfg.value != null ? clearBtn('festival', 'Clear setting', 'The app goes back to following the calendar (the same as Auto).', ctx, false, 'refresh') : null],
          body: h('div.page-body',
            h('div.media', festThumb(effective, 48), h('div', h('div.cell-main', effective ? effective.name : 'Default theme'), h('div.cell-sub', statusText))),
            h('div.actions',
              ui.segmented([{ value: 'auto', label: 'Follow calendar' }, { value: 'off', label: 'Off for everyone' }], mode, function (m) {
                if (m === 'auto') set({ mode: 'auto' }, 'Following the calendar');
                else set({ mode: 'off' }, 'Festival themes off');
              }, 'Festival mode'),
              mode === 'force' ? ui.pill('Forced', 'warn') : null,
              next ? h('span.muted.small', 'Next on the calendar: ' + next.fest.name + ' · ' + fmt.date(next.date.toISOString())) : null)) }),
        h('div.toolbar', ui.search('Find a festival…', function (val) { ctx.setParam('q', val); drawGrid(val.toLowerCase()); }, q), h('span.muted.small', fmt.plural(FESTS.length, 'festival') + ' · soonest first, force-only at the end')),
        gridHost
      ];
    }, { skeleton: 4 });
  }

  /* ------------------------------------------------------- greeting */

  function renderGreeting(host, ctx) {
    var body = h('div.page-body');
    host.appendChild(body);
    return ui.load(body, function () { return cfgLoad('greeting'); }, function (cfg) {
      var v = cfg.value && typeof cfg.value === 'object' ? cfg.value : {};
      var text = ui.input({ value: v.text || '', maxlength: '160', placeholder: 'Festival week — new mixes every day' });
      var startF = dtField('Show from (optional)', v.start), endF = dtField('Show until (optional)', v.end);
      var preview = h('div.preview-box');
      var problem = h('div');
      function draw() {
        var t = text.value.trim();
        VX.mount(preview, h('p.muted.small', 'Top of Home'), h('h2', t || 'Good evening'), h('p.field-hint', t ? 'Replaces the personal greeting while the window is open.' : 'Empty — Home shows its usual personal greeting.'));
        var p = windowProblem(localToIso(control(startF).value), localToIso(control(endF).value));
        VX.mount(problem, p ? ui.notice(p, 'bad') : null);
        return p;
      }
      [text, control(startF), control(endF)].forEach(function (el) { el.addEventListener('input', draw); });
      draw();
      var st = v.text ? windowStatus(v.start, v.end) : null;
      return ui.grid([
        ui.card({ title: 'Home greeting', sub: st ? 'Published “' + fmt.trunc(v.text, 60) + '” · ' + st.detail : publishedLine(cfg, 'Nothing published'),
          actions: st ? [ui.pill(st.label, st.tone)] : null,
          body: h('div.form',
            cfield('Line', text, 160),
            h('div.form-row', startF, endF),
            h('p.field-hint', 'Times are in your browser’s time zone. Leave both empty to show it until you clear it.'),
            problem,
            h('div.actions',
              ui.button('Publish greeting', { kind: 'primary', icon: 'check', onClick: function () {
                var t = text.value.trim();
                if (!t) { text.classList.add('invalid'); text.focus(); VX.toast('Write the line first', 'bad'); return null; }
                if (draw()) return null;
                var out = { text: t.slice(0, 160) };
                var s = localToIso(control(startF).value), e = localToIso(control(endF).value);
                if (s) out.start = s;
                if (e) out.end = e;
                return publish('greeting', out, ctx);
              } }),
              clearBtn('greeting', 'Clear greeting', 'Home goes back to its usual personal greeting.', ctx, cfg.value == null))) }),
        ui.card({ title: 'Preview', body: preview })
      ], 2);
    }, { skeleton: 4 });
  }

  /* --------------------------------------------------------- layout */

  var SHELVES = ['quick', 'personal', 'aihome', 'discovery', 'charts', 'seasonal', 'moods', 'genres', 'artists', 'albums', 'daypicks', 'loved', 'feed'];
  var SHELF_LABEL = { quick: 'Quick picks', personal: 'Made for you', aihome: 'Designed for you (AI shelves)', discovery: 'Fresh discoveries', charts: 'Charts', seasonal: 'Seasonal listening', moods: 'Moods', genres: 'Genres', artists: 'Artists', albums: 'Albums', daypicks: 'For your day', loved: 'Favourites', feed: 'More to explore' };
  var LAYOUT_DEFAULT = { title: 'Your next favorite starts here.', description: 'Familiar voices, fresh discoveries. A mix that grows with you.' };

  function renderLayout(host, ctx) {
    var body = h('div.page-body');
    host.appendChild(body);
    return ui.load(body, function () { return cfgLoad('home-layout'); }, function (cfg) {
      var v = cfg.value && typeof cfg.value === 'object' && !Array.isArray(cfg.value) ? cfg.value : {};
      var order = (Array.isArray(v.order) ? v.order : []).filter(function (k, i, a) { return SHELVES.indexOf(k) >= 0 && a.indexOf(k) === i; });
      SHELVES.forEach(function (k) { if (order.indexOf(k) < 0) order.push(k); });
      var hidden = {};
      (Array.isArray(v.hidden) ? v.hidden : []).forEach(function (k) { if (SHELVES.indexOf(k) >= 0) hidden[k] = true; });
      var title = ui.input({ value: v.title || '', maxlength: '60', placeholder: LAYOUT_DEFAULT.title });
      var desc = ui.input({ value: v.description || '', maxlength: '160', placeholder: LAYOUT_DEFAULT.description });
      var list = h('ol.list');
      var preview = h('div.preview-box');
      var msg = h('div');

      function hiddenList() { return order.filter(function (k) { return hidden[k]; }); }
      function draw(focus) {
        VX.clear(list);
        order.forEach(function (k, i) {
          var up = h('button.icon-btn', { type: 'button', 'aria-label': 'Move ' + SHELF_LABEL[k] + ' up', disabled: i === 0, onclick: function () { swap(i, i - 1, k); } }, h('span', { 'aria-hidden': 'true' }, '↑'));
          var down = h('button.icon-btn', { type: 'button', 'aria-label': 'Move ' + SHELF_LABEL[k] + ' down', disabled: i === order.length - 1, onclick: function () { swap(i, i + 1, k); } }, h('span', { 'aria-hidden': 'true' }, '↓'));
          var tg = ui.toggle(hidden[k] ? 'Off' : 'Shown', !hidden[k], function (on, cb) {
            if (!on && hiddenList().length >= 12) { cb.checked = true; VX.toast('At most 12 shelves can be turned off', 'bad'); return; }
            if (!on && hiddenList().length + 1 >= order.length) { cb.checked = true; VX.toast('At least one shelf must stay on', 'bad'); return; }
            hidden[k] = !on; draw();
          }, { 'aria-label': 'Show ' + SHELF_LABEL[k] });
          list.appendChild(h('li', h('span.muted', { style: { width: '22px', 'text-align': 'right' } }, String(i + 1)), h('div.grow', h('div.cell-main', SHELF_LABEL[k]), h('div.cell-sub', k)), tg, up, down));
          if (focus === k) setTimeout(function () { (up.disabled ? down : up).focus(); }, 0);
        });
        drawPreview();
      }
      function swap(i, j, k) { if (j < 0 || j >= order.length) return; var t = order[i]; order[i] = order[j]; order[j] = t; draw(k); }
      function drawPreview() {
        VX.mount(preview,
          h('h2', title.value.trim() || LAYOUT_DEFAULT.title),
          h('p.muted', desc.value.trim() || LAYOUT_DEFAULT.description),
          h('ol', order.filter(function (k) { return !hidden[k]; }).map(function (k) { return h('li', SHELF_LABEL[k]); })),
          hiddenList().length ? h('p.field-hint', 'Turned off for everyone: ' + hiddenList().map(function (k) { return SHELF_LABEL[k]; }).join(', ')) : null);
      }
      title.addEventListener('input', drawPreview);
      desc.addEventListener('input', drawPreview);
      draw();
      return ui.grid([
        ui.card({ title: 'Home layout', sub: 'Listeners can still reorder and hide shelves on their own Home, but cannot bring back a shelf you turned off. ' + publishedLine(cfg),
          body: h('div.form',
            cfield('Headline', title, 60),
            cfield('Description', desc, 160),
            h('div.field', h('span.field-label', 'Shelves, top first'), list),
            msg,
            h('div.actions',
              ui.button('Publish layout', { kind: 'primary', icon: 'check', onClick: function () {
                return publish('home-layout', { title: title.value.trim().slice(0, 60), description: desc.value.trim().slice(0, 160), order: order.slice(), hidden: hiddenList().slice(0, 12) }, ctx);
              } }),
              clearBtn('home-layout', 'Back to default', 'Home uses its built-in headline, order and shelves again.', ctx, cfg.value == null, 'refresh'))) }),
        ui.card({ title: 'Preview', sub: 'Default Home for a new listener', body: preview })
      ], 2);
    }, { skeleton: 6 });
  }

  /* ------------------------------------------------------------ faq */

  function renderFaq(host, ctx) {
    var body = h('div.page-body');
    host.appendChild(body);
    return ui.load(body, function () { return cfgLoad('support-faq'); }, function (cfg) {
      var items = (Array.isArray(cfg.value) ? cfg.value : []).filter(function (x) { return x && typeof x === 'object'; }).map(function (x) { return { q: String(x.q || ''), a: String(x.a || '') }; });
      if (!items.length) items.push({ q: '', a: '' });
      var list = h('div.editor-list');
      var preview = h('div.preview-box');
      var count = h('span.muted.small');
      function draw(focusIdx) {
        VX.clear(list);
        items.forEach(function (it, i) {
          var q = ui.input({ value: it.q, maxlength: '160', placeholder: 'Question', 'aria-label': 'Question ' + (i + 1) });
          var a = ui.textarea({ value: it.a, maxlength: '1200', rows: 3, placeholder: 'Answer', 'aria-label': 'Answer ' + (i + 1) });
          q.addEventListener('input', function () { it.q = q.value; drawPreview(); });
          a.addEventListener('input', function () { it.a = a.value; drawPreview(); });
          var move = function (j) { if (j < 0 || j >= items.length) return; var t = items[i]; items[i] = items[j]; items[j] = t; draw(j); };
          list.appendChild(h('div.editor-row',
            h('div.form', { style: { 'max-width': 'none', gap: '8px' } }, q, a, counter(a, 1200)),
            h('div.actions', { style: { 'flex-direction': 'column' } },
              h('button.icon-btn', { type: 'button', 'aria-label': 'Move question ' + (i + 1) + ' up', disabled: i === 0, onclick: function () { move(i - 1); } }, h('span', { 'aria-hidden': 'true' }, '↑')),
              h('button.icon-btn', { type: 'button', 'aria-label': 'Move question ' + (i + 1) + ' down', disabled: i === items.length - 1, onclick: function () { move(i + 1); } }, h('span', { 'aria-hidden': 'true' }, '↓')),
              h('button.icon-btn', { type: 'button', 'aria-label': 'Remove question ' + (i + 1), onclick: function () { items.splice(i, 1); if (!items.length) items.push({ q: '', a: '' }); draw(); } }, VX.icon('trash')))));
          if (focusIdx === i) setTimeout(function () { q.focus(); }, 0);
        });
        drawPreview();
      }
      function clean() { return items.map(function (x) { return { q: x.q.trim().slice(0, 160), a: x.a.trim().slice(0, 1200) }; }).filter(function (x) { return x.q && x.a; }); }
      function drawPreview() {
        var c = clean();
        count.textContent = fmt.num(c.length) + ' of 30';
        VX.mount(preview, c.length ? c.map(function (x) { return h('details', h('summary', h('strong', x.q)), h('p', { style: { 'white-space': 'pre-wrap' } }, x.a)); }) : ui.empty('No questions yet', 'Only questions with an answer are published.'));
      }
      draw();
      return ui.grid([
        ui.card({ title: 'Help center FAQ', sub: 'Up to 30 questions. Rows without both a question and an answer are skipped. ' + publishedLine(cfg, 'No FAQ'), actions: [count],
          body: h('div.form', { style: { 'max-width': 'none' } },
            list,
            h('div.actions', ui.button('Add a question', { kind: 'ghost', small: true, icon: 'plus', disabled: items.length >= 30, onClick: function () { if (items.length >= 30) return; items.push({ q: '', a: '' }); draw(items.length - 1); } })),
            h('div.actions',
              ui.button('Publish FAQ', { kind: 'primary', icon: 'check', onClick: function () {
                var c = clean();
                if (!c.length) { VX.toast('Add at least one question with an answer, or use Clear', 'bad'); return null; }
                if (c.length > 30) { VX.toast('At most 30 questions', 'bad'); return null; }
                return publish('support-faq', c, ctx);
              } }),
              clearBtn('support-faq', 'Clear FAQ', 'The FAQ disappears from Help & feedback.', ctx, cfg.value == null))) }),
        ui.card({ title: 'Preview', sub: 'As listeners see it in Help & feedback', body: preview })
      ], 2);
    }, { skeleton: 5 });
  }

  /* ------------------------------------------------------- announce */

  function renderAnnounce(host, ctx) {
    var body = h('div.page-body');
    host.appendChild(body);
    return ui.load(body, function () { return cfgLoad('broadcast'); }, function (cfg) {
      var v = cfg.value && typeof cfg.value === 'object' ? cfg.value : {};
      var text = ui.textarea({ value: v.text || '', maxlength: '240', rows: 3, placeholder: 'New: Listen Together is here — invite a friend.' });
      var link = ui.input({ value: v.link || '', maxlength: '200', placeholder: '/together' });
      var startF = dtField('Show from (optional)', v.start), endF = dtField('Show until (optional)', v.end);
      var preview = h('div.preview-box');
      var problem = h('div');
      function draw() {
        var t = text.value.trim(), l = link.value.trim();
        VX.mount(preview, h('div.media', h('span.dot.info', { 'aria-hidden': 'true' }), h('div.grow', h('div.cell-main', t || 'Your announcement'), l ? h('div.cell-sub', 'Tapping opens ' + l) : null), h('span.muted', { 'aria-hidden': 'true' }, '✕')));
        var p = l && (l.charAt(0) !== '/' || l.charAt(1) === '/') ? 'The link must be a path inside the app that starts with “/”, e.g. /together.' : windowProblem(localToIso(control(startF).value), localToIso(control(endF).value));
        VX.mount(problem, p ? ui.notice(p, 'bad') : null);
        return p;
      }
      [text, link, control(startF), control(endF)].forEach(function (el) { el.addEventListener('input', draw); });
      draw();
      var st = v.text ? windowStatus(v.start, v.end) : null;
      return ui.grid([
        ui.card({ title: 'Announcement', sub: st ? 'Published: “' + fmt.trunc(v.text, 60) + '” · ' + st.detail : publishedLine(cfg, 'Nothing published'),
          actions: st ? [ui.pill(st.label, st.tone)] : null,
          body: h('div.form',
            cfield('Message', text, 240),
            ui.field('Opens (optional)', link, 'A path in the app, e.g. /together or /search'),
            h('div.form-row', startF, endF),
            problem,
            h('div.actions',
              ui.button('Publish announcement', { kind: 'primary', icon: 'send', onClick: function () {
                var t = text.value.trim(), l = link.value.trim();
                if (!t) { text.classList.add('invalid'); text.focus(); VX.toast('Write the message first', 'bad'); return null; }
                if (draw()) return null;
                // A new id when the words change, so listeners who dismissed the old one see this one.
                var same = v.id && v.text === t && (v.link || '') === l;
                var out = { id: same ? String(v.id).slice(0, 40) : 'a' + Date.now().toString(36), text: t.slice(0, 240) };
                if (l) out.link = l.slice(0, 200);
                var s = localToIso(control(startF).value), e = localToIso(control(endF).value);
                if (s) out.start = s;
                if (e) out.end = e;
                return publish('broadcast', out, ctx);
              } }),
              clearBtn('broadcast', 'Stop showing', 'The announcement disappears for every listener within about a minute.', ctx, cfg.value == null)),
            h('p.field-hint', 'Changing the words counts as a new announcement: listeners who closed the old one will see it.')) }),
        ui.card({ title: 'Preview', sub: 'The bar at the top of the app', body: preview })
      ], 2);
    }, { skeleton: 4 });
  }

  function cap(s) { s = String(s == null ? '' : s); return s ? s.charAt(0).toUpperCase() + s.slice(1) : '—'; }
})();
