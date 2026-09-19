/*
 * 7.2.0 — owner console section modules.
 *
 * app.js is one large script; new panels live in their own files under
 * /admin/sections/ instead. Each file registers itself here:
 *
 *   window.VinaXAdminSections.register('trends', {
 *     local: false,          // true = editor state: the auto-refresh tick leaves it alone
 *     load: function (h) {   // h = helpers from app.js (see SECTION_HELPERS there)
 *       h.api('/api/admin/trends').then(function (d) { h.view(h.html`...${d.x}...`); })
 *         .catch(function (e) { h.fail(e); });
 *     },
 *   });
 *
 * app.js dispatches to a registered module before its own if/else chain.
 * Every value written into the page goes through h.esc or the h.html tagged
 * template (which escapes each interpolation) — never raw string concatenation.
 * This file loads before app.js; section files load after it.
 */
(function () {
  'use strict';
  var mods = {};
  window.VinaXAdminSections = {
    register: function (key, def) {
      if (!/^[a-z][a-z0-9-]{0,39}$/.test(String(key)) || !def || typeof def.load !== 'function') return;
      mods[key] = def;
    },
    get: function (key) { return Object.prototype.hasOwnProperty.call(mods, key) ? mods[key] : null; },
    keys: function () { return Object.keys(mods); },
  };
})();
