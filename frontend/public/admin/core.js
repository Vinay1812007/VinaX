/* VinaX owner console — core (13.8 rebuild).
 *
 * One global, `VX`, shared by every page file in /admin/pages/. Classic
 * script on purpose: index.html loads each file with its own <script> tag so
 * scripts/admin-stamp.mjs can content-stamp every URL (module imports would
 * not be stamped and would go stale behind the custom domain's browser TTL).
 *
 * Contents
 *   VX.h            DOM builder (text is always escaped — never innerHTML)
 *   VX.api          fetch wrapper: owner token, timeouts, 401 → sign-in
 *   VX.fmt          number / time / percent formatting
 *   VX.ui           cards, KPI tiles, tables, charts, tabs, forms, toasts,
 *                   confirm dialogs, drawers, state panels, downloads
 *   VX.page(def)    page registry consumed by app.js
 */
(function () {
  'use strict';

  var VX = (window.VX = window.VX || {});
  var TOKEN_KEY = 'vinax_admin_token';

  /* ------------------------------------------------------------------ DOM */

  function append(el, child) {
    if (child == null || child === false || child === true) return;
    if (Array.isArray(child)) { child.forEach(function (c) { append(el, c); }); return; }
    if (child instanceof Node) { el.appendChild(child); return; }
    el.appendChild(document.createTextNode(String(child)));
  }

  /**
   * h('div.card#id', { onclick, class, style: {..}, dataset: {..}, ...attrs }, children...)
   * Children may be strings, numbers, nodes, arrays or null. Strings are text.
   */
  function h(sel, attrs) {
    var m = String(sel).match(/^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i) || [];
    var el = document.createElement(m[1] || 'div');
    (m[2] || '').replace(/([.#])([\w-]+)/g, function (_, k, v) {
      if (k === '.') el.classList.add(v); else el.id = v;
      return '';
    });
    var start = 1;
    if (attrs && typeof attrs === 'object' && !(attrs instanceof Node) && !Array.isArray(attrs)) {
      start = 2;
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === 'class') { String(v).split(/\s+/).forEach(function (c) { if (c) el.classList.add(c); }); }
        else if (k === 'style' && typeof v === 'object') { Object.keys(v).forEach(function (p) { if (v[p] != null) el.style.setProperty(p, String(v[p])); }); }
        else if (k === 'dataset') { Object.keys(v).forEach(function (d) { el.dataset[d] = v[d]; }); }
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') { el.addEventListener(k.slice(2), v); }
        else if (k === 'value') { el.value = v; }
        else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden' || k === 'multiple' || k === 'readOnly') { el[k] = !!v; }
        else if (v === true) { el.setAttribute(k, ''); }
        else { el.setAttribute(k, String(v)); }
      });
    }
    for (var i = start; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  VX.h = h;
  VX.$ = function (sel, root) { return (root || document).querySelector(sel); };
  VX.$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  VX.clear = function (el) { while (el && el.firstChild) el.removeChild(el.firstChild); return el; };
  VX.mount = function (el) { VX.clear(el); for (var i = 1; i < arguments.length; i++) append(el, arguments[i]); return el; };

  var SVGNS = 'http://www.w3.org/2000/svg';
  function s(tag, attrs) {
    var el = document.createElementNS(SVGNS, tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { if (attrs[k] != null) el.setAttribute(k, String(attrs[k])); });
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  VX.svg = s;

  function icon(name) {
    var svg = s('svg', { class: 'ic', 'aria-hidden': 'true', focusable: 'false', viewBox: '0 0 24 24' });
    var use = document.createElementNS(SVGNS, 'use');
    use.setAttribute('href', '#i-' + name);
    svg.appendChild(use);
    return svg;
  }
  VX.icon = icon;

  /* --------------------------------------------------------------- format */

  var nf = new Intl.NumberFormat('en-IN');
  var cf = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
  var fmt = (VX.fmt = {
    num: function (n) { if (n == null || n === '' || isNaN(Number(n))) return '—'; return nf.format(Math.round(Number(n) * 100) / 100); },
    compact: function (n) { if (n == null || isNaN(Number(n))) return '—'; return Math.abs(Number(n)) < 10000 ? nf.format(Math.round(Number(n))) : cf.format(Number(n)); },
    pct: function (n, digits) {
      if (n == null || isNaN(Number(n))) return '—';
      var v = Number(n);
      return v.toFixed(digits == null ? (Math.abs(v) < 10 && v % 1 ? 1 : 0) : digits) + '%';
    },
    /** ratio 0..1 → "42%" */
    ratio: function (r, digits) { return r == null || isNaN(Number(r)) ? '—' : fmt.pct(Number(r) * 100, digits); },
    money: function (n) { if (n == null || isNaN(Number(n))) return '—'; var v = Number(n); return '$' + (v !== 0 && Math.abs(v) < 0.01 ? v.toFixed(4) : v.toFixed(2)); },
    ms: function (n) { if (n == null || isNaN(Number(n))) return '—'; var v = Number(n); return v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1) + ' s' : Math.round(v) + ' ms'; },
    dur: function (sec) {
      if (sec == null || isNaN(Number(sec))) return '—';
      var v = Math.max(0, Math.round(Number(sec)));
      if (v < 60) return v + 's';
      if (v < 3600) return Math.floor(v / 60) + 'm ' + (v % 60 ? (v % 60) + 's' : '').trim();
      var hrs = Math.floor(v / 3600), min = Math.floor((v % 3600) / 60);
      if (hrs < 48) return hrs + 'h' + (min ? ' ' + min + 'm' : '');
      return Math.round(hrs / 24) + 'd';
    },
    bytes: function (b) {
      if (b == null || isNaN(Number(b))) return '—';
      var v = Number(b), u = ['B', 'KB', 'MB', 'GB', 'TB'], i = 0;
      while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
      return (i ? v.toFixed(v < 10 ? 1 : 0) : v) + ' ' + u[i];
    },
    date: function (iso) {
      if (!iso) return '—';
      var d = new Date(iso);
      if (isNaN(d)) return String(iso);
      return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
    },
    dateTime: function (iso) {
      if (!iso) return '—';
      var d = new Date(iso);
      if (isNaN(d)) return String(iso);
      return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    },
    time: function (iso) { if (!iso) return '—'; var d = new Date(iso); return isNaN(d) ? String(iso) : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); },
    ago: function (iso) {
      if (!iso) return '—';
      var t = typeof iso === 'number' ? iso : new Date(iso).getTime();
      if (isNaN(t)) return String(iso);
      var d = (Date.now() - t) / 1000;
      if (d < -60) return 'in ' + fmt.dur(-d);
      if (d < 45) return 'just now';
      if (d < 3600) return Math.round(d / 60) + ' min ago';
      if (d < 86400) return Math.round(d / 3600) + ' h ago';
      if (d < 86400 * 30) return Math.round(d / 86400) + ' d ago';
      return fmt.date(iso);
    },
    /** "2026-10-21" → "21 Oct" (days keep their calendar date, no TZ shift) */
    day: function (ymd) {
      if (!ymd) return '—';
      var m = String(ymd).match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (!m) return String(ymd);
      var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    },
    plural: function (n, one, many) { return fmt.num(n) + ' ' + (Number(n) === 1 ? one : (many || one + 's')); },
    trunc: function (str, n) { str = str == null ? '' : String(str); return str.length > n ? str.slice(0, n - 1) + '…' : str; },
    country: (function () {
      var dn = null;
      try { dn = new Intl.DisplayNames(['en'], { type: 'region' }); } catch (e) {}
      return function (code) {
        if (!code) return '—';
        var c = String(code).toUpperCase();
        if (!/^[A-Z]{2}$/.test(c) || c === 'XX' || c === 'T1') return c === 'XX' ? 'Unknown' : c;
        try { return (dn && dn.of(c)) || c; } catch (e) { return c; }
      };
    })()
  });

  /* ------------------------------------------------------------------ API */

  var authListeners = [];
  VX.auth = {
    token: function () { try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } },
    set: function (t) { try { sessionStorage.setItem(TOKEN_KEY, t); } catch (e) {} },
    clear: function () { try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) {} },
    onExpired: function (fn) { authListeners.push(fn); }
  };

  function qs(params) {
    if (!params) return '';
    var p = new URLSearchParams();
    Object.keys(params).forEach(function (k) { var v = params[k]; if (v != null && v !== '') p.set(k, String(v)); });
    var str = p.toString();
    return str ? '?' + str : '';
  }

  var ERROR_TEXT = {
    not_configured: 'This feature needs a server secret that is not set.',
    unauthorized: 'Signed out — enter the owner password again.',
    rate_limited: 'Too many requests — wait a moment and retry.',
    timeout: 'The server took too long to answer.',
    network: 'Network error — check the connection.'
  };
  VX.errorText = function (code, fallback) { return ERROR_TEXT[code] || fallback || (code ? String(code).replace(/_/g, ' ') : 'Something went wrong.'); };

  /**
   * Every call resolves (never rejects) to
   *   { ok, status, data, error, message }
   * `error` is the server's error code when it sent one.
   */
  function request(method, path, opts) {
    opts = opts || {};
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var ms = opts.timeout || 25000;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, ms) : null;
    var headers = { 'x-admin-token': VX.auth.token() };
    var init = { method: method, headers: headers, cache: 'no-store', signal: ctrl ? ctrl.signal : undefined };
    if (opts.body !== undefined) { headers['content-type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
    return fetch(path + qs(opts.params), init).then(function (res) {
      if (timer) clearTimeout(timer);
      var ct = res.headers.get('content-type') || '';
      var parse = ct.indexOf('json') >= 0 ? res.json().catch(function () { return null; }) : (opts.raw ? Promise.resolve(null) : res.text().then(function (t) { try { return JSON.parse(t); } catch (e) { return t ? { text: t } : null; } }));
      return parse.then(function (data) {
        if (res.status === 401 && !opts.noAuthRedirect) {
          VX.auth.clear();
          authListeners.forEach(function (fn) { try { fn(); } catch (e) {} });
        }
        var code = data && typeof data === 'object' ? (data.error || data.code || null) : null;
        var ok = res.ok && !(data && data.ok === false);
        return {
          ok: ok,
          status: res.status,
          data: data,
          error: ok ? null : (code || 'http_' + res.status),
          message: ok ? '' : VX.errorText(code, (data && (data.message || data.detail)) || ('HTTP ' + res.status)),
          headers: res.headers
        };
      });
    }).catch(function (e) {
      if (timer) clearTimeout(timer);
      var aborted = e && e.name === 'AbortError';
      return { ok: false, status: 0, data: null, error: aborted ? 'timeout' : 'network', message: VX.errorText(aborted ? 'timeout' : 'network') };
    });
  }

  // Short-lived GET memo: two panels on one page asking for the same
  // endpoint share one request; a refresh clears it.
  var memo = new Map();
  VX.api = {
    get: function (path, params, opts) {
      var key = path + qs(params);
      if (!(opts && opts.fresh)) {
        var hit = memo.get(key);
        if (hit && Date.now() - hit.at < 4000) return hit.p;
      }
      var p = request('GET', path, Object.assign({}, opts, { params: params }));
      memo.set(key, { at: Date.now(), p: p });
      return p;
    },
    post: function (path, body, opts) { memo.clear(); return request('POST', path, Object.assign({}, opts, { body: body == null ? {} : body })); },
    // No admin route accepts DELETE/PUT (the Worker answers 405).
    /** Raw fetch with the owner token, for file downloads. */
    blob: function (path, params) {
      return fetch(path + qs(params), { headers: { 'x-admin-token': VX.auth.token() }, cache: 'no-store' })
        .then(function (res) { return res.ok ? res.blob().then(function (b) { return { ok: true, blob: b, headers: res.headers }; }) : { ok: false, status: res.status }; })
        .catch(function () { return { ok: false, status: 0 }; });
    },
    clearMemo: function () { memo.clear(); },
    /**
     * GET JSON from an allowed third-party host (the map geocoder). Never
     * carries the owner token, cookies or a referrer. Resolves to the parsed
     * JSON, or null on any failure.
     */
    external: function (url) {
      if (!/^https:\/\//.test(url)) return Promise.resolve(null);
      return fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'force-cache' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; });
    }
  };

  /* -------------------------------------------------------------- toasts */

  VX.toast = function (msg, tone) {
    var host = document.getElementById('toasts');
    if (!host) return;
    var t = h('div.toast' + (tone ? '.' + tone : ''), { role: tone === 'bad' ? 'alert' : 'status' }, msg);
    host.appendChild(t);
    setTimeout(function () { t.classList.add('out'); }, tone === 'bad' ? 6000 : 3200);
    setTimeout(function () { t.remove(); }, tone === 'bad' ? 6400 : 3600);
  };

  /* ------------------------------------------------------------- dialogs */

  var lastFocus = null;
  function trapKeys(dialog, close) {
    return function (e) {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key !== 'Tab') return;
      var f = VX.$$('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])', dialog).filter(function (x) { return !x.disabled && x.offsetParent !== null; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
  }

  /** Modal. Returns { el, close }. `actions` = [{ label, kind, onClick(close) }]. */
  VX.modal = function (o) {
    lastFocus = document.activeElement;
    var scrim = h('div.scrim');
    var close = function () {
      scrim.remove();
      document.removeEventListener('keydown', onKey, true);
      if (o.onClose) o.onClose();
      if (lastFocus && lastFocus.focus) try { lastFocus.focus(); } catch (e) {}
    };
    var foot = (o.actions || []).map(function (a) {
      return VX.ui.button(a.label, { kind: a.kind, onClick: function () { return a.onClick ? a.onClick(close) : close(); } });
    });
    var box = h('div.modal' + (o.wide ? '.wide' : ''), { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'mdl-title' },
      h('div.modal-head', h('h2#mdl-title', o.title || ''), h('button.icon-btn', { type: 'button', 'aria-label': 'Close', onclick: close }, icon('close'))),
      h('div.modal-body', o.body),
      foot.length ? h('div.modal-foot', foot) : null
    );
    var onKey = trapKeys(box, close);
    scrim.appendChild(box);
    scrim.addEventListener('mousedown', function (e) { if (e.target === scrim) close(); });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(scrim);
    var f = VX.$('input, select, textarea, .modal-foot button:last-child', box) || box.querySelector('button');
    if (f) setTimeout(function () { f.focus(); }, 20);
    return { el: box, close: close };
  };

  /** Confirm → Promise<boolean>. Set `typed` to require typing a word. */
  VX.confirm = function (o) {
    return new Promise(function (resolve) {
      var done = false;
      var input = o.typed ? VX.ui.input({ placeholder: o.typed, 'aria-label': 'Type ' + o.typed + ' to confirm' }) : null;
      var m = VX.modal({
        title: o.title || 'Are you sure?',
        body: [h('p', o.body || ''), input ? h('p.muted', 'Type ', h('code', o.typed), ' to confirm.') : null, input],
        onClose: function () { if (!done) resolve(false); },
        actions: [
          { label: 'Cancel', kind: 'ghost', onClick: function (close) { close(); } },
          { label: o.confirmLabel || 'Confirm', kind: o.danger ? 'danger' : 'primary', onClick: function (close) {
            if (input && input.value.trim() !== o.typed) { input.classList.add('invalid'); input.focus(); return; }
            done = true; resolve(true); close();
          } }
        ]
      });
      return m;
    });
  };

  /** Side drawer for drilldowns. Returns { body, close, setTitle }. */
  VX.drawer = function (o) {
    lastFocus = document.activeElement;
    var old = document.getElementById('drawer');
    if (old) old.remove();
    var body = h('div.drawer-body');
    var titleEl = h('h2', o.title || '');
    var close = function () {
      wrap.remove();
      document.removeEventListener('keydown', onKey, true);
      if (lastFocus && lastFocus.focus) try { lastFocus.focus(); } catch (e) {}
    };
    var panel = h('aside.drawer', { role: 'dialog', 'aria-modal': 'true', 'aria-label': o.title || 'Details' },
      h('div.drawer-head', titleEl, h('button.icon-btn', { type: 'button', 'aria-label': 'Close', onclick: close }, icon('close'))),
      body);
    var wrap = h('div#drawer.drawer-wrap', h('div.drawer-scrim', { onclick: close }), panel);
    var onKey = trapKeys(panel, close);
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(wrap);
    setTimeout(function () { var b = panel.querySelector('button'); if (b) b.focus(); }, 20);
    return { body: body, close: close, setTitle: function (t) { titleEl.textContent = t; } };
  };

  /* --------------------------------------------------------------- export */

  function csvCell(v) {
    if (v == null) return '';
    if (typeof v === 'object') v = JSON.stringify(v);
    var str = String(v);
    // Neutralise spreadsheet formula injection.
    if (/^[=+\-@\t\r]/.test(str)) str = "'" + str;
    return /[",\n\r]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
  }
  function saveBlob(name, blob) {
    var a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  VX.download = {
    blob: saveBlob,
    json: function (name, obj) { saveBlob(name.replace(/\.json$/, '') + '.json', new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' })); },
    csv: function (name, rows, columns) {
      rows = rows || [];
      var cols = columns || (rows[0] ? Object.keys(rows[0]).map(function (k) { return { key: k, label: k }; }) : []);
      var lines = [cols.map(function (c) { return csvCell(c.label || c.key); }).join(',')];
      rows.forEach(function (r) { lines.push(cols.map(function (c) { return csvCell(c.csv ? c.csv(r) : r[c.key]); }).join(',')); });
      saveBlob(name.replace(/\.csv$/, '') + '.csv', new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    }
  };
  VX.stamp = function () { var d = new Date(); return d.toISOString().slice(0, 10); };

  /* ------------------------------------------------------------------- UI */

  var ui = (VX.ui = {});
  var uid = 0;
  ui.id = function (p) { uid += 1; return (p || 'vx') + '-' + uid; };

  /** Button. onClick may return a promise — the button shows busy until it settles. */
  ui.button = function (label, o) {
    o = o || {};
    var b = h('button.btn' + (o.kind ? '.' + o.kind : '') + (o.small ? '.sm' : ''), { type: o.type || 'button', title: o.title, disabled: o.disabled, 'aria-label': o.ariaLabel },
      o.icon ? icon(o.icon) : null, label ? h('span', label) : null);
    if (o.onClick) {
      b.addEventListener('click', function (e) {
        if (b.getAttribute('aria-busy') === 'true') return;
        var r = o.onClick(e, b);
        if (r && typeof r.then === 'function') {
          b.setAttribute('aria-busy', 'true'); b.disabled = true;
          var done = function () { b.removeAttribute('aria-busy'); b.disabled = !!o.disabled; };
          r.then(done, done);
        }
      });
    }
    return b;
  };

  ui.pill = function (text, tone) { return h('span.pill' + (tone ? '.' + tone : ''), text); };
  ui.dot = function (tone) { return h('span.dot' + (tone ? '.' + tone : ''), { 'aria-hidden': 'true' }); };
  ui.mono = function (text) { return h('code.mono', text == null ? '—' : String(text)); };
  ui.muted = function (text) { return h('span.muted', text); };

  /** Card. o = { title, sub, actions:[nodes], body, span: 1|2|3|'full', pad: false, id } */
  ui.card = function (o) {
    var head = (o.title || o.actions) ? h('div.card-head',
      h('div.card-titles', o.title ? h('h3', o.title) : null, o.sub ? h('p.card-sub', o.sub) : null),
      o.actions ? h('div.card-actions', o.actions) : null) : null;
    var body = h('div.card-body' + (o.pad === false ? '.flush' : ''), o.body);
    var c = h('section.card' + (o.span ? '.span-' + o.span : '') + (o.tone ? '.tone-' + o.tone : ''), { id: o.id }, head, body);
    c.body = body;
    return c;
  };
  ui.grid = function (children, cols) { return h('div.grid' + (cols ? '.cols-' + cols : ''), children); };
  ui.row = function () { return h('div.row', Array.prototype.slice.call(arguments)); };
  ui.section = function (title, sub, children) { return h('div.section', h('div.section-head', h('h2', title), sub ? h('p.muted', sub) : null), children); };

  /** KPI tiles. items = [{ label, value, sub, tone, delta (number %, + is good unless inverse), inverse, spark:[n] , hint }] */
  ui.kpis = function (items) {
    return h('div.kpis', items.filter(Boolean).map(function (k) {
      var delta = null;
      if (k.delta != null && isFinite(k.delta)) {
        var good = k.inverse ? k.delta < 0 : k.delta > 0;
        delta = h('span.delta' + (k.delta === 0 ? '' : good ? '.up' : '.down'), (k.delta > 0 ? '▲ ' : k.delta < 0 ? '▼ ' : '') + Math.abs(Math.round(k.delta)) + '%');
      }
      return h('div.kpi' + (k.tone ? '.tone-' + k.tone : ''), { title: k.hint },
        h('div.kpi-label', k.label),
        h('div.kpi-value', k.value == null ? '—' : k.value),
        h('div.kpi-foot', delta, k.sub ? h('span.kpi-sub', k.sub) : null),
        k.spark && k.spark.length > 1 && k.spark.some(function (v) { return Number(v) > 0; }) ? ui.spark(k.spark) : null);
    }));
  };

  /* -- state panels -- */
  ui.loading = function (label) { return h('div.state.loading', { role: 'status' }, h('span.spinner', { 'aria-hidden': 'true' }), h('span', label || 'Loading…')); };
  ui.skeleton = function (rows) { var out = []; for (var i = 0; i < (rows || 4); i++) out.push(h('div.sk-line', { style: { width: (60 + ((i * 37) % 40)) + '%' } })); return h('div.skeleton', { 'aria-hidden': 'true' }, out); };
  ui.empty = function (title, hint, action) { return h('div.state.empty', h('div.state-icon', icon('inbox')), h('strong', title || 'Nothing here yet'), hint ? h('p', hint) : null, action || null); };
  ui.error = function (msg, retry, detail) {
    return h('div.state.error', { role: 'alert' }, h('div.state-icon', icon('alert')), h('strong', 'Could not load'), h('p', msg || 'Something went wrong.'),
      detail ? h('code.mono.small', detail) : null,
      retry ? ui.button('Try again', { kind: 'ghost', small: true, icon: 'refresh', onClick: retry }) : null);
  };
  ui.notice = function (text, tone) { return h('div.notice' + (tone ? '.' + tone : ''), { role: tone === 'bad' ? 'alert' : null }, icon(tone === 'bad' ? 'alert' : tone === 'ok' ? 'check' : 'info'), h('div', text)); };

  /**
   * Load helper: shows a loading state in `host`, calls the API, then renders.
   * render(data, res) returns node(s). Errors render inline with retry.
   *   VX.ui.load(host, () => VX.api.get('/api/admin/x'), (d) => ...)
   */
  ui.load = function (host, fetcher, render, o) {
    o = o || {};
    var run = function () {
      if (!o.quiet) VX.mount(host, o.skeleton ? ui.skeleton(o.skeleton) : ui.loading());
      return Promise.resolve(fetcher()).then(function (res) {
        if (!res || !res.ok) {
          if (res && res.status === 401) return VX.mount(host, ui.error('Signed out.'));
          VX.mount(host, ui.error(res ? res.message : 'No response', run, res && res.error && res.status ? 'HTTP ' + res.status + ' · ' + res.error : null));
          return null;
        }
        var out;
        try { out = render(res.data, res); }
        catch (e) { console.error(e); out = ui.error('This panel could not show the data: ' + (e && e.message), run); }
        VX.mount(host, out);
        return res;
      });
    };
    return run();
  };

  /* -- form controls -- */
  ui.input = function (attrs) { return h('input.input', Object.assign({ type: 'text' }, attrs)); };
  ui.textarea = function (attrs) { return h('textarea.input', Object.assign({ rows: 4 }, attrs)); };
  ui.select = function (options, value, attrs) {
    var sel = h('select.input', attrs || {});
    options.forEach(function (o) {
      var v = typeof o === 'object' ? o.value : o, l = typeof o === 'object' ? o.label : o;
      sel.appendChild(h('option', { value: v, selected: String(v) === String(value) }, l));
    });
    return sel;
  };
  /** Switch: returns <label> with .input = the checkbox */
  ui.toggle = function (label, checked, onChange, attrs) {
    var cb = h('input', Object.assign({ type: 'checkbox', role: 'switch', checked: !!checked }, attrs || {}));
    if (onChange) cb.addEventListener('change', function () { onChange(cb.checked, cb); });
    var l = h('label.switch', cb, h('span.track', { 'aria-hidden': 'true' }), label ? h('span.switch-label', label) : null);
    l.input = cb;
    return l;
  };
  /** Field wrapper: label + control + hint */
  ui.field = function (label, control, hint, o) {
    var id = control.id || ui.id('f');
    if (control.tagName && /INPUT|SELECT|TEXTAREA/.test(control.tagName)) control.id = id;
    return h('div.field' + (o && o.inline ? '.inline' : ''), h('label.field-label', { for: id }, label), control, hint ? h('p.field-hint', hint) : null);
  };
  /** Segmented control. options = [{value,label}] */
  ui.segmented = function (options, value, onChange, label) {
    var wrap = h('div.seg', { role: 'radiogroup', 'aria-label': label || 'Options' });
    options.forEach(function (o) {
      var b = h('button', { type: 'button', role: 'radio', 'aria-checked': String(String(o.value) === String(value)), onclick: function () {
        VX.$$('button', wrap).forEach(function (x) { x.setAttribute('aria-checked', 'false'); });
        b.setAttribute('aria-checked', 'true');
        onChange(o.value);
      } }, o.label);
      wrap.appendChild(b);
    });
    return wrap;
  };
  /** Search box with debounce */
  ui.search = function (placeholder, onInput, value) {
    var t = null;
    var inp = h('input.input.search-input', { type: 'search', placeholder: placeholder || 'Search…', 'aria-label': placeholder || 'Search', value: value || '' });
    inp.addEventListener('input', function () { clearTimeout(t); t = setTimeout(function () { onInput(inp.value.trim()); }, 220); });
    return h('div.search-box', icon('search'), inp);
  };
  /** Pretty JSON block */
  ui.json = function (obj) { return h('pre.json', JSON.stringify(obj, null, 2)); };
  /** Definition list from [[k, v], ...] */
  ui.dl = function (pairs) {
    return h('dl.kv', pairs.filter(Boolean).map(function (p) { return [h('dt', p[0]), h('dd', p[1] == null || p[1] === '' ? '—' : p[1])]; }));
  };

  /** Tabs. tabs = [{ id, label, badge }]; onSelect(id). Returns { el, select(id) } */
  ui.tabs = function (tabs, active, onSelect) {
    var bar = h('div.tabs', { role: 'tablist' });
    var btns = {};
    tabs.forEach(function (t) {
      var b = h('button.tab', { type: 'button', role: 'tab', id: 'tab-' + t.id, 'aria-selected': String(t.id === active), tabindex: t.id === active ? '0' : '-1', onclick: function () { select(t.id); } },
        t.label, t.badge != null ? h('span.tab-badge', String(t.badge)) : null);
      btns[t.id] = b;
      bar.appendChild(b);
    });
    bar.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      var ids = tabs.map(function (t) { return t.id; });
      var cur = ids.indexOf((VX.$('[aria-selected="true"]', bar) || {}).id ? VX.$('[aria-selected="true"]', bar).id.slice(4) : ids[0]);
      var next = ids[(cur + (e.key === 'ArrowRight' ? 1 : ids.length - 1)) % ids.length];
      select(next); btns[next].focus();
    });
    function select(id) {
      Object.keys(btns).forEach(function (k) { btns[k].setAttribute('aria-selected', String(k === id)); btns[k].tabIndex = k === id ? 0 : -1; });
      onSelect(id);
    }
    return { el: bar, select: select };
  };

  /* -- table -- */

  /**
   * Data table with sort, filter, paging and CSV export.
   * o = {
   *   columns: [{ key, label, align:'right', render(row) → node|text, sort: fn(row)|false, csv(row), width, nowrap, hide }],
   *   rows, empty: 'text', emptyHint, search: true|'placeholder', pageSize: 25,
   *   exportName: 'file', onRow(row), sortKey, sortDir: 'desc', toolbar: [nodes], dense, rowClass(row)
   * }
   * Returns the element; el.update(rows) re-renders with new rows.
   */
  ui.table = function (o) {
    var rows = o.rows || [];
    var cols = o.columns.filter(function (c) { return !c.hide; });
    var sortKey = o.sortKey || null, dir = o.sortDir || 'desc', q = '', page = 0, size = o.pageSize || 25;
    var wrap = h('div.tbl-wrap');
    var info = h('span.tbl-info.muted');
    var bodyHost = h('div.tbl-scroll');
    var pager = h('div.tbl-pager');
    var tools = [];
    if (o.search !== false && (o.search || rows.length > 8)) tools.push(ui.search(typeof o.search === 'string' ? o.search : 'Filter rows…', function (v) { q = v.toLowerCase(); page = 0; draw(); }));
    if (o.toolbar) tools = tools.concat(o.toolbar);
    var spacer = h('span.grow');
    var exp = o.exportName !== false ? ui.button('CSV', { kind: 'ghost', small: true, icon: 'download', title: 'Download these rows as CSV', onClick: function () { VX.download.csv((o.exportName || 'vinax-export') + '-' + VX.stamp(), filtered(), cols.map(function (c) { return { key: c.key, label: c.label, csv: c.csv || (c.sortVal ? c.sortVal : null) }; })); } }) : null;
    var bar = h('div.tbl-bar', tools, spacer, info, exp);

    function val(r, c) { return c.sortVal ? c.sortVal(r) : r[c.key]; }
    function filtered() {
      var list = rows;
      if (q) list = list.filter(function (r) { return cols.some(function (c) { var v = val(r, c); return v != null && String(v).toLowerCase().indexOf(q) >= 0; }); });
      if (sortKey) {
        var c = cols.filter(function (x) { return x.key === sortKey; })[0];
        if (c) {
          list = list.slice().sort(function (a, b) {
            var x = val(a, c), y = val(b, c);
            if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
            var nx = Number(x), ny = Number(y);
            var r = (!isNaN(nx) && !isNaN(ny) && x !== '' && y !== '') ? nx - ny : String(x).localeCompare(String(y));
            return dir === 'asc' ? r : -r;
          });
        }
      }
      return list;
    }
    function draw() {
      var list = filtered();
      var pages = Math.max(1, Math.ceil(list.length / size));
      if (page >= pages) page = pages - 1;
      var slice = list.slice(page * size, page * size + size);
      if (!rows.length) {
        VX.mount(bodyHost, ui.empty(o.empty || 'No data yet', o.emptyHint));
        info.textContent = ''; VX.clear(pager); bar.hidden = !o.toolbar; if (exp) exp.disabled = true;
        return;
      }
      bar.hidden = false; if (exp) exp.disabled = false;
      var thead = h('thead', h('tr', cols.map(function (c) {
        var sortable = c.sort !== false;
        var ariaSort = sortKey === c.key ? (dir === 'asc' ? 'ascending' : 'descending') : null;
        return h('th' + (c.align ? '.' + c.align : ''), { scope: 'col', 'aria-sort': ariaSort, style: c.width ? { width: c.width } : null },
          sortable ? h('button.th-sort', { type: 'button', onclick: function () {
            if (sortKey === c.key) dir = dir === 'asc' ? 'desc' : 'asc'; else { sortKey = c.key; dir = c.align === 'right' ? 'desc' : 'asc'; }
            draw();
          } }, c.label, h('span.sort-ind', { 'aria-hidden': 'true' }, sortKey === c.key ? (dir === 'asc' ? '↑' : '↓') : '')) : c.label);
      })));
      var tbody = h('tbody', slice.map(function (r) {
        var tr = h('tr' + (o.onRow ? '.clickable' : '') + (o.rowClass ? (o.rowClass(r) ? '.' + o.rowClass(r) : '') : ''), cols.map(function (c) {
          var v = c.render ? c.render(r) : r[c.key];
          return h('td' + (c.align ? '.' + c.align : '') + (c.nowrap ? '.nowrap' : ''), v == null || v === '' ? h('span.muted', '—') : v);
        }));
        if (o.onRow) {
          tr.tabIndex = 0;
          tr.addEventListener('click', function (e) { if (e.target.closest('button, a, input, select')) return; o.onRow(r, e); });
          tr.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target === tr) o.onRow(r, e); });
        }
        return tr;
      }));
      VX.mount(bodyHost, slice.length ? h('table.tbl' + (o.dense ? '.dense' : ''), thead, tbody) : ui.empty('No rows match “' + q + '”'));
      info.textContent = list.length === rows.length ? fmt.plural(rows.length, 'row') : fmt.num(list.length) + ' of ' + fmt.plural(rows.length, 'row');
      VX.clear(pager);
      if (pages > 1) {
        pager.appendChild(ui.button('Previous', { kind: 'ghost', small: true, disabled: page === 0, onClick: function () { page--; draw(); } }));
        pager.appendChild(h('span.muted', 'Page ' + (page + 1) + ' of ' + pages));
        pager.appendChild(ui.button('Next', { kind: 'ghost', small: true, disabled: page >= pages - 1, onClick: function () { page++; draw(); } }));
      }
    }
    wrap.appendChild(bar);
    wrap.appendChild(bodyHost);
    wrap.appendChild(pager);
    wrap.update = function (r) { rows = r || []; draw(); };
    draw();
    return wrap;
  };

  /* -- charts (dependency-free SVG) -- */

  var PALETTE = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)'];
  ui.palette = PALETTE;

  ui.spark = function (values, o) {
    o = o || {};
    var w = o.width || 120, ht = o.height || 28;
    var vals = values.map(Number).filter(function (v) { return isFinite(v); });
    if (vals.length < 2) return h('span');
    var max = Math.max.apply(null, vals), min = Math.min.apply(null, vals);
    var span = max - min || 1;
    var pts = vals.map(function (v, i) { return [(i / (vals.length - 1)) * w, ht - 2 - ((v - min) / span) * (ht - 4)]; });
    var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
    return s('svg', { class: 'spark', viewBox: '0 0 ' + w + ' ' + ht, preserveAspectRatio: 'none', 'aria-hidden': 'true' },
      s('path', { d: d + ' L' + w + ' ' + ht + ' L0 ' + ht + ' Z', class: 'spark-fill' }),
      s('path', { d: d, class: 'spark-line' }));
  };

  function niceMax(v) {
    if (v <= 0) return 1;
    var p = Math.pow(10, Math.floor(Math.log10(v)));
    var n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  }

  /**
   * Line / area / column chart over a category axis.
   * o = { labels: [..], series: [{ name, values: [..], color }], type: 'area'|'line'|'bar', height, format(v), labelFormat(l), stacked }
   */
  ui.chart = function (o) {
    var labels = o.labels || [];
    var series = (o.series || []).filter(function (x) { return x && x.values; });
    var host = h('div.chart', { style: { height: (o.height || 220) + 'px' } });
    if (!labels.length || !series.length || series.every(function (x) { return x.values.every(function (v) { return !Number(v); }); })) {
      host.appendChild(ui.empty(o.empty || 'No data in this period', o.emptyHint));
      host.classList.add('is-empty');
      return h('div.chart-wrap', host);
    }
    // Geometry in a 1000×H box stretched to the card width; axis text is
    // HTML laid over it so labels never stretch with the SVG.
    var W = 1000, H = o.height || 220, padT = 6;
    var iw = W, ih = H - padT;
    var type = o.type || 'area';
    var maxV = 0;
    if (type === 'bar' && o.stacked) labels.forEach(function (_, i) { var t = 0; series.forEach(function (sr) { t += Number(sr.values[i]) || 0; }); maxV = Math.max(maxV, t); });
    else series.forEach(function (sr) { sr.values.forEach(function (v) { maxV = Math.max(maxV, Number(v) || 0); }); });
    var top = niceMax(maxV);
    var f = o.format || fmt.compact;
    var lf = o.labelFormat || function (l) { return /^\d{4}-\d{2}-\d{2}/.test(String(l)) ? fmt.day(l) : String(l); };
    var svg = s('svg', { viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'none', class: 'chart-svg', role: 'img', 'aria-label': o.title || 'Chart' });
    var yAxis = h('div.chart-y', { 'aria-hidden': 'true' });
    var xAxis = h('div.chart-x', { 'aria-hidden': 'true' });
    for (var g = 0; g <= 4; g++) {
      var y = padT + ih - (g / 4) * ih;
      svg.appendChild(s('line', { x1: 0, x2: W, y1: y, y2: y, class: 'grid-line' }));
      yAxis.appendChild(h('span', { style: { top: (y / H * 100).toFixed(2) + '%' } }, f(top * g / 4)));
    }
    var n = labels.length;
    var step = Math.max(1, Math.ceil(n / 7));
    var xAt = function (i) { return type === 'bar' ? (i + 0.5) * (iw / n) : (n === 1 ? iw / 2 : (i / (n - 1)) * iw); };
    var shownIdx = 0;
    labels.forEach(function (l, i) {
      if (i % step !== 0) return;
      var pct = xAt(i) / W * 100;
      // Every other label is "minor" and hides in narrow cards (container query).
      xAxis.appendChild(h('span' + (pct < 4 ? '.first' : pct > 96 ? '.last' : '') + (shownIdx++ % 2 ? '.minor' : ''), { style: { left: pct.toFixed(2) + '%' } }, lf(l)));
    });
    var yAt = function (v) { return padT + ih - (Math.max(0, Number(v) || 0) / top) * ih; };
    if (type === 'bar') {
      var bw = (iw / n) * (o.stacked ? 0.7 : 0.8 / series.length);
      labels.forEach(function (_, i) {
        var acc = 0;
        series.forEach(function (sr, si) {
          var v = Number(sr.values[i]) || 0;
          var x = o.stacked ? xAt(i) - bw / 2 : xAt(i) - (bw * series.length) / 2 + si * bw;
          var y0 = yAt(acc + v), y1 = yAt(acc);
          var r = s('rect', { x: x, y: y0, width: Math.max(1, bw - 2), height: Math.max(0, y1 - y0), class: 'bar', fill: sr.color || PALETTE[si % PALETTE.length] });
          var tt = s('title'); tt.textContent = lf(labels[i]) + ' · ' + sr.name + ': ' + f(v); r.appendChild(tt);
          svg.appendChild(r);
          if (o.stacked) acc += v;
        });
      });
    } else {
      series.forEach(function (sr, si) {
        var color = sr.color || PALETTE[si % PALETTE.length];
        var pts = sr.values.map(function (v, i) { return [xAt(i), yAt(v)]; });
        var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
        if (type === 'area' && series.length <= 2) svg.appendChild(s('path', { d: d + ' L' + pts[pts.length - 1][0] + ' ' + (padT + ih) + ' L' + pts[0][0] + ' ' + (padT + ih) + ' Z', fill: color, class: 'area' }));
        var line = s('path', { d: d, stroke: color, class: 'line' });
        var tt = s('title'); tt.textContent = sr.name + ': ' + sr.values.map(function (v, i) { return lf(labels[i]) + ' ' + f(v); }).join(', '); line.appendChild(tt);
        svg.appendChild(line);
      });
    }
    host.classList.add('has-axes');
    host.appendChild(yAxis);
    host.appendChild(xAxis);
    host.appendChild(svg);
    var legend = series.length > 1 ? h('div.legend', series.map(function (sr, si) {
      return h('span.legend-item', h('span.swatch', { style: { background: sr.color || PALETTE[si % PALETTE.length] } }), sr.name);
    })) : null;
    return h('div.chart-wrap', legend, host);
  };

  /** Horizontal bars. items = [{ label, value, sub, href }] */
  ui.hbars = function (items, o) {
    o = o || {};
    items = (items || []).filter(function (x) { return x && x.value != null; });
    if (!items.length) return ui.empty(o.empty || 'No data yet', o.emptyHint);
    var max = Math.max.apply(null, items.map(function (x) { return Number(x.value) || 0; })) || 1;
    var f = o.format || fmt.num;
    return h('ol.hbars', items.slice(0, o.limit || 12).map(function (it, i) {
      return h('li', { title: it.title || null },
        h('span.hb-rank', String(i + 1)),
        h('div.hb-main',
          h('div.hb-top', h('span.hb-label', it.label || '—'), h('span.hb-val', f(it.value))),
          it.sub ? h('div.hb-sub', it.sub) : null,
          h('div.hb-track', h('div.hb-fill', { style: { width: Math.max(1.5, (Number(it.value) || 0) / max * 100) + '%' } }))));
    }));
  };

  /** Donut / share list. items = [{ label, value }] */
  ui.share = function (items, o) {
    o = o || {};
    items = (items || []).filter(function (x) { return x && Number(x.value) > 0; });
    if (!items.length) return ui.empty(o.empty || 'No data yet');
    var total = items.reduce(function (a, b) { return a + Number(b.value); }, 0);
    var R = 42, C = 2 * Math.PI * R, off = 0;
    var svg = s('svg', { viewBox: '0 0 100 100', class: 'donut', role: 'img', 'aria-label': o.title || 'Share' });
    svg.appendChild(s('circle', { cx: 50, cy: 50, r: R, class: 'donut-bg' }));
    var shown = items.slice(0, 6);
    var rest = items.slice(6).reduce(function (a, b) { return a + Number(b.value); }, 0);
    if (rest) shown.push({ label: 'Other', value: rest });
    shown.forEach(function (it, i) {
      var len = (Number(it.value) / total) * C;
      svg.appendChild(s('circle', { cx: 50, cy: 50, r: R, class: 'donut-seg', stroke: PALETTE[i % PALETTE.length], 'stroke-dasharray': len.toFixed(2) + ' ' + (C - len).toFixed(2), 'stroke-dashoffset': (-off).toFixed(2), transform: 'rotate(-90 50 50)' }));
      off += len;
    });
    return h('div.share', svg, h('ul.share-list', shown.map(function (it, i) {
      return h('li', h('span.swatch', { style: { background: PALETTE[i % PALETTE.length] } }), h('span.share-label', it.label || '—'), h('span.share-val', fmt.num(it.value)), h('span.muted', fmt.pct(Number(it.value) / total * 100)));
    })));
  };

  /** Simple meter 0..1. Pass `label` (what it measures) for screen readers. */
  ui.meter = function (ratio, tone, label) {
    var r = Math.max(0, Math.min(1, Number(ratio) || 0));
    return h('div.meter' + (tone ? '.' + tone : ''), { role: 'meter', 'aria-label': label || 'Level', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(r * 100)) }, h('div.meter-fill', { style: { width: (r * 100).toFixed(1) + '%' } }));
  };

  /** Status dot + label from a tone string */
  ui.status = function (tone, label) { return h('span.status.' + (tone || 'muted'), ui.dot(tone), label); };

  /* -------------------------------------------------------------- pages */

  var pages = [];
  /**
   * Register a page.
   * def = {
   *   id, title, group, icon, desc,
   *   tabs: [{ id, label, render(host, ctx) }]   — or —   render(host, ctx)
   * }
   * ctx = { refresh(), every(ms, fn), onDispose(fn), params, setParam(k, v), tab }
   */
  VX.page = function (def) { pages.push(def); };
  VX.pages = function () { return pages.slice(); };

  /** Song/listener cell: thumbnail + title + subtitle */
  ui.media = function (img, title, sub, round) {
    var initial = function () { return h('span.' + (round ? 'avatar' : 'thumb'), { 'aria-hidden': 'true' }, round && title ? String(title).trim().charAt(0).toUpperCase() : ''); };
    var pic = img && /^https:\/\//.test(img)
      ? h('img.' + (round ? 'avatar' : 'thumb'), { src: img, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' })
      : initial();
    // A dead photo URL falls back to the initial instead of a broken image.
    if (pic.tagName === 'IMG') pic.addEventListener('error', function () { if (pic.parentNode) pic.parentNode.replaceChild(initial(), pic); });
    return h('div.media', pic, h('div', h('div.cell-main', title || '—'), sub ? h('div.cell-sub', sub) : null));
  };

  /** Days-window select used by many analytics pages. */
  VX.ui.daysPicker = function (value, onChange) {
    return ui.segmented([{ value: 1, label: '24h' }, { value: 7, label: '7d' }, { value: 30, label: '30d' }, { value: 90, label: '90d' }], value, onChange, 'Time range');
  };
})();

/* 14.0 — shared helpers for the database-backed pages. */
(function () {
  'use strict';
  var VX = window.VX, h = VX.h, ui = VX.ui, fmt = VX.fmt;

  /** The card every data page shows while the database is not set up. */
  ui.setupCard = function (ctx) {
    return ui.card({
      title: 'Database not set up', tone: 'warn',
      body: [
        h('p', 'This page reads the VinaX database, and the Worker has no database configured yet. Three steps:'),
        h('ol.steps', { style: { 'margin-top': '10px' } },
          h('li', 'Create a Supabase project and paste ', h('code.mono', 'backend/supabase/schema.sql'), ' into its SQL editor, then Run.'),
          h('li', 'Set the Worker secrets ', h('code.mono', 'SUPABASE_URL'), ' and ', h('code.mono', 'SUPABASE_SERVICE_ROLE_KEY'), '.'),
          h('li', 'Open the Database page — it shows the schema version the paste wrote.')),
        h('pre.json', { style: { 'margin-top': '10px' } }, 'cd backend\nnpx wrangler secret put SUPABASE_URL --config worker/wrangler.toml\nnpx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --config worker/wrangler.toml'),
        ctx && ctx.go ? h('div.toolbar', { style: { 'margin-top': '12px' } }, ui.button('Open Database page', { kind: 'ghost', small: true, icon: 'database', onClick: function () { ctx.go('database', 'tables'); } })) : null
      ]
    });
  };

  /** `d.configured === false` → the setup card, else null. */
  ui.gate = function (d, ctx) { return d && d.configured === false ? ui.setupCard(ctx) : null; };

  /** Arrays and objects from an answer that may be empty. */
  VX.arr = function (v) { return Array.isArray(v) ? v : []; };
  VX.obj = function (v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; };
  VX.num = function (v) { var n = Number(v); return isFinite(n) ? n : 0; };

  /** Hour-of-week heat map: cells[7][24] (Sunday first), values scaled by opacity. */
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  ui.heatmap = function (cells, o) {
    o = o || {};
    cells = VX.arr(cells);
    if (!cells.length || !cells.some(function (r) { return VX.arr(r).some(function (v) { return VX.num(v) > 0; }); })) return ui.empty(o.empty || 'No activity in this period');
    var max = 1;
    cells.forEach(function (r) { VX.arr(r).forEach(function (v) { max = Math.max(max, VX.num(v)); }); });
    var grid = h('div.heat', { style: { 'grid-template-columns': '36px repeat(24, minmax(8px, 1fr))' }, role: 'img', 'aria-label': o.label || 'Activity by hour and weekday' });
    grid.appendChild(h('span'));
    for (var hh = 0; hh < 24; hh++) grid.appendChild(h('span.heat-lbl', hh % 3 === 0 ? String(hh) : ''));
    cells.slice(0, 7).forEach(function (row, d) {
      grid.appendChild(h('span.heat-lbl', DAYS[d] || String(d)));
      for (var x = 0; x < 24; x++) {
        var v = VX.num(VX.arr(row)[x]);
        grid.appendChild(h('div.heat-cell', { title: DAYS[d] + ' ' + x + ':00 · ' + fmt.num(v), style: { opacity: v ? (0.15 + 0.85 * v / max).toFixed(2) : '0.06' } }));
      }
    });
    return grid;
  };

  /** Previous / Next controls for server-side paging. */
  ui.pager = function (offset, limit, total, onPage) {
    var pages = Math.max(1, Math.ceil(VX.num(total) / limit));
    var page = Math.floor(offset / limit);
    return h('div.tbl-pager',
      ui.button('Previous', { kind: 'ghost', small: true, disabled: page <= 0, onClick: function () { onPage(Math.max(0, offset - limit)); } }),
      h('span.muted', 'Page ' + fmt.num(page + 1) + ' of ' + fmt.num(pages) + ' · ' + fmt.plural(total, 'row')),
      ui.button('Next', { kind: 'ghost', small: true, disabled: page >= pages - 1, onClick: function () { onPage(offset + limit); } }));
  };

  /** A short random id for dedupe keys. */
  VX.rid = function () {
    var b = new Uint8Array(8);
    (window.crypto || {}).getRandomValues ? window.crypto.getRandomValues(b) : b.forEach(function (_, i) { b[i] = Math.floor(Math.random() * 256); });
    return Array.prototype.map.call(b, function (x) { return x.toString(16).padStart(2, '0'); }).join('');
  };

  /** Time cell: relative text with the full stamp as a tooltip. */
  ui.ago = function (iso) { return iso ? h('span', { title: fmt.dateTime(iso) }, fmt.ago(iso)) : h('span.muted', '—'); };
})();
