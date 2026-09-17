/* Pre-paint boot for the admin console. Loaded from <head> (external file —
   the console's CSP forbids inline scripts) so the right theme and sidebar
   width are in place before the first paint: no theme flash, no layout shift.
   app.js owns the same logic at runtime (applyTheme / setRail); this file
   only has to agree with it on the storage keys. */
(function () {
  'use strict';
  var root = document.documentElement;
  var theme = null;
  try {
    theme = localStorage.getItem('vinax_admin_theme');
    // Legacy flag written by older console builds ('1' = light).
    if (theme !== 'light' && theme !== 'dark' && localStorage.getItem('vinax_admin_light')) theme = 'light';
  } catch (e) { /* storage blocked — fall through to the system preference */ }
  if (theme !== 'light' && theme !== 'dark') {
    var light = false;
    try { light = !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches); } catch (e) {}
    theme = light ? 'light' : 'dark';
  }
  if (theme === 'light') root.classList.add('light');
  try { if (localStorage.getItem('vinax_admin_sidebar') === 'rail') root.classList.add('sb-rail'); } catch (e) {}
})();
