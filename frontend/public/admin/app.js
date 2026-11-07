/* VinaX console — shell (console rebuild).
 *
 * Owns Google sign-in (with the owner recovery password), the sidebar (ten
 * folding groups, one job per page, and a "Find a page" box), the hash
 * router (#/page, with every old page and tab address sent to its page now
 * and a "Page not found" screen), the top
 * bar (breadcrumb, global search, date range, auto-refresh, theme, profile),
 * keyboard shortcuts (press ?) with quick actions in Ctrl K, and the
 * unsaved-changes guard. Pages register with VX.page() in
 * /admin/pages/*.js; this file only mounts them. See docs/admin-console.md.
 */
(function () {
  'use strict';
  var VX = window.VX, h = VX.h, ui = VX.ui, fmt = VX.fmt, $ = function (id) { return document.getElementById(id); };

  /** Sidebar groups, top to bottom, with the icon each shows when the menu is collapsed. */
  var GROUPS = ['Overview', 'Users', 'Music Stats', 'Audience', 'Search & Library', 'Notifications', 'App Settings', 'App Health', 'Growth & SEO', 'System'];
  var GROUP_ICONS = {
    Overview: 'grid', Users: 'users', 'Music Stats': 'growth', Audience: 'globe', 'Search & Library': 'library',
    Notifications: 'bell', 'App Settings': 'settings', 'App Health': 'pulse', 'Growth & SEO': 'target', System: 'database'
  };
  var THEME_KEY = 'vinax_admin_theme';
  var AUTO_KEY = 'vinax_admin_auto';
  var AUTO_MS_KEY = 'vinax_admin_auto_ms';
  var RANGE_KEY = 'vinax_admin_range';
  var RAIL_KEY = 'vinax_admin_sidebar';

  /**
   * Old addresses → today's pages. Every tab of the old pages is its own page
   * now, so "page/tab" keys come first; a bare old page id goes to its first
   * page. Alerts, emails and dashboard notices from the server still use the
   * old addresses, so these stay.
   */
  var REDIRECTS = {
    '': 'dashboard', overview: 'dashboard', listeners: 'users', audience: 'users',
    publish: 'app-settings/home-screen', settings: 'app-settings/home-screen', 'app-settings': 'app-settings/home-screen',
    notify: 'send-notification', push: 'send-notification', analytics: 'top-songs', catalog: 'find-music',
    experiments: 'ab-tests', seo: 'google-search', admin: 'admins', roles: 'admins',
    'analytics/errors': 'app-errors',
    'publish/home': 'app-settings/home-screen', 'publish/app': 'app-settings/features',
    'publish/catalog': 'app-settings/search', 'publish/operations': 'app-settings/maintenance',
    'notify/send': 'send-notification', 'notify/audience': 'send-notification', 'notify/push': 'notification-setup',
    // Split in the one-job-per-page rebuild.
    live: 'listening-now', 'live/now': 'listening-now', 'live/activity': 'recent-activity', 'live/rooms': 'listen-together',
    'song-stats': 'top-songs', 'song-stats/top-songs': 'top-songs', 'song-stats/rising': 'rising-songs',
    'song-stats/artists': 'top-artists', 'song-stats/languages': 'languages', 'song-stats/skips': 'skipped-songs',
    'song-stats/places': 'where-users-are', 'song-stats/engagement': 'listening-time',
    'song-stats/retention': 'coming-back', 'song-stats/funnel': 'signup-journey',
    library: 'find-music', 'library/search': 'find-music', 'library/blocked': 'blocked-music',
    'search-insights': 'search-overview', 'search-insights/overview': 'search-overview',
    'search-insights/nothing-found': 'search-no-results', 'search-insights/pins': 'search-pins',
    notifications: 'send-notification', 'notifications/compose': 'send-notification',
    'notifications/history': 'sent-notifications', 'notifications/audiences': 'saved-audiences',
    'notifications/setup': 'notification-setup', 'app-settings/notification-rules': 'notification-rules',
    health: 'app-errors', 'health/errors': 'app-errors', 'health/checks': 'server-checks',
    'health/sources': 'music-sources', 'health/ai': 'ai-status', 'health/recommendations': 'recommendations',
    'health/versions': 'app-versions', 'health/keys': 'api-keys',
    'google-search/summary': 'google-search', 'google-search/pages': 'page-check', 'google-search/console': 'search-console',
    database: 'db-tables', 'database/tables': 'db-tables', 'database/jobs': 'scheduled-jobs',
    'database/changes': 'change-log', 'database/maintenance': 'db-maintenance'
  };

  var pages = VX.pages().slice().sort(function (a, b) {
    var g = GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group);
    return g || (a.order || 50) - (b.order || 50);
  });
  var byId = {};
  pages.forEach(function (p) { byId[p.id] = p; });
  /** Pages in the menu and in search (a user's profile opens from a person, not the menu). */
  var navPages = pages.filter(function (p) { return !p.hidden; });

  var current = null; // { page, tab, params, timers, disposers, leave }
  var lastHash = location.hash;

  /* ------------------------------------------------------------ theme */
  var mql = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
  function themePref() { try { var t = localStorage.getItem(THEME_KEY); return t === 'light' || t === 'dark' ? t : 'system'; } catch (e) { return 'system'; } }
  function applyTheme() {
    var pref = themePref();
    var light = pref === 'light' || (pref === 'system' && !!(mql && mql.matches));
    document.documentElement.classList.toggle('light', light);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', light ? '#eaf0f7' : '#070b14');
  }
  if (mql && mql.addEventListener) mql.addEventListener('change', function () { if (themePref() === 'system') { applyTheme(); rerender(); } });
  var themeSel = $('themeSel');
  themeSel.value = themePref();
  themeSel.addEventListener('change', function () { setThemePref(themeSel.value); }); // re-render: charts read colours from CSS variables

  /* ------------------------------------------------------------- nav */
  /*
   * Every group folds open and shut. Only the group of the page you are on
   * starts open; moving to a page in another group starts fresh. Typing in
   * "Find a page" opens every group and shows only the pages that match.
   */
  var openGroups = {};      // group → true / false, set by the admin's clicks
  var navGroup = null;      // the group of the page on screen
  var navFilter = '';
  function navMatch(p, q) { return (p.title + ' ' + p.group + ' ' + (p.keywords || '') + ' ' + (p.desc || '')).toLowerCase().indexOf(q) >= 0; }
  function buildNav() {
    var nav = VX.clear($('nav'));
    var q = navFilter.trim().toLowerCase();
    var shown = 0;
    GROUPS.forEach(function (g, gi) {
      var list = navPages.filter(function (p) { return p.group === g && (!q || navMatch(p, q)); });
      if (!list.length) return;
      shown += list.length;
      var open = q ? true : openGroups[g] != null ? openGroups[g] : g === navGroup;
      var listId = 'navg-' + gi;
      var btn = h('button.nav-group-toggle', {
        type: 'button', title: g, 'aria-expanded': String(open), 'aria-controls': listId,
        onclick: function () { if (q) return; openGroups[g] = !open; buildNav(); }
      }, VX.icon(GROUP_ICONS[g] || 'grid'), h('span', g), VX.icon('chevron'));
      nav.appendChild(h('div.nav-group' + (open ? '.open' : '') + (g === navGroup ? '.has-current' : ''), { dataset: { group: g } },
        btn,
        h('ul', { id: listId, hidden: !open }, list.map(function (p) {
          return h('li', h('a.nav-link', { href: '#/' + p.id, dataset: { page: p.id }, title: p.title }, VX.icon(p.icon || 'grid'), h('span', p.title)));
        }))));
    });
    if (!shown) nav.appendChild(h('p.nav-empty', 'No page matches “' + navFilter.trim() + '”.'));
    if (current) markNav(current.page.id);
  }
  function markNav(id) {
    var g = id && byId[id] ? byId[id].group : null;
    if (g !== navGroup) { navGroup = g; openGroups = {}; buildNav(); return; }
    var on = id && byId[id] && byId[id].navAs ? byId[id].navAs : id; // a profile lights up All Users
    VX.$$('.nav-link').forEach(function (a) {
      if (a.dataset.page === on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    // The phone bar: its page lights up; any other page lights up Menu.
    var inBar = false;
    VX.$$('#bottomBar a.bb-link').forEach(function (a) {
      var hit = a.dataset.page === on;
      inBar = inBar || hit;
      if (hit) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    $('bbMenu').classList.toggle('on', !!on && !inBar);
  }
  var filterBox = $('navFilter');
  filterBox.addEventListener('input', function () { navFilter = filterBox.value; buildNav(); });
  filterBox.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && filterBox.value) { e.preventDefault(); e.stopPropagation(); filterBox.value = ''; navFilter = ''; buildNav(); }
    else if (e.key === 'Enter') { var a = VX.$('#nav .nav-link'); if (a) { e.preventDefault(); a.click(); } }
  });
  // Choosing a page clears the filter so the menu goes back to its groups.
  $('nav').addEventListener('click', function (e) {
    if (navFilter && e.target.closest && e.target.closest('.nav-link')) { filterBox.value = ''; navFilter = ''; setTimeout(buildNav, 0); }
  });
  function openNav(open) {
    document.body.classList.toggle('nav-open', open);
    $('scrimNav').hidden = !open;
    $('menuBtn').setAttribute('aria-expanded', String(open));
    $('bbMenu').setAttribute('aria-expanded', String(open));
    if (open) { var a = VX.$('.nav-link[aria-current]') || VX.$('.nav-link'); if (a) a.focus(); }
  }
  $('menuBtn').addEventListener('click', function () { openNav(!document.body.classList.contains('nav-open')); });
  $('sbClose').addEventListener('click', function () { openNav(false); $('menuBtn').focus(); });
  $('scrimNav').addEventListener('click', function () { openNav(false); });
  $('bbMenu').addEventListener('click', function () { openNav(!document.body.classList.contains('nav-open')); });
  $('railBtn').addEventListener('click', function () {
    var rail = !document.documentElement.classList.contains('sb-rail');
    document.documentElement.classList.toggle('sb-rail', rail);
    $('railBtn').setAttribute('aria-pressed', String(rail));
    $('railBtn').setAttribute('aria-label', rail ? 'Expand the menu' : 'Collapse the menu');
    try { localStorage.setItem(RAIL_KEY, rail ? 'rail' : 'full'); } catch (e) {}
  });

  /* ----------------------------------------------------------- router */
  function parseHash() {
    var parts = (location.hash || '').replace(/^#\/?/, '').split('?');
    var path = decodeURIComponent(parts[0] || '').replace(/\/+$/, '');
    var params = {};
    new URLSearchParams(parts[1] || '').forEach(function (v, k) { params[k] = v; });
    return { path: path, params: params };
  }
  /** Longest registered page id that prefixes the path; the next segment is the tab. */
  function resolve(path) {
    var segs = path.split('/').filter(Boolean);
    for (var n = segs.length; n > 0; n--) {
      var id = segs.slice(0, n).join('/');
      if (byId[id]) return { page: byId[id], tab: segs[n] || null, extra: segs.slice(n + 1) };
    }
    return null;
  }
  function setHash(page, tab, params, replace) {
    var q = new URLSearchParams();
    Object.keys(params || {}).forEach(function (k) { if (params[k] != null && params[k] !== '') q.set(k, params[k]); });
    var next = '#/' + page + (tab ? '/' + tab : '') + (q.toString() ? '?' + q.toString() : '');
    lastHash = next;
    if (next === location.hash) return;
    if (replace) history.replaceState(null, '', next); else history.pushState(null, '', next);
  }

  function dispose() {
    if (!current) return;
    current.timers.forEach(clearInterval);
    current.disposers.forEach(function (fn) { try { fn(); } catch (e) {} });
    current.timers = []; current.disposers = [];
  }

  function stampUpdated() { $('updated').textContent = 'Last updated ' + fmt.time(new Date().toISOString()) + ' ' + VX.tzShort(); }

  function crumbs(page, tab) {
    var host = VX.clear($('crumbs'));
    host.appendChild(h('span.muted', page.group));
    host.appendChild(h('span.muted.sep', { 'aria-hidden': 'true' }, '›'));
    host.appendChild(h(tab ? 'span' : 'h1#pageTitle', page.title));
    if (tab && page.tabs && page.tabs.length > 1) {
      host.appendChild(h('span.muted.sep', { 'aria-hidden': 'true' }, '›'));
      host.appendChild(h('h1#pageTitle', tab.label));
    }
  }

  function notFound() {
    dispose();
    current = null;
    markNav(null);
    VX.mount($('crumbs'), h('h1#pageTitle', 'Page not found'));
    $('pageDesc').textContent = '';
    VX.clear($('pageTabs'));
    $('rangeHost').hidden = true;
    document.title = 'Page not found · VinaX Console';
    VX.mount($('pageBody'), ui.notFound(function () { setHash('dashboard', null, {}); route(); }));
  }

  /**
   * An old address → { path, params } of today's page, or null when the
   * address is already current. "page/tab" wins over "page"; an unknown old
   * tab falls back to the old page's first page. "#/users?user=<id>" opens
   * that person's profile page.
   */
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function translate(path, params) {
    var segs = path.split('/').filter(Boolean);
    var two = segs.slice(0, 2).join('/');
    var to = null;
    if (segs.length >= 2 && own(REDIRECTS, two)) to = REDIRECTS[two];
    else if (own(REDIRECTS, path)) to = REDIRECTS[path];
    else if (!resolve(path) && segs.length && own(REDIRECTS, segs[0])) to = REDIRECTS[segs[0]];
    if (to == null && segs[0] === 'users' && params && params.user) return { path: 'user', params: { id: params.user } };
    return to == null ? null : { path: to, params: params || {} };
  }

  function route() {
    var r = parseHash();
    var moved = translate(r.path, r.params);
    if (moved) { setHash(moved.path, null, moved.params, true); return route(); }
    var hit = resolve(r.path);
    if (!hit) return notFound();
    var page = hit.page;
    var tabs = page.tabs || null;
    var tab = tabs ? (tabs.filter(function (t) { return t.id === hit.tab; })[0] || tabs[0]) : null;
    dispose();
    current = { page: page, tab: tab, params: r.params, timers: [], disposers: [], leave: null };
    lastHash = location.hash;
    markNav(page.id);
    crumbs(page, tab);
    $('pageDesc').textContent = (tab && tab.desc) || page.desc || '';
    document.title = page.title + ' · VinaX Console';
    var tabHost = VX.clear($('pageTabs'));
    if (tabs && tabs.length > 1) {
      tabHost.appendChild(VX.ui.tabs(tabs.map(function (t) { return { id: t.id, label: t.label, badge: t.badge }; }), tab.id, function (id) {
        go(page.id, id, {});
      }).el);
    }
    drawRange(page);
    renderBody();
    openNav(false);
    var main = $('main'); if (main && main.scrollTo) main.scrollTo(0, 0);
  }

  /** Navigate, asking first when the current page has unsaved changes. */
  function go(page, tab, params) {
    var moved = translate(page + (tab ? '/' + tab : ''), params || {});
    if (moved) { page = moved.path; tab = null; params = moved.params; }
    leaveOk().then(function (ok) { if (ok) { setHash(page, tab, params || {}); route(); } });
  }
  function leaveOk() {
    var msg = current && current.leave ? current.leave() : null;
    if (!msg) return Promise.resolve(true);
    return VX.confirm({ title: 'Leave without saving?', body: msg, confirmLabel: 'Leave without saving', danger: true });
  }
  function onNav() {
    if (location.hash === lastHash) return;
    var target = location.hash;
    var msg = current && current.leave ? current.leave() : null;
    if (!msg) { route(); return; }
    history.replaceState(null, '', lastHash); // stay until the admin decides
    VX.confirm({ title: 'Leave without saving?', body: msg, confirmLabel: 'Leave without saving', danger: true }).then(function (ok) {
      if (ok) { current.leave = null; history.pushState(null, '', target); route(); }
    });
  }
  window.addEventListener('popstate', onNav);
  window.addEventListener('hashchange', onNav);
  window.addEventListener('beforeunload', function (e) {
    if (current && current.leave && current.leave()) { e.preventDefault(); e.returnValue = ''; }
  });

  /* ------------------------------------------------------- date range */
  function rangeFrom(params) {
    var key = params.range;
    if (!key) { try { key = localStorage.getItem(RANGE_KEY) || '7'; } catch (e) { key = '7'; } }
    if (key === 'custom' && params.from && params.to) {
      var a = new Date(params.from + 'T00:00:00Z'), b = new Date(params.to + 'T00:00:00Z');
      var days = Math.max(1, Math.min(90, Math.round((b - a) / 86400000) + 1));
      return { key: 'custom', days: days, from: params.from, to: params.to, label: fmt.day(params.from) + ' – ' + fmt.day(params.to) };
    }
    var r = VX.RANGES.filter(function (x) { return x.value === key && x.days; })[0] || VX.RANGES[1];
    return { key: r.value, days: r.days, from: null, to: null, label: r.label };
  }
  function drawRange(page) {
    var host = $('rangeHost');
    host.hidden = !page.range;
    if (!page.range) return;
    var cur = rangeFrom(current.params);
    var sel = ui.select(VX.RANGES.map(function (r) { return { value: r.value, label: r.value === 'custom' && cur.key === 'custom' ? cur.label : r.label }; }), cur.key, { 'aria-label': 'Date range' });
    sel.addEventListener('change', function () {
      if (sel.value !== 'custom') {
        try { localStorage.setItem(RANGE_KEY, sel.value); } catch (e) {}
        var p = Object.assign({}, current.params, { range: sel.value }); delete p.from; delete p.to;
        setHash(current.page.id, current.tab ? current.tab.id : null, p, true);
        current.params = p; drawRange(current.page); renderBody();
        return;
      }
      var v = { start: cur.from || VX.time.toDate(new Date(Date.now() - 6 * 86400000).toISOString()), end: cur.to || VX.time.today() };
      VX.modal({
        title: 'Custom date range',
        body: [h('p.muted', 'Pick up to 90 days.'), ui.dateRange(v, function (x) { v = x; }, { startLabel: 'From', endLabel: 'To', startHint: ' ', endHint: ' ' })],
        onClose: function () { drawRange(current.page); },
        actions: [
          { label: 'Cancel', kind: 'ghost' },
          { label: 'Apply', kind: 'primary', onClick: function (close) {
            if (!v.start || !v.end || v.end < v.start) { VX.toast('Choose a start date before the end date.', 'bad'); return; }
            var p = Object.assign({}, current.params, { range: 'custom', from: v.start, to: v.end });
            setHash(current.page.id, current.tab ? current.tab.id : null, p, true);
            current.params = p; close(); renderBody();
          } }
        ]
      });
    });
    VX.mount(host, sel);
  }

  function makeCtx() {
    var cur = current;
    return {
      page: cur.page.id,
      tab: cur.tab ? cur.tab.id : null,
      params: cur.params,
      range: rangeFrom(cur.params),
      setParam: function (k, v) {
        if (cur !== current) return;
        if (v == null || v === '') delete cur.params[k]; else cur.params[k] = v;
        setHash(cur.page.id, cur.tab ? cur.tab.id : null, cur.params, true);
      },
      refresh: function () { if (cur === current) renderBody(); },
      every: function (ms, fn) { if (cur !== current) return; cur.timers.push(setInterval(function () { if (!document.hidden) fn(); }, ms)); },
      onDispose: function (fn) { cur.disposers.push(fn); },
      onLeave: function (fn) { cur.leave = fn; },
      go: function (page, tab, params) { if (cur !== current) return; go(page, tab, params); },
      stamp: stampUpdated
    };
  }

  function renderBody() {
    if (!current) return;
    dispose();
    current.leave = null;
    VX.api.clearMemo();
    // Every render gets its own container: a slow answer for a page the admin
    // already left lands in a detached element.
    var body = h('div.page-body');
    VX.mount($('pageBody'), body);
    var fn = current.tab ? current.tab.render : current.page.render;
    try {
      var out = fn(body, makeCtx());
      if (out && typeof out.then === 'function') out.then(stampUpdated, stampUpdated); else stampUpdated();
    } catch (e) {
      console.error(e);
      VX.mount(body, VX.ui.error('This page failed to start: ' + (e && e.message), function () { renderBody(); }));
    }
  }
  function rerender() { if (current) renderBody(); else if (!$('app').hidden) route(); }

  /* ---------------------------------------------------- refresh / auto */
  $('refreshBtn').addEventListener('click', function () { rerender(); });
  var autoTimer = null;
  function autoMs() { var v = 30000; try { v = Number(localStorage.getItem(AUTO_MS_KEY)) || 30000; } catch (e) {} return [15000, 30000, 60000, 300000].indexOf(v) >= 0 ? v : 30000; }
  function setAuto(on) {
    clearInterval(autoTimer);
    autoTimer = on ? setInterval(function () {
      // Never refresh under an open dialog, menu or while the admin is typing.
      if (document.hidden || document.querySelector('.scrim, #drawer, .menu.open')) return;
      var a = document.activeElement;
      if (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && $('pageBody').contains(a)) return;
      if (current && current.page.noAuto) return;
      rerender();
    }, autoMs()) : null;
    $('autoMs').disabled = !on;
  }
  $('autoRefresh').addEventListener('change', function (e) {
    try { localStorage.setItem(AUTO_KEY, e.target.checked ? '1' : '0'); } catch (x) {}
    setAuto(e.target.checked);
  });
  $('autoMs').value = String(autoMs());
  $('autoMs').addEventListener('change', function (e) {
    try { localStorage.setItem(AUTO_MS_KEY, e.target.value); } catch (x) {}
    setAuto($('autoRefresh').checked);
  });

  /* ---------------------------------------------------- global search */
  function openPalette() {
    var items = [];
    navPages.forEach(function (p) {
      items.push({ label: p.title, sub: p.group, page: p.id, kind: 'Pages', words: (p.keywords || '') + ' ' + (p.desc || '') });
      (p.tabs || []).forEach(function (t) { if (p.tabs.length > 1) items.push({ label: t.label, sub: p.title, page: p.id, tab: t.id, kind: 'Pages' }); });
      (p.sections || []).forEach(function (s) { items.push({ label: s.title, sub: p.group + ' › ' + p.title, page: p.id, params: { section: s.key }, kind: 'Settings' }); });
    });
    var actions = quickActions().map(function (a) { return { label: a.label, sub: a.keys ? 'Shortcut: ' + a.keys : 'Quick action', kind: 'Quick actions', run: a.run, words: a.words || '' }; });
    var list = h('ul.palette-list', { role: 'listbox', id: 'paletteList' });
    var input = VX.ui.input({ placeholder: 'Search pages, users, songs and settings…', 'aria-label': 'Search the console', role: 'combobox', 'aria-controls': 'paletteList', 'aria-expanded': 'true' });
    var sel = 0, shown = actions.slice(0, 6).concat(items.slice(0, 24)), remote = [], seq = 0, timer = null;
    var m;
    function pick(it) { m.close(); if (it.run) it.run(); else go(it.page, it.tab || null, it.params || {}); }
    function draw() {
      VX.clear(list);
      var all = shown.concat(remote);
      var lastKind = null;
      all.slice(0, 50).forEach(function (it, i) {
        if (it.kind !== lastKind) { list.appendChild(h('li.palette-group', { role: 'presentation' }, it.kind)); lastKind = it.kind; }
        var li = h('li', { role: 'option', 'aria-selected': String(i === sel), onclick: function () { pick(it); } },
          it.img !== undefined ? ui.media(it.img, it.label, it.sub, it.round) : [h('span', it.label), h('span.muted.small', it.sub)]);
        list.appendChild(li);
      });
      if (!all.length) list.appendChild(h('li.palette-group', 'No matches'));
      var on = VX.$$('li[role="option"]', list)[sel]; if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
    }
    input.addEventListener('input', function () {
      var q = input.value.trim().toLowerCase();
      var match = function (it) { return (it.label + ' ' + it.sub + ' ' + (it.words || '')).toLowerCase().indexOf(q) >= 0; };
      shown = !q ? actions.slice(0, 6).concat(items.slice(0, 24)) : items.filter(match).concat(actions.filter(match));
      remote = []; sel = 0; draw();
      clearTimeout(timer);
      if (q.length < 2) return;
      timer = setTimeout(function () {
        var my = ++seq;
        Promise.all([
          VX.findUsers(q).catch(function () { return []; }),
          VX.findMusic(q, 'songs').catch(function () { return []; })
        ]).then(function (res) {
          if (my !== seq) return;
          remote = res[0].slice(0, 5).map(function (u) { return { kind: 'Users', label: u.name || u.email || 'User', sub: u.name ? u.email : '', img: u.picture, round: true, page: 'user', params: { id: u.id } }; })
            .concat(res[1].slice(0, 5).map(function (s) { return { kind: 'Songs', label: s.title, sub: s.sub || '', img: s.image, page: 'find-music', params: { q: s.title } }; }));
          draw();
        });
      }, 300);
    });
    input.addEventListener('keydown', function (e) {
      var n = Math.min(shown.length + remote.length, 50);
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, n - 1); draw(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); draw(); }
      else if (e.key === 'Enter') { var it = shown.concat(remote)[sel]; if (it) { e.preventDefault(); pick(it); } }
    });
    m = VX.modal({ title: 'Search', body: [input, list] });
    m.el.classList.add('palette');
    draw();
  }
  $('paletteBtn').addEventListener('click', openPalette);
  $('searchBtn').addEventListener('click', openPalette);

  /* ------------------------------------------- shortcuts, quick actions */
  /** "g" then a letter opens a page. Only pages that exist are listed. */
  var GO_KEYS = [
    ['d', 'dashboard'], ['l', 'listening-now'], ['u', 'users'], ['f', 'feedback'], ['s', 'top-songs'], ['m', 'find-music'],
    ['t', 'trending'], ['i', 'search-overview'], ['n', 'send-notification'], ['h', 'app-errors'], ['a', 'alerts'], ['b', 'db-tables']
  ];
  function setThemePref(v) {
    try { if (v === 'system') localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, v); } catch (e) {}
    themeSel.value = v;
    applyTheme();
    rerender();
  }
  function toggleTheme() { setThemePref(document.documentElement.classList.contains('light') ? 'dark' : 'light'); }
  function toggleAuto() { var cb = $('autoRefresh'); cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')); VX.toast(cb.checked ? 'Auto-refresh on ✓' : 'Auto-refresh off', 'ok'); }
  function quickActions() {
    var light = document.documentElement.classList.contains('light');
    var list = [
      { label: 'Send a notification', words: 'push message compose', run: function () { go('send-notification', null, {}); }, edit: true },
      { label: 'Customise the dashboard', words: 'layout cards move hide', run: function () { go('dashboard', null, { customise: '1' }); } },
      { label: light ? 'Switch to dark theme' : 'Switch to light theme', keys: 'T', words: 'theme dark light mode', run: toggleTheme },
      { label: $('autoRefresh').checked ? 'Turn auto-refresh off' : 'Turn auto-refresh on', words: 'auto refresh', run: toggleAuto },
      { label: 'Refresh this page', keys: 'R', words: 'reload', run: function () { rerender(); } },
      { label: 'Keyboard shortcuts', keys: '?', words: 'keys help hotkeys', run: openShortcuts },
      { label: 'Put the app in maintenance', words: 'maintenance downtime offline', run: function () { go('app-settings/maintenance', null, {}); }, edit: true },
      { label: 'See app errors', words: 'errors crashes problems', run: function () { go('app-errors', null, {}); } },
      { label: 'Collapse or expand the menu', keys: '[', words: 'sidebar rail menu', run: function () { $('railBtn').click(); } },
      { label: 'Copy a link to this page', words: 'share url address', run: function () { VX.copy(location.href, 'Link copied'); } },
      { label: 'Sign out', words: 'log out logout', run: signOut }
    ];
    return list.filter(function (a) { return !a.edit || VX.can('edit'); }).filter(function (a) {
      return a.label !== 'Customise the dashboard' || !!byId.dashboard;
    });
  }
  function openShortcuts() {
    if (document.querySelector('.shortcuts')) return;
    var row = function (keys, text) { return h('li', h('span', text), h('span.keys', keys.map(function (k) { return h('kbd', k); }))); };
    var nav = GO_KEYS.filter(function (g) { return byId[g[1]]; }).map(function (g) { return row(['G', g[0].toUpperCase()], byId[g[1]].title); });
    var m = VX.modal({ title: 'Keyboard shortcuts', body: [
      h('div.shortcut-cols',
        h('section', h('h4.subhead', 'Anywhere'), h('ul.shortcut-list',
          row(['Ctrl', 'K'], 'Search and quick actions'),
          row(['/'], 'Search'),
          row(['R'], 'Refresh this page'),
          row(['T'], 'Switch light or dark theme'),
          row(['['], 'Collapse or expand the menu'),
          row(['?'], 'Show this list'),
          row(['Esc'], 'Close a window or menu'))),
        h('section', h('h4.subhead', 'Go to a page'), h('ul.shortcut-list', nav))),
      h('p.muted.small', 'Shortcuts are off while you are typing in a box.')
    ] });
    m.el.classList.add('shortcuts');
  }
  var goPending = 0;
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); if (!document.querySelector('.palette') && !$('app').hidden) openPalette(); return; }
    var t = e.target;
    if (t && (/INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable)) return;
    if (document.querySelector('.scrim, #drawer')) return;
    if (e.ctrlKey || e.metaKey || e.altKey || $('app').hidden) return;
    var key = e.key;
    if (goPending && Date.now() - goPending < 1200) {
      goPending = 0;
      var hit = GO_KEYS.filter(function (g) { return g[0] === key.toLowerCase() && byId[g[1]]; })[0];
      if (hit) { e.preventDefault(); go(hit[1], null, {}); }
      return;
    }
    goPending = 0;
    if (key === 'r' || key === 'R') { e.preventDefault(); rerender(); }
    else if (key === 'g' || key === 'G') { goPending = Date.now(); }
    else if (key === '?') { e.preventDefault(); openShortcuts(); }
    else if (key === '/') { e.preventDefault(); openPalette(); }
    else if (key === 't' || key === 'T') { e.preventDefault(); toggleTheme(); }
    else if (key === '[') { e.preventDefault(); $('railBtn').click(); }
  });

  /* ---------------------------------------------------------- profile */
  var ROLE_TEXT = { owner: 'Owner', editor: 'Editor', viewer: 'Viewer' };
  function drawProfile() {
    var me = VX.me || {};
    var btn = $('profileBtn');
    VX.mount(btn, ui.media(me.picture, null, null, true).firstChild);
    if (!me.picture) VX.mount(btn, h('span.avatar', String(me.name || me.email || 'A').charAt(0).toUpperCase()));
    btn.setAttribute('aria-label', 'Profile: ' + (me.email || 'admin'));
    document.body.classList.toggle('role-viewer', me.role === 'viewer');
  }
  $('profileBtn').addEventListener('click', function (e) {
    e.stopPropagation();
    var pop = $('profilePop');
    if (!pop.hidden) { pop.hidden = true; return; }
    var me = VX.me || {};
    var tz = ui.select(VX.TIMEZONES, VX.tz(), { 'aria-label': 'Time zone' });
    tz.addEventListener('change', function () { VX.setTz(tz.value); stampUpdated(); rerender(); VX.toast('Times now shown in ' + VX.tzShort() + ' ✓', 'ok'); });
    VX.mount(pop,
      h('div.profile-head', ui.media(me.picture, me.name || me.email, me.name ? me.email : null, true)),
      h('p', 'Role: ', ui.pill(ROLE_TEXT[me.role] || 'Viewer', me.role === 'owner' ? 'accent' : me.role === 'editor' ? 'ok' : null)),
      me.via === 'password' ? h('p.muted.small', 'Signed in with the owner recovery password.') : null,
      h('label.dd', h('span.dd-label', 'Change timezone'), tz),
      ui.button('Sign out', { kind: 'ghost', icon: 'logout', onClick: signOut }));
    pop.hidden = false;
  });
  document.addEventListener('click', function (e) { var pop = $('profilePop'); if (!pop.hidden && !pop.contains(e.target) && e.target !== $('profileBtn')) pop.hidden = true; });

  /* ----------------------------------------------------------- auth */
  var gsiLoaded = false;
  function showLogin(msg) {
    dispose();
    current = null;
    $('app').hidden = true;
    $('login').hidden = false;
    $('loginErr').textContent = msg || '';
    $('token').value = '';
    VX.api.get('/api/admin/session', null, { fresh: true, noAuthRedirect: true }).then(function (res) {
      var d = res.data || {};
      $('pwBox').hidden = !d.passwordAllowed;
      setupTurnstile(d.turnstileSiteKey || null);
      if (!d.googleReady || !d.googleClientId) {
        VX.mount($('gsiBtn'), h('p.muted.small', 'Google sign-in is not set up on the server yet. Use the owner recovery password below.'));
        if (d.passwordAllowed) $('pwBox').open = true;
        return;
      }
      loadGsi(d.googleClientId);
    });
  }
  function loadGsi(clientId) {
    var start = function () {
      try {
        window.google.accounts.id.initialize({ client_id: clientId, callback: onGoogle, ux_mode: 'popup', auto_select: false });
        VX.clear($('gsiBtn'));
        window.google.accounts.id.renderButton($('gsiBtn'), { theme: document.documentElement.classList.contains('light') ? 'outline' : 'filled_black', size: 'large', text: 'signin_with', shape: 'pill', width: 280 });
      } catch (e) {
        VX.mount($('gsiBtn'), h('p.login-err', 'Google sign-in could not start. Reload the page to try again.'));
      }
    };
    if (window.google && window.google.accounts && window.google.accounts.id) { start(); return; }
    if (gsiLoaded) return;
    gsiLoaded = true;
    VX.mount($('gsiBtn'), h('p.muted.small', 'Loading Google sign-in…'));
    var s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = start;
    s.onerror = function () { gsiLoaded = false; VX.mount($('gsiBtn'), h('p.login-err', 'Could not reach Google. Check the connection and reload.')); };
    document.head.appendChild(s);
  }
  /* Cloudflare Turnstile: the security check under the sign-in buttons (only
     when the server names a site key). Each pass is good for one sign-in. */
  var ts = { key: null, id: null, token: null, loading: false };
  function setupTurnstile(siteKey) {
    ts.key = siteKey;
    var box = $('tsBox');
    if (!siteKey) { if (box) box.style.display = 'none'; return; }
    if (!box) {
      box = document.createElement('div');
      box.id = 'tsBox';
      box.className = 'ts-box';
      box.style.cssText = 'display:flex;justify-content:center;min-height:65px;margin:12px 0 4px';
      $('gsiBtn').insertAdjacentElement('afterend', box);
    }
    box.style.display = 'flex';
    var start = function () {
      ts.token = null;
      if (ts.id != null) { try { window.turnstile.reset(ts.id); } catch (e) {} return; }
      try {
        ts.id = window.turnstile.render(box, {
          sitekey: siteKey,
          action: 'console-signin',
          theme: document.documentElement.classList.contains('light') ? 'light' : 'dark',
          'refresh-expired': 'auto',
          callback: function (t) { ts.token = t; },
          'expired-callback': function () { ts.token = null; },
          'error-callback': function () { ts.token = null; }
        });
      } catch (e) {
        VX.mount(box, h('p.login-err', 'The security check could not start. Reload the page to try again.'));
      }
    };
    if (window.turnstile) { start(); return; }
    if (ts.loading) return;
    ts.loading = true;
    var s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = function () { ts.loading = false; start(); };
    s.onerror = function () { ts.loading = false; s.remove(); VX.mount(box, h('p.login-err', 'Could not reach the security check. Check the connection and reload.')); };
    document.head.appendChild(s);
  }
  /** The check's token for one sign-in: { ok, token }. Not ok while the check has not passed yet. */
  function takeTurnstile() {
    if (!ts.key) return { ok: true, token: undefined };
    if (!ts.token) return { ok: false };
    var t = ts.token;
    ts.token = null;
    try { window.turnstile.reset(ts.id); } catch (e) {}
    return { ok: true, token: t };
  }
  var CHECK_WAIT = 'Wait for the security check under the button to finish, then try again.';
  var CHECK_FAILED = 'The security check did not pass. Let it run again, then sign in.';

  function onGoogle(resp) {
    var check = takeTurnstile();
    if (!check.ok) { $('loginErr').textContent = CHECK_WAIT; return; }
    $('loginErr').textContent = 'Checking your account…';
    VX.api.post('/api/admin/session', { credential: resp && resp.credential, turnstile: check.token }, { noAuthRedirect: true }).then(function (res) {
      var d = res.data || {};
      if (res.ok && d.token) { VX.auth.set(d.token); VX.me = d.me || null; $('loginErr').textContent = ''; boot(); return; }
      var msg = {
        not_an_admin: 'This Google account (' + (d.email || 'unknown') + ') is not on the admin list. Ask an Owner to invite you on Admins & Roles.',
        email_not_verified: 'Google has not verified this email address yet.',
        invalid_token: 'Google sign-in did not go through. Try again.',
        rate_limited: 'Too many attempts — wait a minute and try again.',
        human_check: CHECK_FAILED,
        google_not_configured: 'Google sign-in is not set up on the server yet.'
      }[res.error] || (res.status === 0 ? 'Could not reach the server.' : 'Sign-in failed — ' + (res.message || 'try again') + '.');
      $('loginErr').textContent = msg;
    });
  }
  $('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var t = $('token').value.trim();
    if (!t) { $('loginErr').textContent = 'Enter the owner recovery password.'; return; }
    var btn = $('enter');
    if (ts.key) { passwordSignIn(t, btn); return; }
    btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    $('loginErr').textContent = '';
    VX.auth.set(t);
    VX.api.get('/api/admin/session', null, { fresh: true, noAuthRedirect: true }).then(function (res) {
      btn.disabled = false; btn.removeAttribute('aria-busy');
      if (res.status === 0) { VX.auth.clear(); $('loginErr').textContent = 'Could not reach the server.'; return; }
      if (!res.data || !res.data.me) { VX.auth.clear(); $('loginErr').textContent = 'That password is not right (or too many tries — wait 15 minutes).'; $('token').select(); return; }
      boot(res);
    });
  });
  /* With Turnstile on, the password is traded for a session once, after the check. */
  function passwordSignIn(password, btn) {
    var check = takeTurnstile();
    if (!check.ok) { $('loginErr').textContent = CHECK_WAIT; return; }
    btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    $('loginErr').textContent = '';
    VX.api.post('/api/admin/session', { password: password, turnstile: check.token }, { noAuthRedirect: true }).then(function (res) {
      btn.disabled = false; btn.removeAttribute('aria-busy');
      var d = res.data || {};
      if (res.ok && d.token) { VX.auth.set(d.token); VX.me = d.me || null; $('token').value = ''; boot(); return; }
      $('loginErr').textContent = {
        wrong_password: 'That password is not right (or too many tries — wait 15 minutes).',
        human_check: CHECK_FAILED,
        human_check_unavailable: 'The security check could not be reached, so the password cannot be used right now. Try again in a minute.',
        password_off: 'The recovery password is turned off on the server.'
      }[res.error] || (res.status === 0 ? 'Could not reach the server.' : 'Sign-in failed — ' + (res.message || 'try again') + '.');
      if (res.error === 'wrong_password') $('token').select();
    });
  }
  function signOut() {
    VX.auth.clear();
    VX.me = null;
    VX.api.clearMemo();
    $('profilePop').hidden = true;
    try { if (window.google && window.google.accounts) window.google.accounts.id.disableAutoSelect(); } catch (e) {}
    showLogin('Signed out.');
  }
  VX.auth.onExpired(function () { showLogin('You were signed out. Sign in again.'); });

  /** Signed in: learn who we are, then open the console. */
  function boot(pre) {
    var p = pre ? Promise.resolve(pre) : VX.api.get('/api/admin/session', null, { fresh: true, noAuthRedirect: true });
    p.then(function (res) {
      var d = (res && res.data) || {};
      if (!d.me) { VX.auth.clear(); showLogin(res && res.status === 0 ? 'Could not reach the server.' : ''); return; }
      VX.me = d.me;
      drawProfile();
      var banner = $('dbBanner');
      banner.hidden = true;
      if (d.databaseConfigured && d.schemaWanted && (d.schema == null || d.schema < d.schemaWanted) && VX.can('owner')) {
        VX.mount(banner, ui.notice(h('span', h('strong', 'One-time database update needed. '),
          'Until it runs, some numbers can still include people who never signed in, and some pages may not load. ',
          ui.button('How to update', { kind: 'ghost', small: true, onClick: function () { go('db-maintenance'); } })), 'warn'));
        banner.hidden = false;
      }
      $('login').hidden = true;
      $('app').hidden = false;
      if (!location.hash) setHash('dashboard', null, {}, true);
      route();
    });
  }

  /* ----------------------------------------------------------- boot */
  buildNav();
  applyTheme();
  try { if (localStorage.getItem(RAIL_KEY) === 'rail') { document.documentElement.classList.add('sb-rail'); $('railBtn').setAttribute('aria-pressed', 'true'); } } catch (e) {}
  var host = location.hostname;
  var envChip = $('envChip');
  if (/(^|\.)vinaxmusic\.online$/.test(host)) { envChip.textContent = 'Live site'; envChip.classList.add('live'); }
  else { envChip.textContent = 'Test site'; envChip.classList.add('test'); }
  VX.api.get('/api/version', null, { noAuthRedirect: true }).then(function (res) {
    var d = res.data || {};
    var v = d.version || d.latest || d.versionName;
    if (v) $('buildChip').textContent = 'App version ' + v;
  });
  try { if (localStorage.getItem(AUTO_KEY) === '1') { $('autoRefresh').checked = true; setAuto(true); } else setAuto(false); } catch (e) { setAuto(false); }

  if (VX.auth.token()) boot(); else showLogin('');
})();
