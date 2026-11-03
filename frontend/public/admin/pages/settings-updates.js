/* App Settings › App Updates — the oldest app version allowed on each
 * platform, and whether people are asked or made to update.
 * Stored shape and who reads it: docs/admin-console.md → "App Updates". */
(function () {
  'use strict';
  var VX = window.VX, h = VX.h, ui = VX.ui, fmt = VX.fmt, st = VX.st;
  var arr = VX.arr, obj = VX.obj;

  var PLATFORMS = [['android', 'Android app'], ['web', 'Website'], ['ios', 'iPhone app']];

  /** "1.8.10" vs "1.8.9" (anything after + or - is ignored). */
  function cmp(a, b) {
    var pa = String(a).split(/[+-]/)[0].split('.').map(function (x) { return parseInt(x, 10) || 0; });
    var pb = String(b).split(/[+-]/)[0].split('.').map(function (x) { return parseInt(x, 10) || 0; });
    for (var i = 0; i < Math.max(pa.length, pb.length); i++) { var d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; }
    return 0;
  }
  var base = function (v) { return String(v || '').split(/[+-]/)[0]; };

  /** Versions people actually use: { android: [{ version, users }], … }, newest first. */
  var versions = null;
  function loadVersions() {
    if (!versions) versions = VX.api.get('/api/admin/listeners', { filters: 1 }).then(function (res) {
      var d = obj(res.data);
      var rows = arr(d.versions || obj(d.filters).versions);
      var out = { android: {}, web: {}, ios: {} };
      rows.forEach(function (r) {
        var p = String(r.platform || 'web').toLowerCase(); var v = base(r.version || r.appVersion);
        if (!out[p] || !/^\d+(\.\d+)*$/.test(v)) return;
        out[p][v] = (out[p][v] || 0) + (Number(r.users) || 0);
      });
      var lists = {};
      Object.keys(out).forEach(function (p) { lists[p] = Object.keys(out[p]).sort(function (a, b) { return cmp(b, a); }).map(function (v) { return { version: v, users: out[p][v] }; }); });
      return { ok: res.ok, lists: lists };
    });
    return versions;
  }
  function affected(list, min) { return min ? list.filter(function (x) { return cmp(x.version, min) < 0; }).reduce(function (a, x) { return a + x.users; }, 0) : 0; }

  var section = {
    key: 'min-version', title: 'App Updates', wide: true,
    desc: 'Ask or make people on old versions update. “Force” blocks the app until they update, so use it only for serious problems.',
    fromValue: function (v) {
      v = obj(v);
      var m = { message: v.message || '', build: v.build };
      PLATFORMS.forEach(function (p) { var r = obj(v[p[0]]); m[p[0]] = { min: r.minVersion || '', mode: r.mode === 'force' ? 'force' : 'suggest' }; });
      return m;
    },
    toValue: function (m) {
      var o = {};
      if (typeof m.build === 'number') o.build = m.build;
      PLATFORMS.forEach(function (p) { var r = m[p[0]]; if (r.min) o[p[0]] = { minVersion: r.min, mode: r.mode }; });
      if (m.message.trim() && PLATFORMS.some(function (p) { return m[p[0]].min; })) o.message = m.message.trim();
      return Object.keys(o).length ? o : null;
    },
    describe: function (v) {
      v = obj(v);
      var parts = PLATFORMS.filter(function (p) { return obj(v[p[0]]).minVersion; }).map(function (p) {
        var r = obj(v[p[0]]); return p[1] + ': ' + (r.mode === 'force' ? 'must update' : 'asked to update') + ' below ' + r.minVersion;
      });
      if (typeof v.build === 'number' && !obj(v.android).minVersion) parts.push('Android: must update below build ' + v.build);
      return parts.length ? parts.join(' · ') : 'Every version allowed';
    },
    confirmSave: function (m) {
      var forced = PLATFORMS.filter(function (p) { return m[p[0]].min && m[p[0]].mode === 'force'; });
      return forced.length ? { title: 'Force an update?', body: 'People on older versions of the ' + forced.map(function (p) { return p[1]; }).join(' and ') + ' cannot use VinaX until they update. Users will see this within 1 minute.', typed: true, danger: true, confirmLabel: 'Force update' } : null;
    },
    render: function (m, set, api) {
      var host = h('div.form-col', ui.skeleton(4));
      loadVersions().then(function (data) {
        var cards = PLATFORMS.map(function (p) {
          var key = p[0], r = m[key], list = data.lists[key] || [];
          var count = h('p.affect');
          function sync() {
            var n = affected(list, r.min);
            count.textContent = !r.min ? 'No rule — every version can be used.' : 'This will affect ' + fmt.plural(n, 'user') + ' on older versions.';
            count.classList.toggle('warn', !!(r.min && n));
          }
          var opts = [{ value: '', label: 'Any version (no rule)' }].concat(list.map(function (x) { return { value: x.version, label: x.version + ' — ' + fmt.plural(x.users, 'user') }; }));
          if (r.min && !list.some(function (x) { return x.version === r.min; })) opts.push({ value: r.min, label: r.min + ' (current rule)' });
          var modeHost = h('div');
          function drawMode() {
            VX.mount(modeHost, r.min ? ui.radios('Update type', [
              { value: 'suggest', label: 'Suggest update', hint: 'People see a reminder and can skip it.' },
              { value: 'force', label: 'Force update', hint: 'People must update before using the app.' }
            ], r.mode, function (v) { r.mode = v; set(m); }, { cards: true, disabled: api.readOnly }) : null);
          }
          drawMode(); sync();
          return h('section.update-card',
            h('h4', p[1]),
            ui.dropdown('Oldest version allowed', opts, r.min, function (v) { r.min = v; set(m); drawMode(); sync(); }, { disabled: api.readOnly }),
            list.length ? null : h('p.muted.small', 'No signed-in user has reported a version on this platform yet.'),
            modeHost, count);
        });
        VX.mount(host,
          data.ok ? null : ui.notice('The list of versions in use could not load. Rules already set are kept.', 'warn'),
          h('div.update-grid', cards),
          st.text(m, 'message', set, { label: 'Update message', max: 240, multiline: true, rows: 2, placeholder: 'e.g. This version has a bug that stops songs playing. Please update.', hint: 'Shown to people on an older version. Leave empty for a standard message.' }),
          typeof m.build === 'number' ? h('p.muted.small', 'An older rule also asks Android builds below ' + m.build + ' to update. It stays until you reset this setting.') : null);
      });
      return host;
    }
  };

  VX.settingsPage({
    id: 'app-settings/updates', title: 'App Updates', icon: 'download', order: 3,
    desc: 'Choose the oldest app version people may use on each platform.',
    sections: [section]
  });
})();
