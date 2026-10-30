/* VinaX console — Publish page.
 * The published settings (GET /api/admin/settings → keys, values, updated;
 * GET ?key= → one key with its history; POST { key, value } writes, value
 * null clears). Every key has a JSON editor; the common ones also have a
 * small form that produces the JSON. */
(function () {
  'use strict';
  var VX = window.VX, h = VX.h, ui = VX.ui, fmt = VX.fmt, arr = VX.arr, obj = VX.obj, num = VX.num;

  VX.page({
    id: 'publish', title: 'Publish', group: 'Content', icon: 'layout', noAuto: true,
    desc: 'Settings the app reads live: banners, greeting, Home layout, announcement, feature switches, site mode and more.',
    render: render
  });

  /* ----------------------------------------------------------- forms */
  // Each form: build(value) → { el, read() → value | throws Error(message) }.
  var str = function (v) { return v == null ? '' : String(v); };
  function dateInput(value, label) { return ui.input({ type: 'date', value: str(value).slice(0, 10), 'aria-label': label }); }
  function textVal(inp) { var v = inp.value.trim(); return v || undefined; }
  function clean(o) { Object.keys(o).forEach(function (k) { if (o[k] === undefined || o[k] === '') delete o[k]; }); return o; }

  var FORMS = {
    greeting: function (value) {
      var v = obj(value);
      var text = ui.input({ value: str(v.text), maxlength: 160, placeholder: 'Good evening — new Telugu releases are in.' });
      var start = dateInput(v.start, 'Start date'), end = dateInput(v.end, 'End date');
      return { el: h('div.form', ui.field('Text', text, 'Up to 160 characters, shown under the Home title.'), h('div.form-row', ui.field('From', start), ui.field('Until', end))),
        read: function () { if (!text.value.trim()) throw new Error('The greeting needs a text.'); return clean({ text: text.value.trim(), start: textVal(start), end: textVal(end) }); } };
    },
    broadcast: function (value) {
      var v = obj(value);
      var id = ui.input({ value: str(v.id) || 'b-' + VX.stamp(), maxlength: 40 });
      var text = ui.textarea({ value: str(v.text), rows: 2, maxlength: 240 });
      var link = ui.input({ value: str(v.link), maxlength: 200, placeholder: '/charts (a path on the site)' });
      var start = dateInput(v.start, 'Start date'), end = dateInput(v.end, 'End date');
      return { el: h('div.form', ui.field('Id', id, 'Change it to show the bar again to people who dismissed the previous one.'), ui.field('Text', text), ui.field('Link', link, 'Optional; a site path starting with /.'), h('div.form-row', ui.field('From', start), ui.field('Until', end))),
        read: function () {
          if (!text.value.trim()) throw new Error('The broadcast needs a text.');
          if (link.value.trim() && link.value.trim().charAt(0) !== '/') throw new Error('The link must be a site path starting with /.');
          return clean({ id: id.value.trim() || 'b-' + VX.stamp(), text: text.value.trim(), link: textVal(link), start: textVal(start), end: textVal(end) });
        } };
    },
    announcement: function (value) {
      var v = obj(value);
      var title = ui.input({ value: str(v.title), maxlength: 120 });
      var body = ui.textarea({ value: str(v.body), rows: 3, maxlength: 300 });
      var link = ui.input({ value: str(v.link) || '/', maxlength: 200 });
      return { el: h('div.form', ui.notice('The Android app shows this once as a notification when it opens. Saving stamps a new time, so everyone sees it again.', 'info'), ui.field('Title', title), ui.field('Body', body), ui.field('Link', link, 'A site path starting with /.')),
        read: function () {
          if (!title.value.trim()) throw new Error('The announcement needs a title.');
          var l = link.value.trim() || '/';
          if (l.charAt(0) !== '/') throw new Error('The link must be a site path starting with /.');
          return { title: title.value.trim(), body: body.value.trim(), link: l, ts: Date.now() };
        } };
    },
    'status-note': function (value) {
      var v = obj(value);
      var text = ui.textarea({ value: str(v.text), rows: 3, maxlength: 400, placeholder: 'We are looking into slow searches since 18:00 IST.' });
      return { el: h('div.form', ui.field('Note', text, 'Shown at the top of status.vinaxmusic.online. Clear the key to remove it.')),
        read: function () { if (!text.value.trim()) throw new Error('Type a note, or use Clear to remove it.'); return { text: text.value.trim() }; } };
    },
    'site-mode': function (value) {
      var v = obj(value);
      var mode = ui.select([{ value: 'live', label: 'Live — the app works normally' }, { value: 'maintenance', label: 'Maintenance — everyone sees the gate' }], v.mode === 'maintenance' ? 'maintenance' : 'live');
      var note = ui.textarea({ value: str(v.note), rows: 2, maxlength: 200, placeholder: 'VinaX is getting a quick tune-up.' });
      var warn = ui.notice('Maintenance puts every listener behind a gate within a minute: no browsing, no search, no playback except what is already downloaded. Use it only while something is really broken.', 'bad');
      warn.hidden = mode.value !== 'maintenance';
      mode.addEventListener('change', function () { warn.hidden = mode.value !== 'maintenance'; });
      return { el: h('div.form', ui.field('Mode', mode), warn, ui.field('Note', note, 'Shown on the gate while in maintenance.')),
        read: function () { return clean({ mode: mode.value, note: textVal(note) }); }, danger: function () { return mode.value === 'maintenance'; } };
    },
    'min-version': function (value) {
      var v = obj(value);
      var build = ui.input({ type: 'number', min: 1, step: 1, value: str(v.build), style: { 'max-width': '160px' } });
      return { el: h('div.form', ui.field('Minimum Android build', build, 'Builds below this number must update before they can play. Leave empty and Clear to lift it.')),
        read: function () { var n = Math.floor(num(build.value)); if (n < 1) throw new Error('Enter a build number above 0.'); return { build: n }; } };
    },
    retention: function (value) {
      var v = obj(value);
      var days = ui.input({ type: 'number', min: 7, max: 3650, step: 1, value: str(v.eventsDays || 180), style: { 'max-width': '160px' } });
      return { el: h('div.form', ui.field('Keep usage events for (days)', days, 'Housekeeping deletes older events every hour. 7 to 3650.')),
        read: function () { var n = Math.floor(num(days.value)); if (n < 7 || n > 3650) throw new Error('Days must be between 7 and 3650.'); return { eventsDays: n }; } };
    },
    push: function (value) {
      var v = obj(value);
      var gap = ui.input({ type: 'number', min: 0, max: 168, step: 1, value: str(v.minGapHours != null ? v.minGapHours : 20), style: { 'max-width': '140px' } });
      var qs = ui.input({ type: 'number', min: 0, max: 23, step: 1, value: str(v.quietStart != null ? v.quietStart : 22), style: { 'max-width': '140px' } });
      var qe = ui.input({ type: 'number', min: 0, max: 23, step: 1, value: str(v.quietEnd != null ? v.quietEnd : 8), style: { 'max-width': '140px' } });
      return { el: h('div.form', h('div.form-row', ui.field('Hours between pushes to one device', gap), ui.field('Quiet hours start', qs, 'Device local time, 0–23'), ui.field('Quiet hours end', qe))),
        read: function () { return { minGapHours: Math.max(0, Math.min(168, Math.floor(num(gap.value)))), quietStart: Math.max(0, Math.min(23, Math.floor(num(qs.value)))), quietEnd: Math.max(0, Math.min(23, Math.floor(num(qe.value)))) }; } };
    },
    banners: function (value) {
      var rows = arr(value).map(function (b) { return obj(b); });
      var list = h('div.editor-list');
      var inputs = [];
      function draw() {
        VX.clear(list); inputs = [];
        rows.forEach(function (b, i) {
          var f = {
            title: ui.input({ value: str(b.title), maxlength: 80, placeholder: 'Title', 'aria-label': 'Banner ' + (i + 1) + ' title' }),
            subtitle: ui.input({ value: str(b.subtitle), maxlength: 120, placeholder: 'Subtitle', 'aria-label': 'Banner ' + (i + 1) + ' subtitle' }),
            linkType: ui.select([{ value: '', label: 'No link' }, { value: 'song', label: 'Song' }, { value: 'album', label: 'Album' }, { value: 'playlist', label: 'Playlist' }, { value: 'artist', label: 'Artist' }, { value: 'url', label: 'Site path' }], str(b.linkType)),
            linkId: ui.input({ value: str(b.linkId), maxlength: 200, placeholder: 'Id or path', 'aria-label': 'Banner ' + (i + 1) + ' link' }),
            img: ui.input({ value: str(b.img), maxlength: 500, placeholder: 'https://… image', 'aria-label': 'Banner ' + (i + 1) + ' image' }),
            start: dateInput(b.start, 'Banner ' + (i + 1) + ' start'), end: dateInput(b.end, 'Banner ' + (i + 1) + ' end'),
            id: str(b.id) || 'bn-' + VX.rid().slice(0, 6)
          };
          inputs.push(f);
          list.appendChild(h('div.editor-row',
            h('div.form', { style: { 'max-width': 'none' } }, h('div.form-row', f.title, f.subtitle), h('div.form-row', f.linkType, f.linkId), h('div.form-row', f.img, f.start, f.end)),
            ui.button('', { kind: 'ghost', small: true, icon: 'trash', ariaLabel: 'Remove banner', onClick: function () { rows.splice(i, 1); draw(); } })));
        });
        if (!rows.length) list.appendChild(ui.empty('No banners', 'Add one — at most ten are shown.'));
      }
      draw();
      return { el: h('div.form', { style: { 'max-width': 'none' } }, list, h('div.actions', ui.button('Add banner', { kind: 'ghost', small: true, icon: 'plus', disabled: rows.length >= 10, onClick: function () { if (rows.length < 10) { rows.push({}); draw(); } } }))),
        read: function () {
          var out = inputs.map(function (f) {
            if (!f.title.value.trim()) throw new Error('Every banner needs a title.');
            var img = f.img.value.trim();
            if (img && !/^https:\/\//.test(img)) throw new Error('Banner images must be https:// links.');
            return clean({ id: f.id, title: f.title.value.trim(), subtitle: textVal(f.subtitle), linkType: f.linkType.value || undefined, linkId: f.linkType.value ? textVal(f.linkId) : undefined, img: img || undefined, start: textVal(f.start), end: textVal(f.end) });
          });
          return out;
        } };
    },
    flags: function (value) {
      var v = obj(value);
      var KNOWN = [
        { key: 'listenTogether', label: 'Listen Together', note: 'Off hides the entries in the app.' }
      ];
      var keys = KNOWN.map(function (k) { return k.key; });
      Object.keys(v).forEach(function (k) { if (keys.indexOf(k) < 0 && typeof v[k] === 'boolean') { KNOWN.push({ key: k, label: k, note: 'Set earlier from JSON.' }); keys.push(k); } });
      var toggles = {};
      var list = h('ul.list', KNOWN.map(function (k) {
        var t = ui.toggle(k.label, v[k.key] !== false, null, { 'aria-label': k.label });
        toggles[k.key] = t;
        return h('li', t, h('span.grow.muted.small', k.note));
      }));
      return { el: h('div.form', { style: { 'max-width': 'none' } }, ui.notice('A switch that is on (or missing) means the feature works as built. Off turns it off for every listener within a minute.', 'info'), list),
        read: function () { var out = {}; Object.keys(toggles).forEach(function (k) { out[k] = toggles[k].input.checked; }); return out; } };
    }
  };

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
      function drawList() {
        var groups = [];
        var byGroup = {};
        keys.forEach(function (k) { var g = k.group || 'Other'; if (!byGroup[g]) { byGroup[g] = []; groups.push(g); } byGroup[g].push(k); });
        VX.mount(listHost, ui.card({ pad: false, body: h('div', { style: { padding: '6px 8px 10px' } }, groups.map(function (g) {
          return [h('div.key-group', g), h('ul.key-list', byGroup[g].map(function (k) {
            var set = values[k.key] !== undefined && values[k.key] !== null;
            return h('li', h('button', { type: 'button', 'aria-current': String(k.key === current), onclick: function () { current = k.key; ctx.setParam('key', k.key); drawList(); drawEditor(); } },
              h('span.key-title', k.title || k.key, ' ', set ? ui.pill('Set', 'ok') : null),
              h('span.key-sub', set && obj(updated[k.key]).at ? 'Edited ' + fmt.ago(updated[k.key].at) : 'Using the app default')));
          }))];
        })) }));
      }
      function drawEditor(override) {
        var spec = keys.filter(function (k) { return k.key === current; })[0] || { key: current };
        var value = override !== undefined ? override : values[current];
        var up = obj(updated[current]);
        var form = FORMS[spec.key] ? FORMS[spec.key](value) : null;
        var mode = form ? 'form' : 'json';
        var json = ui.textarea({ class: 'code', value: value === undefined || value === null ? '' : JSON.stringify(value, null, 2), rows: 12, spellcheck: 'false', 'aria-label': 'JSON value' });
        var err = h('p.login-err', { role: 'alert' });
        var formHost = h('div', form ? form.el : null);
        var jsonHost = h('div', ui.field('JSON', json, 'The exact value stored. ' + (spec.note || '')));
        jsonHost.hidden = mode !== 'json'; formHost.hidden = mode !== 'form';
        function toJsonMode() {
          if (mode === 'form' && form) { try { json.value = JSON.stringify(form.read(), null, 2); } catch (e) { /* leave the textarea as is */ } }
          mode = 'json'; jsonHost.hidden = false; formHost.hidden = true; err.textContent = '';
        }
        function toFormMode() {
          var v;
          try { v = json.value.trim() ? JSON.parse(json.value) : null; } catch (e) { err.textContent = 'Fix the JSON first: ' + e.message; return; }
          form = FORMS[spec.key](v); VX.mount(formHost, form.el);
          mode = 'form'; jsonHost.hidden = true; formHost.hidden = false; err.textContent = '';
        }
        function readValue() {
          if (mode === 'form' && form) return form.read();
          if (!json.value.trim()) throw new Error('The value is empty — use Clear to remove the key.');
          try { return JSON.parse(json.value); } catch (e) { throw new Error('Not valid JSON: ' + e.message); }
        }
        function save() {
          var v;
          try { v = readValue(); } catch (e) { err.textContent = e.message; json.classList.add('invalid'); return Promise.resolve(); }
          json.classList.remove('invalid'); err.textContent = '';
          var go = function () {
            return VX.api.post('/api/admin/settings', { key: spec.key, value: v }).then(function (res) {
              if (!res.ok) { err.textContent = res.error === 'unknown_key' ? 'The server does not know this key.' : res.error === 'too_large' ? 'The value is too large (60 KB limit).' : res.message; return; }
              values[spec.key] = v; updated[spec.key] = { at: new Date().toISOString(), by: 'owner' };
              VX.toast('Published', 'ok'); drawList(); drawEditor();
            });
          };
          if (form && form.danger && form.danger()) {
            return VX.confirm({ title: 'Put the site in maintenance?', body: 'Every listener sees the gate within a minute and cannot browse or play until you set the mode back to Live.', danger: true, typed: 'MAINTENANCE', confirmLabel: 'Switch to maintenance' }).then(function (yes) { if (yes) return go(); });
          }
          return go();
        }
        function clear() {
          return VX.confirm({ title: 'Clear ' + (spec.title || spec.key) + '?', body: 'The app goes back to its built-in default for this setting.', danger: true, confirmLabel: 'Clear' }).then(function (yes) {
            if (!yes) return;
            return VX.api.post('/api/admin/settings', { key: spec.key, value: null }).then(function (res) {
              if (!res.ok) { err.textContent = res.message; return; }
              delete values[spec.key]; delete updated[spec.key];
              VX.toast('Cleared', 'ok'); drawList(); drawEditor();
            });
          });
        }
        var history = h('div');
        ui.load(history, function () { return VX.api.get('/api/admin/settings', { key: spec.key }, { fresh: true }); }, function (hd) {
          var rows = arr(hd.history);
          if (!rows.length) return ui.empty('No history yet', 'Every save and clear of this key is listed here.');
          return h('ul.list', rows.slice(0, 20).map(function (r) {
            return h('li', h('span.feed-time', fmt.ago(r.at)), h('div.grow', h('div.cell-main', r.value === null || r.value === undefined ? 'Cleared' : fmt.trunc(JSON.stringify(r.value), 90)), h('div.cell-sub', 'by ' + (r.by || 'owner') + ' · ' + fmt.dateTime(r.at))),
              r.value !== null && r.value !== undefined ? ui.button('Restore', { kind: 'ghost', small: true, onClick: function () { drawEditor(r.value); VX.toast('Loaded into the editor — press Publish to apply', 'ok'); } }) : null);
          }));
        }, { skeleton: 3 });
        VX.mount(editorHost,
          ui.card({
            title: spec.title || spec.key, sub: spec.note,
            actions: [
              form ? ui.segmented([{ value: 'form', label: 'Form' }, { value: 'json', label: 'JSON' }], mode, function (m) { if (m === 'json') toJsonMode(); else toFormMode(); }, 'Editor') : null
            ],
            body: h('div.stack',
              h('div.muted.small', up.at ? 'Published ' + fmt.ago(up.at) + ' by ' + (up.by || 'owner') : 'Not published — the app uses its built-in default.', override !== undefined ? [' ', ui.pill('Restored from history, not saved yet', 'warn')] : null),
              formHost, jsonHost, err,
              h('div.actions', ui.button('Publish', { kind: 'primary', icon: 'upload', onClick: save }), values[spec.key] !== undefined && values[spec.key] !== null ? ui.button('Clear', { kind: 'ghost', icon: 'trash', onClick: clear }) : null, h('span.muted.small', 'Listeners see a change within about a minute.')))
          }),
          ui.card({ title: 'History', sub: 'Newest 20 changes to this key', body: history }));
      }
      drawList(); drawEditor();
      return h('div.publish', listHost, editorHost);
    }, { skeleton: 8 });
  }
})();
