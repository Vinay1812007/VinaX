/* VinaX owner console — shell (13.8 rebuild).
 *
 * Owns sign-in, the sidebar, the hash router (#/page/tab), the top bar
 * (refresh, auto-refresh, theme, sign out) and the Ctrl+K quick jump.
 * Pages register themselves with VX.page() in /admin/pages/*.js; this file
 * only mounts them. See docs/admin-console.md.
 */
(function () {
  'use strict';
  var VX = window.VX, h = VX.h, $ = function (id) { return document.getElementById(id); };

  var GROUPS = ['System', 'Audience', 'Intelligence', 'Content'];
  var THEME_KEY = 'vinax_admin_theme';
  var AUTO_KEY = 'vinax_admin_auto';
  var AUTO_MS = 30000;

  var pages = VX.pages();
  var byId = {};
  pages.forEach(function (p) { byId[p.id] = p; });

  var current = null; // { page, tab, disposers: [], timers: [] }

  /* ------------------------------------------------------------ theme */
  function applyTheme(t) {
    document.documentElement.classList.toggle('light', t === 'light');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'light' ? '#f6f6f3' : '#0e0f13');
  }
  $('themeBtn').addEventListener('click', function () {
    var next = document.documentElement.classList.contains('light') ? 'dark' : 'light';
    try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
    applyTheme(next);
    // Charts read colours from CSS variables; re-render so they follow.
    rerender();
  });

  /* ------------------------------------------------------------- nav */
  function buildNav() {
    var nav = VX.clear($('nav'));
    GROUPS.forEach(function (g) {
      var list = pages.filter(function (p) { return p.group === g; });
      if (!list.length) return;
      nav.appendChild(h('div.nav-group',
        h('div.nav-group-label', g),
        h('ul', list.map(function (p) {
          return h('li', h('a.nav-link', { href: '#/' + p.id, dataset: { page: p.id } }, VX.icon(p.icon || 'grid'), h('span', p.title)));
        }))));
    });
  }
  function markNav(id) {
    VX.$$('.nav-link').forEach(function (a) {
      if (a.dataset.page === id) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  }

  function openNav(open) {
    document.body.classList.toggle('nav-open', open);
    $('scrimNav').hidden = !open;
    $('menuBtn').setAttribute('aria-expanded', String(open));
    if (open) { var a = VX.$('.nav-link[aria-current]') || VX.$('.nav-link'); if (a) a.focus(); }
  }
  $('menuBtn').addEventListener('click', function () { openNav(!document.body.classList.contains('nav-open')); });
  $('sbClose').addEventListener('click', function () { openNav(false); $('menuBtn').focus(); });
  $('scrimNav').addEventListener('click', function () { openNav(false); });

  /* ----------------------------------------------------------- router */
  function parseHash() {
    var parts = (location.hash || '').replace(/^#\/?/, '').split('?');
    var segs = parts[0].split('/').filter(Boolean);
    var params = {};
    new URLSearchParams(parts[1] || '').forEach(function (v, k) { params[k] = v; });
    return { page: segs[0] || 'overview', tab: segs[1] || null, params: params };
  }
  function setHash(page, tab, params, replace) {
    var q = new URLSearchParams();
    Object.keys(params || {}).forEach(function (k) { if (params[k] != null && params[k] !== '') q.set(k, params[k]); });
    var next = '#/' + page + (tab ? '/' + tab : '') + (q.toString() ? '?' + q.toString() : '');
    if (next === location.hash) return;
    if (replace) history.replaceState(null, '', next); else history.pushState(null, '', next);
  }

  function dispose() {
    if (!current) return;
    current.timers.forEach(clearInterval);
    current.disposers.forEach(function (fn) { try { fn(); } catch (e) {} });
    current.timers = []; current.disposers = [];
  }

  function stampUpdated() { $('updated').textContent = 'Updated ' + new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }

  function route() {
    var r = parseHash();
    var page = byId[r.page] || byId.overview || pages[0];
    var tabs = page.tabs || null;
    var tab = tabs ? (tabs.filter(function (t) { return t.id === r.tab; })[0] || tabs[0]) : null;
    dispose();
    current = { page: page, tab: tab, params: r.params, timers: [], disposers: [] };
    markNav(page.id);
    $('pageTitle').textContent = page.title;
    $('crumbGroup').textContent = page.group;
    $('pageDesc').textContent = (tab && tab.desc) || page.desc || '';
    document.title = page.title + ' · VinaX Console';
    var tabHost = VX.clear($('pageTabs'));
    if (tabs && tabs.length > 1) {
      tabHost.appendChild(VX.ui.tabs(tabs.map(function (t) { return { id: t.id, label: t.label }; }), tab.id, function (id) {
        setHash(page.id, id, {});
        route();
      }).el);
    }
    renderBody();
    openNav(false);
  }

  function makeCtx() {
    var cur = current;
    return {
      tab: cur.tab ? cur.tab.id : null,
      params: cur.params,
      setParam: function (k, v) {
        if (cur !== current) return;
        cur.params[k] = v;
        setHash(cur.page.id, cur.tab ? cur.tab.id : null, cur.params, true);
      },
      refresh: function () { if (cur === current) renderBody(); },
      every: function (ms, fn) { if (cur !== current) return; cur.timers.push(setInterval(function () { if (!document.hidden) fn(); }, ms)); },
      onDispose: function (fn) { cur.disposers.push(fn); },
      go: function (page, tab, params) { if (cur !== current) return; setHash(page, tab, params || {}); route(); }
    };
  }

  function renderBody() {
    if (!current) return;
    dispose();
    VX.api.clearMemo();
    // 13.8.1 — every render gets its own container. A slow request from a
    // page or tab the owner already left now lands in a detached element
    // instead of drawing over the page that is showing.
    var body = h('div.page-body');
    VX.mount($('pageBody'), body);
    var fn = current.tab ? current.tab.render : current.page.render;
    try {
      var out = fn(body, makeCtx());
      if (out && typeof out.then === 'function') out.then(stampUpdated, stampUpdated); else stampUpdated();
    } catch (e) {
      console.error(e);
      VX.mount(body, VX.ui.error('This page failed to start: ' + (e && e.message)));
    }
  }
  function rerender() { if (current) renderBody(); }

  window.addEventListener('popstate', route);
  window.addEventListener('hashchange', route);

  /* ---------------------------------------------------- refresh / auto */
  $('refreshBtn').addEventListener('click', function () { rerender(); });
  var autoTimer = null;
  function setAuto(on) {
    clearInterval(autoTimer);
    autoTimer = on ? setInterval(function () {
      // Never refresh under an open dialog or while the owner is typing.
      if (document.hidden || document.querySelector('.scrim, #drawer')) return;
      var a = document.activeElement;
      if (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && $('pageBody').contains(a)) return;
      if (current && current.page.noAuto) return;
      rerender();
    }, AUTO_MS) : null;
  }
  $('autoRefresh').addEventListener('change', function (e) {
    try { localStorage.setItem(AUTO_KEY, e.target.checked ? '1' : '0'); } catch (x) {}
    setAuto(e.target.checked);
  });

  /* ----------------------------------------------------- quick jump */
  function openPalette() {
    var items = [];
    pages.forEach(function (p) {
      items.push({ label: p.title, sub: p.group, page: p.id });
      (p.tabs || []).forEach(function (t) { items.push({ label: t.label, sub: p.title, page: p.id, tab: t.id }); });
    });
    var list = h('ul.palette-list', { role: 'listbox', id: 'paletteList' });
    var input = VX.ui.input({ placeholder: 'Jump to a page or tab…', 'aria-label': 'Jump to', role: 'combobox', 'aria-controls': 'paletteList', 'aria-expanded': 'true' });
    var sel = 0, shown = items;
    var m;
    function go(it) { m.close(); setHash(it.page, it.tab || null, {}); route(); }
    function draw() {
      VX.clear(list);
      shown.slice(0, 40).forEach(function (it, i) {
        var li = h('li', { role: 'option', 'aria-selected': String(i === sel), onclick: function () { go(it); } }, h('span', it.label), h('span.muted.small', it.sub));
        list.appendChild(li);
      });
      var on = list.children[sel]; if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
    }
    input.addEventListener('input', function () {
      var q = input.value.trim().toLowerCase();
      shown = !q ? items : items.filter(function (it) { return (it.label + ' ' + it.sub).toLowerCase().indexOf(q) >= 0; });
      sel = 0; draw();
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, Math.min(shown.length, 40) - 1); draw(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); draw(); }
      else if (e.key === 'Enter' && shown[sel]) { e.preventDefault(); go(shown[sel]); }
    });
    m = VX.modal({ title: 'Jump to', body: [input, list] });
    m.el.classList.add('palette');
    draw();
  }
  $('paletteBtn').addEventListener('click', openPalette);
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); if (!document.querySelector('.palette')) openPalette(); return; }
    var t = e.target;
    if (t && (/INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable)) return;
    if (document.querySelector('.scrim, #drawer')) return;
    if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'r' || e.key === 'R') && !$('app').hidden) { e.preventDefault(); rerender(); }
  });

  /* ----------------------------------------------------------- auth */
  function showLogin(msg) {
    dispose();
    $('app').hidden = true;
    $('login').hidden = false;
    $('loginErr').textContent = msg || '';
    $('token').value = '';
    setTimeout(function () { $('token').focus(); }, 30);
  }
  VX.auth.onExpired(function () { showLogin('Your session ended — sign in again.'); });

  function showApp() {
    $('login').hidden = true;
    $('app').hidden = false;
    if (!location.hash) setHash('overview', null, {}, true);
    route();
  }

  $('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var t = $('token').value.trim();
    if (!t) { $('loginErr').textContent = 'Enter the owner password.'; return; }
    var btn = $('enter');
    btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    $('loginErr').textContent = '';
    VX.auth.set(t);
    // Cheapest owner-only endpoint: proves the password without loading data.
    VX.api.get('/api/admin/envcheck', null, { fresh: true, noAuthRedirect: true }).then(function (res) {
      btn.disabled = false; btn.removeAttribute('aria-busy');
      if (res.status === 401 || res.status === 403) { VX.auth.clear(); $('loginErr').textContent = 'That password is not right.'; $('token').select(); return; }
      if (res.status === 429) { VX.auth.clear(); $('loginErr').textContent = 'Too many attempts — wait 15 minutes and try again.'; return; }
      if (res.status === 503 && res.error === 'admin_not_configured') { VX.auth.clear(); $('loginErr').textContent = 'The server has no owner password set (ADMIN_LOGIN_PASSWORD).'; return; }
      if (res.status === 0) { VX.auth.clear(); $('loginErr').textContent = 'Could not reach the server.'; return; }
      showApp();
    });
  });

  $('logoutBtn').addEventListener('click', function () {
    VX.auth.clear();
    VX.api.clearMemo();
    showLogin('Signed out.');
  });

  /* ----------------------------------------------------------- boot */
  buildNav();
  var host = location.hostname;
  var envChip = $('envChip');
  if (/^(localhost|127\.|0\.0\.0\.0)/.test(host)) { envChip.textContent = 'Local'; envChip.classList.add('local'); }
  else if (/pages\.dev$/.test(host)) { envChip.textContent = 'Preview'; envChip.classList.add('preview'); }
  VX.api.get('/api/version', null, { noAuthRedirect: true }).then(function (res) {
    var d = res.data || {};
    var v = d.version || d.latest || d.versionName;
    if (v) $('buildChip').textContent = 'App ' + v;
  });
  try { if (localStorage.getItem(AUTO_KEY) === '1') { $('autoRefresh').checked = true; setAuto(true); } } catch (e) {}

  if (VX.auth.token()) showApp(); else showLogin('');
})();
