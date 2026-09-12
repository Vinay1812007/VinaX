(function () {
  'use strict';
  var TOKEN_KEY = 'vinax_admin_token';
  var active = 'live';
  var rangeDays = 7;
  var autoRefresh = true;
  var autoTimer = null;
  var exportRows = null, exportName = 'vinax';
  var userOffset = 0, userQ = '';
  var lastJson = null, lastStampAt = Date.now();
  // Request-budget fix: default auto-refresh 10s -> 30s. An always-open
  // admin tab at 10s burned ~8-9k Worker requests/day by itself; 30s keeps
  // dashboards live at a third of the cost (header selector still offers 10s).
  var refreshMs = parseInt((localStorage.getItem('vinax_admin_interval') || '30000'), 10) || 30000;

  function $(id) { return document.getElementById(id); }
  function token() { return sessionStorage.getItem(TOKEN_KEY) || ''; }
  function noop() {}
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  // Audit finding H-SRV-10 — safe HTML template tag. Prefer this over raw
  // innerHTML string concatenation for new code: every ${value} is escaped
  // automatically, so a hostile display name or a broken upstream string can
  // never break out of the surrounding HTML context.
  //   host.innerHTML = html`<div>${untrusted}</div>`;
  // The one narrow escape hatch — an already-trusted HTML fragment — is not
  // supported by design; hand-build those fragments with esc() as usual.
  function html(strings, ...values) {
    var out = strings[0];
    for (var i = 0; i < values.length; i++) {
      var v = values[i];
      out += (v == null) ? '' : String(v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
      out += strings[i + 1];
    }
    return out;
  }
  // Export to window for use across the file / future modules.
  try { window.html = html; } catch (_e) {}

  // ---------- Custom dialogs (styled replacements for alert/confirm/prompt) ----------
  // Native browser popups ("admin.sirimillavinay.online says") are replaced by
  // in-page modals that match the console theme. Promise-based:
  //   vxAlert(msg, opts)    → resolves when dismissed
  //   vxConfirm(msg, opts)  → resolves true (OK) / false (Cancel)
  //   vxPrompt(msg, opts)   → resolves trimmed input string, or null on cancel
  // opts: { title, okText, cancelText, danger, placeholder, value, minLength,
  // note }. danger paints the OK button red for destructive actions. Enter =
  // OK, Escape / overlay click = Cancel. minLength keeps OK disabled (with an
  // inline note) until the prompt input is long enough — mandatory reasons.
  function vxDialog(o) {
    return new Promise(function (resolve) {
      var prevFocus = document.activeElement;
      var isPrompt = o.mode === 'prompt';
      var hasCancel = o.mode !== 'alert';
      var wrap = document.createElement('div');
      wrap.className = 'vxd-overlay';
      wrap.innerHTML =
        '<div class="vxd' + (o.danger ? ' danger' : '') + '" role="dialog" aria-modal="true">' +
          '<div class="vxd-head"><span class="vxd-logo"></span>' + esc(o.title || 'VinaX Admin') + '</div>' +
          '<div class="vxd-msg"></div>' +
          (isPrompt ? '<input class="vxd-input" type="text">' : '') +
          (isPrompt && o.minLength ? '<div class="vxd-note"></div>' : '') +
          '<div class="vxd-actions">' +
            (hasCancel ? '<button class="ghost vxd-cancel" type="button">' + esc(o.cancelText || 'Cancel') + '</button>' : '') +
            '<button class="vxd-ok" type="button">' + esc(o.okText || 'OK') + '</button>' +
          '</div>' +
        '</div>';
      wrap.querySelector('.vxd-msg').textContent = o.message || '';
      var input = wrap.querySelector('.vxd-input');
      var note = wrap.querySelector('.vxd-note');
      var okBtn = wrap.querySelector('.vxd-ok');
      var cancelBtn = wrap.querySelector('.vxd-cancel');
      if (input) {
        if (o.placeholder) input.placeholder = o.placeholder;
        if (o.value) input.value = o.value;
      }
      function valid() {
        if (!input || !o.minLength) return true;
        var ok = input.value.trim().length >= o.minLength;
        okBtn.disabled = !ok;
        if (note) note.textContent = ok ? '' : (o.note || ('At least ' + o.minLength + ' characters required.'));
        return ok;
      }
      function close(result) {
        document.removeEventListener('keydown', onKey, true);
        wrap.classList.add('closing');
        setTimeout(function () { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); }, 130);
        if (prevFocus && prevFocus.focus) { try { prevFocus.focus(); } catch (_f) {} }
        resolve(result);
      }
      function done() {
        if (!valid()) { if (input) input.focus(); return; }
        close(o.mode === 'confirm' ? true : (isPrompt ? input.value.trim() : undefined));
      }
      function cancel() { close(o.mode === 'confirm' ? false : (isPrompt ? null : undefined)); }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); return; }
        if (e.key === 'Enter') {
          if (e.target === cancelBtn) return; // native click on focused Cancel
          e.preventDefault(); done();
        }
      }
      okBtn.addEventListener('click', done);
      if (cancelBtn) cancelBtn.addEventListener('click', cancel);
      wrap.addEventListener('mousedown', function (e) { if (e.target === wrap) cancel(); });
      if (input) input.addEventListener('input', valid);
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(wrap);
      valid();
      setTimeout(function () { (input || okBtn).focus(); if (input && o.value) input.select(); }, 30);
    });
  }
  function vxAlert(message, opts) { return vxDialog(Object.assign({ mode: 'alert', message: message }, opts || {})); }
  function vxConfirm(message, opts) { return vxDialog(Object.assign({ mode: 'confirm', message: message }, opts || {})); }
  function vxPrompt(message, opts) { return vxDialog(Object.assign({ mode: 'prompt', message: message }, opts || {})); }

  // Device-type icon for user rows: instant visual scan of web vs app.
  function platIcon(p) {
    p = String(p || 'web').toLowerCase();
    if (p === 'android' || p === 'ios') return '📱';
    if (p === 'tv') return '📺';
    if (p === 'desktop' || p === 'electron') return '💻';
    return '🌐';
  }
  function ago(iso) { var s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000)); if (s < 60) return s + 's ago'; if (s < 3600) return Math.round(s / 60) + 'm ago'; if (s < 86400) return Math.round(s / 3600) + 'h ago'; return Math.round(s / 86400) + 'd ago'; }
  function date(iso) { try { return new Date(iso).toLocaleDateString(); } catch (e) { return '—'; } }
  function ist(s) {
    if (!s) return '—';
    try {
      // Accept both "YYYY-MM-DD HH:MM:SS" (naive UTC) and full ISO strings.
      // Blindly appending Z to "…+00:00" made every ISO stamp "Invalid Date".
      var str = String(s).replace(' ', 'T');
      if (!/([zZ]|[+-]\d\d:?\d\d)$/.test(str)) str += 'Z';
      var d = new Date(str);
      if (isNaN(d.getTime())) d = new Date(String(s));
      if (isNaN(d.getTime())) return String(s);
      return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true, day: '2-digit', month: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });
    } catch (e) { return s; }
  }
  function pct(v, max) { return max > 0 ? Math.round((v / max) * 100) : 0; }
  function stamp() { lastStampAt = Date.now(); var st = $('stale'); if (st) st.hidden = true; $('updated').textContent = 'Updated ' + new Date().toLocaleTimeString(); }
  function setExport(name, rows) { exportName = name; exportRows = rows && rows.length ? rows : null; $('csv').hidden = !exportRows; }

  function api(path) {
    return fetch(path, { headers: { 'x-admin-token': token() }, cache: 'no-store' }).then(function (res) {
      if (res.status === 401) { sessionStorage.removeItem(TOKEN_KEY); showLogin('Invalid token.'); return null; }
      if (!res.ok) throw new Error('http ' + res.status);
      return res.json().then(function (j) { lastJson = j; var jb = $('json'); if (jb) jb.disabled = false; return j; });
    });
  }
  var memoCache = {};
  function memoReset() { memoCache = {}; }
  // Silent refresh: resolve null when the payload didn't change, so loaders
  // skip repainting. Still stamps freshness so the stale banner stays honest.
  // `key` lets two callers share one endpoint without deduping each other
  // (the header pulse and the Overview panel both read /api/admin/overview).
  function apiMemo(path, key) {
    key = key || path;
    return api(path).then(function (d) {
      stamp();
      var sig = JSON.stringify(d);
      if (memoCache[key] === sig) return null;
      memoCache[key] = sig;
      return d;
    });
  }
  function postApi(path, body) {
    return fetch(path, { method: 'POST', headers: { 'x-admin-token': token(), 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(function (res) {
      if (res.status === 401) { sessionStorage.removeItem(TOKEN_KEY); showLogin('Invalid token.'); return null; }
      return res.json();
    });
  }
  function downloadCsv() {
    if (!exportRows) return;
    var cols = Object.keys(exportRows[0]);
    var lines = [cols.join(',')].concat(exportRows.map(function (r) {
      return cols.map(function (c) { var v = r[c] == null ? '' : String(r[c]); return '"' + v.replace(/"/g, '""') + '"'; }).join(',');
    }));
    var blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = exportName + '-' + new Date().toISOString().slice(0, 10) + '.csv'; a.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function showLogin(msg) { stopAuto(); $('app').hidden = true; $('login').hidden = false; $('loginErr').textContent = msg || ''; }
  function showApp() { $('login').hidden = true; $('app').hidden = false; }

  function bars(items, labelFn, valFn) {
    if (!items || !items.length) return '<div class="empty">No data yet.</div>';
    var max = items.reduce(function (m, x) { return Math.max(m, valFn(x)); }, 0);
    return items.map(function (x) {
      return '<div class="brow"><div class="blabel">' + labelFn(x) + '</div><div class="btrack"><div class="bfill" style="width:' + pct(valFn(x), max) + '%"></div></div><div class="bval">' + valFn(x) + '</div></div>';
    }).join('');
  }
  function songRows(items) {
    if (!items || !items.length) return '<div class="empty">No data yet.</div>';
    var max = items.reduce(function (m, x) { return Math.max(m, x.plays); }, 0);
    return items.map(function (x) {
      var img = x.song_image ? '<img class="thumb" loading="lazy" alt="" src="' + esc(x.song_image) + '" />' : '<span class="thumb ph"></span>';
      var name = esc(x.song_title || '') + (x.song_artist ? ' <span class="muted">· ' + esc(x.song_artist) + '</span>' : '');
      return '<div class="srow">' + img + '<div class="sname">' + name + '</div><div class="btrack"><div class="bfill" style="width:' + pct(x.plays, max) + '%"></div></div><div class="bval">' + x.plays + '</div></div>';
    }).join('');
  }
  function dayChart(rows, key, color) {
    if (!rows || !rows.length) return '<div class="empty">No data yet.</div>';
    var max = rows.reduce(function (m, x) { return Math.max(m, x[key]); }, 0);
    return '<div class="days">' + rows.map(function (x) {
      var h = max > 0 ? Math.round((x[key] / max) * 110) : 2;
      return '<div class="day" title="' + esc(x.day) + ': ' + x[key] + '"><div class="col" style="height:' + h + 'px' + (color ? ';background:' + color : '') + '"></div><div class="t">' + esc(String(x.day).slice(5)) + '</div></div>';
    }).join('') + '</div>';
  }

  function card(n, l) { return '<div class="card"><div class="n">' + (n || 0) + '</div><div class="l">' + l + '</div></div>'; }
  function hourChart(rows) {
    var map = {}; (rows || []).forEach(function (r) { map[r.hour] = r.plays; });
    var arr = []; for (var h = 0; h < 24; h++) arr.push({ h: h, plays: map[h] || 0 });
    var max = arr.reduce(function (m, x) { return Math.max(m, x.plays); }, 0);
    return '<div class="days">' + arr.map(function (x) {
      var ht = max > 0 ? Math.round((x.plays / max) * 110) : 2;
      return '<div class="day" title="' + x.h + ':00 UTC · ' + x.plays + ' plays"><div class="col" style="height:' + ht + 'px"></div><div class="t">' + x.h + '</div></div>';
    }).join('') + '</div>';
  }
  function trendingRows(items) {
    if (!items || !items.length) return '<tr><td colspan="3" class="empty">No data yet.</td></tr>';
    return items.map(function (x) {
      var delta = x.plays - (x.prev_plays || 0);
      var trend = delta > 0 ? '<span style="color:var(--ok)">▲ ' + delta + '</span>' : (delta < 0 ? '<span style="color:var(--danger)">▼ ' + Math.abs(delta) + '</span>' : '<span class="muted">—</span>');
      var img = x.song_image ? '<img class="thumb-sm" loading="lazy" alt="" src="' + esc(x.song_image) + '" />' : '';
      return '<tr><td><span class="nowcell">' + img + '<span>' + esc(x.song_title || '') + (x.song_artist ? ' <span class="muted">· ' + esc(x.song_artist) + '</span>' : '') + '</span></span></td><td>' + x.plays + '</td><td>' + trend + '</td></tr>';
    }).join('');
  }

  // ---------- Live ----------
  function renderLive(d) {
    var countries = d.byCountry || {};
    var ck = Object.keys(countries).sort(function (a, b) { return countries[b] - countries[a]; });
    var L = d.listeners || [];
    setExport('live-listeners', L);
    var rows = L.map(function (r) {
      var loc = [r.city, r.country].filter(Boolean).map(esc).join(', ') || '<span class="muted">Unknown</span>';
      var thumb = r.image ? '<img class="thumb-sm" loading="lazy" alt="" src="' + esc(r.image) + '" />' : '';
      var song = r.song ? '<span class="nowcell">' + thumb + '<span>' + esc(r.song) + (r.artist ? ' <span class="muted">· ' + esc(r.artist) + '</span>' : '') + '</span></span>' : '<span class="muted">—</span>';
      return '<tr><td><span class="dot2 ' + (r.playing ? 'on' : 'off') + '"></span>' + esc(r.name) + '</td><td>' + song + '</td><td>' + loc + '</td><td><span class="pill">' + esc(r.platform) + '</span>' + (r.deviceId ? ' <span class="muted">' + esc(String(r.deviceId).slice(0, 8)) + '</span>' : '') + '</td><td class="muted">' + ago(r.lastSeen) + '</td></tr>';
    }).join('');
    $('view').innerHTML =
      '<div class="cards"><div class="card"><div class="n">' + (d.count || 0) + '</div><div class="l">Active now (60s)</div></div>' +
      '<div class="card"><div class="n">' + (d.playing || 0) + '</div><div class="l">Currently playing</div></div>' +
      '<div class="card"><div class="n">' + ck.length + '</div><div class="l">Countries</div></div></div>' +
      '<div class="chips">' + ck.map(function (k) { return '<span class="pill">' + esc(k) + ' · ' + countries[k] + '</span>'; }).join('') + '</div>' +
      '<table><thead><tr><th>Listener</th><th>Now playing</th><th>Location</th><th>Device</th><th>Seen</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="5" class="empty">No one is listening right now.</td></tr>') + '</tbody></table>';
    stamp();
  }
  function loadLive() { apiMemo('/api/admin/live').then(function (d) { if (d && active === 'live') renderLive(d); }).catch(noop); }

  // ---------- Location ----------
  function renderLocation(d) {
    setExport('location-cities', d.cities || []);
    var cities = (d.cities || []).map(function (r) { return '<tr><td>' + esc(r.city) + '</td><td>' + esc(r.country) + '</td><td>' + r.listeners + '</td><td class="muted">' + r.plays + '</td></tr>'; }).join('');
    $('view').innerHTML =
      '<h3>Listeners by country</h3>' + bars(d.countries || [], function (x) { return esc(x.country); }, function (x) { return x.listeners; }) +
      '<h3>Platforms</h3>' + bars(d.platforms || [], function (x) { return esc(x.platform); }, function (x) { return x.listeners; }) +
      '<h3>Top cities</h3><table><thead><tr><th>City</th><th>Country</th><th>Listeners</th><th>Plays</th></tr></thead><tbody>' +
      (cities || '<tr><td colspan="4" class="empty">No data yet.</td></tr>') + '</tbody></table>';
    stamp();
  }
  function loadLocation() { apiMemo('/api/admin/location?days=' + rangeDays).then(function (d) { if (d && active === 'location') renderLocation(d); }).catch(noop); }


  // --- World Listening: Leaflet + OpenStreetMap tiles (vendored under
  // /admin/leaflet, so script-src 'self' still holds). Range cities from
  // /api/admin/location are the calm base layer; live listeners from
  // /api/admin/live pulse on top. CITY_COORD answers common cities exactly;
  // anything unknown is geocoded once via Nominatim (throttled, cached in
  // localStorage) and refines from the country-centroid guess on the next
  // repaint.
  var CITY_COORD = {
    'mumbai':[19.08,72.88],'bombay':[19.08,72.88],'delhi':[28.61,77.21],'new delhi':[28.61,77.21],
    'bengaluru':[12.97,77.59],'bangalore':[12.97,77.59],'hyderabad':[17.38,78.49],'chennai':[13.08,80.27],
    'madras':[13.08,80.27],'kolkata':[22.57,88.36],'calcutta':[22.57,88.36],'pune':[18.52,73.86],
    'ahmedabad':[23.03,72.58],'jaipur':[26.91,75.79],'surat':[21.17,72.83],'lucknow':[26.85,80.95],
    'kanpur':[26.45,80.33],'nagpur':[21.15,79.09],'indore':[22.72,75.86],'bhopal':[23.26,77.41],
    'visakhapatnam':[17.69,83.22],'vizag':[17.69,83.22],'patna':[25.59,85.14],'vadodara':[22.31,73.18],
    'coimbatore':[11.02,76.96],'kochi':[9.93,76.27],'cochin':[9.93,76.27],'thiruvananthapuram':[8.52,76.94],
    'trivandrum':[8.52,76.94],'guwahati':[26.14,91.74],'chandigarh':[30.73,76.78],'mysuru':[12.30,76.64],
    'mysore':[12.30,76.64],'vijayawada':[16.51,80.65],'madurai':[9.93,78.12],'nashik':[19.99,73.79],
    'rajkot':[22.30,70.80],'ranchi':[23.34,85.31],'raipur':[21.25,81.63],'amritsar':[31.63,74.87],
    'varanasi':[25.32,82.97],'aurangabad':[19.88,75.34],'jodhpur':[26.24,73.02],'gwalior':[26.22,78.18],
    'ludhiana':[30.90,75.86],'agra':[27.18,78.01],'noida':[28.54,77.39],'gurugram':[28.46,77.03],
    'gurgaon':[28.46,77.03],'faridabad':[28.41,77.31],'ghaziabad':[28.67,77.45],'dehradun':[30.32,78.03],
    'jamshedpur':[22.80,86.20],'warangal':[17.97,79.59],'tirupati':[13.63,79.42],'guntur':[16.31,80.44],
    'nellore':[14.44,79.99],'kakinada':[16.99,82.25],'rajahmundry':[17.00,81.78],'bhubaneswar':[20.30,85.82],
    'srikakulam':[18.30,83.90],'anantapur':[14.68,77.60],'kurnool':[15.83,78.04],'kadapa':[14.47,78.82],
    'new york':[40.71,-74.01],'brooklyn':[40.68,-73.94],'london':[51.51,-0.13],'dubai':[25.20,55.27],
    'singapore':[1.35,103.82],'toronto':[43.65,-79.38],'sydney':[-33.87,151.21],'melbourne':[-37.81,144.96],
    'los angeles':[34.05,-118.24],'chicago':[41.88,-87.63],'san francisco':[37.77,-122.42],'houston':[29.76,-95.37],
    'dallas':[32.78,-96.80],'seattle':[47.61,-122.33],'atlanta':[33.75,-84.39],'boston':[42.36,-71.06],
    'washington':[38.91,-77.04],'jersey city':[40.72,-74.05],'edison':[40.52,-74.41],'ashburn':[39.04,-77.49],
    'vancouver':[49.28,-123.12],'auckland':[-36.85,174.76],'tokyo':[35.68,139.69],'hong kong':[22.32,114.17],
    'kuala lumpur':[3.14,101.69],'riyadh':[24.71,46.68],'dammam':[26.43,50.10],'jeddah':[21.49,39.19],
    'doha':[25.29,51.53],'abu dhabi':[24.45,54.38],'sharjah':[25.35,55.41],'muscat':[23.59,58.41],
    'kuwait city':[29.38,47.99],'manama':[26.23,50.59],'frankfurt':[50.11,8.68],'berlin':[52.52,13.40],
    'paris':[48.86,2.35],'amsterdam':[52.37,4.90],'zurich':[47.37,8.54],'dublin':[53.35,-6.26],
    'johannesburg':[-26.20,28.05],'nairobi':[-1.29,36.82],'lagos':[6.52,3.38],'cairo':[30.04,31.24],
    'colombo':[6.93,79.85],'kathmandu':[27.72,85.32],'dhaka':[23.81,90.41],'karachi':[24.86,67.01],
    'lahore':[31.55,74.34],'islamabad':[33.68,73.05]
  };
  var GEO_CENTROID = {
    IN:[22,79],US:[39,-98],GB:[54,-2],CA:[56,-106],AU:[-25,133],AE:[24,54],SA:[24,45],
    PK:[30,70],BD:[24,90],NP:[28,84],LK:[7,81],SG:[1,104],MY:[4,102],ID:[-2,118],
    PH:[13,122],TH:[15,101],JP:[36,138],KR:[36,128],CN:[35,105],HK:[22,114],DE:[51,10],
    FR:[46,2],IT:[42,13],ES:[40,-4],NL:[52,5],SE:[62,15],NO:[62,10],CH:[47,8],IE:[53,-8],
    PT:[39,-8],RU:[61,105],UA:[49,32],TR:[39,35],EG:[27,30],ZA:[-30,25],NG:[10,8],
    KE:[0,38],BR:[-10,-55],AR:[-34,-64],MX:[23,-102],CL:[-30,-71],CO:[4,-73],NZ:[-42,174],
    QA:[25,51],KW:[29,48],OM:[21,57],BH:[26,50],IL:[31,35],FI:[64,26],DK:[56,10],
    BE:[50,4],AT:[47,14],PL:[52,20],GR:[39,22],MM:[21,96],KH:[13,105],VN:[16,108],
    TW:[24,121],MA:[32,-6],DZ:[28,3],AF:[33,66],IR:[32,53],IQ:[33,44]
  };
  var mapState = null;

  // Nominatim geocode cache (accurate coords for cities outside CITY_COORD).
  // One lookup per unknown city EVER (misses cached as 'x'), ≥1.2 s between
  // requests per the OSM usage policy — admin-only traffic, so tiny volume.
  var GEO_CACHE_KEY = 'vinax_admin_geo2';
  var geoCache = null;
  function geoCacheLoad() {
    if (!geoCache) {
      try { geoCache = JSON.parse(localStorage.getItem(GEO_CACHE_KEY) || '{}') || {}; } catch (e) { geoCache = {}; }
    }
    return geoCache;
  }
  function geoCacheSave() { try { localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(geoCache)); } catch (e) {} }
  var geoQueue = [], geoQueued = {}, geoBusy = false;
  function queueGeocode(city, cc) {
    var key = (String(city || '').toLowerCase().trim() + '|' + String(cc || '').toUpperCase().slice(0, 2));
    if (!city || geoQueued[key] || geoCacheLoad()[key] !== undefined) return;
    geoQueued[key] = true;
    geoQueue.push({ key: key, city: city, cc: cc });
    pumpGeocode();
  }
  function pumpGeocode() {
    if (geoBusy) return;
    var next = geoQueue.shift();
    if (!next) return;
    geoBusy = true;
    fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&city=' + encodeURIComponent(next.city) + (next.cc ? '&countrycodes=' + encodeURIComponent(String(next.cc).toLowerCase()) : ''))
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (j) {
        var hit = j && j[0];
        var c = geoCacheLoad();
        c[next.key] = (hit && hit.lat) ? [parseFloat(hit.lat), parseFloat(hit.lon)] : 'x';
        geoCacheSave();
      })
      .catch(noop)
      .then(function () { setTimeout(function () { geoBusy = false; pumpGeocode(); }, 1200); });
  }

  /** Returns [lat, lon, exact] — exact from CITY_COORD or the geocode cache,
   *  else a deterministic jitter around the country centroid (and queues a
   *  real geocode for next time). */
  function cityLL(city, cc) {
    var key = String(city || '').toLowerCase().trim();
    if (CITY_COORD[key]) return CITY_COORD[key];
    var cached = geoCacheLoad()[key + '|' + String(cc || '').toUpperCase().slice(0, 2)];
    if (cached && cached !== 'x') return cached;
    if (cached === undefined) queueGeocode(city, cc);
    var g = GEO_CENTROID[String(cc || '').toUpperCase().slice(0, 2)];
    if (!g) return null;
    var h = 0, i;
    for (i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
    var jx = ((h % 97) / 97 - 0.5) * 7, jy = (((h >> 4) % 97) / 97 - 0.5) * 6;
    return [g[0] + jy, g[1] + jx];
  }
  /** True when cityLL would answer with a real (non-jittered) coordinate. */
  function cityExact(city, cc) {
    var key = String(city || '').toLowerCase().trim();
    if (CITY_COORD[key]) return true;
    var cached = geoCacheLoad()[key + '|' + String(cc || '').toUpperCase().slice(0, 2)];
    return !!(cached && cached !== 'x');
  }

  // Last good payloads — apiMemo resolves null for unchanged data, and a
  // double-click on the nav used to feed renderWorld(null, null), blanking
  // the whole map until the upstream data actually changed.
  var lastWorldLoc = null, lastWorldLive = null;
  function loadWorld() {
    Promise.all([
      apiMemo('/api/admin/location?days=' + rangeDays).catch(function () { return null; }),
      apiMemo('/api/admin/live').catch(function () { return null; })
    ]).then(function (r) {
      if (r[0]) lastWorldLoc = r[0];
      if (r[1]) lastWorldLive = r[1];
      if (active !== 'world') return;
      // Repaint only when something changed OR the section was just entered
      // (view still shows "Loading…"). Unchanged auto-ticks skip the repaint
      // so map pan/zoom isn't reset every 10 s.
      if (r[0] || r[1] || !document.getElementById('wmap')) renderWorld(lastWorldLoc, lastWorldLive);
    });
  }

  function renderWorld(loc, live) {
    loc = loc || {}; live = live || {};
    var countries = loc.countries || [];
    setExport('world-countries', countries);
    var cities = loc.cities || [];
    var mappable = 0;
    cities.forEach(function (r) { if (cityLL(r.city, r.country)) mappable++; });
    var liveList = (live && live.listeners) || [];
    var nowN = (live && live.count) || liveList.length;
    var nowRows = liveList.slice(0, 24).map(function (r) {
      var where = [r.city, r.country].filter(Boolean).map(esc).join(', ') || '<span class="muted">Unknown</span>';
      var song = r.song ? esc(r.song) + (r.artist ? ' <span class="muted">· ' + esc(r.artist) + '</span>' : '') : '<span class="muted">—</span>';
      return '<tr><td><span class="dot2 ' + (r.playing ? 'on' : 'off') + '"></span>' + esc(r.name || 'Listener') + (r.username ? ' <span class="muted">@' + esc(r.username) + '</span>' : '') + '</td><td>' + song + '</td><td class="muted">' + where + '</td></tr>';
    }).join('');
    var list = countries.slice(0, 12).map(function (c) {
      return '<tr><td>' + esc(c.country) + '</td><td>' + c.listeners + '</td></tr>';
    }).join('') || '<tr><td colspan="2" class="empty">No data yet.</td></tr>';
    $('view').innerHTML =
      '<div style="display:flex;flex-wrap:wrap;gap:20px;align-items:flex-start">' +
        '<div style="flex:2;min-width:300px">' +
          '<div id="wmap"></div>' +
          '<p class="muted" style="margin-top:8px"><span class="dot2 on"></span> ' + nowN + ' listening now · ' + mappable + ' active cities in the selected range. OpenStreetMap — drag to pan, scroll or pinch to zoom.</p>' +
        '</div>' +
        '<div style="flex:1;min-width:240px">' +
          '<h3>Listening now</h3>' +
          '<table><thead><tr><th>Listener</th><th>Track</th><th>Where</th></tr></thead><tbody>' +
          (nowRows || '<tr><td colspan="3" class="empty">No one is listening right now.</td></tr>') + '</tbody></table>' +
          '<h3>By country (range)</h3>' +
          '<table><thead><tr><th>Country</th><th>Listeners</th></tr></thead><tbody>' + list + '</tbody></table>' +
        '</div>' +
      '</div>';
    stamp();
    startLeafletMap(cities, liveList);
  }

  // Leaflet world map. Keeps the operator's view (center/zoom) across
  // repaints via mapState.view; range cities are sized circles, live
  // listeners are pulsing dots (CSS .live-dot in index.html).
  var leafMap = null;
  function startLeafletMap(cities, liveList) {
    var host = $('wmap');
    if (!host) return;
    if (typeof L === 'undefined') { host.innerHTML = '<div class="empty">Map library failed to load.</div>'; return; }
    var prev = mapState && mapState.view;
    if (leafMap) { try { leafMap.remove(); } catch (e) {} leafMap = null; }
    leafMap = L.map(host, { worldCopyJump: true, zoomControl: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors'
    }).addTo(leafMap);
    if (prev) leafMap.setView([prev.lat, prev.lng], prev.zoom);
    else leafMap.setView([21.5, 79.0], 4); // India-centered default
    leafMap.on('moveend zoomend', function () {
      if (!leafMap) return;
      var c = leafMap.getCenter();
      mapState = { view: { lat: c.lat, lng: c.lng, zoom: leafMap.getZoom() } };
    });
    var maxN = 1;
    cities.forEach(function (r) { if ((r.listeners || 0) > maxN) maxN = r.listeners || 0; });
    cities.forEach(function (r) {
      var ll = cityLL(r.city, r.country);
      if (!ll) return;
      var n = r.listeners || 0;
      var exact = cityExact(r.city, r.country);
      var m = L.circleMarker([ll[0], ll[1]], {
        radius: 4 + 10 * Math.sqrt(n / maxN),
        color: '#4f8cff', weight: 1, opacity: 0.8,
        fillColor: '#4f8cff', fillOpacity: 0.3
      }).addTo(leafMap);
      m.bindPopup('<b>' + esc(r.city || 'Unknown') + '</b>' + (r.country ? ', ' + esc(r.country) : '') +
        '<br>' + n + ' listener' + (n === 1 ? '' : 's') + ' \u00b7 ' + (r.plays || 0) + ' plays' +
        (exact ? '' : '<br><i>approximate \u2014 refining\u2026</i>'));
    });
    liveList.forEach(function (r) {
      var ll = cityLL(r.city, r.country);
      if (!ll) return;
      var icon = L.divIcon({ className: 'live-dot' + (r.playing ? ' playing' : ''), iconSize: [14, 14] });
      var m = L.marker([ll[0], ll[1]], { icon: icon, zIndexOffset: 500 }).addTo(leafMap);
      var song = r.song ? esc(r.song) + (r.artist ? ' \u00b7 ' + esc(r.artist) : '') : (r.playing ? 'Playing' : 'Online');
      m.bindPopup('<b>' + esc(r.name || 'Listener') + (r.username ? ' @' + esc(r.username) : '') + '</b><br>' + song + '<br>' + esc([r.city, r.country].filter(Boolean).join(', ') || 'Unknown'));
    });
  }

  // ---------- Music ----------
  function renderMusic(d) {
    setExport('music-top-songs', d.topSongs || []);
    $('view').innerHTML =
      '<h3>Plays per day</h3>' + dayChart(d.playsByDay, 'plays') +
      '<h3>Top songs</h3>' + songRows(d.topSongs || []) +
      '<h3>Top artists</h3>' + bars(d.topArtists || [], function (x) { return esc(x.song_artist); }, function (x) { return x.plays; }) +
      '<h3>Top languages</h3>' + bars(d.topLanguages || [], function (x) { return esc(x.language); }, function (x) { return x.plays; });
    stamp();
  }
  function loadMusic() { apiMemo('/api/admin/music?days=' + rangeDays).then(function (d) { if (d && active === 'music') renderMusic(d); }).catch(noop); }

  // ---------- A/B Experiments ----------
  // The nav button existed but no section did — clicking it left "Loading…"
  // on screen forever. Read-only view over GET /api/admin/experiments.
  function renderExperiments(d) {
    var exps = (d && d.experiments) || [];
    setExport('experiments', exps);
    if (d && d.configured === false) {
      $('view').innerHTML = '<div class="card"><p class="muted">Experiments table not found — check the D1 database binding (tables auto-create on first use).</p></div>';
      stamp();
      return;
    }
    var cards = exps.map(function (x) {
      var rows = (x.metrics || []).map(function (m) {
        return '<tr><td>' + esc(m.variant) + '</td><td>' + (m.pct != null ? m.pct + '%' : '—') + '</td><td>' + (m.devices || 0) + '</td><td>' + (m.playsPerDevice != null ? m.playsPerDevice : '—') + '</td><td>' + (m.skipRatePct != null ? m.skipRatePct + '%' : '—') + '</td></tr>';
      }).join('');
      return '<div class="card" style="margin-bottom:14px"><h3 style="margin-top:0">' + esc(x.name || x.key) + ' ' + (x.active ? '<span class="pill">active</span>' : '<span class="pill" style="opacity:.6">paused</span>') + '</h3>' +
        '<p class="muted" style="font-size:12px">key: <span style="font-family:monospace">' + esc(x.key) + '</span> · created ' + date(x.created_at) + ' · metrics from the last 14 days</p>' +
        '<table><thead><tr><th>Variant</th><th>Split</th><th>Devices</th><th>Plays/device</th><th>Skip rate</th></tr></thead><tbody>' +
        (rows || '<tr><td colspan="5" class="empty">No variants.</td></tr>') + '</tbody></table></div>';
    }).join('');
    $('view').innerHTML = cards || '<div class="empty">No experiments yet. Create one via POST /api/admin/experiments.</div>';
    stamp();
  }
  function loadExperiments() { apiMemo('/api/admin/experiments').then(function (d) { if (d && active === 'experiments') renderExperiments(d); }).catch(noop); }

  // ---------- Users ----------
  function renderUsers(d) {
    var s = d.summary || {};
    var U = d.users || [];
    setExport('users', U);
    var rows = U.map(function (u) {
      var loc = [u.city, u.country].filter(Boolean).map(esc).join(', ') || '<span class="muted">—</span>';
      return '<tr class="clickable" data-uid="' + esc(u.device_id) + '" data-uname="' + esc(u.name || 'Anonymous') + '"><td><span class="dot2 ' + (u.is_playing ? 'on' : 'off') + '"></span>' + esc(u.name || 'Anonymous') + (u.username ? ' <span class="muted">@' + esc(u.username) + '</span>' : '') + '</td><td>' + loc + '</td><td><span class="pill">' + platIcon(u.platform) + ' ' + esc(u.platform || 'web') + '</span> <span class="muted">' + esc(String(u.device_id || '').slice(0, 8)) + '</span></td><td class="muted">' + date(u.first_seen) + '</td><td class="muted">' + ago(u.last_seen) + '</td><td><button class="ghost udel" data-del="' + esc(u.device_id) + '" style="padding:4px 10px;font-size:11px;color:var(--danger)">Delete</button></td></tr>';
    }).join('');
    var canPrev = userOffset > 0;
    // D-22 follow-up: the server already computes hasMore (fetches limit+1);
    // trust it instead of re-deriving from the page length, which disabled
    // "Next" one page early on an exactly-full last page.
    var canNext = d.hasMore != null ? !!d.hasMore : U.length >= (d.limit || 50);
    $('view').innerHTML =
      '<div class="cards"><div class="card"><div class="n">' + (s.total_users || 0) + '</div><div class="l">Total users</div></div>' +
      '<div class="card"><div class="n">' + (s.active_24h || 0) + '</div><div class="l">Active (24h)</div></div>' +
      '<div class="card"><div class="n">' + (s.new_24h || 0) + '</div><div class="l">New (24h)</div></div>' +
      '<div class="card"><div class="n">' + (s.total_plays || 0) + '</div><div class="l">Total plays</div></div></div>' +
      '<div class="row" style="margin-bottom:12px"><input id="uq" type="search" placeholder="Search by name…" value="' + esc(userQ) + '" style="max-width:280px" /><button id="ugo">Search</button><span class="muted" style="font-size:12px">Tip: click a row for details</span></div>' +
      '<table><thead><tr><th>Listener</th><th>Location</th><th>Device</th><th>First seen</th><th>Last seen</th><th></th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="6" class="empty">No users found.</td></tr>') + '</tbody></table>' +
      '<div class="row" style="margin-top:14px"><button class="ghost" id="uprev"' + (canPrev ? '' : ' disabled') + '>← Prev</button>' +
      '<span class="muted">Showing ' + (userOffset + 1) + '–' + (userOffset + U.length) + '</span>' +
      '<button class="ghost" id="unext"' + (canNext ? '' : ' disabled') + '>Next →</button></div>';
    $('ugo').addEventListener('click', function () { userQ = $('uq').value.trim(); userOffset = 0; loadUsers(); });
    $('uq').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('ugo').click(); });
    $('uprev').addEventListener('click', function () { if (userOffset > 0) { userOffset = Math.max(0, userOffset - (d.limit || 50)); loadUsers(); } });
    $('unext').addEventListener('click', function () { userOffset += (d.limit || 50); loadUsers(); });
    Array.prototype.forEach.call(document.querySelectorAll('tr[data-uid]'), function (tr) {
      tr.addEventListener('click', function () { openUser(tr.getAttribute('data-uid'), tr.getAttribute('data-uname')); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('button.udel'), function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        if (b.disabled) return; // double-click guard: never stack two prompts / two deletes
        b.disabled = true;
        vxPrompt('Deleting this user and ALL their events.', {
          title: 'Delete user', danger: true, okText: 'Delete user',
          placeholder: 'Reason — mandatory, kept as an audit note',
          minLength: 3, note: 'A written reason is mandatory (at least 3 characters).'
        }).then(function (reason) {
          if (reason == null) { b.disabled = false; return; }
          postApi('/api/admin/maintenance', { action: 'delete_user', device_id: b.getAttribute('data-del'), reason: reason }).then(function (r) { if (r) loadUsers(); else b.disabled = false; }).catch(function () { b.disabled = false; });
        });
      });
    });
    stamp();
  }
  function loadUsers() {
    apiMemo('/api/admin/users?limit=50&offset=' + userOffset + (userQ ? '&q=' + encodeURIComponent(userQ) : ''))
      .then(function (d) { if (d && active === 'users') renderUsers(d); }).catch(noop);
  }

  // ---------- User drill-down ----------
  function openUser(deviceId, name) {
    $('modalBody').innerHTML = '<button class="x" id="mx">✕</button><div class="empty">Loading…</div>';
    $('modal').hidden = false;
    $('mx').addEventListener('click', closeModal);
    // Plain api(), NOT apiMemo: the memo resolves null for an unchanged
    // payload, which left the modal stuck on "Loading…" whenever the same
    // user was opened twice (double-click, or close + reopen).
    api('/api/admin/user?deviceId=' + encodeURIComponent(deviceId)).then(function (d) {
      if (!d) return;
      var u = d.user || {};
      var ev = d.events || [];
      var plays = ev.filter(function (e) { return e.type === 'play'; });
      var songMap = {}, langMap = {};
      plays.forEach(function (e) {
        if (e.song_title) {
          var k = e.song_title + '|' + (e.song_artist || '');
          songMap[k] = songMap[k] || { title: e.song_title, artist: e.song_artist, plays: 0 };
          songMap[k].plays++;
        }
        var l = e.language || 'unknown';
        langMap[l] = (langMap[l] || 0) + 1;
      });
      var top = Object.keys(songMap).map(function (k) { return songMap[k]; }).sort(function (a, b) { return b.plays - a.plays; }).slice(0, 12);
      var langs = Object.keys(langMap).map(function (l) { return { language: l, plays: langMap[l] }; }).sort(function (a, b) { return b.plays - a.plays; });
      var recent = ev.slice(0, 18).map(function (e) { return '<tr><td><span class="pill">' + esc(e.type) + '</span></td><td>' + (e.song_title ? esc(e.song_title) : '<span class="muted">—</span>') + '</td><td class="muted">' + ago(e.created_at) + '</td></tr>'; }).join('');
      $('modalBody').innerHTML =
        '<button class="x" id="mx">✕</button>' +
        '<h2 style="margin:2px 0 2px">' + esc(name || u.name || 'Anonymous') + (u.username ? ' <span class="muted" style="font-size:14px">@' + esc(u.username) + '</span>' : '') + '</h2>' +
        '<div class="muted" style="font-size:12.5px;margin-bottom:14px">' + esc([u.city, u.country].filter(Boolean).join(', ') || 'Unknown') + ' · ' + esc(u.platform || 'web') + (u.app_version ? ' · v' + esc(u.app_version) : '') + ' · joined ' + date(u.first_seen) + ' · last seen ' + ago(u.last_seen) + '</div>' +
        '<div class="cards"><div class="card"><div class="n">' + plays.length + '</div><div class="l">Plays (recent)</div></div>' +
        '<div class="card"><div class="n">' + top.length + '</div><div class="l">Distinct songs</div></div>' +
        '<div class="card"><div class="n">' + esc(langs[0] ? langs[0].language : '—') + '</div><div class="l">Top language</div></div></div>' +
        '<h3>Top songs</h3>' + bars(top, function (x) { return esc(x.title) + (x.artist ? ' <span class="muted">· ' + esc(x.artist) + '</span>' : ''); }, function (x) { return x.plays; }) +
        '<h3>Recent activity</h3><table><tbody>' + (recent || '<tr><td class="empty">No activity.</td></tr>') + '</tbody></table>';
      $('mx').addEventListener('click', closeModal);
    }).catch(noop);
  }
  function closeModal() { $('modal').hidden = true; $('modalBody').innerHTML = ''; }

  // ---------- Content ----------
  function doBlock(id, title) { if (!id) return; postApi('/api/admin/content', { action: 'block', songId: id, songTitle: title || '' }).then(function (r) { if (r) loadContent(); }).catch(noop); }
  function doUnblock(id) { postApi('/api/admin/content', { action: 'unblock', songId: id }).then(function (r) { if (r) loadContent(); }).catch(noop); }
  function renderContent(d) {
    var blocked = d.blocked || [];
    setExport('blocked-songs', blocked);
    var brows = blocked.map(function (b) { return '<tr><td>' + esc(b.song_title || b.song_id) + '</td><td class="muted">' + esc(b.reason || '—') + '</td><td><button class="ghost" data-unblock="' + esc(b.song_id) + '">Unblock</button></td></tr>'; }).join('');
    var trows = (d.topSongs || []).map(function (sng) {
      var t = (sng.song_title || sng.song_id) + (sng.song_artist ? ' · ' + sng.song_artist : '');
      return '<tr><td>' + esc(sng.song_title || sng.song_id) + (sng.song_artist ? ' <span class="muted">· ' + esc(sng.song_artist) + '</span>' : '') + '</td><td class="muted">' + sng.plays + '</td><td><button class="ghost" data-block="' + esc(sng.song_id) + '" data-title="' + esc(t) + '">Block</button></td></tr>';
    }).join('');
    $('view').innerHTML =
      '<div class="row" style="margin-bottom:8px"><input id="bid" type="text" placeholder="Block a song by ID…" style="max-width:320px" /><button id="bgo">Block</button></div>' +
      '<h3>Blocked songs (' + blocked.length + ')</h3><table><thead><tr><th>Song</th><th>Reason</th><th></th></tr></thead><tbody>' + (brows || '<tr><td colspan="3" class="empty">Nothing blocked.</td></tr>') + '</tbody></table>' +
      '<h3>Most played (30d) — block from here</h3><table><thead><tr><th>Song</th><th>Plays</th><th></th></tr></thead><tbody>' + (trows || '<tr><td colspan="3" class="empty">No data yet.</td></tr>') + '</tbody></table>';
    $('bgo').addEventListener('click', function () { doBlock($('bid').value.trim(), ''); });
    $('bid').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('bgo').click(); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-block]'), function (b) { b.addEventListener('click', function () { doBlock(b.getAttribute('data-block'), b.getAttribute('data-title')); }); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-unblock]'), function (b) { b.addEventListener('click', function () { doUnblock(b.getAttribute('data-unblock')); }); });
    stamp();
  }
  function loadContent() { apiMemo('/api/admin/content').then(function (d) { if (d && active === 'content') renderContent(d); }).catch(noop); }

  // ---------- Technical ----------
  function healthHtml(h) {
    if (!h) return '<div class="empty">Health check unavailable.</div>';
    var rows = (h.ai || []).map(function (k) {
      var badge = k.ok
        ? '<span style="color:var(--ok)">OK ' + (k.status || '') + '</span>'
        : '<span style="color:var(--danger)">FAIL ' + (k.status == null ? 'network' : k.status) + '</span>';
      var extra = k.configured ? '' : ' <span class="muted">(not configured)</span>';
      return '<tr><td>' + esc(k.key) + extra + '</td><td class="muted">' + esc(aiNick(k.model)) + '</td><td>' + badge + '</td><td class="muted">' + esc(k.note || '') + '</td></tr>';
    }).join('');
    var sb = h.database || h.supabase || {};
    var sbBadge = sb.lastEventAt
      ? '<span style="color:var(--ok)">last event ' + ago(sb.lastEventAt) + '</span>'
      : '<span style="color:var(--danger)">' + esc(sb.note || 'no readable events') + '</span>';
    return '<table><thead><tr><th>Key</th><th>Model</th><th>Status</th><th>Detail</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<p class="muted" style="margin-top:8px">Database (D1): ' + (sb.configured ? sbBadge : '<span style="color:var(--danger)">not configured</span>') + '</p>';
  }
  function renderTechnical(d) {
    var s = d.summary || {};
    setExport('errors', d.errors || []);
    var errRows = (d.errors || []).map(function (e) { return '<tr><td><span class="pill">' + esc(e.error_kind) + '</span></td><td>' + esc(e.message || '—') + '</td><td>' + e.hits + '</td><td class="muted">' + ago(e.last_seen) + '</td></tr>'; }).join('');
    var vitCards = (d.vitals || []).map(function (v) {
      var val = v.p75 == null ? '—' : (v.p75 + (v.unit || ''));
      var split = v.count ? ('<span style="color:var(--ok)">' + v.good + ' good</span> · ' + v.ni + ' ni · <span style="color:var(--danger)">' + v.poor + ' poor</span>') : 'no samples yet';
      return '<div class="card"><div class="n">' + val + '</div><div class="l">' + esc(v.metric) + ' p75 · ' + split + '</div></div>';
    }).join('');
    var lyricList = (d.lyricMisses || []).map(function (x) { return { song_title: x.song_title, song_artist: x.song_artist, plays: x.hits }; });
    $('view').innerHTML =
      '<div class="cards"><div class="card"><div class="n">' + (s.errors_24h || 0) + '</div><div class="l">Errors (24h)</div></div>' +
      '<div class="card"><div class="n">' + (s.plays_24h || 0) + '</div><div class="l">Plays (24h)</div></div>' +
      '<div class="card"><div class="n">' + (s.active_sessions || 0) + '</div><div class="l">Active sessions (5m)</div></div>' +
      '<div class="card"><div class="n">' + (s.versions || 0) + '</div><div class="l">App versions</div></div></div>' +
      '<h3>System health <span class="muted">· live key + database check</span> <button id="hrecheck" class="ghost" style="padding:3px 10px;font-size:11px">Re-check</button></h3><div id="healthbox"><div class="empty">Pinging all 7 lanes + database — can take ~20s…</div></div>' +
      '<h3>Web Vitals — field p75 (' + (d.days || 7) + 'd)</h3><div class="cards">' + (vitCards || '<div class="empty">No data yet.</div>') + '</div>' +
      '<h3>Lyrics not found (' + (d.days || 7) + 'd)</h3>' + songRows(lyricList) +
      '<h3>App versions</h3>' + bars(d.versions || [], function (x) { return esc(x.app_version) + ' <span class="muted">· ' + esc(x.platform) + '</span>'; }, function (x) { return x.users; }) +
      '<h3>Errors per day</h3>' + dayChart(d.errorsByDay, 'hits', 'linear-gradient(180deg,#ff8080,#ff4d4d)') +
      '<h3>Top errors</h3><table><thead><tr><th>Kind</th><th>Message</th><th>Hits</th><th>Last</th></tr></thead><tbody>' + (errRows || '<tr><td colspan="4" class="empty">No errors logged. 🎉</td></tr>') + '</tbody></table>' +
      '<h3>Data tools <span class="muted">· database maintenance</span></h3><div class="row" style="flex-wrap:wrap;gap:8px">' +
      '<button class="ghost" id="mt-purge">Purge events &gt; 90d</button>' +
      '<button class="ghost" id="mt-errors">Clear all errors</button>' +
      '<button class="ghost" id="mt-ai">Trim AI log (keep 14d)</button>' +
      '<button class="ghost" id="mt-fb">Delete resolved feedback</button>' +
      '<button class="ghost" id="mt-rooms">Close all rooms</button>' +
      '<span class="muted" id="mt-out" style="font-size:12px"></span></div>';
    stamp();
  }
  function bindMaint() {
    function run(btn, action, extra, msg) {
      var el = $(btn);
      if (!el) return;
      el.addEventListener('click', function () {
        vxConfirm(msg, { title: 'Maintenance', danger: true, okText: 'Yes, run it' }).then(function (ok) {
          if (!ok) return;
          el.disabled = true;
          postApi('/api/admin/maintenance', Object.assign({ action: action }, extra || {})).then(function (r) {
            el.disabled = false;
            var o = $('mt-out');
            if (o) o.textContent = r && r.ok ? 'Done ✓' : 'Failed';
            setTimeout(function () { if (o) o.textContent = ''; }, 4000);
          }).catch(function () { el.disabled = false; });
        });
      });
    }
    run('mt-purge', 'purge_events', { days: 90 }, 'Delete ALL events older than 90 days?');
    run('mt-errors', 'clear_errors', {}, 'Delete ALL error events?');
    run('mt-ai', 'trim_ai', { days: 14 }, 'Delete AI log entries older than 14 days?');
    run('mt-fb', 'clear_feedback', {}, 'Delete all RESOLVED feedback?');
    run('mt-rooms', 'close_rooms', {}, 'End ALL Listen Together rooms right now?');
  }

  function loadTechnical() {
    apiMemo('/api/admin/technical?days=' + rangeDays).then(function (d) {
      if (d && active === 'technical') {
        renderTechnical(d);
        bindMaint();
        renderSiteMode();
        renderAuditLog();
        api('/api/admin/health').then(function (h) {
          var el = document.getElementById('healthbox');
          if (el && active === 'technical') el.innerHTML = healthHtml(h);
          else if (el) el.innerHTML = '<div class="empty">Switched away — open Technical again for fresh pings.</div>';
        }).catch(function () {
          var el = document.getElementById('healthbox');
          if (el) el.innerHTML = '<div class="empty">Health check failed to load.</div>';
        });
      }
    }).catch(noop);
  }

  // ---------- Feedback ----------
  var fbType = 'all', fbStatus = 'open', fbData = [];
  function resolveFeedback(id) { postApi('/api/admin/feedback', { id: id, status: 'resolved' }).then(function (r) { if (r) loadFeedback(); }).catch(noop); }
  function fbSeg(attr, cur, opts) {
    return '<div class="seg">' + opts.map(function (o) { return '<button data-' + attr + '="' + o[0] + '"' + (o[0] === cur ? ' class="active"' : '') + '>' + o[1] + '</button>'; }).join('') + '</div>';
  }
  function renderFeedback(d) {
    if (d) fbData = d.feedback || [];
    var F = fbData;
    setExport('feedback', F);
    var view = F.filter(function (f) {
      var okT = fbType === 'all' || (f.type || 'other') === fbType;
      var okS = fbStatus === 'all' || (fbStatus === 'resolved' ? f.status === 'resolved' : f.status !== 'resolved');
      return okT && okS;
    });
    var rows = view.map(function (f) {
      var loc = [f.city, f.country].filter(Boolean).map(esc).join(', ') || '<span class="muted">—</span>';
      var done = f.status === 'resolved';
      var action = done ? '<span class="muted">resolved</span>' : '<button class="ghost" data-resolve="' + f.id + '">Resolve</button>';
      return '<tr style="' + (done ? 'opacity:.5' : '') + '"><td><span class="pill">' + esc(f.type || 'other') + '</span></td><td>' + esc(f.message || '') + '</td><td>' + esc(f.name || 'Anonymous') + '</td><td><span class="pill">' + esc(f.platform || 'web') + '</span>' + (f.app_version ? ' <span class="muted">v' + esc(f.app_version) + '</span>' : '') + '</td><td class="muted">' + loc + '</td><td class="muted">' + ago(f.created_at) + '</td><td>' + action + '</td></tr>';
    }).join('');
    var open = F.filter(function (f) { return f.status !== 'resolved'; }).length;
    $('view').innerHTML =
      '<div class="cards">' + card(open, 'Open') + card(F.filter(function (f) { return f.type === 'bug'; }).length, 'Bugs') + card(F.filter(function (f) { return f.type === 'idea'; }).length, 'Ideas') + '</div>' +
      '<div class="row" style="margin-bottom:12px;gap:14px;flex-wrap:wrap">' + fbSeg('ft', fbType, [['all', 'All'], ['bug', 'Bugs'], ['idea', 'Ideas'], ['other', 'Other']]) + fbSeg('fs', fbStatus, [['open', 'Open'], ['resolved', 'Resolved'], ['all', 'All']]) + '</div>' +
      (rows
        ? '<table><thead><tr><th>Type</th><th>Message</th><th>From</th><th>App</th><th>Location</th><th>When</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>'
        : emptyState('empty_feedback', 'No feedback in this view', 'Try switching filters above, or wait — listener feedback lands here as they hit the "Tell us" button in-app.'));
    Array.prototype.forEach.call(document.querySelectorAll('[data-ft]'), function (b) { b.addEventListener('click', function () { fbType = b.getAttribute('data-ft'); renderFeedback(); }); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-fs]'), function (b) { b.addEventListener('click', function () { fbStatus = b.getAttribute('data-fs'); renderFeedback(); }); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-resolve]'), function (b) { b.addEventListener('click', function () { resolveFeedback(parseInt(b.getAttribute('data-resolve'), 10)); }); });
    stamp();
  }
  function loadFeedback() { apiMemo('/api/admin/feedback').then(function (d) { if (d && active === 'feedback') renderFeedback(d); }).catch(noop); }

  // ---------- Overview ----------
  function loadOverview() { apiMemo('/api/admin/overview').then(function (d) { if (d && active === 'overview') { renderOverview(d); loadDigest(); loadGrowth(); renderQuickActions(); } }).catch(noop); }
  // Overview health strip — built only from fields the overview payload
  // already carries (summary.*); nothing is invented, everything defaults to 0.
  function fmtN(n) { n = Number(n || 0); return isFinite(n) ? n.toLocaleString() : '0'; }
  function healthStrip(s) {
    s = s || {};
    var hasErrors = typeof s.errors_24h === 'number';
    var errs = Number(s.errors_24h || 0);
    var cls = !hasErrors ? 'warn' : errs === 0 ? 'ok' : (errs < 10 ? 'warn' : 'bad');
    var label = !hasErrors ? 'Error telemetry unavailable' : errs === 0 ? 'No reported errors in 24h' : (fmtN(errs) + ' error' + (errs === 1 ? '' : 's') + ' in 24h');
    var stick = (s.dau && s.mau) ? Math.round((Number(s.dau) / Math.max(1, Number(s.mau))) * 100) + '%' : '—';
    return '<div class="health-strip" id="healthstrip">' +
      '<span class="hz-status ' + cls + '"><span class="hz-dot"></span>' + esc(label) + '</span>' +
      '<span class="hz-m"><b>' + fmtN(s.active_now) + '</b> listening now</span>' +
      '<span class="hz-m"><b>' + fmtN(s.plays_today) + '</b> plays today</span>' +
      '<span class="hz-m"><b>' + fmtN(s.new_today) + '</b> new today</span>' +
      '<span class="hz-m"><b>' + fmtN(s.feedback_new) + '</b> new feedback</span>' +
      '<span class="hz-m" title="Daily active ÷ monthly active"><b>' + esc(stick) + '</b> DAU / MAU</span>' +
      '<span class="spacer"></span>' +
      '<span class="muted">Refreshes every ' + Math.round(refreshMs / 1000) + 's</span>' +
      '</div>';
  }
  // Overview companions (quick actions, growth, digest) prepend themselves to
  // #view; keep them below the health strip when it is present.
  function insertTop(view, markup) {
    var hs = view.querySelector('#healthstrip');
    if (hs) hs.insertAdjacentHTML('afterend', markup); else view.insertAdjacentHTML('afterbegin', markup);
  }
  function operationsBrief(s) {
    var errors = typeof s.errors_24h === 'number' ? s.errors_24h : null;
    var feedback = typeof s.feedback_new === 'number' ? s.feedback_new : null;
    var headline = errors === null ? 'Waiting for operational signals' : errors > 0 ? 'A few things need your attention' : 'Make the next listening session better';
    return '<section class="ops-brief"><div><span class="ops-eyebrow">VINAX / CONTROL ROOM</span><h2>' + esc(headline) + '</h2><p>Your audience, music experience and release tools in one place.</p></div>' +
      '<div class="ops-actions"><a href="#technical"><b>' + (errors === null ? '—' : fmtN(errors)) + '</b><span>Errors · last 24 hours →</span></a>' +
      '<a href="#feedback"><b>' + (feedback === null ? '—' : fmtN(feedback)) + '</b><span>New feedback →</span></a>' +
      '<a href="#homescreen"><b>Home studio</b><span>Curate the listener experience →</span></a>' +
      '<a href="#releases"><b>Release centre</b><span>Inspect builds and versions →</span></a>' +
      '<a href="#ai"><b>AI intelligence</b><span>Review engines and request health →</span></a>' +
      '<a href="#skips"><b>Discovery quality</b><span>See where listeners skip →</span></a></div></section>';
  }
  function renderOverview(d) {
    var s = d.summary || {};
    var deltas = d.deltas || d.summaryDeltas || {};
    setExport('overview-top-songs', d.topSongs || []);
    function chip(delta) {
      if (delta == null || delta === 0 || isNaN(delta)) return '';
      var cls = delta > 0 ? 'up' : 'dn';
      var sign = delta > 0 ? '+' : '';
      return '<span class="kt ' + cls + '">' + sign + Math.round(delta) + '%</span>';
    }
    function kc(n, l, iconKey, deltaKey) {
      var icon = ICONS[iconKey] || '';
      var d2 = deltaKey ? deltas[deltaKey] : null;
      return '<div class="card kpi"><span class="ki">' + icon + '</span><div class="n">' + (n == null ? 0 : n) + '</div><div class="l">' + esc(l) + '</div>' + chip(d2) + '</div>';
    }
    $('view').innerHTML =
      operationsBrief(s) + healthStrip(s) +
      '<div class="cards">' +
      kc(s.active_now, 'Listening now', 'listeners', 'active_now') +
      kc(s.total_users, 'Total users', 'users', 'total_users') +
      kc(s.new_today, 'New today', 'plus', 'new_today') +
      kc(s.plays_today, 'Plays today', 'play', 'plays_today') +
      kc(s.dau, 'DAU', 'dau', 'dau') +
      kc(s.wau, 'WAU', 'wau', 'wau') +
      kc(s.mau, 'MAU', 'wau') +
      kc(s.errors_24h, 'Errors (24h)') + kc(s.feedback_new, 'New feedback') +
      kc(s.plays_7d, 'Streams (7d)') +
      kc(((s.plays_7d || 0) / Math.max(1, s.total_users || 1)).toFixed(1), 'Avg plays / user (7d)') +
      '<div class="card kpi"><div class="n">₹0</div><div class="l">Revenue · free forever</div></div>' + '</div>' +
      '<h3>Plays per day (14d)</h3>' + dayChart(d.playsByDay, 'plays') +
      '<h3>New users per day (14d)</h3>' + dayChart(d.newUsersByDay, 'users', 'linear-gradient(180deg,#6ee7b7,#10b981)') +
      '<h3>Top songs (7d)</h3>' + songRows(d.topSongs || []) +
      '<h3>Top countries (7d)</h3>' + bars(d.topCountries || [], function (x) { return esc(x.country); }, function (x) { return x.listeners; });
    stamp();
  }

  // ---------- Insights ----------
  function loadInsights() { apiMemo('/api/admin/insights?days=' + rangeDays).then(function (d) { if (d && active === 'insights') renderInsights(d); }).catch(noop); }
  function renderInsights(d) {
    var s = d.segments || {};
    setExport('top-listeners', d.topListeners || []);
    var listeners = (d.topListeners || []).map(function (u) {
      return '<tr class="clickable" data-uid="' + esc(u.device_id) + '" data-uname="' + esc(u.name || 'Anonymous') + '"><td>' + esc(u.name || 'Anonymous') + (u.username ? ' <span class="muted">@' + esc(u.username) + '</span>' : '') + '</td><td>' + u.plays + '</td></tr>';
    }).join('');
    $('view').innerHTML =
      '<div class="cards">' + card(s.new_7d, 'New (7d)') + card(s.returning_7d, 'Returning (7d)') + card(s.inactive_30d, 'Inactive (7–30d)') + card(s.power_users, 'Power users (20+ plays)') + '</div>' +
      '<h3>Listening by hour (UTC)</h3>' + hourChart(d.playsByHour) +
      '<h3>Trending songs</h3><table><thead><tr><th>Song</th><th>Plays</th><th>Trend</th></tr></thead><tbody>' + trendingRows(d.trending) + '</tbody></table>' +
      '<h3>Top listeners</h3><table><thead><tr><th>Listener</th><th>Plays</th></tr></thead><tbody>' + (listeners || '<tr><td colspan="2" class="empty">No data yet.</td></tr>') + '</tbody></table>' +
      '<h3>Languages</h3>' + bars(d.languages || [], function (x) { return esc(x.language); }, function (x) { return x.plays; });
    Array.prototype.forEach.call(document.querySelectorAll('tr[data-uid]'), function (tr) { tr.addEventListener('click', function () { openUser(tr.getAttribute('data-uid'), tr.getAttribute('data-uname')); }); });
    stamp();
  }

  // ---------- Activity Feed ----------
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (t && t.classList && t.classList.contains('act-chip')) {
      actFilter = t.getAttribute('data-t');
      if (actLast) renderActivity(actLast);
    }
  });
  function loadActivity() { apiMemo('/api/admin/activity').then(function (d) { if (d && active === 'activity') renderActivity(d); }).catch(noop); }
  var actFilter = 'all';
  var actLast = null;
  function renderActivity(d) {
    actLast = d;
    var E = (d.events || []).filter(function (e) { return actFilter === 'all' || e.type === actFilter; });
    setExport('activity', E);
    var rows = E.map(function (e) {
      var loc = [e.city, e.country].filter(Boolean).map(esc).join(', ') || '<span class="muted">—</span>';
      var song = e.song_title ? esc(e.song_title) + (e.song_artist ? ' <span class="muted">· ' + esc(e.song_artist) + '</span>' : '') : '<span class="muted">—</span>';
      return '<tr><td><span class="pill">' + esc(e.type) + '</span></td><td>' + song + '</td><td class="muted">' + esc((e.device_id || '').slice(0, 8)) + '</td><td><span class="pill">' + esc(e.platform || 'web') + '</span></td><td class="muted">' + loc + '</td><td class="muted">' + ago(e.created_at) + '</td></tr>';
    }).join('');
    var chips = ['all', 'play', 'search', 'favorite', 'download', 'share', 'error'].map(function (t) {
      return '<button class="ghost act-chip" data-t="' + t + '" style="padding:4px 12px;font-size:11px' + (actFilter === t ? ';background:var(--grad);color:#fff;border-color:transparent' : '') + '">' + (t === 'all' ? 'All' : t) + '</button>';
    }).join('');
    $('view').innerHTML = '<div class="row" style="flex-wrap:wrap;gap:6px;margin-bottom:10px">' + chips + '</div>' +
      (rows ? '<table><thead><tr><th>Event</th><th>Song</th><th>Device</th><th>Platform</th><th>Location</th><th>When</th></tr></thead><tbody>' + rows + '</tbody></table>'
        : emptyState('empty_activity', 'No recent activity to show', 'Listener events (plays, searches, favorites, downloads, shares) will stream in here as they happen.'));
    stamp();
  }


  // ---------- routing / header ----------
  function loadAi() { apiMemo('/api/admin/ai?days=' + rangeDays).then(function (d) { if (d && active === 'ai') renderAi(d); }).catch(noop); }
  function renderAi(d) {
    var m = (d && d.metrics) || {};
    var total = m.total || 0, ok = m.ok || 0, fail = m.fail || 0;
    var rate = total > 0 ? Math.round((ok / total) * 100) : 0;
    var recent = m.recent || [];
    setExport('ai-events', recent);
    var errs = m.by_error || [];
    var errTable = errs.length
      ? '<table><thead><tr><th>Error</th><th>Count</th></tr></thead><tbody>' + errs.map(function (x) { return '<tr><td>' + esc(x.error) + '</td><td>' + x.count + '</td></tr>'; }).join('') + '</tbody></table>'
      : '<div class="empty">No errors \uD83C\uDF89</div>';
    var recentRows = recent.length
      ? recent.map(function (x) {
          var st = x.ok ? '<span style="color:var(--ok)">ok</span>' : '<span style="color:var(--danger)">' + esc(x.error || ('HTTP ' + (x.status || ''))) + '</span>';
          return '<tr><td class="muted">' + esc(ist(x.ts)) + '</td><td><span class="pill">' + esc(x.feature) + '</span></td><td class="muted">' + esc(aiNick(x.model)) + '</td><td>' + st + '</td><td>' + (x.latency_ms != null ? x.latency_ms + ' ms' : '\u2014') + '</td><td><span class="pill">' + esc(x.client || '\u2014') + '</span></td></tr>';
        }).join('')
      : null;
    if (total === 0 && !recentRows) {
      $('view').innerHTML = emptyState('empty_ai', 'No AI requests logged yet', 'Once the app hits the AI lanes, requests, models, latencies, and failures will land here for triage.');
      stamp();
      return;
    }
    $('view').innerHTML =
      '<div class="cards">' + card(total, 'AI requests') + card(rate + '%', 'Success rate') + card(fail, 'Failures') + card((m.avg_latency_ms || 0) + ' ms', 'Avg latency') + '</div>' +
      '<h3>Requests per day</h3>' + dayChart(m.by_day, 'total') +
      '<h3>By feature</h3>' + bars(m.by_feature, function (x) { return esc(x.feature); }, function (x) { return x.total; }) +
      '<h3>By model</h3>' + bars(m.by_model, function (x) { return esc(aiNick(x.model)); }, function (x) { return x.count; }) +
      '<h3>Web vs App</h3>' + bars(m.by_client, function (x) { return esc(x.client); }, function (x) { return x.count; }) +
      '<h3>Errors</h3>' + errTable +
      '<h3>Recent requests</h3><table><thead><tr><th>Time (IST)</th><th>Feature</th><th>Model</th><th>Status</th><th>Latency</th><th>Client</th></tr></thead><tbody>' + recentRows + '</tbody></table>';
    stamp();
  }

  // ---------- Real-Time ----------
  function renderRealtime(d) {
    var errs = (d.recentErrors || []).map(function (e) {
      return '<tr><td>' + esc(e.error_kind || '—') + '</td><td>' + esc(e.message || '') + '</td><td class="muted">' + ago(e.created_at) + '</td></tr>';
    }).join('');
    var cities = (d.liveCities || []).map(function (u) {
      return '<tr><td><span class="dot2 on"></span>' + esc(u.name || 'Anonymous') + (u.username ? ' <span class="muted">@' + esc(u.username) + '</span>' : '') + '</td><td>' + esc([u.city, u.country].filter(Boolean).join(', ') || '—') + '</td><td>' + esc(u.current_song_title || '—') + '</td></tr>';
    }).join('');
    $('view').innerHTML =
      '<div class="cards">' +
      card(d.startsPerMin, 'Songs started / min') + card(d.liveListeners, 'Listening now (5m)') +
      card(d.joins5m, 'New users (5m)') + card(d.errors5m, 'Errors (5m)') +
      card((d.aiP50 || 0) + 'ms', 'AI latency p50 (15m)') + card(d.aiOkRate == null ? '—' : d.aiOkRate + '%', 'AI success (15m)') +
      card(d.activeRooms, 'Active rooms') + '</div>' +
      '<h3>Live listeners</h3><table><thead><tr><th>Listener</th><th>Location</th><th>Now playing</th></tr></thead><tbody>' +
      (cities || '<tr><td colspan="3" class="empty">Nobody listening right now.</td></tr>') + '</tbody></table>' +
      '<h3>Errors (last 5 minutes)</h3><table><thead><tr><th>Kind</th><th>Message</th><th>When</th></tr></thead><tbody>' +
      (errs || '<tr><td colspan="3" class="empty">No errors. 🎉</td></tr>') + '</tbody></table>';
    stamp();
  }
  function loadRealtime() { apiMemo('/api/admin/realtime').then(function (d) { if (d && active === 'realtime') renderRealtime(d); }).catch(noop); }

  // ---------- Search Analytics ----------
  function renderSearchA(d) {
    function qrows(list) {
      return (list || []).map(function (r) { return '<tr><td>' + esc(r.query) + '</td><td>' + r.count + '</td></tr>'; }).join('');
    }
    var artists = bars(d.artists || [], function (x) { return esc(x.artist || x.name || ''); }, function (x) { return x.plays || x.count || 0; });
    var langs = bars(d.languages || [], function (x) { return esc(x.language || x.name || ''); }, function (x) { return x.plays || x.count || 0; });
    var topBody = qrows(d.top);
    $('view').innerHTML =
      '<div class="cards">' + card(d.total, 'Searches') + card((d.top || []).length, 'Distinct queries') + card((d.zero || []).length, 'Zero-result queries') + '</div>' +
      (topBody
        ? '<h3>Top searches</h3><table><thead><tr><th>Query</th><th>Count</th></tr></thead><tbody>' + topBody + '</tbody></table>' +
          '<h3>Searches with no results <span class="muted">· content gaps</span></h3><table><thead><tr><th>Query</th><th>Count</th></tr></thead><tbody>' +
          (qrows(d.zero) || '<tr><td colspan="2" class="empty">None — every search found something.</td></tr>') + '</tbody></table>' +
          '<h3>Trending artists (plays)</h3>' + artists +
          '<h3>Trending languages</h3>' + langs
        : emptyState('empty_search', 'No searches yet', 'As listeners search the catalog, top queries and zero-result gaps will surface here — a quick read on catalog holes.'));
    setExport('searches', d.top || []);
    stamp();
  }
  function loadSearchA() { apiMemo('/api/admin/search-analytics?days=' + rangeDays).then(function (d) { if (d && active === 'search') renderSearchA(d); }).catch(noop); }

  // ---------- Engagement ----------
  function renderEngagement(d) {
    var r = d.retention || {};
    function rv(v) { return v == null ? '—' : v + '%'; }
    $('view').innerHTML =
      '<div class="cards">' +
      card(d.plays, 'Plays (' + d.days + 'd)') + card(d.skipRate + '%', 'Skip rate') +
      card(d.completionRate + '%', 'Completion rate') + card(d.repeatRate + '%', 'Repeat rate') +
      card(d.avgPlaysPerUser, 'Avg plays / listener') + card(d.favorites, 'Favorites added') +
      card(d.downloads, 'Downloads') + card(d.shares, 'Shares') + '</div>' +
      '<h3>Retention <span class="muted">· of users first seen N days ago, % still active</span></h3>' +
      '<div class="cards">' + card(rv(r.d1), 'Day 1') + card(rv(r.d7), 'Day 7') + card(rv(r.d30), 'Day 30') + '</div>' +
      '<p class="muted" style="font-size:12px">Skip / completion / favorite / share tracking began with v1.1.20 — numbers grow as listeners use the updated app.</p>';
    stamp();
  }
  function loadEngagement() { apiMemo('/api/admin/engagement?days=' + rangeDays).then(function (d) { if (d && active === 'engagement') renderEngagement(d); }).catch(noop); }

  // ---------- Notifications (push composer) ----------
  var PN_BASES = ['https://www.sirimillavinay.online/api/cat', 'https://saavn.sumit.co/api', 'https://nepotuneapi.vercel.app/api'];
  var pnDest = '/';
  var pnKind = 'home';
  function pnPickHtml(txt) { return '<span class="pill">Opens: ' + esc(txt) + '</span>'; }
  function pnParse(j) {
    var d = j && j.data ? j.data : j;
    var list = (d && (d.results || d.songs || d.albums)) || [];
    return Array.isArray(list) ? list : [];
  }
  function pnImg(item) {
    var im = item.image || item.images;
    if (Array.isArray(im) && im.length) { var last = im[im.length - 1]; return (last && (last.url || last.link)) || ''; }
    return typeof im === 'string' ? im : '';
  }
  function pnSub(item) {
    if (item.subtitle) return item.subtitle;
    var a = item.artists && item.artists.primary;
    if (Array.isArray(a)) return a.map(function (x) { return x.name; }).join(', ');
    return item.primaryArtists || item.artist || '';
  }
  function pnSearch(q) {
    var out = $('pn-results');
    out.innerHTML = '<div class="empty">Searching…</div>';
    var path = '/search/' + (pnKind === 'album' ? 'albums' : 'songs') + '?query=' + encodeURIComponent(q) + '&limit=8';
    var i = 0;
    var anyOk = false; // a base responded with valid JSON (results may be empty)
    function tryNext() {
      if (i >= PN_BASES.length) {
        // Distinguish "no matches for this query" (a base answered, empty)
        // from "every source is down" — the old code showed the scary
        // "sources unavailable" for BOTH, so a rare/short query looked broken.
        out.innerHTML = anyOk
          ? '<div class="empty">No matches for “' + esc(q) + '” — try a different spelling.</div>'
          : '<div class="empty">Catalog sources unavailable right now — try again.</div>';
        return;
      }
      var base = PN_BASES[i]; i += 1;
      fetch(base + path, { signal: AbortSignal.timeout(6000) }).then(function (r) {
        if (!r.ok) throw new Error('http ' + r.status);
        return r.json();
      }).then(function (j) {
        anyOk = true;
        var list = pnParse(j);
        if (!list.length) { tryNext(); return; }
        out.innerHTML = list.slice(0, 8).map(function (it, idx) {
          var name = it.name || it.title || '';
          return '<button class="ghost pn-row" data-i="' + idx + '" style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:7px 10px;border-radius:12px;margin-bottom:2px">' +
            (pnImg(it) ? '<img src="' + esc(pnImg(it)) + '" alt="" style="width:34px;height:34px;border-radius:8px;object-fit:cover;flex-shrink:0" />' : '') +
            '<span style="min-width:0"><b style="display:block;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(name) + '</b>' +
            '<span class="muted" style="font-size:11px;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(pnSub(it)) + '</span></span></button>';
        }).join('');
        Array.prototype.forEach.call(out.querySelectorAll('.pn-row'), function (b) {
          b.addEventListener('click', function () {
            var it = list[parseInt(b.getAttribute('data-i'), 10)];
            var name = it.name || it.title || '';
            pnDest = '/' + (pnKind === 'album' ? 'album' : 'song') + '/' + encodeURIComponent(it.id);
            $('pn-chosen').innerHTML = pnPickHtml((pnKind === 'album' ? 'Album · ' : 'Song · ') + name);
            out.innerHTML = '';
            $('pn-q').value = '';
          });
        });
      }).catch(function () { tryNext(); });
    }
    tryNext();
  }
  function pnSetKind(k) {
    pnKind = k;
    pnDest = '/';
    $('pn-chosen').innerHTML = k === 'home' ? pnPickHtml('Home') : (k === 'custom' ? pnPickHtml('Custom link') : '');
    $('pn-searchwrap').style.display = (k === 'song' || k === 'album') ? '' : 'none';
    $('pn-customwrap').style.display = k === 'custom' ? '' : 'none';
    $('pn-results').innerHTML = '';
    Array.prototype.forEach.call(document.querySelectorAll('.pn-kind'), function (b) {
      b.classList.toggle('active', b.getAttribute('data-k') === k);
    });
  }
  function loadNotifyStat() {
    apiMemo('/api/admin/push').then(function (d) {
      if (active !== 'notify2' || !d) return;
      var el = $('pn-stat');
      if (!el) return;
      if (d.configured === false) el.innerHTML = '⚠ Push keys are missing on the server — sending is disabled.';
      else el.innerHTML = '<b>' + (d.subscribers || 0) + '</b> device(s) subscribed' + ((d.subscribers || 0) === 0 ? ' — listeners opt in via the 🔔 card on Home or Settings → Notifications.' : '.');
      stamp();
    }).catch(noop);
  }
  function loadNotify() {
    if (!document.getElementById('pn-send')) { renderNotify(); loadNotifyLog(); return; }
    loadNotifyStat();
    loadNotifyLog();
  }
  // ---------- Content Control (blocklist manager) ----------
  function renderContent(d) {
    var blocked = d.blocked || [];
    var top = d.topSongs || [];
    var bset = {};
    blocked.forEach(function (b) { bset[b.song_id] = true; });
    var topRows = top.map(function (t) {
      var isB = !!bset[t.song_id];
      return '<tr><td><b>' + esc(t.song_title || t.song_id) + '</b> <span class="muted">' + esc(t.song_artist || '') + '</span></td><td>' + (t.plays || 0) + '</td>' +
        '<td>' + (isB ? '<span class="pill">blocked</span>' : '<button class="ghost ct-block" data-id="' + esc(t.song_id) + '" data-title="' + esc(t.song_title || '') + '" style="padding:3px 10px;font-size:11px;color:var(--danger)">Block</button>') + '</td></tr>';
    }).join('');
    var bRows = blocked.map(function (b) {
      return '<tr><td><b>' + esc(b.song_title || b.song_id) + '</b></td><td class="muted">' + esc(b.reason || '\u2014') + '</td><td class="muted">' + date(b.created_at) + '</td>' +
        '<td><button class="ghost ct-unblock" data-id="' + esc(b.song_id) + '" style="padding:3px 10px;font-size:11px">Unblock</button></td></tr>';
    }).join('');
    $('view').innerHTML =
      '<div class="card" style="margin-bottom:14px"><h3 style="margin-top:0">Block by ID <span class="muted">\u00b7 for takedown requests \u2014 removal reaches every client within minutes</span></h3>' +
      '<div class="row"><input id="ct-id" type="text" placeholder="Song ID (from the song page URL)" style="max-width:280px" />' +
      '<input id="ct-reason" type="text" placeholder="Reason (e.g. DMCA #123)" style="max-width:280px" />' +
      '<button id="ct-add">Block song</button><span class="muted" id="ct-out" style="font-size:12px"></span></div></div>' +
      '<h3>Most played (30d) \u2014 block candidates</h3><table><thead><tr><th>Song</th><th>Plays</th><th></th></tr></thead><tbody>' +
      (topRows || '<tr><td colspan="3" class="empty">No play data yet.</td></tr>') + '</tbody></table>' +
      '<h3 style="margin-top:18px">Blocklist (' + blocked.length + ')</h3><table><thead><tr><th>Song</th><th>Reason</th><th>Since</th><th></th></tr></thead><tbody>' +
      (bRows || '<tr><td colspan="4" class="empty">Nothing blocked \u2014 as it should be.</td></tr>') + '</tbody></table>';
    function act(action, songId, title, reason) {
      postApi('/api/admin/content', { action: action, songId: songId, songTitle: title || null, reason: reason || null }).then(function (r) {
        if (r) loadContent(); else vxAlert('Action failed', { title: 'Content Control' });
      }).catch(noop);
    }
    $('ct-add').addEventListener('click', function () {
      var id = $('ct-id').value.trim();
      if (!id) { $('ct-out').textContent = 'Song ID required.'; return; }
      vxConfirm('Block this song for every listener?', { title: 'Content Control', danger: true, okText: 'Block song' }).then(function (ok) {
        if (ok) act('block', id, null, $('ct-reason').value.trim());
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('.ct-block'), function (b) {
      b.addEventListener('click', function () {
        vxPrompt('Block “' + (b.getAttribute('data-title') || b.getAttribute('data-id')) + '” for every listener?', { title: 'Content Control', danger: true, okText: 'Block song', placeholder: 'Reason (kept on record)' }).then(function (reason) {
          if (reason != null) act('block', b.getAttribute('data-id'), b.getAttribute('data-title'), reason);
        });
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('.ct-unblock'), function (b) {
      b.addEventListener('click', function () {
        vxConfirm('Unblock this song?', { title: 'Content Control', okText: 'Unblock' }).then(function (ok) {
          if (ok) act('unblock', b.getAttribute('data-id'));
        });
      });
    });
    setExport('blocklist', blocked);
    stamp();
  }
  function loadContent() { apiMemo('/api/admin/content').then(function (d) { if (d && active === 'content') renderContent(d); }).catch(noop); }
  // ---------- Growth card (Overview) ----------
  var lastGrowth = null;
  function loadGrowth() {
    apiMemo('/api/admin/growth').then(function (d) {
      if (active !== 'overview') return;
      // Overview repaints wipe #view; growth's payload is day-granular so the
      // memo answers null on most ticks — fall back to the last good payload
      // or the card silently disappears after the first auto-refresh.
      if (d) lastGrowth = d; else d = lastGrowth;
      if (!d) return;
      var old = document.getElementById('growthbox');
      if (old) old.remove();
      var view = $('view');
      if (!view) return;
      var max = 1;
      (d.days || []).forEach(function (n) { if (n > max) max = n; });
      // Compose day labels: today - (n-1-i)
      var days = d.days || [];
      var today = new Date();
      var bars = days.map(function (n, i) {
        var dt = new Date(today.getTime() - (days.length - 1 - i) * 86400000);
        var lbl = (dt.getMonth() + 1) + '/' + dt.getDate();
        return '<div class="spk-bar" data-lbl="' + esc(lbl + ': ' + n) + '" style="flex:1;display:flex;flex-direction:column-reverse;height:100%;cursor:default"><div style="height:' + Math.max(4, Math.round((n / max) * 100)) + '%;background:var(--accent);opacity:.85;border-radius:3px 3px 0 0;transition:opacity .12s"></div></div>';
      }).join('');
      var delta = d.prev14 > 0 ? Math.round(((d.last14 - d.prev14) / d.prev14) * 100) : (d.last14 > 0 ? 100 : 0);
      var dTxt = (delta >= 0 ? '+' : '') + delta + '% vs previous 14 days';
      insertTop(view,
        '<div class="card" id="growthbox" style="margin-bottom:14px;position:relative;overflow:visible"><h3 style="margin-top:0">New listeners <span class="muted">\u00b7 last 14 days \u00b7 <b>' + d.last14 + '</b> joined \u00b7 ' + esc(dTxt) + '</span></h3>' +
        '<div id="spk-wrap" style="display:flex;align-items:flex-end;gap:4px;height:64px;padding:6px 0;border-bottom:1px solid var(--border)">' + bars + '</div>' +
        '<span class="spk-chip" id="spk-chip"></span></div>');
      var chipEl = document.getElementById('spk-chip');
      Array.prototype.forEach.call(document.querySelectorAll('.spk-bar'), function (el) {
        el.addEventListener('mouseenter', function () {
          if (!chipEl) return;
          chipEl.textContent = el.getAttribute('data-lbl');
          chipEl.classList.add('show');
          var b = el.getBoundingClientRect();
          chipEl.style.left = (b.left + b.width / 2 - 30) + 'px';
          chipEl.style.top = (b.top - 26) + 'px';
        });
        el.addEventListener('mouseleave', function () { if (chipEl) chipEl.classList.remove('show'); });
      });
    }).catch(noop);
  }
  // ---------- Quick actions (Overview) ----------
  function renderQuickActions() {
    var old = document.getElementById('quickbox');
    if (old) old.remove();
    var view = $('view');
    if (!view) return;
    insertTop(view,
      '<div class="card" id="quickbox" style="margin-bottom:14px"><div class="row" style="flex-wrap:wrap;gap:8px">' +
      '<button class="ghost qa-go" data-to="notify2">\ud83d\udce3 Send notification</button>' +
      '<button class="ghost qa-go" data-to="technical">\u26a1 Site mode</button>' +
      '<button class="ghost qa-go" data-to="content">\ud83d\udeab Content control</button>' +
      '<button class="ghost qa-go" data-to="feedback">\ud83d\udcac Feedback</button>' +
      '<button class="ghost qa-go" data-to="rooms">\ud83d\udc65 Live rooms</button>' +
      '<span class="muted" style="font-size:11px;align-self:center">\u2318K anywhere \u2192 jump</span>' +
      '</div></div>');
    Array.prototype.forEach.call(document.querySelectorAll('.qa-go'), function (b) {
      b.addEventListener('click', function () { setSection(b.getAttribute('data-to')); });
    });
  }
  // ---------- Command palette ----------
  var paletteOpen = false;
  function openPalette() {
    if (paletteOpen) return;
    paletteOpen = true;
    var items = Object.keys(TITLES).map(function (k) { return { label: TITLES[k], go: function () { setSection(k); } }; });
    items.push({ label: 'Action: Re-check engine health', go: function () { setSection('technical'); window.setTimeout(function () { var b = document.getElementById('hrecheck'); if (b) b.click(); }, 600); } });
    items.push({ label: 'Action: Send a notification', go: function () { setSection('notify2'); } });
    items.push({ label: 'Action: Site mode (maintenance switch)', go: function () { setSection('technical'); } });
    var wrap = document.createElement('div');
    wrap.className = 'modal';
    wrap.id = 'palette';
    wrap.innerHTML = '<div class="box" style="max-width:440px"><input id="pal-q" type="text" placeholder="Jump to\u2026 (type to filter)" style="width:100%;margin-bottom:10px" /><div id="pal-list"></div></div>';
    document.body.appendChild(wrap);
    var q = document.getElementById('pal-q');
    var list = document.getElementById('pal-list');
    var current = [];
    var sel = 0;
    function paint() {
      var f = (q.value || '').toLowerCase();
      current = items.filter(function (it) { return it.label.toLowerCase().indexOf(f) !== -1; }).slice(0, 9);
      if (sel >= current.length) sel = Math.max(0, current.length - 1);
      list.innerHTML = current.map(function (it, i) {
        return '<div class="pal-item' + (i === sel ? ' pal-sel' : '') + '" data-i="' + i + '" style="padding:9px 12px;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;' + (i === sel ? 'background:var(--grad);color:#fff' : '') + '">' + esc(it.label) + '</div>';
      }).join('') || '<div class="empty">No match</div>';
      Array.prototype.forEach.call(list.querySelectorAll('.pal-item'), function (el) {
        el.addEventListener('click', function () { pick(parseInt(el.getAttribute('data-i'), 10)); });
      });
    }
    function close() {
      paletteOpen = false;
      var el = document.getElementById('palette');
      if (el) el.remove();
      document.removeEventListener('keydown', keys, true);
    }
    function pick(i) {
      var it = current[i];
      close();
      if (it) it.go();
    }
    function keys(e) {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, current.length - 1); paint(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); paint(); }
      else if (e.key === 'Enter') { e.preventDefault(); pick(sel); }
    }
    document.addEventListener('keydown', keys, true);
    wrap.addEventListener('click', function (e) { if (e.target === wrap) close(); });
    q.addEventListener('input', function () { sel = 0; paint(); });
    paint();
    q.focus();
  }
  // ---------- Sent-notification log ----------
  function loadNotifyLog() {
    apiMemo('/api/admin/notifylog').then(function (d) {
      if (active !== 'notify2' || !d) return;
      var host = document.getElementById('pn-logbox');
      if (!host) return;
      var rows = (d.rows || []).map(function (r) {
        var when = ist(r.created_at);
        if (r.type === 'announcement') {
          var t = '', b = '', canRetract = true;
          try { var j = JSON.parse(r.message || '{}'); t = j.title || ''; b = j.body || ''; } catch (e) { t = r.message || ''; }
          return '<tr><td><span class="pill">announcement</span></td><td><b>' + esc(t) + '</b> <span class="muted">' + esc(b) + '</span></td><td class="muted">' + when + '</td>' +
            '<td>' + (canRetract ? '<button class="ghost pn-retract" data-at="' + esc(r.created_at) + '" style="padding:3px 10px;font-size:11px;color:var(--danger)">Retract</button>' : '') + '</td></tr>';
        }
        var parts = String(r.message || '').split('|');
        return '<tr><td><span class="pill">daily pick</span></td><td><b>' + esc(parts[1] || '') + '</b> <span class="muted">sent to ' + esc(parts[0] || '0') + ' device(s)</span></td><td class="muted">' + when + '</td><td></td></tr>';
      }).join('');
      host.innerHTML = '<h3>Sent log <span class="muted">· retracting an announcement stops app pickups; delivered web pushes can\u2019t be recalled</span></h3>' +
        '<table><thead><tr><th>Type</th><th>Content</th><th>When</th><th></th></tr></thead><tbody>' +
        (rows || '<tr><td colspan="4" class="empty">Nothing sent yet.</td></tr>') + '</tbody></table>';
      Array.prototype.forEach.call(host.querySelectorAll('.pn-retract'), function (b) {
        b.addEventListener('click', function () {
          vxConfirm('Retract this announcement? App users will stop receiving it on open.', { title: 'Notifications', danger: true, okText: 'Retract' }).then(function (ok) {
            if (!ok) return;
            postApi('/api/admin/notifylog', { action: 'retract', created_at: b.getAttribute('data-at') }).then(function (r) {
              if (r && r.ok) loadNotifyLog();
              else vxAlert('Retract failed', { title: 'Notifications' });
            }).catch(noop);
          });
        });
      });
    }).catch(noop);
  }
  // ---------- Admin audit trail ----------
  function renderAuditLog() {
    apiMemo('/api/admin/audit').then(function (d) {
      if (active !== 'technical' || !d) return;
      var old = document.getElementById('auditlog');
      if (old) old.remove();
      var anchor = document.getElementById('sitemode');
      if (!anchor) return;
      var rows = (d.items || []).map(function (it) {
        var label = it.kind === 'site-mode' ? 'site mode' : it.kind === 'song-push' ? 'daily pick' : it.kind === 'user-delete' ? 'user delete' : it.kind;
        var text = it.text || '';
        if (it.kind === 'announcement') { try { var j = JSON.parse(text); text = (j.title || '') + ' \u2014 ' + (j.body || ''); } catch (e) { /* raw */ } }
        if (it.kind === 'song-push') { var p = text.split('|'); text = (p[1] || '') + ' \u2192 ' + (p[0] || '0') + ' device(s)'; }
        return '<tr><td><span class="pill">' + esc(label) + '</span></td><td>' + esc(String(text).slice(0, 90)) + '</td><td class="muted">' + ist(it.at) + '</td></tr>';
      }).join('');
      anchor.insertAdjacentHTML('afterend',
        '<div class="card" id="auditlog" style="margin-bottom:14px">' +
        '<h3 style="margin-top:0">Admin audit trail <span class="muted">· every owner action, on the record</span></h3>' +
        '<table><thead><tr><th>Action</th><th>Detail</th><th>When (IST)</th></tr></thead><tbody>' +
        (rows || '<tr><td colspan="3" class="empty">No admin actions recorded yet.</td></tr>') + '</tbody></table></div>');
    }).catch(noop);
  }
  // ---------- Site mode (Live / Maintenance) ----------
  var smStatus = '';
  var smNote = '';
  var smOut = '';
  function renderSiteMode() {
    var prevNote = document.getElementById('sm-note');
    if (prevNote) smNote = prevNote.value;
    var prevOut = document.getElementById('sm-out');
    if (prevOut) smOut = prevOut.textContent;
    var old = document.getElementById('sitemode');
    if (old) old.remove();
    var view = $('view');
    if (!view) return;
    view.insertAdjacentHTML('afterbegin',
      '<div class="card" id="sitemode" style="margin-bottom:14px">' +
      '<h3 style="margin-top:0">Site mode <span class="muted" id="sm-now">' + (smStatus || 'checking…') + '</span></h3>' +
      '<p class="muted" style="font-size:12px">Maintenance shows listeners a friendly “be right back” screen (it re-checks every minute). This console stays reachable either way.</p>' +
      '<input id="sm-note" type="text" placeholder="Optional message shown to listeners (e.g. Back in 20 minutes!)" style="margin-bottom:8px" />' +
      '<div class="row"><button id="sm-live">● Go live</button><button id="sm-maint" class="ghost" style="color:var(--danger)">Enter maintenance</button><span class="muted" id="sm-out" style="font-size:12px"></span></div>' +
      '</div>');
    document.getElementById('sm-note').value = smNote;
    document.getElementById('sm-out').textContent = smOut;
    function refresh() {
      fetch('/api/site-mode?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
        smStatus = d.mode === 'maintenance' ? '· <b style="color:var(--danger)">MAINTENANCE</b>' + (d.note ? ' — ' + esc(d.note) : '') : '· <b style="color:var(--ok)">LIVE</b>';
        var el = document.getElementById('sm-now');
        if (el) el.innerHTML = smStatus;
        stamp();
      }).catch(noop);
    }
    function setMode(mode) {
      var noteEl = document.getElementById('sm-note');
      var note = noteEl ? noteEl.value : '';
      var label = mode === 'maintenance' ? 'Put the WHOLE site into maintenance for every listener?' : 'Bring the site back live for everyone?';
      vxConfirm(label, mode === 'maintenance'
        ? { title: 'Site mode', danger: true, okText: 'Enter maintenance' }
        : { title: 'Site mode', okText: 'Go live' }).then(function (ok) {
        if (!ok) return;
        smOut = 'Switching…';
        $('sm-out').textContent = smOut;
        postApi('/api/admin/maintenance', { action: 'site_mode', mode: mode, note: note.trim() }).then(function (r) {
          smOut = r && r.ok ? 'Done — takes effect within a minute. ✓' : 'Failed';
          var el = document.getElementById('sm-out');
          if (el) el.textContent = smOut;
          refresh();
        }).catch(function () {
          smOut = 'Failed';
          var el = document.getElementById('sm-out');
          if (el) el.textContent = smOut;
        });
      });
    }
    document.getElementById('sm-live').addEventListener('click', function () { setMode('live'); });
    document.getElementById('sm-maint').addEventListener('click', function () { setMode('maintenance'); });
    refresh();
  }
  // ---------- Weekly digest (Overview) ----------
  var lastDigest = null;
  function loadDigest() {
    apiMemo('/api/admin/digest').then(function (d) {
      if (active !== 'overview') return;
      // Same last-good fallback as loadGrowth — see comment there.
      if (d && d.digest) lastDigest = d; else d = lastDigest;
      if (!d || !d.digest) return;
      var g = d.digest;
      var old = document.getElementById('digestbox');
      if (old) old.remove();
      var view = $('view');
      if (!view) return;
      var prev = d.previous || g.previous || {};
      function dl(cur, key) {
        var p = prev[key];
        if (p == null || p === 0) return '';
        var pct2 = Math.round(((cur - p) / p) * 100);
        if (pct2 === 0) return '';
        var cls = pct2 > 0 ? 'up' : 'dn';
        var sign = pct2 > 0 ? '+' : '';
        return ' <span class="kt ' + cls + '" style="font-size:10px;padding:1px 6px;border-radius:999px">' + sign + pct2 + '%</span>';
      }
      insertTop(view,
        '<div class="card" id="digestbox" style="margin-bottom:14px">' +
        '<h3 style="margin-top:0">This week <span class="muted">· since ' + esc(g.week_of || '') + (g.sampled ? ' · sampled' : '') + '</span></h3>' +
        '<div class="kpis" style="margin:0">' +
        '<span class="k"><b>' + (g.active_listeners || 0) + '</b> listeners' + dl(g.active_listeners || 0, 'active_listeners') + '</span>' +
        '<span class="k"><b>' + (g.new_listeners || 0) + '</b> new' + dl(g.new_listeners || 0, 'new_listeners') + '</span>' +
        '<span class="k"><b>' + (g.plays || 0) + '</b> plays' + dl(g.plays || 0, 'plays') + '</span>' +
        '<span class="k"><b>' + (g.searches || 0) + '</b> searches' + dl(g.searches || 0, 'searches') + '</span>' +
        '<span class="k"><b>' + (g.errors || 0) + '</b> errors' + dl(g.errors || 0, 'errors') + '</span>' +
        '<span class="k">Top song: <b>' + esc(g.top_song || '—') + '</b></span>' +
        '<span class="k">Top search: <b>' + esc(g.top_search || '—') + '</b></span>' +
        '</div></div>');
    }).catch(noop);
  }
  function renderNotify() {
    $('view').innerHTML =
      '<div class="card" style="max-width:640px">' +
      '<h3 style="margin-top:0">Send a notification</h3>' +
      '<p class="muted" style="font-size:12px">Browsers that opted in get a push instantly; the Android app shows it next time it opens. Use sparingly.</p>' +
      '<p class="muted" id="pn-stat" style="font-size:12px">Checking subscribers…</p>' +
      '<input id="pn-title" type="text" placeholder="Title (e.g. New Telugu hits are in!)" style="margin-bottom:8px" />' +
      '<input id="pn-body" type="text" placeholder="Message (max 300 chars)" style="margin-bottom:10px" />' +
      '<p class="muted" style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;margin:0 0 6px">Where should it open?</p>' +
      '<div class="seg" style="margin-bottom:8px">' +
      '<button class="pn-kind active" data-k="home">Home</button>' +
      '<button class="pn-kind" data-k="song">A song</button>' +
      '<button class="pn-kind" data-k="album">An album</button>' +
      '<button class="pn-kind" data-k="custom">Custom link</button>' +
      '</div>' +
      '<div id="pn-searchwrap" style="display:none"><input id="pn-q" type="text" placeholder="Search the catalog…" style="margin-bottom:6px" /><div id="pn-results"></div></div>' +
      '<div id="pn-customwrap" style="display:none"><input id="pn-link" type="text" placeholder="/made-for-you, /charts, /together…" style="margin-bottom:6px" /></div>' +
      '<p id="pn-chosen" style="margin:4px 0 12px">' + pnPickHtml('Home') + '</p>' +
      '<div class="row"><button id="pn-send">Send to all</button><span class="muted" id="pn-out" style="font-size:12px"></span></div>' +
      '</div>' +
      '<div class="card" id="pn-logbox" style="max-width:820px;margin-top:14px"><div class="empty">Loading sent log…</div></div>';
    pnKind = 'home';
    pnDest = '/';
    Array.prototype.forEach.call(document.querySelectorAll('.pn-kind'), function (b) {
      b.addEventListener('click', function () { pnSetKind(b.getAttribute('data-k')); });
    });
    var deb = null;
    $('pn-q').addEventListener('input', function () {
      if (deb) clearTimeout(deb);
      var q = $('pn-q').value.trim();
      if (q.length < 2) { $('pn-results').innerHTML = ''; return; }
      deb = setTimeout(function () { pnSearch(q); }, 350);
    });
    $('pn-send').addEventListener('click', function () {
      var t = $('pn-title').value.trim(), b = $('pn-body').value.trim();
      if (!t || !b) { $('pn-out').textContent = 'Title and message are required.'; return; }
      var link = pnKind === 'custom' ? ($('pn-link').value.trim() || '/') : pnDest;
      if (link.charAt(0) !== '/') { $('pn-out').textContent = 'Links must be in-app paths starting with /.'; return; }
      vxConfirm('Send this notification to ALL subscribed devices now?\n\nOpens: ' + link, { title: 'Push notification', okText: 'Send now' }).then(function (ok) {
        if (!ok) return;
        $('pn-send').disabled = true;
        $('pn-out').textContent = 'Sending…';
        postApi('/api/admin/push', { title: t, body: b, link: link }).then(function (r) {
          $('pn-send').disabled = false;
          if (!r) { $('pn-out').textContent = 'Failed'; return; }
          $('pn-out').textContent = 'Delivered to ' + (r.sent || 0) + ' of ' + (r.total || 0) + ' web device(s)' + (r.gone ? ' · ' + r.gone + ' expired removed' : '') + ' ✓ — the app picks it up on next open.';
          loadNotifyStat();
        }).catch(function () { $('pn-send').disabled = false; $('pn-out').textContent = 'Failed'; });
      });
    });
    loadNotifyStat();
  }

  // ---------- Live Rooms ----------
  function renderRooms(d) {
    var rows = (d.rooms || []).map(function (r) {
      var live = r.members > 0 ? '<span class="dot2 on"></span>' : '<span class="dot2 off"></span>';
      var song = r.song_title ? esc(r.song_title) + (r.song_artist ? ' <span class="muted">· ' + esc(r.song_artist) + '</span>' : '') : '<span class="muted">—</span>';
      return '<tr><td>' + live + '<b>' + esc(r.code) + '</b></td><td>' + esc(r.host || '—') + '</td><td>' + r.members + '</td><td>' + song + '</td><td>' + (r.playing ? '<span class="pill">Playing</span>' : '<span class="pill">Paused</span>') + '</td><td class="muted">' + ago(r.updated_at) + '</td><td><button class="ghost rend" data-code="' + esc(r.code) + '" style="padding:4px 10px;font-size:11px;color:var(--danger)">End</button></td></tr>';
    }).join('');
    $('view').innerHTML =
      '<div class="cards">' + card(d.active, 'Rooms live now') + card(d.listeners, 'People in rooms') + card((d.rooms || []).length, 'Rooms (last 2h)') + '</div>' +
      (rows
        ? '<h3>Listen Together rooms</h3><table><thead><tr><th>Code</th><th>Host</th><th>Members</th><th>Now playing</th><th>State</th><th>Updated</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>'
        : emptyState('empty_rooms', 'No Listen Together rooms right now', 'When listeners open a room and share the code, active + recent rooms show up here — with a one-click "end" for moderation.'));
    Array.prototype.forEach.call(document.querySelectorAll('button.rend'), function (b) {
      b.addEventListener('click', function () {
        if (b.disabled) return; // double-click guard
        b.disabled = true;
        vxConfirm('End room ' + b.getAttribute('data-code') + ' for everyone?', { title: 'Live Rooms', danger: true, okText: 'End room' }).then(function (ok) {
          if (!ok) { b.disabled = false; return; }
          postApi('/api/admin/maintenance', { action: 'end_room', code: b.getAttribute('data-code') }).then(function (r) { if (r) loadRooms(); else b.disabled = false; }).catch(function () { b.disabled = false; });
        });
      });
    });
    setExport('rooms', d.rooms || []);
    stamp();
  }
  function loadRooms() { apiMemo('/api/admin/rooms').then(function (d) { if (d && active === 'rooms') renderRooms(d); }).catch(noop); }

  // ---------- AI Lab (streaming test bench for every AI lane, v5.4.0) ----------
  // Interactive pane: EXCLUDED from the silent auto-refresh — loadAiLab only
  // paints once and never clobbers a conversation in progress.
  var LAB_LANES = [
    // model = the lane's PINNED primary (must match functions/_lib/ai.ts LANE_MODEL).
    // v5.21.0 — rebuilt for the owner's 2026-09-09 key rotation: 19 lanes over
    // 18 keys (dj and chat share the lightning key). Every secret is new, so
    // this bench is how each engine earns its verified status back.
    { lane: 'dj', name: 'NMTRN 3.5 LTNG', nick: 'VinaX NVD NMTRN 3.5 LTNG 30B', model: 'nvidia/nemotron-3.5-lightning-30b-a3b' },
    { lane: 'chat', name: 'BALANCED', nick: 'VinaX Balanced (LTNG key)', model: 'nvidia/nemotron-3.5-lightning-30b-a3b' },
    { lane: 'fast', name: 'OSS 20B', nick: 'VinaX OAI OSS 20B', model: 'openai/gpt-oss-20b' },
    { lane: 'deep', name: 'NMTRN SUP', nick: 'VinaX NVD NMTRN SUP', model: 'nvidia/nemotron-3-super-120b-a12b' },
    { lane: 'scholar', name: 'GRQ ALL', nick: 'VinaX GRQ ALL', model: 'llama-3.3-70b-versatile', catalog: 'grq' },
    { lane: 'home', name: 'NMTRN ULT', nick: 'VinaX NVD NMTRN ULT', model: 'nvidia/nemotron-3-ultra-550b-a55b' },
    { lane: 'search', name: 'NMTRN NN OMNI', nick: 'VinaX NVD NMTRN NN OMNI 30B', model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning' },
    { lane: 'pro', name: 'DP V4 PRO', nick: 'VinaX DP V4 PRO', model: 'deepseek-ai/deepseek-v4-pro-0813' },
    { lane: 'mini', name: 'MST NMTRN', nick: 'VinaX MST NMTRN', model: 'mistralai/mistral-nemotron' },
    { lane: 'agent', name: 'K3', nick: 'VinaX K3', model: 'moonshotai/kimi-k3' },
    { lane: 'router', name: 'OPR ALL', nick: 'VinaX OPR ALL', model: 'meta-llama/llama-3.3-70b-instruct:free', catalog: 'opr' },
    { lane: 'vision', name: 'VSN 11B', nick: 'VinaX MTA VSN 11B', model: 'meta/llama-3.2-11b-vision-instruct' },
    { lane: 'vision90', name: 'VSN 90B', nick: 'VinaX MTA VSN 90B', model: 'meta/llama-3.2-90b-vision-instruct' },
    { lane: 'dsflash', name: 'DP V4 FLASH', nick: 'VinaX DP V4 FLASH', model: 'deepseek-ai/deepseek-v4-flash-0731' },
    { lane: 'diffusion', name: 'DIF GEM', nick: 'VinaX GGL DIF GEM 26B A4B IT', model: 'google/diffusiongemma-26b-a4b-it' },
    { lane: 'gemma4', name: 'GEM 4 31B', nick: 'VinaX GGL GEM 4 31B', model: 'google/gemma-4-31b-it' },
    { lane: 'muse', name: 'MUSE GMR', nick: 'VinaX MTA MUSE GMR 30B', model: 'meta/muse-glimmer-30b' },
    { lane: 'laguna', name: 'LGNA XS 2.1', nick: 'VinaX PSD LGNA XS 2.1', model: 'poolside/laguna-xs-2.1' },
    { lane: 'rank', name: 'ING CALBTN 1.5', nick: 'VinaX NVD ING CALBTN 1.5 31B', model: 'nvidia/ising-calibration-1.5-31b' }
  ];
  var labLane = 'chat';
  // v5.22.0 — the bench can probe a lane on a model OTHER than its pin. For
  // the two catalog lanes that is a dropdown of every free model the key
  // actually serves (fetched from /api/aimodels, the same list the app's
  // engine picker uses); for every other lane it is a free-text slug box, so
  // a candidate replacement is VERIFIED SERVING before it is ever pinned —
  // the registry's core honesty rule.
  var labCatalog = { grq: [], opr: [] };
  var labCatalogPrefix = { grq: 'groq', opr: 'openrouter' }; // upstream name shown per row
  var labCatalogState = 'idle'; // idle | loading | ready | failed
  var labModelBy = {};          // lane -> slug override ('' = use the pin)
  var labHist = {}; // lane -> [{ role, content, error?, meta? }] — in memory only, gone on reload
  var labBusy = false;
  var labPingBusy = false;
  var labHealth = {}; // lane -> 'ok' | 'warn' | 'bad' — chip health dots (grey when unknown)
  var labPingedAt = ''; // 'HH:MM IST' when the last full ping sweep finished
  var labAutoPinged = false; // the first Lab open auto-pings once per page load

  function labInfo(lane) { for (var i = 0; i < LAB_LANES.length; i++) { if (LAB_LANES[i].lane === lane) return LAB_LANES[i]; } return LAB_LANES[0]; }
  // v5.6.2 — owner rule: the AI nicknames are the ONLY model names shown
  // anywhere in the app. Served slugs map to their VinaX names here.
  var AI_NICKS = [
    // v5.21.0 names. Specific slugs first; the retired rows stay at the
    // bottom so historical telemetry still labels cleanly.
    [/nemotron-3\.5-lightning/i, 'VinaX NVD NMTRN 3.5 LTNG 30B'],
    [/nemotron-3-super-120b|nemotron.super/i, 'VinaX NVD NMTRN SUP'],
    [/nemotron-3-ultra/i, 'VinaX NVD NMTRN ULT'],
    [/nano-omni/i, 'VinaX NVD NMTRN NN OMNI 30B'],
    [/mistral-nemotron/i, 'VinaX MST NMTRN'],
    [/deepseek-v4-pro/i, 'VinaX DP V4 PRO'],
    [/deepseek-v4-flash/i, 'VinaX DP V4 FLASH'],
    [/kimi/i, 'VinaX K3'],
    [/diffusiongemma/i, 'VinaX GGL DIF GEM 26B A4B IT'],
    [/muse-glimmer/i, 'VinaX MTA MUSE GMR 30B'],
    [/gemma-4/i, 'VinaX GGL GEM 4 31B'],
    [/laguna/i, 'VinaX PSD LGNA XS 2.1'],
    [/ising-calibration/i, 'VinaX NVD ING CALBTN 1.5 31B'],
    [/llama-3\.2-90b-vision/i, 'VinaX MTA VSN 90B'],
    [/llama-3\.2-11b-vision/i, 'VinaX MTA VSN 11B'],
    [/gpt-oss-20b/i, 'VinaX OAI OSS 20B'],
    // A marketplace pick keeps its own name — the seat chose that engine.
    [/:free$/i, 'VinaX OPR ALL'],
    // Retired 2026-09-09 — kept so older rows in the dashboards read cleanly.
    [/nemotron-3-nano/i, 'VinaX NVD NMTRN NN30B A3B (retired)'],
    [/minimax/i, 'VinaX AI (retired)'],
    [/gpt-oss-120b/i, 'VinaX AI (retired)'],
    [/llama-3\.3-70b|llama-3\.1-8b|llama3/i, 'VinaX GRQ ALL']
  ];
  function aiNick(m) {
    var str = String(m || '');
    if (!str) return '\u2014';
    for (var i = 0; i < AI_NICKS.length; i++) { if (AI_NICKS[i][0].test(str)) return AI_NICKS[i][1]; }
    var p = str.split('/');
    return p[p.length - 1];
  }
  function labShortModel(m) { return aiNick(m); }
  function labNow() { try { return new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true, hour: 'numeric', minute: '2-digit' }) + ' IST'; } catch (e) { return ''; } }
  function labMetaText(meta) {
    var bits = [labShortModel(meta.model), meta.lane,
      'TTFB ' + (meta.ttfb == null ? '—' : meta.ttfb + ' ms'),
      meta.total == null ? '—' : meta.total + ' ms total',
      (meta.chars || 0) + ' chars'];
    if (meta.aborted) bits.push('aborted ⚠');
    if (meta.at) bits.push(meta.at);
    return bits.join(' · ');
  }
  function labPaintMsgs() {
    var host = $('lab-msgs');
    if (!host) return;
    var hist = labHist[labLane] || [];
    if (!hist.length) {
      host.innerHTML = '<div class="empty">No messages on this lane yet — type below. Replies come straight from this lane\'s own key and the model chosen above, with no failover.</div>';
      return;
    }
    host.innerHTML = hist.map(function (m) {
      if (m.role === 'user') return '<div class="lab-msg user">' + esc(m.content) + '</div>';
      return '<div class="lab-msg ' + (m.error ? 'err' : 'bot') + '">' + esc(m.content) + '</div>' +
        (m.meta ? '<div class="lab-meta">' + esc(labMetaText(m.meta)) + '</div>' : '');
    }).join('');
    host.scrollTop = host.scrollHeight;
  }
  function labStream(lane, hist) {
    labBusy = true;
    var sb0 = $('lab-send');
    if (sb0) sb0.disabled = true;
    var host = $('lab-msgs');
    var bubble = document.createElement('div');
    bubble.className = 'lab-msg bot lab-cursor';
    var metaDiv = document.createElement('div');
    metaDiv.className = 'lab-meta';
    metaDiv.textContent = 'Contacting ' + labInfo(lane).nick + '…';
    if (host) {
      var e0 = host.querySelector('.empty');
      if (e0) e0.remove();
      host.appendChild(bubble);
      host.appendChild(metaDiv);
      host.scrollTop = host.scrollHeight;
    }
    var t0 = Date.now();
    var override = labModelBy[lane] || '';
    var meta = { model: override || labInfo(lane).model, lane: lane, ttfb: null, total: null, chars: 0, at: labNow() };
    var full = '';
    var aborted = false;
    var outMsgs = hist.filter(function (m) { return !m.error; }).slice(-16).map(function (m) { return { role: m.role, content: m.content }; });
    function finish(errText) {
      meta.total = Date.now() - t0;
      meta.chars = full.length;
      if (aborted) meta.aborted = true;
      if (errText && !full) hist.push({ role: 'assistant', content: errText, error: true, meta: meta });
      else hist.push({ role: 'assistant', content: full || '(empty reply)', meta: meta });
      labBusy = false;
      var sb = $('lab-send');
      if (sb) sb.disabled = false;
      if (active === 'ailab' && lane === labLane) labPaintMsgs();
    }
    fetch('/api/admin/ailab', {
      method: 'POST',
      headers: { 'x-admin-token': token(), 'content-type': 'application/json' },
      body: JSON.stringify(override
        ? { lane: lane, messages: outMsgs, maxTokens: 1000, model: override }
        : { lane: lane, messages: outMsgs, maxTokens: 1000 })
    }).then(function (res) {
      if (res.status === 401) { sessionStorage.removeItem(TOKEN_KEY); labBusy = false; showLogin('Invalid token.'); return null; }
      var ct = res.headers.get('content-type') || '';
      if (ct.indexOf('text/event-stream') === -1) {
        // 200 JSON envelope { error, status, head } — the honest upstream story.
        return res.json().catch(function () { return { error: 'http_' + res.status }; }).then(function (j) {
          finish('⚠ ' + (j && j.error ? j.error : 'failed') +
            (j && j.status ? ' · status ' + j.status : '') +
            (j && j.head ? ' — ' + String(j.head).slice(0, 200) : ''));
          return null;
        });
      }
      var reader = res.body.getReader();
      var dec = new TextDecoder();
      var buf = '';
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) { finish(null); return null; }
          buf += dec.decode(r.value, { stream: true });
          var nl;
          while ((nl = buf.indexOf('\n')) >= 0) {
            var line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (line.indexOf('data:') !== 0) continue;
            var data = line.slice(5).trim();
            if (!data) continue;
            var j = null;
            try { j = JSON.parse(data); } catch (e2) { continue; }
            if (j.meta) {
              if (j.meta.model) meta.model = j.meta.model;
              if (j.meta.lane) meta.lane = j.meta.lane;
            } else if (typeof j.delta === 'string' && j.delta) {
              if (meta.ttfb == null) meta.ttfb = Date.now() - t0;
              full += j.delta;
              bubble.textContent = full;
              if (host) host.scrollTop = host.scrollHeight;
            } else if (j.error) {
              aborted = true;
            }
          }
          return pump();
        });
      }
      return pump();
    }).catch(function () {
      aborted = true;
      finish('⚠ network error — request failed');
    });
  }
  function labSend() {
    if (labBusy) return;
    var ta = $('lab-in');
    if (!ta) return;
    var text = ta.value.trim();
    if (!text) return;
    ta.value = '';
    var hist = labHist[labLane] || (labHist[labLane] = []);
    hist.push({ role: 'user', content: text });
    labPaintMsgs();
    labStream(labLane, hist);
  }
  function labPaintPing(lane, ok, ms, why) {
    var el = $('lab-ping-' + lane);
    if (!el) return;
    el.className = 'lab-ping ' + (ok ? 'ok' : 'bad');
    el.textContent = labInfo(lane).name + ' ' + (ok ? '✓ ' + ms + ' ms' : '✗ ' + (why || 'failed'));
    el.title = labInfo(lane).nick;
  }
  // Health dot on each lane chip: green answered <4s, amber answered slow, red failed.
  function labPaintDot(lane) {
    var el = $('lab-dot-' + lane);
    if (el) el.className = 'lab-dot' + (labHealth[lane] ? ' ' + labHealth[lane] : '');
  }
  function labPaintPingAt() {
    var el = $('lab-ping-at');
    if (el) el.textContent = labPingedAt ? 'last checked ' + labPingedAt : '';
  }
  function labPingAll() {
    var host = $('lab-pings');
    if (!host || labPingBusy) return;
    labPingBusy = true;
    host.innerHTML = LAB_LANES.map(function (L) {
      return '<span class="lab-ping" id="lab-ping-' + esc(L.lane) + '">' + esc(L.name) + ' …</span>';
    }).join('');
    var left = LAB_LANES.length;
    LAB_LANES.forEach(function (L) {
      var t0 = Date.now();
      // Ping whatever the lane is currently set to probe: the pinned model,
      // or the override chosen above it — so a candidate slug can be health-
      // checked in the same sweep as everything else.
      var ov = labModelBy[L.lane] || '';
      var pingBody = { lane: L.lane, messages: [{ role: 'user', content: 'ping' }], maxTokens: 1 };
      if (ov) pingBody.model = ov;
      fetch('/api/admin/ailab', {
        method: 'POST',
        headers: { 'x-admin-token': token(), 'content-type': 'application/json' },
        body: JSON.stringify(pingBody)
      }).then(function (res) {
        if (res.status === 401) { sessionStorage.removeItem(TOKEN_KEY); showLogin('Invalid token.'); return { ok: false, why: '401' }; }
        var ct = res.headers.get('content-type') || '';
        if (ct.indexOf('text/event-stream') === -1) {
          return res.json().catch(function () { return {}; }).then(function (j) {
            return { ok: false, why: (j && j.error ? j.error + (j.status ? ' ' + j.status : '') : 'http ' + res.status) };
          });
        }
        // Drain the tiny stream; reaching done = the lane answered.
        return res.text().then(function () { return { ok: true }; });
      }).then(function (r) {
        var ms = Date.now() - t0;
        labHealth[L.lane] = r.ok ? (ms < 4000 ? 'ok' : 'warn') : 'bad';
        labPaintDot(L.lane);
        labPaintPing(L.lane, r.ok, ms, r.why);
      }).catch(function () {
        labHealth[L.lane] = 'bad';
        labPaintDot(L.lane);
        labPaintPing(L.lane, false, Date.now() - t0, 'network');
      }).then(function () {
        left -= 1;
        if (left <= 0) {
          labPingBusy = false;
          labPingedAt = labNow();
          labPaintPingAt();
        }
      });
    });
  }
  // ---------- Music catalog source health (server-side, /api/admin/musicapi) ----------
  var MUSIC_APIS = [
    { id: 'vinax-cat', label: 'VinaX /api/cat' },
    { id: 'vinax-render', label: 'VinaX Music API' },
    { id: 'saavn-sumit', label: 'sumit.co' },
    { id: 'saavn-dev', label: 'saavn.dev' },
    { id: 'nepotune', label: 'nepotune' },
    { id: 'b4a', label: 'b4a.run' }
  ];
  var labMusicBusy = false;
  var labMusicAt = '';
  function labPaintMusicAt() { var el = $('lab-music-at'); if (el) el.textContent = labMusicAt ? 'last checked ' + labMusicAt : ''; }
  function labMusicPing() {
    var host = $('lab-music-pings');
    if (!host || labMusicBusy) return;
    labMusicBusy = true;
    host.innerHTML = MUSIC_APIS.map(function (m) {
      return '<span class="lab-ping" id="lab-music-' + esc(m.id) + '">' + esc(m.label) + ' \u2026</span>';
    }).join('');
    fetch('/api/admin/musicapi', { headers: { 'x-admin-token': token() } })
      .then(function (res) {
        if (res.status === 401) { sessionStorage.removeItem(TOKEN_KEY); showLogin('Invalid token.'); return null; }
        return res.json();
      })
      .then(function (j) {
        ((j && j.mirrors) || []).forEach(function (m) {
          var el = $('lab-music-' + m.id);
          if (!el) return;
          el.className = 'lab-ping ' + (m.ok ? 'ok' : 'bad');
          var info = null;
          for (var i = 0; i < MUSIC_APIS.length; i++) { if (MUSIC_APIS[i].id === m.id) info = MUSIC_APIS[i]; }
          el.textContent = (info ? info.label : m.id) + ' ' + (m.ok ? '\u2713 ' + m.ms + ' ms' : '\u2717 ' + (m.note || 'failed'));
          el.title = m.base + (m.ok ? ' \u00b7 ' + m.songs + ' result(s)' : '');
        });
      })
      .catch(function () {
        MUSIC_APIS.forEach(function (m) {
          var el = $('lab-music-' + m.id);
          if (el) { el.className = 'lab-ping bad'; el.textContent = m.label + ' \u2717 network'; }
        });
      })
      .then(function () { labMusicBusy = false; labMusicAt = labNow(); labPaintMusicAt(); });
  }
  /** Fetch the two free-model menus once per Lab session. An unreachable
   *  provider is reported as such — the bench never shows an invented list. */
  function labLoadCatalog() {
    if (labCatalogState === 'loading' || labCatalogState === 'ready') return;
    labCatalogState = 'loading';
    labPaintModelRow();
    fetch('/api/aimodels')
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('http ' + r.status)); })
      .then(function (j) {
        var groups = (j && j.groups) || [];
        labCatalog = { grq: [], opr: [] };
        groups.forEach(function (g) {
          if ((g.id === 'grq' || g.id === 'opr') && g.models) {
            labCatalog[g.id] = g.models;
            if (g.prefix) labCatalogPrefix[g.id] = g.prefix;
          }
        });
        labCatalogState = 'ready';
      })
      .catch(function () { labCatalogState = 'failed'; })
      .then(function () { labPaintModelRow(); });
  }
  /** The model control for the CURRENT lane: a free-model dropdown on the two
   *  catalog lanes, a slug box everywhere else. */
  function labPaintModelRow() {
    var host = $('lab-model-row');
    if (!host) return;
    var info = labInfo(labLane);
    var cur = labModelBy[labLane] || '';
    if (info.catalog) {
      var list = labCatalog[info.catalog] || [];
      // "<upstream> / <model name>" — the owner asked for the provider to be
      // visible on every row, so a slug is never ambiguous while benching.
      var pfx = labCatalogPrefix[info.catalog] || info.catalog;
      var opts = '<option value="">' + esc(pfx) + ' / auto \u00b7 today\u2019s default</option>' +
        list.map(function (m) {
          var label = pfx + ' / ' + m.label + (m.context ? ' \u00b7 ' + Math.round(m.context / 1000) + 'k' : '');
          return '<option value="' + esc(m.id) + '"' + (m.id === cur ? ' selected' : '') + '>' + esc(label) + '</option>';
        }).join('');
      var note = labCatalogState === 'loading' ? 'loading the free list\u2026'
        : labCatalogState === 'failed' ? 'list unavailable \u2014 the key or provider is unreachable'
        : list.length ? list.length + ' free chat model(s) \u00b7 auto picks a live one, never a fixed slug'
        : 'no free chat models reported on this key';
      host.innerHTML = '<label class="muted" style="font-size:11px" for="lab-model-sel">Model</label>' +
        '<select id="lab-model-sel" style="min-width:280px">' + opts + '</select>' +
        '<span class="muted" style="font-size:11px">' + esc(note) + '</span>' +
        '<button class="ghost" id="lab-model-reload" style="padding:3px 10px;font-size:11px">Reload list</button>';
      $('lab-model-sel').addEventListener('change', function () { labModelBy[labLane] = this.value; });
      $('lab-model-reload').addEventListener('click', function () { labCatalogState = 'idle'; labLoadCatalog(); });
    } else {
      host.innerHTML = '<label class="muted" style="font-size:11px" for="lab-model-in">Model</label>' +
        '<input id="lab-model-in" type="text" spellcheck="false" style="min-width:280px" ' +
        'placeholder="' + esc(info.model) + '" value="' + esc(cur) + '">' +
        '<span class="muted" style="font-size:11px">blank = the pinned model \u00b7 type a slug to probe a candidate on this key</span>';
      $('lab-model-in').addEventListener('input', function () { labModelBy[labLane] = this.value.trim(); });
    }
  }
  // ==========================================================================
  //  Catalog model monitoring (v5.24.0)
  //  The two aggregator keys are ONE chip each in the lane strip, but each
  //  opens a whole catalog. This pings every free chat model those keys serve,
  //  one row per model, so a single dead engine inside a catalog is visible
  //  instead of hiding behind a green key.
  //
  //  Pings are STAGGERED on purpose. Both keys are free tiers and the agent
  //  lane already answered 429 to a single ping — firing ~24 calls at once
  //  would manufacture rate-limit failures that say nothing about the models.
  // ==========================================================================
  var labCatBusy = false;
  var labCatAt = '';
  var labCatHealth = {}; // slug -> 'ok' | 'warn' | 'bad'
  var CAT_PING_GAP_MS = 350;
  function labPaintCatAt() {
    var el = $('lab-cat-at');
    if (el) el.textContent = labCatAt ? 'last checked ' + labCatAt : '';
  }
  function labCatRows() {
    var rows = [];
    ['grq', 'opr'].forEach(function (gid) {
      var lane = gid === 'grq' ? 'scholar' : 'router';
      (labCatalog[gid] || []).forEach(function (m) {
        rows.push({ id: m.id, label: (labCatalogPrefix[gid] || gid) + ' / ' + m.label, lane: lane });
      });
    });
    return rows;
  }
  function labCatId(slug) { return 'lab-cat-' + slug.replace(/[^a-zA-Z0-9]/g, '_'); }
  function labPaintCatPing(row, ok, ms, why) {
    var el = $(labCatId(row.id));
    if (!el) return;
    el.className = 'lab-ping ' + (ok ? 'ok' : 'bad');
    el.textContent = row.label + ' ' + (ok ? '\u2713 ' + ms + ' ms' : '\u2717 ' + (why || 'failed'));
    el.title = row.id;
  }
  function labCatPingAll() {
    var host = $('lab-cat-pings');
    if (!host || labCatBusy) return;
    var rows = labCatRows();
    if (!rows.length) {
      host.innerHTML = '<span class="muted" style="font-size:11px">No catalog models loaded \u2014 use \u201cReload list\u201d on a catalog lane first.</span>';
      return;
    }
    labCatBusy = true;
    host.innerHTML = rows.map(function (r) {
      return '<span class="lab-ping" id="' + labCatId(r.id) + '">' + esc(r.label) + ' \u2026</span>';
    }).join('');
    var left = rows.length;
    function done() {
      left -= 1;
      if (left <= 0) { labCatBusy = false; labCatAt = labNow(); labPaintCatAt(); }
    }
    rows.forEach(function (r, i) {
      // Stagger: one call every CAT_PING_GAP_MS so a free-tier key is never
      // hit with the whole catalog at once.
      setTimeout(function () {
        var t0 = Date.now();
        fetch('/api/admin/ailab', {
          method: 'POST',
          headers: { 'x-admin-token': token(), 'content-type': 'application/json' },
          body: JSON.stringify({ lane: r.lane, model: r.id, messages: [{ role: 'user', content: 'ping' }], maxTokens: 1 })
        }).then(function (res) {
          if (res.status === 401) { sessionStorage.removeItem(TOKEN_KEY); showLogin('Invalid token.'); return { ok: false, why: '401' }; }
          var ct = res.headers.get('content-type') || '';
          if (ct.indexOf('text/event-stream') === -1) {
            return res.json().catch(function () { return {}; }).then(function (j) {
              return { ok: false, why: (j && j.error ? j.error + (j.status ? ' ' + j.status : '') : 'http ' + res.status) };
            });
          }
          return res.text().then(function () { return { ok: true }; });
        }).then(function (rr) {
          var ms = Date.now() - t0;
          labCatHealth[r.id] = rr.ok ? (ms < 4000 ? 'ok' : 'warn') : 'bad';
          labPaintCatPing(r, rr.ok, ms, rr.why);
        }).catch(function () {
          labCatHealth[r.id] = 'bad';
          labPaintCatPing(r, false, Date.now() - t0, 'network');
        }).then(done);
      }, i * CAT_PING_GAP_MS);
    });
  }
  function renderAiLab() {
    var chips = LAB_LANES.map(function (L) {
      return '<button class="lab-chip' + (L.lane === labLane ? ' active' : '') + '" data-lane="' + esc(L.lane) + '">' +
        '<span class="ln"><span class="lab-dot" id="lab-dot-' + esc(L.lane) + '"></span>' + esc(L.name) + ' · ' + esc(L.lane) + '</span>' +
        '<span class="lm">' + esc(L.nick) + '</span></button>';
    }).join('');
    $('view').innerHTML =
      '<div class="card" id="lab-root" style="max-width:860px">' +
      '<h3 style="margin-top:0">API Monitoring <span class="muted">· 18 keys across 19 lanes, every free catalog model, and the music sources — no failover, failures show honestly</span></h3>' +
      '<div class="lab-chips">' + chips + '</div>' +
      '<div class="row" id="lab-model-row" style="margin-bottom:10px;flex-wrap:wrap;align-items:center;gap:8px"></div>' +
      '<div class="row" style="margin-bottom:10px;flex-wrap:wrap"><button class="ghost" id="lab-ping">Ping all lanes</button><span id="lab-ping-at" class="lab-ping-at"></span><span id="lab-pings" class="chips" style="margin:0"></span></div>' +
      '<div class="row" style="margin-bottom:10px;flex-wrap:wrap"><button class="ghost" id="lab-cat">Ping catalog models</button><span id="lab-cat-at" class="lab-ping-at"></span><span id="lab-cat-pings" class="chips" style="margin:0"></span></div>' +
      '<div class="row" style="margin-bottom:10px;flex-wrap:wrap"><button class="ghost" id="lab-music">Ping music APIs</button><span id="lab-music-at" class="lab-ping-at"></span><span id="lab-music-pings" class="chips" style="margin:0"></span></div>' +
      '<div class="lab-msgs" id="lab-msgs"></div>' +
      '<textarea id="lab-in" class="lab-input" rows="3" placeholder="Test message — Enter sends, Shift+Enter for a new line"></textarea>' +
      '<div class="row" style="margin-top:10px"><button id="lab-send">Send</button><button class="ghost" id="lab-clear">Clear chat</button><span class="muted" style="font-size:11px">History lives per lane, in memory only — capped at 1000 tokens per reply.</span></div>' +
      '</div>';
    labPaintMsgs();
    Array.prototype.forEach.call(document.querySelectorAll('.lab-chip'), function (b) {
      b.addEventListener('click', function () {
        labLane = b.getAttribute('data-lane');
        Array.prototype.forEach.call(document.querySelectorAll('.lab-chip'), function (x) { x.classList.toggle('active', x === b); });
        labPaintMsgs();
        labPaintModelRow();
      });
    });
    $('lab-send').addEventListener('click', labSend);
    $('lab-clear').addEventListener('click', function () { labHist[labLane] = []; labPaintMsgs(); });
    $('lab-ping').addEventListener('click', labPingAll);
    $('lab-cat').addEventListener('click', labCatPingAll);
    $('lab-music').addEventListener('click', labMusicPing);
    $('lab-in').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); labSend(); }
    });
    labPaintModelRow();
    labLoadCatalog();
    labPaintDots();
    labPaintPingAt();
    labPaintMusicAt();
    labPaintCatAt();
    // First open of the Lab auto-checks lane health once — dots fill in
    // without a click; later refreshes never repaint the chat.
    if (!labAutoPinged) { labAutoPinged = true; labPingAll(); labMusicPing(); }
    stamp();
  }
  function labPaintDots() { LAB_LANES.forEach(function (L) { labPaintDot(L.lane); }); }
  // Paint once; on auto-refresh ticks just stamp freshness — never repaint an
  // interactive pane (that would eat a chat mid-stream).
  function loadAiLab() { if (!document.getElementById('lab-root')) renderAiLab(); else stamp(); }

  // ==========================================================================
  //  Shared helpers for new sections (SVG icons, empty-state, catalogs)
  // ==========================================================================
  var ICONS = {
    listeners: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-7 7-7s7 3 7 7"/><circle cx="17" cy="7" r="3"/><path d="M22 20c0-3-2-5-5-5"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M10 8l6 4-6 4z" fill="currentColor"/></svg>',
    dau: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="3"/><path d="M3 10h18M8 2v4M16 2v4"/></svg>',
    wau: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12h4l3-8 4 16 3-8h4"/></svg>',
    empty_activity: '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="32" cy="32" r="26" stroke="rgba(255,255,255,0.2)"/><path d="M20 34l8 8 16-18" stroke="rgba(34,211,238,0.7)"/></svg>',
    empty_search: '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="28" cy="28" r="16" stroke="rgba(255,255,255,0.3)"/><path d="M40 40l14 14" stroke="rgba(34,211,238,0.7)"/></svg>',
    empty_ai: '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="14" y="16" width="36" height="30" rx="6" stroke="rgba(255,255,255,0.3)"/><circle cx="24" cy="30" r="3" fill="rgba(34,211,238,0.7)"/><circle cx="40" cy="30" r="3" fill="rgba(34,211,238,0.7)"/><path d="M22 40h20" stroke="rgba(255,255,255,0.3)"/></svg>',
    empty_feedback: '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 16h40v28H36l-8 8v-8H12z" stroke="rgba(255,255,255,0.3)"/><circle cx="24" cy="30" r="2" fill="rgba(34,211,238,0.7)"/><circle cx="32" cy="30" r="2" fill="rgba(34,211,238,0.7)"/><circle cx="40" cy="30" r="2" fill="rgba(34,211,238,0.7)"/></svg>',
    empty_rooms: '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="24" cy="26" r="6" stroke="rgba(255,255,255,0.3)"/><circle cx="42" cy="30" r="5" stroke="rgba(255,255,255,0.3)"/><path d="M12 48c0-6 6-10 12-10s12 4 12 10" stroke="rgba(34,211,238,0.7)"/><path d="M34 46c0-4 4-8 8-8s10 4 10 8" stroke="rgba(255,255,255,0.3)"/></svg>',
    empty_music: '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M24 46V16l24-4v30" stroke="rgba(34,211,238,0.7)"/><circle cx="20" cy="46" r="4" stroke="rgba(255,255,255,0.3)"/><circle cx="44" cy="42" r="4" stroke="rgba(255,255,255,0.3)"/></svg>'
  };
  function emptyState(iconKey, title, hint) {
    return html`<div class="empty-state">${''}` + (ICONS[iconKey] || '') + html`<div class="es-title">${title}</div><div class="es-hint">${hint}</div></div>`;
  }
  // Static catalog of the React app's home shelves (mirrors src/features/home/*).
  // Kept here to avoid a runtime import; update when new shelves land.
  var HOME_SHELVES_CATALOG = [
    { id: 'made-for-you', name: 'Made For You', source: 'usePersonalShelves' },
    { id: 'trending-near-you', name: 'Trending Near You', source: 'useTrendingShelves' },
    { id: 'most-played', name: 'Most Played', source: 'usePersonalShelves' },
    { id: 'new-releases', name: 'New Releases', source: 'useTrendingShelves' },
    { id: 'top-charts', name: 'Top Charts', source: 'useTrendingShelves' },
    { id: 'popular-artists', name: 'Popular Artists', source: 'useYourArtists' },
    { id: 'recently-added', name: 'Recently Added', source: 'useDiscoveryShelves' },
    { id: 'mood-collections', name: 'Mood Collections', source: 'useMoodShelves' },
    { id: 'fresh-finds', name: 'Fresh Finds', source: 'useDiscoveryShelves' },
    { id: 'daily-mix', name: 'Daily Mix', source: 'useDailyMix' },
    { id: 'seasonal', name: 'Seasonal Picks', source: 'useSeasonalShelf' },
    { id: 'genres', name: 'Browse by Genre', source: 'useGenreShelves' },
    { id: 'unlimited-feed', name: 'Unlimited Feed', source: 'useUnlimitedFeed' }
  ];
  var LANGUAGES_STATIC = [
    'hindi','punjabi','tamil','telugu','malayalam','kannada','marathi','bengali','gujarati','english',
    'bhojpuri','haryanvi','urdu','odia','assamese','rajasthani','konkani','maithili','nepali','sanskrit','tulu','dogri','kashmiri'
  ];
  var MOODS_STATIC = [
    { id: 'romance', label: 'Romance' }, { id: 'workout', label: 'Workout' }, { id: 'chill', label: 'Chill' },
    { id: 'party', label: 'Party' }, { id: 'sad', label: 'Heartbreak' }, { id: 'devotional', label: 'Devotional' },
    { id: 'travel', label: 'Road Trip' }, { id: 'focus', label: 'Focus' }
  ];
  var GENRE_SHELVES_STATIC = [
    { id: 'pop', label: 'Pop' }, { id: 'hiphop', label: 'Hip Hop' }, { id: 'rock', label: 'Rock' },
    { id: 'indie', label: 'Indie' }, { id: 'edm', label: 'EDM' }, { id: 'classical', label: 'Classical' },
    { id: 'jazz', label: 'Jazz' }, { id: 'country', label: 'Country' }, { id: 'kpop', label: 'K-Pop' },
    { id: 'lofi', label: 'Lo-fi' }, { id: 'telugu', label: 'Telugu Hits' }, { id: 'tamil', label: 'Tamil Hits' },
    { id: 'bollywood', label: 'Bollywood' }, { id: 'punjabi', label: 'Punjabi' }
  ];
  var REGIONAL_STATIC = [
    { id: 'south', label: 'South India' }, { id: 'north', label: 'North India' },
    { id: 'east', label: 'East India' }, { id: 'west', label: 'West India' },
    { id: 'northeast', label: 'North-East India' }, { id: 'global', label: 'Global' }
  ];
  var ACCENTS = ['ember','ocean','violet','rose','emerald','sunset','aurora','mono','gold','azure'];
  var ACCENT_COLORS = { ember: '#22d3ee', ocean: '#38bdf8', violet: '#a78bfa', rose: '#f472b6', emerald: '#34d399', sunset: '#fb923c', aurora: '#a3e635', mono: '#94a3b8', gold: '#facc15', azure: '#60a5fa' };

  // ---------- Song Management (AI-curated, honest stub) ----------
  var songsTab = 'trending';
  function renderSongsSection() {
    var tabs = [['trending','Trending'],['featured','Featured'],['new','New Release'],['recommended','Recommended']];
    var endpoints = {
      trending: '/api/vinaxai (trending recommendations) · /api/admin/overview.topSongs',
      featured: '/api/admin/music (topSongs, editorial pin — TODO)',
      new: '/api/vinaxai (newReleases prompt) — TODO',
      recommended: '/api/vinaxai (per-user recs) — TODO'
    };
    $('view').innerHTML =
      '<div class="stub-banner"><h4>AI-curated Song Editor</h4>' +
      '<p>Each tab here will be driven by the VinaX AI models plus editorial pins. The backend endpoints below are the intended feed; the editor UI (drag-to-reorder, pin, block, boost) lands with the <b>/api/admin/songs</b> service.</p></div>' +
      '<div class="subtabs" id="songTabs">' + tabs.map(function (t) {
        return '<button data-t="' + t[0] + '"' + (t[0] === songsTab ? ' class="active"' : '') + '>' + t[1] + '</button>';
      }).join('') + '</div>' +
      '<div class="card" style="margin-bottom:14px"><h3 style="margin-top:0">' + esc(tabs.filter(function(t){return t[0]===songsTab;})[0][1]) + ' — data source</h3>' +
      '<p class="muted" style="font-size:12.5px">Feeds from: <code>' + esc(endpoints[songsTab]) + '</code></p>' +
      '<div class="row" style="gap:8px"><button id="song-preview" class="ghost qa-go">Preview top 3 (live)</button><span class="muted" style="font-size:12px" id="song-preview-out">Click preview to load current top songs.</span></div>' +
      '<div id="song-preview-box" style="margin-top:12px"></div></div>' +
      emptyState('empty_music', 'Song editor lands with the next release',
        'Curated ordering, pins, and blocks will flow through the AI-curator here. The endpoint contract is documented above.');
    Array.prototype.forEach.call(document.querySelectorAll('#songTabs button'), function (b) {
      b.addEventListener('click', function () { songsTab = b.getAttribute('data-t'); renderSongsSection(); });
    });
    $('song-preview').addEventListener('click', function () {
      $('song-preview-out').textContent = 'Loading…';
      api('/api/admin/overview').then(function (d) {
        var top = (d && d.topSongs || []).slice(0, 3);
        if (!top.length) { $('song-preview-box').innerHTML = emptyState('empty_music','No top songs yet','As listeners play, top tracks appear here.'); $('song-preview-out').textContent = ''; return; }
        var rows = top.map(function (s) {
          return html`<tr><td>${s.song_title || ''}</td><td class="muted">${s.song_artist || ''}</td><td>${s.plays}</td></tr>`;
        }).join('');
        $('song-preview-box').innerHTML = '<table><thead><tr><th>Title</th><th>Artist</th><th>Plays</th></tr></thead><tbody>' + rows + '</tbody></table>';
        $('song-preview-out').textContent = 'Live from /api/admin/overview';
      }).catch(function () { $('song-preview-out').textContent = 'Failed to load.'; });
    });
    stamp();
  }

  // ---------- Playlist Management (AI-managed, coming-soon) ----------
  var plTab = 'featured';
  function renderPlaylistsSection() {
    var tabs = [['featured','Featured'],['trending','Trending'],['mood','Mood'],['genre','Genre'],['regional','Regional']];
    $('view').innerHTML =
      '<div class="stub-banner"><h4>AI-managed Playlists</h4>' +
      '<p>Playlists across all five surfaces will be auto-assembled by the VinaX AI, ranked with recent play data, and pinned by editors. The manager UI ships alongside the <b>/api/admin/playlists</b> service.</p></div>' +
      '<div class="subtabs" id="plTabs">' + tabs.map(function (t) {
        return '<button data-t="' + t[0] + '"' + (t[0] === plTab ? ' class="active"' : '') + '>' + t[1] + '</button>';
      }).join('') + '</div>' +
      '<div id="pl-live-box">' + emptyState('empty_music','Loading current curation preview…','Sourced from /api/admin/music where available.') + '</div>';
    Array.prototype.forEach.call(document.querySelectorAll('#plTabs button'), function (b) {
      b.addEventListener('click', function () { plTab = b.getAttribute('data-t'); renderPlaylistsSection(); });
    });
    api('/api/admin/music?days=' + rangeDays).then(function (d) {
      if (active !== 'playlists' || !d) return;
      var rows = (d.topSongs || []).slice(0, 10).map(function (s) {
        return html`<tr><td>${s.song_title || ''}</td><td class="muted">${s.song_artist || ''}</td><td>${s.plays}</td></tr>`;
      }).join('');
      var host = $('pl-live-box');
      if (!host) return;
      if (!rows) { host.innerHTML = emptyState('empty_music','No curated data yet','As listens accrue, top tracks from /api/admin/music will seed each list here.'); return; }
      host.innerHTML = '<h3>Live seed from /api/admin/music — ' + esc(tabs.filter(function(t){return t[0]===plTab;})[0][1]) + '</h3>' +
        '<table><thead><tr><th>Title</th><th>Artist</th><th>Plays</th></tr></thead><tbody>' + rows + '</tbody></table>';
    }).catch(noop);
    stamp();
  }

  // ---------- Home Screen Management (server-backed via /api/admin/appconfig) ----------
  // These are the app's REAL Home block keys (src/constants/homeBlocks.ts) —
  // the old catalog used invented ids that matched nothing client-side, so
  // nothing saved here could ever propagate.
  var HOME_BLOCKS_APP = [
    { id: 'quick', name: 'Quick access grid' },
    { id: 'personal', name: 'Your music shelves' },
    { id: 'discovery', name: 'Discovery shelves' },
    { id: 'charts', name: 'Top 50 cards' },
    { id: 'seasonal', name: 'Seasonal shelf' },
    { id: 'moods', name: 'Mood playlists' },
    { id: 'genres', name: 'Genre collections' },
    { id: 'artists', name: 'Trending artists' },
    { id: 'albums', name: 'Trending albums' },
    { id: 'daypicks', name: 'Time-of-day picks' },
    { id: 'loved', name: 'Recently loved' },
    { id: 'feed', name: 'Endless feed' }
  ];
  function defaultHomeCfg() {
    return HOME_BLOCKS_APP.map(function (s) { return { id: s.id, enabled: true }; });
  }
  function blockName(id) {
    var b = HOME_BLOCKS_APP.filter(function (x) { return x.id === id; })[0];
    return b ? b.name : id;
  }
  var hsCfg = null; // [{id, enabled}] in display order
  var hsLoaded = false;
  var hsPublished = '';
  var hsLoadError = false;
  var hsSaving = false;
  function normalizeHomeCfg(value) {
    var known = {};
    var out = [];
    if (value && Array.isArray(value.blocks)) {
      value.blocks.forEach(function (b) {
        if (b && typeof b.id === 'string' && !known[b.id] && HOME_BLOCKS_APP.some(function (x) { return x.id === b.id; })) {
          known[b.id] = true;
          out.push({ id: b.id, enabled: b.enabled !== false });
        }
      });
    }
    HOME_BLOCKS_APP.forEach(function (s) { if (!known[s.id]) out.push({ id: s.id, enabled: true }); });
    return out;
  }
  function homeDiffHtml(current, published) {
    if (!published) return '';
    var before = [];
    try { before = JSON.parse(published) || []; } catch (e) { return ''; }
    var oldBy = {}; before.forEach(function (b, i) { oldBy[b.id] = { enabled: b.enabled !== false, order: i }; });
    var changes = [];
    (current || []).forEach(function (b, i) {
      var old = oldBy[b.id];
      if (!old) changes.push({ label: blockName(b.id), detail: 'added at position ' + (i + 1) });
      else {
        if (old.order !== i) changes.push({ label: blockName(b.id), detail: 'moved from ' + (old.order + 1) + ' to ' + (i + 1) });
        if (old.enabled !== (b.enabled !== false)) changes.push({ label: blockName(b.id), detail: b.enabled ? 'enabled' : 'hidden' });
      }
    });
    before.forEach(function (b) { if (!(current || []).some(function (x) { return x.id === b.id; })) changes.push({ label: blockName(b.id), detail: 'removed' }); });
    if (!changes.length) return '';
    return '<div class="card hs-diff"><div class="row"><h3 style="margin:0">Draft changes</h3><span class="spacer"></span><span class="pill">' + changes.length + ' change' + (changes.length === 1 ? '' : 's') + '</span></div><p class="muted" style="margin:8px 0 12px">Review what will change for listeners when you publish.</p>' + changes.map(function (c) { return '<div class="hs-diff-row"><b>' + esc(c.label) + '</b><span class="spacer"></span><span class="muted">' + esc(c.detail) + '</span></div>'; }).join('') + '</div>';
  }
  function renderHomescreenSection() {
    if (!hsLoaded) {
      hsLoaded = true;
      $('view').innerHTML = '<div class="empty">Loading published config…</div>';
      api('/api/admin/appconfig?key=home-config').then(function (d) {
        hsCfg = normalizeHomeCfg(d && d.value);
        hsPublished = JSON.stringify(hsCfg);
        hsLoadError = false;
        if (active === 'homescreen') renderHomescreenSection();
      }).catch(function () {
        hsCfg = defaultHomeCfg();
        hsLoadError = true;
        if (active === 'homescreen') renderHomescreenSection();
      });
      return;
    }
    if (!hsCfg) hsCfg = defaultHomeCfg();
    var dirty = JSON.stringify(hsCfg) !== hsPublished;
    var preview = hsCfg.filter(function (b) { return b.enabled; });
    var rows = hsCfg.map(function (s, i) {
      return '<div class="hs-row' + (s.enabled ? '' : ' disabled') + '" data-id="' + esc(s.id) + '">' +
        '<span class="hs-ord">' + (i + 1) + '</span>' +
        '<span style="flex:1;font-weight:600">' + esc(blockName(s.id)) + ' <span class="muted" style="font-size:11px;font-weight:400">' + esc(s.id) + '</span></span>' +
        '<span class="row" style="gap:6px"><button class="ghost icon-btn hs-up" data-id="' + esc(s.id) + '" title="Move up" aria-label="Move up"' + (i === 0 ? ' disabled' : '') + '>▲</button><button class="ghost icon-btn hs-dn" data-id="' + esc(s.id) + '" title="Move down" aria-label="Move down"' + (i === hsCfg.length - 1 ? ' disabled' : '') + '>▼</button></span>' +
        '<span class="row" style="gap:8px"><label class="switch"><span class="track ' + (s.enabled ? 'on' : '') + '"><span class="knob"></span></span><input type="checkbox" aria-label="Show home shelf" class="hs-tog" data-id="' + esc(s.id) + '"' + (s.enabled ? ' checked' : '') + ' /></label></span>' +
        '</div>';
    }).join('');
    $('view').innerHTML =
      '<div class="stub-banner"><h4>Live — published to every client</h4>' +
      '<p>Order + visibility below are the <b>server defaults</b> for the app\'s Home (edge-cached ≤5 min). A listener\'s own Settings → Home layout still wins on their device; blocks disabled here are hidden for everyone.</p></div>' +
      (hsLoadError ? '<div class="stub-banner"><h4>Published layout could not be loaded</h4><p>Retry before editing so you do not overwrite an unseen configuration.</p><button id="hs-retry">Retry loading</button></div>' : '') +
      '<div class="hs-studio"><div class="card"><span class="ops-eyebrow">LAYOUT STARTERS</span><h3>Design a better first impression</h3><p class="muted">Choose a starting point, refine the order, then publish when ready.</p><div class="row" style="flex-wrap:wrap"><button class="ghost hs-preset" data-preset="balanced">Balanced</button><button class="ghost hs-preset" data-preset="discovery">Discovery first</button><button class="ghost hs-preset" data-preset="focused">Focused</button></div></div>' +
      '<div class="card hs-preview"><span class="ops-eyebrow">STRUCTURE PREVIEW · ' + preview.length + ' SHELVES</span><h3>Your daily soundtrack</h3><div class="hs-preview-hero">Aura Mix · always visible</div>' + preview.map(function (b, i) { return '<div class="hs-preview-row"><span>' + (i + 1) + '</span>' + esc(blockName(b.id)) + '</div>'; }).join('') + '</div></div>' +
      '<div class="card" style="margin-bottom:14px"><div class="row"><h3 style="margin-top:0">Home blocks</h3><span class="spacer"></span><span class="pill">' + (dirty ? 'Unpublished changes' : 'Matches published layout') + '</span></div>' + rows +
      '<div class="row" style="margin-top:12px;gap:8px">' +
        '<span class="spacer" style="flex:1"></span>' +
        '<button id="hs-save"' + (hsLoadError || hsSaving || !dirty ? ' disabled' : '') + '>Publish layout</button>' +
        '<button class="ghost" id="hs-reset">Reset to defaults</button>' +
        '<span class="muted" id="hs-out" style="font-size:12px"></span>' +
      '</div></div>' +
      homeDiffHtml(hsCfg, hsPublished) +
      '<h3>Draft JSON</h3>' +
      '<pre id="hs-json" class="codebox" style="max-height:280px">' + esc(JSON.stringify({ blocks: hsCfg }, null, 2)) + '</pre>';
    if ($('hs-retry')) $('hs-retry').addEventListener('click', function () { hsLoaded = false; renderHomescreenSection(); });
    Array.prototype.forEach.call(document.querySelectorAll('.hs-preset'), function (b) {
      b.addEventListener('click', function () {
        var mode = b.getAttribute('data-preset');
        var first = mode === 'discovery' ? ['discovery', 'artists', 'moods', 'personal'] : mode === 'focused' ? ['quick', 'personal', 'loved', 'daypicks'] : ['quick', 'personal', 'discovery', 'daypicks'];
        var ids = first.concat(HOME_BLOCKS_APP.map(function (x) { return x.id; }).filter(function (id) { return first.indexOf(id) < 0; }));
        hsCfg = ids.map(function (id) { return { id: id, enabled: mode !== 'focused' || first.indexOf(id) >= 0 }; });
        renderHomescreenSection();
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('.hs-up'), function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-id');
        var i = hsCfg.findIndex(function (s) { return s.id === id; });
        if (i > 0) { var t = hsCfg[i - 1]; hsCfg[i - 1] = hsCfg[i]; hsCfg[i] = t; renderHomescreenSection(); }
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('.hs-dn'), function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-id');
        var i = hsCfg.findIndex(function (s) { return s.id === id; });
        if (i >= 0 && i < hsCfg.length - 1) { var t = hsCfg[i + 1]; hsCfg[i + 1] = hsCfg[i]; hsCfg[i] = t; renderHomescreenSection(); }
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('.hs-tog'), function (chk) {
      chk.addEventListener('change', function () {
        var id = chk.getAttribute('data-id');
        var s = hsCfg.filter(function (x) { return x.id === id; })[0];
        if (s) { s.enabled = !s.enabled; renderHomescreenSection(); }
      });
    });
    $('hs-save').addEventListener('click', function () {
      var btn = $('hs-save');
      if (btn.disabled || hsSaving) return;
      hsSaving = true;
      btn.disabled = true;
      $('hs-out').textContent = 'Publishing…';
      var submitted = JSON.stringify(hsCfg);
      postApi('/api/admin/appconfig', { key: 'home-config', value: { blocks: JSON.parse(submitted) } }).then(function (r) {
        hsSaving = false;
        if (r && r.ok) hsPublished = submitted;
        if (active !== 'homescreen') return;
        renderHomescreenSection();
        $('hs-out').textContent = r && r.ok ? 'Published ✓ (live within ~5 min)' : 'Publish failed' + (r && r.error ? ' — ' + r.error : '');
        setTimeout(function () { var o = $('hs-out'); if (o) o.textContent = ''; }, 4000);
      }).catch(function () { hsSaving = false; if (active !== 'homescreen') return; renderHomescreenSection(); if ($('hs-out')) $('hs-out').textContent = 'Publish failed — network'; });
    });
    $('hs-reset').addEventListener('click', function () {
      vxConfirm('Reset to the app defaults (all blocks on, default order)? Publish to make it live.', { title: 'Home Screen', okText: 'Reset' }).then(function (ok) {
        if (ok) { hsCfg = defaultHomeCfg(); renderHomescreenSection(); }
      });
    });
    stamp();
  }

  // ---------- Categories & Genres ----------
  var catFilter = '';
  function renderCategoriesSection() {
    var q = (catFilter || '').toLowerCase();
    function tbl(title, items, count) {
      var rows = items.filter(function (x) { return !q || x.label.toLowerCase().indexOf(q) >= 0 || x.id.toLowerCase().indexOf(q) >= 0; })
        .map(function (x) {
          return html`<tr><td>${x.label}</td><td class="muted">${x.id}</td><td class="muted">${count(x)}</td><td>` +
            '<button class="ghost" disabled title="Backend endpoint required — /api/admin/categories" style="padding:3px 10px;font-size:11px">Edit</button> ' +
            '<button class="ghost" disabled title="Backend endpoint required — /api/admin/categories" style="padding:3px 10px;font-size:11px;color:var(--danger)">Delete</button>' +
            '</td></tr>';
        }).join('');
      return '<h3>' + esc(title) + ' <span class="muted">· ' + items.length + '</span></h3>' +
        '<table><thead><tr><th>Name</th><th>ID</th><th>Used in</th><th></th></tr></thead><tbody>' +
        (rows || '<tr><td colspan="4" class="empty">No matches for “' + esc(catFilter) + '”.</td></tr>') + '</tbody></table>';
    }
    var genres = GENRE_SHELVES_STATIC.map(function (g) { return { id: g.id, label: g.label }; });
    var languages = LANGUAGES_STATIC.map(function (id) { return { id: id, label: id.charAt(0).toUpperCase() + id.slice(1) }; });
    var moods = MOODS_STATIC.map(function (m) { return { id: m.id, label: m.label }; });
    var regions = REGIONAL_STATIC;
    $('view').innerHTML =
      '<div class="stub-banner"><h4>Read-only preview</h4>' +
      '<p>Sourced from <code>src/constants/languages.ts</code>, <code>src/constants/seeds.ts</code>, and <code>src/features/home/useGenreShelves.ts</code>. Add / Edit / Delete need <b>/api/admin/categories</b>.</p></div>' +
      '<div class="row" style="margin-bottom:12px"><input id="cat-q" type="search" placeholder="Filter across all categories…" value="' + esc(catFilter) + '" style="max-width:340px" /><button class="ghost" disabled title="Backend endpoint required — /api/admin/categories">+ Add category</button></div>' +
      tbl('Genres', genres, function (x) { return 'GENRE_SHELVES · Browse'; }) +
      tbl('Languages', languages, function (x) { return 'LANGUAGES · seed queries · onboarding'; }) +
      tbl('Moods', moods, function (x) { return 'MOODS · Mood Collections'; }) +
      tbl('Regional', regions, function (x) { return 'Regional shelves (planned)'; });
    var qi = $('cat-q');
    qi.addEventListener('input', function () { catFilter = qi.value; renderCategoriesSection(); qi = $('cat-q'); if (qi) qi.focus(); });
    stamp();
  }

  // ---------- Banner & Promotion Management (server-backed) ----------
  var bnPreview = { title: '', subtitle: '', linkType: 'song', linkId: '', start: '', end: '', img: '' };
  var bnSaved = null; // server copy; null = not loaded yet
  function renderBannersSection() {
    if (bnSaved === null) {
      $('view').innerHTML = '<div class="empty">Loading published banners…</div>';
      api('/api/admin/appconfig?key=banners').then(function (d) {
        bnSaved = (d && Array.isArray(d.value)) ? d.value : [];
        if (active === 'banners') renderBannersSection();
      }).catch(function () {
        bnSaved = [];
        if (active === 'banners') renderBannersSection();
      });
      return;
    }
    var saved = bnSaved;
    function publish(next, out) {
      postApi('/api/admin/appconfig', { key: 'banners', value: next }).then(function (r) {
        if (r && r.ok) { bnSaved = next; $(out).textContent = 'Published ✓ (live within ~5 min)'; setTimeout(renderBannersSection, 600); }
        else $(out).textContent = 'Publish failed' + (r && r.error ? ' — ' + r.error : '');
      }).catch(function () { $(out).textContent = 'Publish failed — network'; });
    }
    var savedRows = saved.map(function (b, i) {
      return html`<tr><td>${b.title}</td><td class="muted">${b.subtitle}</td><td><span class="pill">${b.linkType}</span> ${b.linkId}</td><td class="muted">${b.start || '—'} → ${b.end || '—'}</td>` +
        '<td><button class="ghost bn-del" data-i="' + i + '" style="padding:3px 10px;font-size:11px;color:var(--danger)">Delete</button></td></tr>';
    }).join('');
    $('view').innerHTML =
      '<div class="stub-banner"><h4>Live — published to the site</h4>' +
      '<p>Banners publish to the server (<code>/api/admin/appconfig</code>) and show on every client\'s Home within ~5 minutes, within their schedule window. Keep images small (≤200 KB) — they embed in the config.</p></div>' +
      '<div class="card" style="margin-bottom:14px"><h3 style="margin-top:0">Compose</h3>' +
      '<div class="row" style="flex-wrap:wrap;gap:10px">' +
        '<input id="bn-title" type="text" placeholder="Title" value="' + esc(bnPreview.title) + '" style="max-width:280px" />' +
        '<input id="bn-sub" type="text" placeholder="Subtitle" value="' + esc(bnPreview.subtitle) + '" style="max-width:280px" />' +
      '</div>' +
      '<div class="row" style="flex-wrap:wrap;gap:10px;margin-top:8px">' +
        '<select id="bn-type" class="inp">' +
          ['song','album','playlist','artist'].map(function (t) { return '<option value="' + t + '"' + (bnPreview.linkType === t ? ' selected' : '') + '>' + t + '</option>'; }).join('') +
        '</select>' +
        '<input id="bn-id" type="text" placeholder="Link ID" value="' + esc(bnPreview.linkId) + '" style="max-width:220px" />' +
        '<input id="bn-start" type="date" value="' + esc(bnPreview.start) + '" class="inp" />' +
        '<input id="bn-end" type="date" value="' + esc(bnPreview.end) + '" class="inp" />' +
      '</div>' +
      '<div class="row" style="margin-top:10px"><input id="bn-file" type="file" accept="image/*" /><span class="muted" style="font-size:12px">Embedded in the published config — keep it ≤200 KB</span></div>' +
      '<h3>Preview</h3>' +
      '<div class="bn-preview" id="bn-prev">' +
        (bnPreview.img ? '<img src="' + esc(bnPreview.img) + '" alt="" style="max-height:80px;border-radius:8px;margin-bottom:8px" />' : '') +
        '<h4>' + esc(bnPreview.title || 'Your banner title') + '</h4><p>' + esc(bnPreview.subtitle || 'A helpful subtitle appears here') + '</p></div>' +
      '<div class="row" style="margin-top:12px"><button id="bn-save">Publish banner</button><span class="muted" id="bn-out" style="font-size:12px"></span></div></div>' +
      '<h3>Published banners (' + saved.length + ')</h3>' +
      (savedRows ? '<table><thead><tr><th>Title</th><th>Subtitle</th><th>Link</th><th>Schedule</th><th></th></tr></thead><tbody>' + savedRows + '</tbody></table>'
        : emptyState('empty_activity','No banners yet','Compose one above and click "Publish banner" to make it live.')) +
      '<h3>Saved JSON</h3><pre class="codebox" style="max-height:220px">' + esc(JSON.stringify(saved, null, 2)) + '</pre>';
    function syncFields() {
      bnPreview.title = $('bn-title').value; bnPreview.subtitle = $('bn-sub').value;
      bnPreview.linkType = $('bn-type').value; bnPreview.linkId = $('bn-id').value;
      bnPreview.start = $('bn-start').value; bnPreview.end = $('bn-end').value;
      var p = $('bn-prev');
      p.innerHTML = (bnPreview.img ? '<img src="' + esc(bnPreview.img) + '" alt="" style="max-height:80px;border-radius:8px;margin-bottom:8px" />' : '') +
        html`<h4>${bnPreview.title || 'Your banner title'}</h4><p>${bnPreview.subtitle || 'A helpful subtitle appears here'}</p>`;
    }
    ['bn-title','bn-sub','bn-type','bn-id','bn-start','bn-end'].forEach(function (id) { $(id).addEventListener('input', syncFields); $(id).addEventListener('change', syncFields); });
    $('bn-file').addEventListener('change', function () {
      var f = $('bn-file').files && $('bn-file').files[0]; if (!f) return;
      var rd = new FileReader();
      rd.onload = function () { bnPreview.img = String(rd.result || ''); syncFields(); };
      rd.readAsDataURL(f);
    });
    $('bn-save').addEventListener('click', function () {
      var btn = $('bn-save');
      if (btn.disabled) return;
      if (!bnPreview.title.trim()) { $('bn-out').textContent = 'Title required.'; return; }
      if (bnPreview.img && bnPreview.img.length > 300000) { $('bn-out').textContent = 'Image too large — pick one under ~200 KB.'; return; }
      btn.disabled = true;
      $('bn-out').textContent = 'Publishing…';
      var next = saved.concat([{
        id: 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        title: bnPreview.title, subtitle: bnPreview.subtitle, linkType: bnPreview.linkType,
        linkId: bnPreview.linkId, start: bnPreview.start, end: bnPreview.end, img: bnPreview.img,
        savedAt: new Date().toISOString()
      }]);
      publish(next, 'bn-out');
      setTimeout(function () { if (btn) btn.disabled = false; }, 1200);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.bn-del'), function (b) {
      b.addEventListener('click', function () {
        if (b.disabled) return;
        b.disabled = true;
        var i = parseInt(b.getAttribute('data-i'), 10);
        var next = saved.slice();
        next.splice(i, 1);
        publish(next, 'bn-out');
      });
    });
    stamp();
  }

  // ---------- App Configuration ----------
  var CFG_KEY = 'vinax_admin_appconfig';
  function loadAppCfg() {
    try { var raw = localStorage.getItem(CFG_KEY); if (raw) return JSON.parse(raw); } catch (e) {}
    return { accent: 'ember', theme: '#22d3ee', defaultShelves: HOME_SHELVES_CATALOG.slice(0, 6).map(function (s) { return s.name; }).join('\n'), defaultLang: 'hindi', defaultPlaylists: 'Trending Now\nDaily Mix\nMade For You' };
  }
  function renderConfigSection() {
    var cfg = loadAppCfg();
    $('view').innerHTML =
      '<div class="cards" id="cfg-cards"><div class="card"><div class="n" id="cfg-app">VinaX</div><div class="l">App name · from overview</div></div>' +
      '<div class="card"><div class="n" id="cfg-ver">…</div><div class="l">Version · from overview</div></div>' +
      '<div class="card"><div class="n">Static</div><div class="l">Logo · icons/icon.svg</div></div></div>' +
      '<div class="card" style="margin-bottom:14px"><h3 style="margin-top:0">Brand</h3>' +
      '<div class="row" style="align-items:center;gap:12px;margin-bottom:12px"><img src="/icons/icon.svg" alt="" style="width:56px;height:56px;border-radius:14px;background:var(--surface-3);padding:6px" /><button class="ghost" disabled title="Backend endpoint required — /api/admin/config">Change logo</button></div>' +
      '<div class="row" style="gap:10px;flex-wrap:wrap"><label style="font-size:12px;color:var(--text-3)">Theme color</label><input id="cfg-color" type="color" value="' + esc(cfg.theme) + '" style="width:44px;height:34px;padding:2px" /></div>' +
      '<p class="muted" style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;margin:14px 0 6px">Accent</p>' +
      '<div class="sw" id="cfg-sw">' + ACCENTS.map(function (a) {
        return '<button data-acc="' + a + '"' + (cfg.accent === a ? ' class="on"' : '') + ' style="background:' + ACCENT_COLORS[a] + '" title="' + a + '"></button>';
      }).join('') + '</div></div>' +
      '<div class="card" style="margin-bottom:14px"><h3 style="margin-top:0">Defaults</h3>' +
      '<label style="font-size:12px;color:var(--text-3)">Default homepage shelves</label>' +
      '<textarea id="cfg-shelves" rows="5" class="inp" style="margin-top:4px">' + esc(cfg.defaultShelves) + '</textarea>' +
      '<div class="row" style="gap:10px;margin-top:10px;flex-wrap:wrap"><label style="font-size:12px;color:var(--text-3)">Default language</label>' +
      '<select id="cfg-lang" class="inp">' +
        LANGUAGES_STATIC.map(function (l) { return '<option value="' + l + '"' + (cfg.defaultLang === l ? ' selected' : '') + '>' + (l.charAt(0).toUpperCase() + l.slice(1)) + '</option>'; }).join('') +
      '</select></div>' +
      '<label style="font-size:12px;color:var(--text-3);display:block;margin-top:10px">Default playlists</label>' +
      '<textarea id="cfg-pls" rows="4" class="inp" style="margin-top:4px">' + esc(cfg.defaultPlaylists) + '</textarea></div>' +
      '<div class="card" id="cfg-mm-box" style="margin-bottom:14px"><h3 style="margin-top:0">Maintenance mode message</h3>' +
      '<p class="muted" style="font-size:12px">Reads / writes to <code>/api/admin/site-mode</code> via /api/admin/maintenance.</p>' +
      '<textarea id="cfg-mm" rows="3" class="inp" placeholder="Loading current…"></textarea>' +
      '<div class="row" style="margin-top:10px;gap:8px"><button id="cfg-mm-save">Save maintenance message</button><span class="muted" id="cfg-mm-out" style="font-size:12px"></span></div></div>' +
      '<div class="row" style="gap:8px"><button id="cfg-save">Save config (local)</button><button class="ghost" id="cfg-reset">Reset to defaults</button><span class="muted" id="cfg-out" style="font-size:12px"></span></div>';
    // Load overview for name + version
    api('/api/admin/overview').then(function (d) {
      if (!d || active !== 'config') return;
      $('cfg-app').textContent = 'VinaX';
      $('cfg-ver').textContent = (d.summary && d.summary.version) || (d.version) || '—';
    }).catch(noop);
    // Load current site mode note
    fetch('/api/site-mode?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
      if (active !== 'config') return;
      var mm = $('cfg-mm'); if (mm) mm.value = (d && d.note) || '';
    }).catch(noop);
    $('cfg-mm-save').addEventListener('click', function () {
      var note = $('cfg-mm').value.trim();
      $('cfg-mm-out').textContent = 'Saving…';
      postApi('/api/admin/maintenance', { action: 'site_mode', mode: 'live', note: note }).then(function (r) {
        $('cfg-mm-out').textContent = r && r.ok ? 'Saved ✓' : 'Failed';
      }).catch(function () { $('cfg-mm-out').textContent = 'Failed'; });
    });
    Array.prototype.forEach.call(document.querySelectorAll('#cfg-sw button'), function (b) {
      b.addEventListener('click', function () {
        var acc = b.getAttribute('data-acc');
        try { document.documentElement.dataset.accent = acc; } catch (e) {}
        Array.prototype.forEach.call(document.querySelectorAll('#cfg-sw button'), function (x) { x.classList.toggle('on', x === b); });
      });
    });
    $('cfg-save').addEventListener('click', function () {
      var out = { accent: (document.documentElement.dataset.accent || cfg.accent), theme: $('cfg-color').value, defaultShelves: $('cfg-shelves').value, defaultLang: $('cfg-lang').value, defaultPlaylists: $('cfg-pls').value };
      try { localStorage.setItem(CFG_KEY, JSON.stringify(out)); $('cfg-out').textContent = 'Saved locally ✓'; }
      catch (e) { $('cfg-out').textContent = 'Save failed'; }
      setTimeout(function () { $('cfg-out').textContent = ''; }, 3000);
    });
    $('cfg-reset').addEventListener('click', function () {
      vxConfirm('Reset config to defaults?', { title: 'App Configuration', okText: 'Reset' }).then(function (ok) {
        if (!ok) return;
        try { localStorage.removeItem(CFG_KEY); } catch (e) {}
        renderConfigSection();
      });
    });
    stamp();
  }

  // ---------- Festival Themes (server override of the app's festival calendar) ----------
  // The app skins itself from src/constants/festivals.ts by date. This panel
  // publishes vinax_config key 'festival' ({mode:'auto'|'off'|'force', id})
  // through /api/admin/appconfig; clients pick it up within ~1 minute and
  // either follow the calendar (auto), suppress every skin (off), or wear
  // the chosen festival immediately (force) — splash, confetti and all.
  // Calendar + skins come from the generated public/admin/festivals.js (one source of truth with the app).
  var FEST_LIST = window.VX_FESTIVALS || [];
  function festAutoNow() {
    var d = new Date(), v = (d.getMonth() + 1) * 100 + d.getDate();
    for (var i = 0; i < FEST_LIST.length; i++) {
      var w = FEST_LIST[i].win;
      for (var j = 0; j < w.length; j++) if (v >= w[j][0] && v <= w[j][1]) return FEST_LIST[i];
    }
    return null;
  }
  function festById(id) {
    for (var i = 0; i < FEST_LIST.length; i++) if (FEST_LIST[i].id === id) return FEST_LIST[i];
    return null;
  }
  var ftSaved; // undefined = not loaded; null/'object' = server value
  function renderFestivalsSection() {
    if (ftSaved === undefined) {
      $('view').innerHTML = '<div class="empty">Loading festival config\u2026</div>';
      api('/api/admin/appconfig?key=festival').then(function (d) {
        ftSaved = (d && d.value && typeof d.value === 'object') ? d.value : null;
        if (active === 'festivals') renderFestivalsSection();
      }).catch(function () {
        ftSaved = null;
        if (active === 'festivals') renderFestivalsSection();
      });
      return;
    }
    var mode = (ftSaved && ftSaved.mode) || 'auto';
    var forcedId = mode === 'force' && ftSaved ? String(ftSaved.id || '') : '';
    var auto = festAutoNow();
    var effective = mode === 'off' ? null : (mode === 'force' ? festById(forcedId) : auto);
    function publish(value, label) {
      postApi('/api/admin/appconfig', { key: 'festival', value: value }).then(function (r) {
        var o = $('ft-out');
        if (r && r.ok) {
          ftSaved = value;
          if (o) o.textContent = label + ' \u2713 (listeners update within ~1 min)';
          setTimeout(renderFestivalsSection, 700);
        } else if (o) o.textContent = 'Publish failed' + (r && r.error ? ' \u2014 ' + r.error : '');
      }).catch(function () { var o = $('ft-out'); if (o) o.textContent = 'Publish failed \u2014 network'; });
    }
    var statusLine = effective
      ? '<span class="fest-status-photo" style="display:inline-block;width:32px;height:22px;vertical-align:middle;margin-right:8px;border-radius:6px;background-size:cover;background-position:' + esc(effective.imagePosition || 'center') + ';background-image:url(' + JSON.stringify(effective.image || '') + ')"></span><b>' + esc(effective.name) + '</b>' + (mode === 'force' ? ' <span class="pill">forced</span>' : ' <span class="pill">auto \u00b7 calendar</span>')
      : (mode === 'off' ? 'Default theme <span class="pill">festivals off</span>' : 'Default theme <span class="pill">auto \u00b7 no festival today</span>');
    var cards = FEST_LIST.map(function (f) {
      var isForced = forcedId === f.id;
      var isAuto = auto && auto.id === f.id;
      var sw = f.colors.map(function (c) {
        return '<i style="display:inline-block;width:14px;height:14px;border-radius:4px;margin-right:3px;background:' + esc(c) + ';border:1px solid rgba(255,255,255,.18)"></i>';
      }).join('');
      // Mini preview: the festival's own photo, canvas, ribbon and accent button.
      var preview = '<div style="position:relative;border-radius:10px;overflow:hidden;height:64px;background:' + esc(f.canvas) + ';border:1px solid rgba(255,255,255,.08);margin:8px 0 10px">' +
        '<div style="position:absolute;inset:0;background-image:linear-gradient(180deg,rgba(5,7,15,.05),rgba(5,7,15,.72)),url(' + JSON.stringify(f.image || '') + ');background-size:cover;background-position:' + esc(f.imagePosition || 'center') + ';opacity:.8"></div>' +
        '<div style="position:absolute;top:0;left:0;right:0;height:3px;background:' + esc(f.ribbon) + '"></div>' +
        '<div style="position:absolute;left:10px;top:14px;font-weight:900;font-size:12px;color:#fff;letter-spacing:.2px">VinaX</div>' +
        '<div style="position:absolute;left:10px;bottom:10px;height:8px;width:46%;border-radius:999px;background:rgba(255,255,255,.12)"></div>' +
        '<div style="position:absolute;right:10px;bottom:8px;padding:4px 10px;border-radius:999px;background:' + esc(f.accent) + ';color:#000;font-size:10px;font-weight:800">Play</div>' +
        '</div>';
      return '<div class="card" style="padding:14px 16px' + (isForced ? ';box-shadow:inset 0 0 0 1.5px var(--accent)' : '') + '">' +
        '<div style="display:flex;align-items:center;gap:8px;font-weight:800;font-size:14px">' +
          '<span class="fest-card-photo" style="display:block;width:32px;height:32px;flex:0 0 32px;border-radius:8px;background-image:url(' + JSON.stringify(f.image || '') + ');background-position:' + esc(f.imagePosition || 'center') + ';background-size:cover;border:1px solid rgba(255,255,255,.16)"></span><span style="flex:1;min-width:0">' + esc(f.name) + '</span>' +
          (isForced ? '<span class="pill">forced</span>' : (isAuto ? '<span class="pill">active today</span>' : (f.forceOnly ? '<span class="pill">force-only</span>' : ''))) +
        '</div>' +
        '<div class="muted" style="font-size:11.5px;margin:6px 0 2px">' + esc(f.when) + '</div>' +
        preview +
        '<div class="muted" style="font-size:11px;margin:0 0 8px;color:var(--text-3)">' + esc(f.fx || '') + ' \u00b7 motif: ' + esc(f.motif) + '</div>' +
        '<div style="margin-bottom:10px">' + sw + '</div>' +
        (isForced
          ? '<button class="ghost ft-auto" style="padding:5px 12px;font-size:12px">Back to auto</button>'
          : '<button class="ghost ft-force" data-id="' + esc(f.id) + '" style="padding:5px 12px;font-size:12px">Force now</button>') +
      '</div>';
    }).join('');
    $('view').innerHTML =
      '<div class="stub-banner"><h4>Festival Themes \u2014 live control</h4>' +
      '<p>Every festival is a full theme: a real photo backdrop, greeting splash, shape based confetti, accent colors, top ribbon, ambient glow and a living motif. The app follows its built-in calendar by default. ' +
      'From here you can <b>force</b> any festival for every listener right now, switch everything <b>off</b>, or return to <b>auto</b>. ' +
      '' + FEST_LIST.length + ' festivals, each its own theme (photo, accent, canvas, glow, motif and motion). Lunar dates are 2026 \u2014 refresh them yearly in <code>src/constants/festivals.ts</code>, then run <code>npm run gen:festivals</code>.</p></div>' +
      '<div class="card" style="margin-bottom:14px"><h3 style="margin-top:0">Listeners currently see</h3>' +
      '<p style="font-size:15px;margin:6px 0 12px">' + statusLine + '</p>' +
      '<div class="row" style="gap:10px;flex-wrap:wrap">' +
        '<button id="ft-mode-auto"' + (mode === 'auto' ? '' : ' class="ghost"') + '>Auto (calendar)</button>' +
        '<button id="ft-mode-off"' + (mode === 'off' ? '' : ' class="ghost"') + '>All festivals off</button>' +
        '<span class="muted" id="ft-out" style="font-size:12px"></span>' +
      '</div></div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px">' + cards + '</div>';
    $('ft-mode-auto').addEventListener('click', function () {
      if (mode === 'auto') return;
      publish({ mode: 'auto' }, 'Back to calendar');
    });
    $('ft-mode-off').addEventListener('click', function () {
      if (mode === 'off') return;
      vxConfirm('Turn festival themes OFF for every listener? The app shows its default look even during festival windows.', { title: 'Festival Themes', okText: 'Turn off' }).then(function (ok) {
        if (ok) publish({ mode: 'off' }, 'Festivals off');
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('button.ft-force'), function (b) {
      b.addEventListener('click', function () {
        var f = festById(b.getAttribute('data-id'));
        if (!f) return;
        vxConfirm('Force the ' + f.name + ' theme for EVERY listener now? Splash, confetti and accent colors switch within about a minute.', { title: 'Festival Themes', okText: 'Force ' + f.name }).then(function (ok) {
          if (ok) publish({ mode: 'force', id: f.id }, f.name + ' forced');
        });
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('button.ft-auto'), function (b) {
      b.addEventListener('click', function () { publish({ mode: 'auto' }, 'Back to calendar'); });
    });
    stamp();
  }

  // ---------- v5.13.0 — fourteen more tools (retention, data quality, catalog lookup,
  // engine probe, SEO corpus, edge health, releases, database, audit trail, feature
  // flags, runbook, config backup, trending pins, status note) ----------
  function cfgGet(key) { return api('/api/admin/appconfig?key=' + encodeURIComponent(key)); }
  function cfgSet(key, value) { return postApi('/api/admin/appconfig', { key: key, value: value }); }
  function okPill(ok, text) { return '<span class="pill" style="' + (ok ? 'color:var(--ok);border-color:var(--ok);background:var(--ok-soft)' : 'color:var(--danger);border-color:var(--danger);background:var(--danger-soft)') + '">' + esc(text) + '</span>'; }
  function ago(iso) { if (!iso) return '—'; var m = Math.round((Date.now() - Date.parse(iso)) / 60000); if (!isFinite(m)) return '—'; if (m < 1) return 'just now'; if (m < 60) return m + ' min ago'; if (m < 1440) return Math.round(m / 60) + ' h ago'; return Math.round(m / 1440) + ' d ago'; }
  function showFail(msg) { $('view').innerHTML = '<div class="empty">' + esc(msg || 'Could not load.') + '</div>'; }
  function pctCell(v) {
    var p = v == null ? null : Math.round(v <= 1 ? v * 100 : v);
    return p == null ? '<td class="muted">—</td>' : '<td><span class="btrack" style="display:inline-block;width:70px;vertical-align:middle;margin-right:6px"><span class="bfill" style="display:block;width:' + Math.min(100, p) + '%"></span></span>' + p + '%</td>';
  }

  // 1. Retention cohorts — weekly D1/D7/D30 from the vinax_retention RPC.
  function loadRetention() {
    apiMemo('/api/admin/retention').then(function (d) {
      if (!d || active !== 'retention') return;
      if (!d.configured) { $('view').innerHTML = '<div class="card"><h3 style="margin-top:0">Retention cohorts</h3><p class="muted">The <code>vinax_retention</code> function is not installed in Supabase yet. Run the retention migration and this panel fills in on the next refresh.</p></div>'; return; }
      var cs = d.cohorts || [];
      var avg = function (k) { var xs = cs.map(function (c) { return c[k]; }).filter(function (v) { return v != null; }); if (!xs.length) return null; var s = xs.reduce(function (a, b) { return a + (b <= 1 ? b * 100 : b); }, 0); return Math.round(s / xs.length) + '%'; };
      exportRows = cs; exportName = 'retention'; $('csv').hidden = !cs.length;
      $('view').innerHTML =
        '<div class="cards">' + card(cs.length, 'Weekly cohorts') + card(avg('d1') || '—', 'Avg day-1 return') + card(avg('d7') || '—', 'Avg day-7 return') + card(avg('d30') || '—', 'Avg day-30 return') + '</div>' +
        '<div class="card"><h3 style="margin-top:0">Cohorts <span class="muted">· share of each week’s new listeners who came back</span></h3>' +
        '<table><thead><tr><th>Cohort week</th><th>New listeners</th><th>Day 1</th><th>Day 7</th><th>Day 30</th></tr></thead><tbody>' +
        (cs.length ? cs.map(function (c) { return '<tr><td>' + esc(String(c.cohort_week).slice(0, 10)) + '</td><td>' + (c.cohort_size || 0) + '</td>' + pctCell(c.d1) + pctCell(c.d7) + pctCell(c.d30) + '</tr>'; }).join('') : '<tr><td colspan="5" class="empty">No cohorts yet.</td></tr>') +
        '</tbody></table></div>';
    }).catch(function () { if (active === 'retention') showFail(); });
  }

  // 2. Data quality — one health number + SLO burn.
  function loadDataQuality() {
    apiMemo('/api/admin/dataquality').then(function (d) {
      if (!d || active !== 'dataquality') return;
      var m = d.metrics || {};
      var metric = function (label, v) { return { label: label, v: v == null ? 0 : v, txt: v == null ? '—' : v + '%' }; };
      var items = [metric('Play events with verified origin', m.originVerifiedPct), metric('Play events with a resolved country', m.countryResolvedPct), metric('AI calls that succeeded', m.aiOkPct), metric('AI calls that returned content', m.aiContentPct)];
      $('view').innerHTML =
        '<div class="cards">' + card(d.score == null ? '—' : d.score + '%', 'Data quality score') + card((d.sampled && d.sampled.events) || 0, 'Play events sampled') + card((d.sampled && d.sampled.aiEvents) || 0, 'AI calls sampled') + '</div>' +
        '<div class="card"><h3 style="margin-top:0">Signals</h3>' + items.map(function (x) { return '<div class="brow"><div class="blabel">' + esc(x.label) + '</div><div class="btrack"><div class="bfill" style="width:' + x.v + '%"></div></div><div class="bval">' + x.txt + '</div></div>'; }).join('') + '</div>' +
        '<div class="card"><h3 style="margin-top:0">Service objectives <span class="muted">· error budget burned this window</span></h3><table><thead><tr><th>SLO</th><th>Target</th><th>Actual</th><th>Budget burned</th></tr></thead><tbody>' +
        (d.slos || []).map(function (s) { var burn = s.budgetBurnedPct; return '<tr><td>' + esc(s.name) + '</td><td>' + s.targetPct + '%</td><td>' + (s.actualPct == null ? '—' : s.actualPct + '%') + '</td><td>' + (burn == null ? '—' : okPill(burn <= 100, burn + '%')) + '</td></tr>'; }).join('') +
        '</tbody></table></div>';
    }).catch(function () { if (active === 'dataquality') showFail(); });
  }

  // 3. Catalog lookup — server-side multi-mirror search; copy ids for pushes / blocklist.
  function renderCatalogSection() {
    $('view').innerHTML =
      '<div class="card"><h3 style="margin-top:0">Catalog lookup</h3><p class="muted" style="margin-top:0">Searches the music catalog through the Worker (same-origin, mirror fallback). Copy an id for a push, a banner link or the blocklist.</p>' +
      '<div class="row" style="gap:8px;flex-wrap:wrap"><input id="cat-q" class="inp" placeholder="Song or album name…" style="flex:1;min-width:200px" /><select id="cat-kind" class="inp"><option value="song">Songs</option><option value="album">Albums</option></select><button id="cat-go">Search</button></div>' +
      '<div id="cat-out" style="margin-top:12px"><div class="empty">Type a name and press Search.</div></div></div>';
    var run = function () {
      var q = $('cat-q').value.trim(); if (!q) return;
      $('cat-out').innerHTML = '<div class="empty">Searching…</div>';
      api('/api/admin/catalog-search?q=' + encodeURIComponent(q) + '&kind=' + $('cat-kind').value + '&limit=15').then(function (d) {
        if (!d || active !== 'catalog') return;
        var items = d.items || [];
        if (!items.length) { $('cat-out').innerHTML = '<div class="empty">' + (d.error ? 'Catalog sources unavailable right now.' : 'No matches.') + '</div>'; return; }
        $('cat-out').innerHTML = '<table><thead><tr><th></th><th>Name</th><th>Id</th><th></th></tr></thead><tbody>' + items.map(function (it) {
          return '<tr><td>' + (it.image ? '<img class="thumb-sm" alt="" src="' + esc(it.image) + '" />' : '') + '</td><td><b>' + esc(it.name) + '</b><div class="muted">' + esc(it.subtitle) + '</div></td><td><code>' + esc(it.id) + '</code></td><td><button class="ghost" data-copy="' + esc(it.id) + '">Copy id</button></td></tr>';
        }).join('') + '</tbody></table><p class="muted" style="font-size:11px">Source: ' + esc(d.source || 'mirror') + '</p>';
        Array.prototype.forEach.call($('cat-out').querySelectorAll('[data-copy]'), function (b) { b.addEventListener('click', function () { try { navigator.clipboard.writeText(b.getAttribute('data-copy')); b.textContent = 'Copied ✓'; } catch (e) {} }); });
      }).catch(function () { $('cat-out').innerHTML = '<div class="empty">Search failed.</div>'; });
    };
    $('cat-go').addEventListener('click', run);
    $('cat-q').addEventListener('keydown', function (e) { if (e.key === 'Enter') run(); });
    stamp();
  }

  // 4. Engine probe — one real completion against any lane key, status + latency.
  var PROBE_KEYS = ['DEEPSEEK_V4_FLASH', 'CHATGPT_120_B', 'CHATGPT_20_B', 'NEMOTRON_SUPER', 'NEMOTRON_ULTRA', 'GROQ_API_KEY', 'NVIDIA_NEMOTRON_3_NANO_30B_A3B'];
  function probeLabel(k) { return String(k).replace(/^CHATGPT_/, 'COMMERCIAL_'); }
  function renderEngineProbeSection() {
    $('view').innerHTML =
      '<div class="card"><h3 style="margin-top:0">Engine probe</h3><p class="muted" style="margin-top:0">Sends one tiny completion through the chosen lane key and reports the upstream status and round-trip time. Use it before wiring a new model slug into a lane. Rate-limited to 10 a minute.</p>' +
      '<div class="row" style="gap:8px;flex-wrap:wrap"><select id="probe-key" class="inp">' + PROBE_KEYS.map(function (k) { return '<option value="' + k + '">' + probeLabel(k) + '</option>'; }).join('') + '</select><input id="probe-model" class="inp" placeholder="Model slug (optional — defaults to the lane’s pinned model)" style="flex:1;min-width:240px" /><button id="probe-go">Probe</button></div>' +
      '<div id="probe-out" style="margin-top:12px"></div></div>';
    var hist = [];
    $('probe-go').addEventListener('click', function () {
      var key = $('probe-key').value, model = $('probe-model').value.trim();
      $('probe-go').disabled = true; $('probe-out').innerHTML = '<div class="empty">Probing ' + esc(key) + '…</div>';
      api('/api/admin/enginetest?key=' + encodeURIComponent(key) + (model ? '&model=' + encodeURIComponent(model) : '')).then(function (r) {
        $('probe-go').disabled = false;
        if (!r) return;
        hist.unshift(r);
        $('probe-out').innerHTML = '<table><thead><tr><th>Key</th><th>Model</th><th>Status</th><th>Latency</th><th>Reply head</th></tr></thead><tbody>' + hist.slice(0, 12).map(function (h) {
          return '<tr><td><code>' + esc(probeLabel(h.key)) + '</code></td><td>' + esc(h.model || '') + '</td><td>' + okPill(h.status >= 200 && h.status < 300, h.status ? String(h.status) : (h.error || h.exception || 'no response')) + '</td><td>' + (h.ms || 0) + ' ms</td><td class="muted" style="max-width:360px;white-space:normal;word-break:break-all">' + esc((h.head || h.error || h.exception || '').slice(0, 160)) + '</td></tr>';
        }).join('') + '</tbody></table>';
      }).catch(function (e) { $('probe-go').disabled = false; $('probe-out').innerHTML = '<div class="empty">' + esc(e && e.message === 'http 429' ? 'Rate limited — try again in a minute.' : 'Probe failed.') + '</div>'; });
    });
    stamp();
  }

  // 5. SEO corpus
  function loadSeo() {
    apiMemo('/api/admin/seo').then(function (d) {
      if (!d || active !== 'seo') return;
      if (!d.configured) { showFail('Supabase is not configured.'); return; }
      exportRows = d.newest || []; exportName = 'seo-newest'; $('csv').hidden = !exportRows.length;
      var sm = d.sitemap || {};
      $('view').innerHTML =
        '<div class="cards">' + card(d.total.toLocaleString(), 'URLs in corpus') + (d.counts || []).map(function (c) { return card(c.count.toLocaleString(), c.plural + ' · ' + c.pages + ' sitemap page' + (c.pages === 1 ? '' : 's')); }).join('') + '</div>' +
        '<div class="card"><h3 style="margin-top:0">Sitemap index <span class="muted">· live fetch of /sitemap.xml</span></h3><div class="row" style="gap:10px;align-items:center;flex-wrap:wrap">' + okPill(sm.status === 200, sm.status === 200 ? 'reachable' : ('http ' + sm.status)) + '<span class="muted">' + (sm.entries || 0) + ' child sitemaps · ' + (sm.ms || 0) + ' ms · ' + (sm.bytes || 0) + ' bytes' + (sm.error ? ' · ' + esc(sm.error) : '') + '</span></div></div>' +
        '<div class="row" style="gap:14px;align-items:flex-start;flex-wrap:wrap"><div class="card" style="flex:1;min-width:280px"><h3 style="margin-top:0">Languages <span class="muted">· newest ' + (d.sampled || 0) + ' rows</span></h3>' + bars(d.languages || [], function (x) { return esc(x.lang); }, function (x) { return x.n; }) + '</div>' +
        '<div class="card" style="flex:1;min-width:280px"><h3 style="margin-top:0">Discovered per day</h3>' + dayChart(d.addedByDay || [], 'n') + '</div></div>' +
        '<div class="card"><h3 style="margin-top:0">Newest entries</h3><table><thead><tr><th>Type</th><th>Name</th><th>Lang</th><th>Key</th><th>Added</th></tr></thead><tbody>' + (d.newest || []).map(function (r) { return '<tr><td><span class="pill">' + esc(r.type) + '</span></td><td>' + esc(r.name) + '</td><td>' + esc(r.lang) + '</td><td><code>' + esc(r.key) + '</code></td><td class="muted">' + ago(r.added_at) + '</td></tr>'; }).join('') + '</tbody></table></div>';
    }).catch(function () { if (active === 'seo') showFail(); });
  }

  // 6. Edge & endpoint health — the v5.11.4 outage, as a dashboard.
  function loadEdge() {
    api('/api/admin/edge').then(function (d) {
      if (!d || active !== 'edge') return;
      stamp();
      var sh = d.shell || {};
      $('view').innerHTML =
        '<div class="card" style="border-color:' + (d.healthy ? 'var(--ok)' : 'var(--danger)') + '"><div class="row" style="align-items:center;gap:12px;flex-wrap:wrap"><h3 style="margin:0">' + (d.healthy ? '✅ Edge is healthy' : '⚠️ ' + d.problems + ' problem' + (d.problems === 1 ? '' : 's') + ' found') + '</h3><span class="muted">' + esc(d.origin) + ' · checked ' + ago(d.checkedAt) + '</span><div class="spacer"></div><button id="edge-again" class="ghost">Re-check</button></div></div>' +
        '<div class="cards">' + card(sh.status || 0, 'App shell status') + card((sh.ms || 0) + ' ms', 'Shell latency') + card(sh.cacheStatus || '—', 'Edge cache status') + card(sh.build || '—', 'Live build id') + '</div>' +
        '<div class="card"><h3 style="margin-top:0">Assets the shell needs <span class="muted">· each must be real JavaScript/CSS, never HTML</span></h3><table><thead><tr><th>Asset</th><th>Kind</th><th>Status</th><th>Content-type</th><th>Latency</th><th>Note</th></tr></thead><tbody>' +
        ((d.assets || []).length ? d.assets.map(function (a) { return '<tr><td><code>' + esc(a.path) + '</code></td><td>' + esc(a.kind) + '</td><td>' + okPill(a.ok, a.ok ? 'ok' : (a.status || 'fail')) + '</td><td class="muted">' + esc(a.contentType || '') + '</td><td>' + a.ms + ' ms</td><td class="muted">' + esc(a.note || '') + '</td></tr>'; }).join('') : '<tr><td colspan="6" class="empty">No assets found in the shell — the shell itself may be wrong.</td></tr>') +
        '</tbody></table></div>' +
        '<div class="card"><h3 style="margin-top:0">Public endpoints</h3><table><thead><tr><th>Endpoint</th><th>Path</th><th>Status</th><th>Latency</th><th>Note</th></tr></thead><tbody>' +
        (d.endpoints || []).map(function (p) { return '<tr><td>' + esc(p.name) + '</td><td><code>' + esc(p.method + ' ' + p.path) + '</code></td><td>' + okPill(p.ok, String(p.status || 'fail')) + '</td><td>' + p.ms + ' ms</td><td class="muted">' + esc(p.note || '') + '</td></tr>'; }).join('') +
        '</tbody></table></div>';
      $('edge-again').addEventListener('click', function () { $('view').innerHTML = '<div class="empty">Checking…</div>'; loadEdge(); });
    }).catch(function (e) { if (active === 'edge') showFail(e && e.message === 'http 429' ? 'Rate limited — the check fans out ~15 requests; try again in a minute.' : 'Could not run the edge check.'); });
  }

  // 7. Releases & CI
  function loadReleases() {
    apiMemo('/api/admin/releases').then(function (d) {
      if (!d || active !== 'releases') return;
      if (!d.configured) { $('view').innerHTML = '<div class="card"><h3 style="margin-top:0">Releases &amp; CI</h3><p class="muted">Set the <code>GITHUB_TOKEN</code> secret on the Worker (the same one the Android updater uses) to see releases, workflow runs and recent commits here.</p></div>'; return; }
      var rel = d.release, live = d.live || {};
      var liveVer = live.version || live.latest || live.tag || '—';
      var runPill = function (r) { if (r.status !== 'completed') return '<span class="pill">' + esc(r.status) + '</span>'; return okPill(r.conclusion === 'success', r.conclusion || r.status); };
      $('view').innerHTML =
        '<div class="cards">' + card(rel ? esc(rel.tag) : '—', 'Latest GitHub release') + card(esc(String(liveVer)), 'Version the site reports') + card((d.runs || []).filter(function (r) { return r.conclusion === 'failure'; }).length, 'Failed runs (last 20)') + card((d.commits || []).length, 'Recent commits on main') + '</div>' +
        (rel ? '<div class="card"><h3 style="margin-top:0">' + esc(rel.name || rel.tag) + '</h3><div class="row" style="gap:8px;flex-wrap:wrap">' + (rel.assets || []).map(function (a) { return '<span class="pill">' + esc(a.name) + '</span>'; }).join('') + '</div>' + (rel.notes ? '<pre class="codebox" style="white-space:pre-wrap;margin-top:10px">' + esc(rel.notes) + '</pre>' : '') + '</div>' : '') +
        '<div class="card"><h3 style="margin-top:0">Workflow runs</h3><table><thead><tr><th>#</th><th>Workflow</th><th>Result</th><th>Branch</th><th>Trigger</th><th>Started</th><th></th></tr></thead><tbody>' +
        ((d.runs || []).length ? d.runs.map(function (r) { return '<tr><td class="muted">' + r.number + '</td><td><b>' + esc(r.name) + '</b><div class="muted">' + esc(r.title) + '</div></td><td>' + runPill(r) + '</td><td><code>' + esc(r.branch) + '</code> <span class="muted">' + esc(r.sha) + '</span></td><td>' + esc(r.event) + '</td><td class="muted">' + ago(r.started) + '</td><td><a class="ghost" href="' + esc(r.url) + '" target="_blank" rel="noopener">Open</a></td></tr>'; }).join('') : '<tr><td colspan="7" class="empty">No runs.</td></tr>') +
        '</tbody></table></div>' +
        '<div class="card"><h3 style="margin-top:0">Recent commits</h3><table><tbody>' + (d.commits || []).map(function (c) { return '<tr><td><code>' + esc(c.sha) + '</code></td><td>' + esc(c.message) + '</td><td class="muted">' + esc(c.author) + ' · ' + ago(c.at) + '</td></tr>'; }).join('') + '</tbody></table></div>';
    }).catch(function () { if (active === 'releases') showFail(); });
  }

  // 8. Database overview
  function loadTables() {
    apiMemo('/api/admin/tables').then(function (d) {
      if (!d || active !== 'tables') return;
      if (!d.configured) { showFail('Supabase is not configured.'); return; }
      exportRows = d.tables; exportName = 'database'; $('csv').hidden = false;
      var busiest = d.tables.slice().sort(function (a, b) { return (b.last24h || 0) - (a.last24h || 0); })[0];
      $('view').innerHTML =
        '<div class="cards">' + card((d.totalRows || 0).toLocaleString(), 'Rows across tables') + card(d.tables.length, 'Tables') + card(busiest ? busiest.name.replace('vinax_', '') : '—', 'Busiest in 24 h') + '</div>' +
        '<div class="card"><h3 style="margin-top:0">Tables <span class="muted">· counts are live; age is the newest row</span></h3><table><thead><tr><th>Table</th><th>Rows</th><th>Last 24 h</th><th>Newest row</th><th>What it holds</th></tr></thead><tbody>' +
        d.tables.map(function (t) { var stale = t.ageMin != null && t.ageMin > 1440 && /events|ai_events/.test(t.name); return '<tr><td><code>' + esc(t.name) + '</code></td><td>' + (t.total == null ? '<span class="muted">n/a</span>' : t.total.toLocaleString()) + '</td><td>' + (t.last24h == null ? '—' : '+' + t.last24h.toLocaleString()) + '</td><td>' + (stale ? okPill(false, ago(t.newestAt)) : '<span class="muted">' + ago(t.newestAt) + '</span>') + '</td><td class="muted">' + esc(t.note) + '</td></tr>'; }).join('') +
        '</tbody></table></div>';
    }).catch(function () { if (active === 'tables') showFail(); });
  }

  // 9. Audit trail — every admin action, filterable.
  function loadAuditTrail() {
    apiMemo('/api/admin/audit').then(function (d) {
      if (!d || active !== 'audit') return;
      var items = d.items || [];
      exportRows = items; exportName = 'audit'; $('csv').hidden = !items.length;
      var paint = function (q) {
        var rows = items.filter(function (it) { return !q || ((it.kind || '') + ' ' + (it.text || '')).toLowerCase().indexOf(q) >= 0; });
        $('audit-rows').innerHTML = rows.length ? rows.map(function (it) { var text = it.text || ''; if (it.kind === 'announcement') { try { var j = JSON.parse(text); text = (j.title || '') + ' — ' + (j.body || ''); } catch (e) { /* raw */ } } return '<tr><td><span class="pill">' + esc(it.kind) + '</span></td><td>' + esc(text) + '</td><td class="muted" title="' + esc(it.at) + '">' + ago(it.at) + '</td></tr>'; }).join('') : '<tr><td colspan="3" class="empty">Nothing matches.</td></tr>';
      };
      $('view').innerHTML = '<div class="card"><div class="row" style="gap:8px;align-items:center;flex-wrap:wrap"><h3 style="margin:0">Audit trail</h3><span class="muted">' + items.length + ' entries</span><div class="spacer"></div><input id="audit-q" class="inp" placeholder="Filter…" style="min-width:200px" /></div><table style="margin-top:12px"><thead><tr><th>Kind</th><th>What</th><th>When</th></tr></thead><tbody id="audit-rows"></tbody></table></div>';
      paint('');
      $('audit-q').addEventListener('input', function () { paint($('audit-q').value.trim().toLowerCase()); });
    }).catch(function () { if (active === 'audit') showFail(); });
  }

  // 10. Feature flags — kill-switches the app reads from /api/appconfig?key=flags.
  var KNOWN_FLAGS = [
    { key: 'codeRun', label: 'Run / Preview in VinaX AI code blocks', note: 'Off hides the ▶ Run and Open buttons under code the assistant writes.' },
    { key: 'listenTogether', label: 'Listen Together', note: 'Off hides the Listen Together entry from the sidebar and Library.' }
  ];
  function renderFlagsSection() {
    $('view').innerHTML = '<div class="astra-admin-loading" role="status" aria-label="Loading panel"><p>Connecting your workspace…</p><div class="cards" aria-hidden="true"><div></div><div></div><div></div><div></div></div></div>';
    cfgGet('flags').then(function (d) {
      if (active !== 'flags') return;
      if (d && d.configured === false) { showFail('Supabase is not configured.'); return; }
      var flags = (d && d.value && typeof d.value === 'object') ? d.value : {};
      var known = {}; KNOWN_FLAGS.forEach(function (f) { known[f.key] = true; });
      var custom = Object.keys(flags).filter(function (k) { return !known[k]; });
      var toggle = function (k, on) { return '<label class="switch" data-flag="' + esc(k) + '"><span class="track' + (on ? ' on' : '') + '"><span class="knob"></span></span></label>'; };
      $('view').innerHTML =
        '<div class="card"><h3 style="margin-top:0">Feature flags</h3><p class="muted" style="margin-top:0">Every flag is <b>on</b> unless switched off here. Changes reach listeners within about a minute (edge cache), no app update needed.' + (d && d.updated_at ? ' Last published ' + ago(d.updated_at) + '.' : '') + '</p>' +
        '<table><thead><tr><th>Flag</th><th>What it controls</th><th>State</th></tr></thead><tbody id="flag-rows">' +
        KNOWN_FLAGS.map(function (f) { return '<tr><td><code>' + f.key + '</code><div class="muted">' + esc(f.label) + '</div></td><td class="muted">' + esc(f.note) + '</td><td>' + toggle(f.key, flags[f.key] !== false) + '</td></tr>'; }).join('') +
        custom.map(function (k) { return '<tr><td><code>' + esc(k) + '</code><div class="muted">custom</div></td><td class="muted">Read by <code>useFeatureFlags()</code> in the app.</td><td>' + toggle(k, flags[k] !== false) + ' <button class="ghost" data-del="' + esc(k) + '">Remove</button></td></tr>'; }).join('') +
        '</tbody></table>' +
        '<div class="row" style="gap:8px;margin-top:12px;flex-wrap:wrap"><input id="flag-new" class="inp" placeholder="New flag name (letters, digits, - _)" style="min-width:220px" /><button class="ghost" id="flag-add">Add flag (off)</button><div class="spacer"></div><button id="flag-save">Publish flags</button><span class="muted" id="flag-out" style="font-size:12px"></span></div></div>';
      var state = {}; Object.keys(flags).forEach(function (k) { state[k] = flags[k] !== false; });
      KNOWN_FLAGS.forEach(function (f) { if (!(f.key in state)) state[f.key] = true; });
      Array.prototype.forEach.call(document.querySelectorAll('#flag-rows [data-flag]'), function (l) { l.addEventListener('click', function () { var k = l.getAttribute('data-flag'); state[k] = !state[k]; l.querySelector('.track').classList.toggle('on', state[k]); }); });
      Array.prototype.forEach.call(document.querySelectorAll('#flag-rows [data-del]'), function (b) { b.addEventListener('click', function () { delete state[b.getAttribute('data-del')]; b.closest('tr').remove(); }); });
      $('flag-add').addEventListener('click', function () { var k = $('flag-new').value.trim(); if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/.test(k)) { vxAlert('Flag names: letters, digits, - and _, starting with a letter.', { title: 'Feature flags' }); return; } state[k] = false; var out = {}; Object.keys(state).forEach(function (x) { out[x] = state[x]; }); cfgSet('flags', out).then(function () { renderFlagsSection(); }); });
      $('flag-save').addEventListener('click', function () { var out = {}; Object.keys(state).forEach(function (x) { out[x] = state[x]; }); $('flag-out').textContent = 'Publishing…'; cfgSet('flags', out).then(function (r) { $('flag-out').textContent = r && r.ok ? 'Published ✓' : 'Failed'; }).catch(function () { $('flag-out').textContent = 'Failed'; }); });
      stamp();
    }).catch(function () { if (active === 'flags') showFail(); });
  }

  // 11. Runbook — operator notes that live with the console, not in someone's chat.
  function renderRunbookSection() {
    $('view').innerHTML = '<div class="astra-admin-loading" role="status" aria-label="Loading panel"><p>Connecting your workspace…</p><div class="cards" aria-hidden="true"><div></div><div></div><div></div><div></div></div></div>';
    cfgGet('runbook').then(function (d) {
      if (active !== 'runbook') return;
      if (d && d.configured === false) { showFail('Supabase is not configured.'); return; }
      var notes = (d && Array.isArray(d.value)) ? d.value : [];
      var save = function (next, msg) { $('rb-out').textContent = 'Saving…'; return cfgSet('runbook', next).then(function (r) { if (r && r.ok) { notes = next; paint(); $('rb-out').textContent = msg || 'Saved ✓'; } else $('rb-out').textContent = 'Failed'; }).catch(function () { $('rb-out').textContent = 'Failed'; }); };
      var paint = function () {
        $('rb-list').innerHTML = notes.length ? notes.map(function (n, i) { return '<div class="card" style="margin-bottom:10px"><div class="row" style="align-items:center;gap:8px"><h3 style="margin:0">' + esc(n.title) + '</h3><span class="muted">' + ago(n.updatedAt) + '</span><div class="spacer"></div><button class="ghost" data-edit="' + i + '">Edit</button><button class="ghost" data-del="' + i + '">Delete</button></div><pre class="codebox" style="white-space:pre-wrap;margin:8px 0 0">' + esc(n.body) + '</pre></div>'; }).join('') : '<div class="empty">No notes yet. Write down what to do when things break — the next person on call will thank you.</div>';
        Array.prototype.forEach.call($('rb-list').querySelectorAll('[data-edit]'), function (b) { b.addEventListener('click', function () { var n = notes[+b.getAttribute('data-edit')]; $('rb-title').value = n.title; $('rb-body').value = n.body; $('rb-idx').value = b.getAttribute('data-edit'); $('rb-title').focus(); }); });
        Array.prototype.forEach.call($('rb-list').querySelectorAll('[data-del]'), function (b) { b.addEventListener('click', function () { var i = +b.getAttribute('data-del'); vxConfirm('Delete “' + notes[i].title + '”?', { title: 'Runbook', danger: true, okText: 'Delete' }).then(function (ok) { if (ok) save(notes.filter(function (_, j) { return j !== i; }), 'Deleted'); }); }); });
      };
      $('view').innerHTML =
        '<div class="card" style="margin-bottom:14px"><h3 style="margin-top:0">Runbook</h3><p class="muted" style="margin-top:0">Incident steps, secrets locations (never the secrets), who to call. Stored in the app config store and visible only here.</p>' +
        '<input type="hidden" id="rb-idx" value="" /><input id="rb-title" class="inp" placeholder="Title — e.g. App stuck on “Updating…”" /><textarea id="rb-body" rows="6" class="inp" style="margin-top:8px" placeholder="Steps…"></textarea>' +
        '<div class="row" style="gap:8px;margin-top:10px"><button id="rb-save">Save note</button><button class="ghost" id="rb-clear">Clear</button><span class="muted" id="rb-out" style="font-size:12px"></span></div></div><div id="rb-list"></div>';
      paint();
      $('rb-clear').addEventListener('click', function () { $('rb-idx').value = ''; $('rb-title').value = ''; $('rb-body').value = ''; });
      $('rb-save').addEventListener('click', function () {
        var t = $('rb-title').value.trim(), b = $('rb-body').value.trim(); if (!t || !b) { $('rb-out').textContent = 'Title and steps are both needed.'; return; }
        var idx = $('rb-idx').value === '' ? -1 : +$('rb-idx').value;
        var note = { title: t.slice(0, 120), body: b.slice(0, 8000), updatedAt: new Date().toISOString() };
        var next = notes.slice(); if (idx >= 0 && next[idx]) next[idx] = note; else next.unshift(note);
        save(next.slice(0, 60)).then(function () { $('rb-idx').value = ''; $('rb-title').value = ''; $('rb-body').value = ''; });
      });
      stamp();
    }).catch(function () { if (active === 'runbook') showFail(); });
  }

  // 12. Config backup — every published key as one JSON file, and back again.
  var BACKUP_KEYS = ['banners', 'home-config', 'festival', 'status-note', 'flags', 'runbook', 'trending-pins'];
  function renderBackupSection() {
    $('view').innerHTML =
      '<div class="card"><h3 style="margin-top:0">Config backup</h3><p class="muted" style="margin-top:0">Everything the console has published — banners, home layout, festival override, status note, feature flags, runbook and trending pins — as one JSON file. Restore it here after a mistake, or move it to another environment.</p>' +
      '<div class="row" style="gap:8px;flex-wrap:wrap"><button id="bk-export">Download backup</button><label class="ghost" style="cursor:pointer;display:inline-flex;align-items:center;padding:6px 12px;border:1px solid var(--border);border-radius:8px">Restore from file<input id="bk-file" type="file" accept="application/json" hidden /></label><span class="muted" id="bk-out" style="font-size:12px"></span></div>' +
      '<table style="margin-top:12px"><thead><tr><th>Key</th><th>Last published</th><th>Size</th></tr></thead><tbody id="bk-rows"><tr><td colspan="3" class="empty">Loading…</td></tr></tbody></table></div>';
    var snapshot = {};
    Promise.all(BACKUP_KEYS.map(function (k) { return cfgGet(k).then(function (d) { return { key: k, d: d }; }).catch(function () { return { key: k, d: null }; }); })).then(function (rs) {
      if (active !== 'backup') return;
      $('bk-rows').innerHTML = rs.map(function (r) { var v = r.d && r.d.value; if (v != null) snapshot[r.key] = v; var size = v == null ? 0 : JSON.stringify(v).length; return '<tr><td><code>' + esc(r.key) + '</code></td><td class="muted">' + (r.d && r.d.updated_at ? ago(r.d.updated_at) : '—') + '</td><td class="muted">' + (size ? (size / 1024).toFixed(1) + ' KB' : 'empty') + '</td></tr>'; }).join('');
      stamp();
    });
    $('bk-export').addEventListener('click', function () {
      var blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), config: snapshot }, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob); var a = document.createElement('a'); a.href = url; a.download = 'vinax-config-' + new Date().toISOString().slice(0, 10) + '.json'; a.click(); setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    });
    $('bk-file').addEventListener('change', function () {
      var f = $('bk-file').files[0]; if (!f) return;
      f.text().then(function (txt) {
        var j; try { j = JSON.parse(txt); } catch (e) { $('bk-out').textContent = 'Not a JSON file.'; return; }
        var cfg = j && j.config && typeof j.config === 'object' ? j.config : null; if (!cfg) { $('bk-out').textContent = 'No config block in that file.'; return; }
        var keys = Object.keys(cfg).filter(function (k) { return BACKUP_KEYS.indexOf(k) >= 0; });
        vxConfirm('Restore ' + keys.length + ' key' + (keys.length === 1 ? '' : 's') + ' (' + keys.join(', ') + ')? Current values are overwritten.', { title: 'Config backup', danger: true, okText: 'Restore' }).then(function (ok) {
          if (!ok) return;
          $('bk-out').textContent = 'Restoring…';
          Promise.all(keys.map(function (k) { return cfgSet(k, cfg[k]); })).then(function (rs) { var bad = rs.filter(function (r) { return !r || !r.ok; }).length; $('bk-out').textContent = bad ? bad + ' key(s) failed' : 'Restored ✓'; renderBackupSection(); });
        });
      });
    });
  }

  // 13. Trending pins — curated chips under the search bar, ahead of the organic list.
  function renderTrendingPinsSection() {
    $('view').innerHTML = '<div class="astra-admin-loading" role="status" aria-label="Loading panel"><p>Connecting your workspace…</p><div class="cards" aria-hidden="true"><div></div><div></div><div></div><div></div></div></div>';
    Promise.all([cfgGet('trending-pins'), fetch('/api/trending-searches?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.json(); }).catch(function () { return null; })]).then(function (rs) {
      if (active !== 'trendpins') return;
      var d = rs[0], live = rs[1];
      if (d && d.configured === false) { showFail('Supabase is not configured.'); return; }
      var pins = (d && Array.isArray(d.value)) ? d.value : [];
      $('view').innerHTML =
        '<div class="card"><h3 style="margin-top:0">Trending pins</h3><p class="muted" style="margin-top:0">Up to six searches to show first in the “Trending” chips under the search bar — a new release, a festival, a film. Organic community searches fill the remaining slots. Public within about ten minutes.</p>' +
        '<textarea id="tp-text" rows="6" class="inp" placeholder="One search per line…">' + esc(pins.join('\n')) + '</textarea>' +
        '<div class="row" style="gap:8px;margin-top:10px"><button id="tp-save">Publish pins</button><button class="ghost" id="tp-clear">Remove all pins</button><span class="muted" id="tp-out" style="font-size:12px"></span></div></div>' +
        '<div class="card"><h3 style="margin-top:0">What listeners see now</h3><div class="chips">' + (live && live.queries && live.queries.length ? live.queries.map(function (q) { return '<span class="pill">' + esc(q) + '</span>'; }).join(' ') : '<span class="muted">No trending chips are being served right now.</span>') + '</div></div>';
      var publish = function (list) { $('tp-out').textContent = 'Publishing…'; cfgSet('trending-pins', list).then(function (r) { $('tp-out').textContent = r && r.ok ? 'Published ✓' : 'Failed'; }).catch(function () { $('tp-out').textContent = 'Failed'; }); };
      $('tp-save').addEventListener('click', function () { var list = $('tp-text').value.split('\n').map(function (s) { return s.trim().slice(0, 40); }).filter(function (s, i, a) { return s.length >= 2 && a.indexOf(s) === i; }).slice(0, 6); $('tp-text').value = list.join('\n'); publish(list); });
      $('tp-clear').addEventListener('click', function () { $('tp-text').value = ''; publish([]); });
      stamp();
    }).catch(function () { if (active === 'trendpins') showFail(); });
  }

  // 14. Status note — the owner-written incident line on /api/status and the status page.
  function renderStatusNoteSection() {
    $('view').innerHTML = '<div class="astra-admin-loading" role="status" aria-label="Loading panel"><p>Connecting your workspace…</p><div class="cards" aria-hidden="true"><div></div><div></div><div></div><div></div></div></div>';
    cfgGet('status-note').then(function (d) {
      if (active !== 'statusnote') return;
      if (d && d.configured === false) { showFail('Supabase is not configured.'); return; }
      var v = d && d.value; var note = typeof v === 'string' ? v : (v && typeof v === 'object' && typeof v.text === 'string') ? v.text : '';
      $('view').innerHTML =
        '<div class="card"><h3 style="margin-top:0">Status note</h3><p class="muted" style="margin-top:0">A plain sentence for listeners during an incident (“Search is slow while a source recovers”). Shown by <code>/api/status</code> and the status page; empty means all clear.' + (d && d.updated_at ? ' Last changed ' + ago(d.updated_at) + '.' : '') + '</p>' +
        '<textarea id="sn-text" rows="3" class="inp" maxlength="280" placeholder="All clear — leave empty">' + esc(note) + '</textarea>' +
        '<div class="row" style="gap:8px;margin-top:10px"><button id="sn-save">Publish note</button><button class="ghost" id="sn-clear">All clear</button><a class="ghost" href="/api/status" target="_blank" rel="noopener" style="padding:6px 12px">View /api/status</a><span class="muted" id="sn-out" style="font-size:12px"></span></div></div>';
      var publish = function (text) { $('sn-out').textContent = 'Publishing…'; cfgSet('status-note', text).then(function (r) { $('sn-out').textContent = r && r.ok ? 'Published ✓' : 'Failed'; }).catch(function () { $('sn-out').textContent = 'Failed'; }); };
      $('sn-save').addEventListener('click', function () { publish($('sn-text').value.trim().slice(0, 280)); });
      $('sn-clear').addEventListener('click', function () { $('sn-text').value = ''; publish(''); });
      stamp();
    }).catch(function () { if (active === 'statusnote') showFail(); });
  }

  // ==========================================================================
  // v5.15.0 — 24 more console tools. Config-backed editors talk to
  // /api/admin/appconfig (one key each; listeners read them through the
  // cached /api/appconfig?key=client bundle within about a minute).
  // ==========================================================================
  var DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function wwwOrigin() { return location.origin.replace('admin.', 'www.'); }
  function stampOut(id, text, isErr) { var o = $(id); if (o) { o.textContent = text; o.style.color = isErr ? 'var(--danger)' : ''; } }
  // Small config editor scaffold: loads a key, renders a form via `form(value)`,
  // wires `#<id>-save` to `read()` → publish. Keeps every editor ~20 lines.
  function cfgEditor(opts) {
    $('view').innerHTML = '<div class="astra-admin-loading" role="status" aria-label="Loading panel"><p>Connecting your workspace…</p><div class="cards" aria-hidden="true"><div></div><div></div><div></div><div></div></div></div>';
    cfgGet(opts.key).then(function (d) {
      if (active !== opts.sec) return;
      var value = d && d.configured ? d.value : null;
      $('view').innerHTML = '<div class="card"><h3 style="margin-top:0">' + esc(opts.title) + '</h3><p class="muted" style="margin-top:-4px">' + opts.help + '</p>' + opts.form(value) +
        '<div class="row" style="gap:8px;align-items:center;flex-wrap:wrap;margin-top:12px"><button id="' + opts.sec + '-save">' + esc(opts.saveLabel || 'Publish') + '</button>' +
        (opts.clearable ? '<button id="' + opts.sec + '-clear" class="ghost">Clear</button>' : '') +
        '<span class="muted" id="' + opts.sec + '-out" style="font-size:12px">' + (d && d.updated_at ? 'Last published ' + ago(d.updated_at) : 'Never published') + '</span></div></div>' + (opts.after ? opts.after(value) : '');
      if (opts.wire) opts.wire(value);
      $(opts.sec + '-save').addEventListener('click', function () {
        var v;
        try { v = opts.read(); } catch (e) { stampOut(opts.sec + '-out', String(e && e.message || e), true); return; }
        cfgSet(opts.key, v).then(function (r) {
          if (r && r.ok) { stampOut(opts.sec + '-out', 'Published ✓ · live for listeners within ~1 min'); if (opts.onSaved) opts.onSaved(v); }
          else stampOut(opts.sec + '-out', 'Publish failed' + (r && r.error ? ' — ' + r.error : ''), true);
        }).catch(function () { stampOut(opts.sec + '-out', 'Publish failed — network', true); });
      });
      var c = $(opts.sec + '-clear');
      if (c) c.addEventListener('click', function () {
        vxConfirm('Clear this setting for every listener?', { title: opts.title, okText: 'Clear' }).then(function (ok) {
          if (!ok) return;
          cfgSet(opts.key, opts.empty === undefined ? null : opts.empty).then(function () { cfgEditor(opts); });
        });
      });
    }).catch(function () { if (active === opts.sec) showFail(); });
  }
  function inp(id, value, ph, extra) { return '<input id="' + id + '" class="inp" value="' + esc(value == null ? '' : String(value)) + '" placeholder="' + esc(ph || '') + '" ' + (extra || '') + ' />'; }
  function lbl(text, control) { return '<label style="display:block;margin:10px 0 4px;font-size:12px;color:var(--text-2)">' + esc(text) + '</label>' + control; }
  function isoLocal(v) { if (!v) return ''; var d = new Date(v); if (isNaN(d.getTime())) return ''; var p = function (n) { return (n < 10 ? '0' : '') + n; }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()); }
  function fromLocal(v) { if (!v) return ''; var d = new Date(v); return isNaN(d.getTime()) ? '' : d.toISOString(); }

  // ---- Audience -----------------------------------------------------------
  // 1. Feature usage — which parts of the app people actually touch.
  function loadUsage() {
    apiMemo('/api/admin/usage?days=' + rangeDays).then(function (d) {
      if (!d || active !== 'usage') return;
      if (!d.configured) { showFail('Supabase is not configured.'); return; }
      exportRows = d.byType; exportName = 'feature-usage'; $('csv').hidden = false;
      var total = d.byType.reduce(function (a, x) { return a + x.n; }, 0) || 1;
      $('view').innerHTML =
        '<div class="cards">' + card(d.sampled.toLocaleString(), (d.source === 'exact' ? 'Events counted · exact · ' : 'Events sampled · ') + d.days + ' d') + card(d.byType.length, 'Event kinds') + card(d.byPlatform[0] ? d.byPlatform[0].platform : '—', 'Top platform') + '</div>' +
        '<div class="row" style="gap:14px;align-items:flex-start;flex-wrap:wrap"><div class="card" style="flex:2;min-width:320px"><h3 style="margin-top:0">What listeners do</h3><table><thead><tr><th>Event</th><th>Count</th><th>Share</th><th>Devices</th></tr></thead><tbody>' +
        d.byType.map(function (t) { return '<tr><td><code>' + esc(t.type) + '</code></td><td>' + t.n.toLocaleString() + '</td>' + pctCell(t.n / total) + '<td>' + t.devices.toLocaleString() + '</td></tr>'; }).join('') + '</tbody></table></div>' +
        '<div class="card" style="flex:1;min-width:240px"><h3 style="margin-top:0">By platform</h3>' + bars(d.byPlatform, function (x) { return esc(x.platform); }, function (x) { return x.n; }) + '</div></div>';
    }).catch(function () { if (active === 'usage') showFail(); });
  }
  // 2. Listening heatmap — IST weekday × hour.
  function loadHeatmap() {
    apiMemo('/api/admin/usage?days=' + rangeDays).then(function (d) {
      if (!d || active !== 'heatmap') return;
      if (!d.configured) { showFail('Supabase is not configured.'); return; }
      var max = 1; d.heatmap.forEach(function (r) { r.forEach(function (n) { if (n > max) max = n; }); });
      var grid = '<div style="overflow:auto"><table style="border-collapse:separate;border-spacing:2px"><thead><tr><th></th>' + Array.from({ length: 24 }, function (_, h) { return '<th class="muted" style="font-size:10px;font-weight:600;padding:0 2px">' + h + '</th>'; }).join('') + '</tr></thead><tbody>' +
        d.heatmap.map(function (row, day) { return '<tr><td class="muted" style="font-size:11px;padding-right:6px">' + DAY_NAMES[day] + '</td>' + row.map(function (n, h) { var a = n / max; return '<td title="' + DAY_NAMES[day] + ' ' + h + ':00 · ' + n + ' plays" style="width:22px;height:20px;border-radius:4px;background:rgba(59,120,240,' + (0.06 + a * 0.9).toFixed(2) + ')"></td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
      $('view').innerHTML =
        '<div class="cards">' + card(d.peak ? DAY_NAMES[d.peak.day] + ' ' + d.peak.hour + ':00' : '—', 'Busiest hour (IST)') + card(d.peak ? d.peak.n : 0, 'Plays in that hour') + card(d.days + ' d', 'Window') + '</div>' +
        '<div class="card"><h3 style="margin-top:0">When people listen <span class="muted">· plays + heartbeats, IST</span></h3>' + grid + '<p class="muted" style="font-size:11px;margin:10px 0 0">Darker = more listening. Use it to time pushes, releases and maintenance windows.</p></div>';
    }).catch(function () { if (active === 'heatmap') showFail(); });
  }
  // 3. Onboarding funnel.
  function loadFunnel() {
    apiMemo('/api/admin/funnel?days=' + rangeDays).then(function (d) {
      if (!d || active !== 'funnel') return;
      if (!d.configured) { showFail('Supabase is not configured.'); return; }
      exportRows = d.steps; exportName = 'funnel'; $('csv').hidden = false;
      $('view').innerHTML =
        '<div class="cards">' + card(d.steps[0] ? d.steps[0].devices.toLocaleString() : 0, 'Devices that opened the app') + card((d.steps[2] ? d.steps[2].pct : 0) + '%', 'Went on to play') + card((d.steps[3] ? d.steps[3].pct : 0) + '%', 'Finished a song') + '</div>' +
        '<div class="card"><h3 style="margin-top:0">Funnel <span class="muted">· distinct devices, last ' + d.days + ' d · ' + (d.source === 'exact' ? 'exact (rollup)' : 'sample of ' + d.sampled.toLocaleString() + ' events') + '</span></h3>' +
        d.steps.map(function (s, i) { var prev = i ? d.steps[i - 1].devices : s.devices; var drop = prev ? Math.round((1 - s.devices / prev) * 100) : 0; return '<div class="brow"><div class="blabel">' + esc(s.label) + '</div><div class="btrack"><div class="bfill" style="width:' + s.pct + '%"></div></div><div class="bval">' + s.devices.toLocaleString() + ' · ' + s.pct + '%' + (i ? ' <span class="muted">(−' + drop + '%)</span>' : '') + '</div></div>'; }).join('') + '</div>';
    }).catch(function () { if (active === 'funnel') showFail(); });
  }

  // ---- Catalog ------------------------------------------------------------
  // 4. Song drilldown.
  function renderSongStatsSection() {
    $('view').innerHTML = '<div class="card"><div class="row" style="gap:8px;align-items:center;flex-wrap:wrap"><h3 style="margin:0">Song drilldown</h3><input id="ss-q" class="inp" placeholder="Song id or title…" style="min-width:260px" /><button id="ss-go">Look up</button><span class="muted" style="font-size:12px">plays, skips, listeners, countries · last ' + rangeDays + ' d</span></div></div><div id="ss-out"></div>';
    function run() {
      var q = $('ss-q').value.trim(); if (!q) return;
      $('ss-out').innerHTML = '<div class="empty">Looking up…</div>';
      api('/api/admin/songstats?q=' + encodeURIComponent(q) + '&days=' + rangeDays).then(function (d) {
        if (!d || active !== 'songstats') return;
        if (!d.match) { $('ss-out').innerHTML = '<div class="empty">No plays for that in the last ' + rangeDays + ' days.</div>'; return; }
        var m = d.match;
        exportRows = d.byDay; exportName = 'song-' + m.id; $('csv').hidden = false;
        $('ss-out').innerHTML =
          '<div class="card"><div class="row" style="gap:12px;align-items:center">' + (m.image ? '<img class="thumb-sm" src="' + esc(m.image) + '" alt="" />' : '') + '<div><b>' + esc(m.title) + '</b><div class="muted">' + esc(m.artist) + ' · <code>' + esc(m.id) + '</code></div></div><div class="spacer"></div>' + (d.candidates.length ? '<span class="muted" style="font-size:12px">Also matched: ' + d.candidates.map(function (c) { return '<a href="#" data-ss="' + esc(c.id) + '">' + esc(c.title) + '</a>'; }).join(', ') + '</span>' : '') + '</div></div>' +
          '<div class="cards">' + card(d.totals.plays, 'Plays') + card(d.totals.listeners, 'Listeners') + card(d.skipRate == null ? '—' : d.skipRate + '%', 'Skip rate') + card(d.totals.completes, 'Completions') + card(d.totals.favorites, 'Likes') + '</div>' +
          '<div class="row" style="gap:14px;align-items:flex-start;flex-wrap:wrap"><div class="card" style="flex:2;min-width:300px"><h3 style="margin-top:0">Plays per day</h3>' + dayChart(d.byDay, 'plays') + '</div>' +
          '<div class="card" style="flex:1;min-width:220px"><h3 style="margin-top:0">Countries</h3>' + bars(d.countries, function (x) { return esc(x.country); }, function (x) { return x.n; }) + '</div>' +
          '<div class="card" style="flex:1;min-width:220px"><h3 style="margin-top:0">Platforms</h3>' + bars(d.platforms, function (x) { return esc(x.platform); }, function (x) { return x.n; }) + '</div></div>';
        Array.prototype.forEach.call(document.querySelectorAll('[data-ss]'), function (a) { a.addEventListener('click', function (e) { e.preventDefault(); $('ss-q').value = a.getAttribute('data-ss'); run(); }); });
      }).catch(function () { $('ss-out').innerHTML = '<div class="empty">Lookup failed.</div>'; });
    }
    $('ss-go').addEventListener('click', run);
    $('ss-q').addEventListener('keydown', function (e) { if (e.key === 'Enter') run(); });
  }
  // 5. Skip report.
  function loadSkips() {
    apiMemo('/api/admin/skips?days=' + rangeDays).then(function (d) {
      if (!d || active !== 'skips') return;
      if (!d.configured) { showFail('Supabase is not configured.'); return; }
      exportRows = d.items; exportName = 'skips'; $('csv').hidden = !d.items.length;
      $('view').innerHTML = '<div class="card"><h3 style="margin-top:0">Most skipped <span class="muted">· songs with ≥' + d.min + ' plays in ' + d.days + ' d, ranked by skip rate \u00b7 ' + (d.source === 'exact' ? 'exact' : 'sampled') + '</span></h3><table><thead><tr><th></th><th>Song</th><th>Plays</th><th>Skips</th><th>Rate</th><th></th></tr></thead><tbody>' +
        (d.items.length ? d.items.map(function (s) { return '<tr><td>' + (s.image ? '<img class="thumb-sm" src="' + esc(s.image) + '" alt="" />' : '') + '</td><td><b>' + esc(s.title) + '</b><div class="muted">' + esc(s.artist) + '</div></td><td>' + s.plays + '</td><td>' + s.skips + '</td>' + pctCell(s.rate) + '<td><button class="ghost" data-block="' + esc(s.id) + '" data-title="' + esc(s.title) + '">Block</button> <button class="ghost" data-ss2="' + esc(s.id) + '">Drilldown</button></td></tr>'; }).join('') : '<tr><td colspan="6" class="empty">Nothing skipped enough to report.</td></tr>') + '</tbody></table></div>';
      Array.prototype.forEach.call(document.querySelectorAll('[data-block]'), function (b) { b.addEventListener('click', function () { doBlock(b.getAttribute('data-block'), b.getAttribute('data-title')); }); });
      Array.prototype.forEach.call(document.querySelectorAll('[data-ss2]'), function (b) { b.addEventListener('click', function () { setSection('songstats'); setTimeout(function () { var q = $('ss-q'); if (q) { q.value = b.getAttribute('data-ss2'); $('ss-go').click(); } }, 50); }); });
    }).catch(function () { if (active === 'skips') showFail(); });
  }
  // 6. Search synonyms.
  function renderSynonymsSection() {
    cfgEditor({
      sec: 'synonyms', key: 'search-synonyms', title: 'Search synonyms', clearable: true, empty: {},
      help: 'One per line as <code>typed = rewrite</code>. A query that equals the left side (or contains it as a whole word) is rewritten before it reaches the catalogue — Search, AI music commands and radio all benefit. Example: <code>arr = A. R. Rahman</code>.',
      form: function (v) { var lines = v && typeof v === 'object' ? Object.keys(v).map(function (k) { return k + ' = ' + v[k]; }) : []; return '<textarea id="syn-text" class="inp" rows="12" style="width:100%;font-family:ui-monospace,monospace">' + esc(lines.join('\n')) + '</textarea>'; },
      read: function () { var out = {}; $('syn-text').value.split('\n').forEach(function (l) { var i = l.indexOf('='); if (i < 1) return; var k = l.slice(0, i).trim().toLowerCase(), v = l.slice(i + 1).trim(); if (k && v) out[k] = v; }); if (Object.keys(out).length > 200) throw new Error('Max 200 synonyms'); return out; },
    });
  }
  // 7. Catalog sources.
  function renderSourcesSection() {
    var SOURCES = [{ id: 'vinax-render', label: 'VinaX Music API (Render)' }, { id: 'local-catalog', label: 'VinaX Catalog (/api/cat, web only)' }, { id: 'sirimilla', label: 'sirimillavinay.online' }];
    cfgEditor({
      sec: 'sources', key: 'catalog-sources', title: 'Catalog sources', saveLabel: 'Publish switches',
      help: 'Switch a catalogue source off for every listener (for example while it is down or rate-limited). The app never runs with zero sources — if all are off, all stay on.',
      form: function (v) { return SOURCES.map(function (s) { var on = !(v && v[s.id] === false); return '<div class="row" style="align-items:center;gap:10px;margin:8px 0"><label class="switch"><input type="checkbox" data-src="' + s.id + '"' + (on ? ' checked' : '') + ' /><span class="track' + (on ? ' on' : '') + '"><span class="knob"></span></span></label><b>' + esc(s.label) + '</b><code class="muted">' + s.id + '</code></div>'; }).join(''); },
      wire: function () { Array.prototype.forEach.call(document.querySelectorAll('[data-src]'), function (c) { c.addEventListener('change', function () { c.nextElementSibling.classList.toggle('on', c.checked); }); }); },
      read: function () { var out = {}; Array.prototype.forEach.call(document.querySelectorAll('[data-src]'), function (c) { out[c.getAttribute('data-src')] = c.checked; }); return out; },
    });
  }
  // 8. Language order.
  function renderLanguageOrderSection() {
    var LANGS = ['telugu', 'hindi', 'tamil', 'english', 'punjabi', 'kannada', 'malayalam', 'bengali', 'marathi', 'bhojpuri', 'gujarati', 'urdu'];
    cfgEditor({
      sec: 'langorder', key: 'language-order', title: 'Language order', clearable: true, empty: [],
      help: 'Default order of the language rail on Home for listeners who have not pinned languages. Drag is not needed — type the order, one language id per line, top first.',
      form: function (v) { return '<textarea id="lo-text" class="inp" rows="8" style="width:100%;font-family:ui-monospace,monospace">' + esc((Array.isArray(v) ? v : []).join('\n')) + '</textarea><p class="muted" style="font-size:11px">Known ids: ' + LANGS.join(', ') + '</p>'; },
      read: function () { var out = []; $('lo-text').value.split('\n').forEach(function (l) { var id = l.trim().toLowerCase(); if (id && LANGS.indexOf(id) >= 0 && out.indexOf(id) < 0) out.push(id); }); return out; },
    });
  }
  // 9. Blocklist import / export.
  function renderBlocklistIoSection() {
    $('view').innerHTML = '<div class="card"><h3 style="margin-top:0">Blocklist import / export</h3><p class="muted">Export the current blocklist as JSON, or import one (<code>[{"songId":"…","title":"…"}]</code>). Import adds; it never removes existing blocks.</p>' +
      '<div class="row" style="gap:8px;flex-wrap:wrap;align-items:center"><button id="bl-export">Download blocklist</button><label class="ghost" style="cursor:pointer;display:inline-flex;align-items:center;padding:6px 12px;border:1px solid var(--border);border-radius:8px">Import JSON<input id="bl-file" type="file" accept="application/json" hidden /></label><span class="muted" id="bl-out" style="font-size:12px"></span></div></div>';
    $('bl-export').addEventListener('click', function () {
      api('/api/admin/content').then(function (d) {
        var list = (d && (d.blocked || d.blocklist || d.items)) || [];
        var blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), blocked: list }, null, 2)], { type: 'application/json' });
        var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'vinax-blocklist-' + new Date().toISOString().slice(0, 10) + '.json'; a.click();
        stampOut('bl-out', list.length + ' entries exported');
      }).catch(function () { stampOut('bl-out', 'Export failed', true); });
    });
    $('bl-file').addEventListener('change', function () {
      var f = this.files && this.files[0]; if (!f) return;
      f.text().then(function (t) {
        var j = JSON.parse(t); var list = Array.isArray(j) ? j : (j.blocked || []);
        var items = list.map(function (x) { return { id: x.songId || x.song_id || x.id, title: x.title || x.song_title || '' }; }).filter(function (x) { return x.id; });
        if (!items.length) { stampOut('bl-out', 'No entries found in that file', true); return; }
        vxConfirm('Block ' + items.length + ' songs for every listener?', { title: 'Import blocklist', okText: 'Block all' }).then(function (ok) {
          if (!ok) return;
          var done = 0, fail = 0;
          (function next(i) {
            if (i >= items.length) { stampOut('bl-out', done + ' blocked' + (fail ? ', ' + fail + ' failed' : '')); return; }
            postApi('/api/admin/content', { action: 'block', songId: items[i].id, songTitle: items[i].title, reason: 'blocklist import' }).then(function (r) { if (r && r.ok) done++; else fail++; next(i + 1); }).catch(function () { fail++; next(i + 1); });
          })(0);
        });
      }).catch(function () { stampOut('bl-out', 'Not valid JSON', true); });
    });
  }

  // ---- AI & Engines ---------------------------------------------------------
  // 10. AI starter prompts.
  function renderAiStartersSection() {
    cfgEditor({
      sec: 'aistarters', key: 'ai-starters', title: 'AI starter prompts', clearable: true, empty: [],
      help: 'Extra starter prompts VinaX AI draws from on a new chat (one per line, max 24). Use <code>{lang}</code> for the listener’s first language — e.g. <code>Suggest 5 {lang} songs for a road trip</code>.',
      form: function (v) { return '<textarea id="st-text" class="inp" rows="10" style="width:100%">' + esc((Array.isArray(v) ? v : []).join('\n')) + '</textarea>'; },
      read: function () { return $('st-text').value.split('\n').map(function (l) { return l.trim().slice(0, 160); }).filter(Boolean).slice(0, 24); },
    });
  }
  // 11. AI quick actions.
  function renderAiQuickSection() {
    cfgEditor({
      sec: 'aiquick', key: 'ai-quick', title: 'AI quick actions', clearable: true, empty: [],
      help: 'The chips on VinaX AI’s welcome screen (max 8). One per line as <code>Label | Prompt text | mode</code>; mode is optional (auto, muse, swift, sage, win, translator). Leave empty to keep the built-in eight.',
      form: function (v) { var lines = (Array.isArray(v) ? v : []).map(function (q) { return [q.label || '', q.prompt || '', q.mode || ''].join(' | '); }); return '<textarea id="qa-text" class="inp" rows="9" style="width:100%">' + esc(lines.join('\n')) + '</textarea>'; },
      read: function () { return $('qa-text').value.split('\n').map(function (l) { var p = l.split('|').map(function (x) { return x.trim(); }); if (p.length < 2 || !p[0] || !p[1]) return null; var o = { label: p[0].slice(0, 20), prompt: p[1].slice(0, 200) + ' ' }; if (p[2]) o.mode = p[2].slice(0, 20); return o; }).filter(Boolean).slice(0, 8); },
    });
  }
  // 12. AI house rules.
  function renderAiRulesSection() {
    cfgEditor({
      sec: 'airules', key: 'ai-rules', title: 'AI house rules', clearable: true, empty: '',
      help: 'Plain-text notes appended to the assistant’s system prompt for every chat (max 1200 characters): a promo to mention when relevant, a correction, a tone note. Never put secrets here. Skipped for the Search expert and translator lanes.',
      form: function (v) { return '<textarea id="hr-text" class="inp" rows="8" style="width:100%" maxlength="1200">' + esc(typeof v === 'string' ? v : '') + '</textarea>'; },
      read: function () { return $('hr-text').value.trim().slice(0, 1200); },
    });
  }

  // ---- Operations -----------------------------------------------------------
  // 13. Cron health.
  function loadCron() {
    apiMemo('/api/admin/cron').then(function (d) {
      if (!d || active !== 'cron') return;
      if (!d.configured) { showFail('Supabase is not configured.'); return; }
      var bad = d.jobs.filter(function (j) { return j.ok === false; }).length;
      $('view').innerHTML =
        '<div class="cards">' + card(d.jobs.length, 'Scheduled jobs') + card(bad, 'Overdue') + card(ago(d.checkedAt), 'Checked') + '</div>' +
        '<div class="card"><h3 style="margin-top:0">Jobs <span class="muted">· each leaves a footprint; overdue = footprint older than its schedule allows</span></h3><table><thead><tr><th>Job</th><th>Schedule</th><th>Last footprint</th><th>Status</th><th>Footprint</th></tr></thead><tbody>' +
        d.jobs.map(function (j) { return '<tr><td><b>' + esc(j.label) + '</b><div class="muted"><code>' + esc(j.id) + '</code></div></td><td class="muted">' + esc(j.schedule) + '</td><td>' + (j.lastAt ? ago(j.lastAt) : '<span class="muted">never</span>') + '</td><td>' + (j.ok === null ? '<span class="pill">unreadable</span>' : okPill(j.ok, j.ok ? 'on time' : 'overdue')) + '</td><td class="muted">' + esc(j.note) + '</td></tr>'; }).join('') + '</tbody></table>' +
        '<p class="muted" style="font-size:11px;margin:10px 0 0">Jobs run from GitHub Actions on a schedule. To run one now: Actions → workflow → Run workflow.</p></div>';
    }).catch(function () { if (active === 'cron') showFail(); });
  }
  // 14. Status history — the public status API, 90 days.
  function loadStatusHistory() {
    fetch(wwwOrigin() + '/api/status', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
      if (active !== 'statushist') return;
      var comps = d.components || [];
      $('view').innerHTML =
        '<div class="cards">' + card(comps.length, 'Monitored components') + card(comps.filter(function (c) { return c.status === 'down'; }).length, 'Down now') + card(esc(d.overall || '—'), 'Overall') + '</div>' +
        '<div class="card"><h3 style="margin-top:0">90-day uptime</h3>' +
        (comps.length ? comps.map(function (c) {
          var days = c.days || [];
          var bars = days.map(function (x) { var up = x.total ? x.up / x.total : (x.ok === false ? 0 : 1); var col = up >= 0.999 ? 'var(--ok)' : up >= 0.98 ? '#f59e0b' : 'var(--danger)'; return '<i title="' + esc(x.day || '') + ' · ' + Math.round(up * 100) + '%" style="display:inline-block;width:6px;height:22px;margin-right:1px;border-radius:2px;background:' + col + ';opacity:' + (x.total ? 1 : 0.3) + '"></i>'; }).join('');
          return '<div style="margin:10px 0"><div class="row" style="align-items:center;gap:8px"><b>' + esc(c.name || c.id) + '</b>' + okPill(c.status === 'up', c.status || 'unknown') + '<span class="muted">' + (c.uptime90 != null ? c.uptime90 + '% over 90 d' : '') + (c.latencyMs != null ? ' \u00b7 ' + c.latencyMs + ' ms' : '') + (c.checkedAt ? ' \u00b7 checked ' + ago(c.checkedAt) : '') + '</span>' + '</div><div style="margin-top:4px;white-space:nowrap;overflow:hidden">' + bars + '</div></div>';
        }).join('') : '<div class="empty">No components reported.</div>') +
        '<p class="muted" style="font-size:11px">Source: the public status endpoint. Ticks come from the status-tick workflow every 30 min.</p></div>';
    }).catch(function () { if (active === 'statushist') showFail('Could not reach /api/status.'); });
  }
  // 15. Environment checklist.
  function loadEnvCheck() {
    apiMemo('/api/admin/envcheck').then(function (d) {
      if (!d || active !== 'envcheck') return;
      var groups = {}; d.items.forEach(function (i) { (groups[i.group] = groups[i.group] || []).push(i); });
      $('view').innerHTML =
        '<div class="cards">' + card(d.items.filter(function (i) { return i.set; }).length + '/' + d.items.length, 'Configured') + card(d.missingRequired.length, 'Required missing') + '</div>' +
        (d.missingRequired.length ? '<div class="card" style="border-color:var(--danger)"><b>Missing required:</b> ' + d.missingRequired.map(function (n) { return '<code>' + esc(n) + '</code>'; }).join(' ') + '</div>' : '') +
        Object.keys(groups).map(function (g) { return '<div class="card"><h3 style="margin-top:0">' + esc(g) + '</h3><table><tbody>' + groups[g].map(function (i) { return '<tr><td><code>' + esc(i.name) + '</code></td><td>' + okPill(i.set, i.set ? 'set' : (i.required ? 'missing' : 'not set')) + '</td><td class="muted">' + esc(i.note) + (i.required ? ' · required' : '') + '</td></tr>'; }).join('') + '</tbody></table></div>'; }).join('') +
        '<p class="muted" style="font-size:11px">Names only — values never leave the Worker. Set with <code>wrangler secret put NAME</code>.</p>';
    }).catch(function () { if (active === 'envcheck') showFail(); });
  }
  // 15b. Operations center — one glance across the signals an operator needs
  // before shipping a change or responding to an incident.
  function loadOpsCenter() {
    Promise.all([
      api('/api/admin/cron').catch(function () { return null; }),
      api('/api/admin/envcheck').catch(function () { return null; }),
      api('/api/status').catch(function () { return null; })
    ]).then(function (all) {
      if (active !== 'opscenter') return;
      var cron = all[0] || {}, env = all[1] || {}, status = all[2] || {};
      var jobs = Array.isArray(cron.jobs) ? cron.jobs : [];
      var components = Array.isArray(status.components) ? status.components : [];
      var overdue = jobs.filter(function (j) { return j.ok === false; }).length;
      var down = components.filter(function (c) { return c.status === 'down'; }).length;
      var missing = Array.isArray(env.missingRequired) ? env.missingRequired.length : 0;
      var overall = down ? 'Action needed' : overdue || missing ? 'Watch closely' : (status.overall || 'Operational');
      var overallOk = !down && !overdue && !missing;
      $('view').innerHTML =
        '<div class="ops-center-hero"><div><span class="ops-eyebrow">VINAX / OPERATIONS CENTER</span><h2>' + esc(overall) + '</h2><p class="muted">Service health, scheduled work and release readiness.</p></div><button class="ghost" id="ops-refresh">Refresh signals</button></div>' +
        '<div class="cards ops-center-cards">' + card(components.length ? components.length - down + '/' + components.length : '—', 'Services healthy') + card(overdue, 'Overdue jobs') + card(missing, 'Required secrets missing') + card(overallOk ? 'Ready' : 'Review', 'Release posture') + '</div>' +
        '<div class="ops-center-grid"><div class="card"><div class="row"><h3 style="margin-top:0">Service pulse</h3><span class="spacer"></span><span class="muted">' + (status.generatedAt ? 'checked ' + ago(status.generatedAt) : 'no timestamp') + '</span></div>' + (components.length ? components.map(function (c) { return '<div class="ops-signal"><span class="ops-signal-dot ' + (c.status === 'up' ? 'ok' : 'bad') + '"></span><b>' + esc(c.name || c.id) + '</b><span class="spacer"></span>' + okPill(c.status === 'up', c.status || 'unknown') + (c.latencyMs != null ? '<span class="muted">' + c.latencyMs + ' ms</span>' : '') + '</div>'; }).join('') : '<div class="empty">Status endpoint returned no components.</div>') + '</div>' +
        '<div class="card"><div class="row"><h3 style="margin-top:0">Scheduled work</h3><span class="spacer"></span><a class="ghost" href="#cron">Open cron health</a></div>' + (jobs.length ? jobs.map(function (j) { return '<div class="ops-signal"><span class="ops-signal-dot ' + (j.ok === false ? 'bad' : 'ok') + '"></span><b>' + esc(j.label || j.id) + '</b><span class="spacer"></span>' + okPill(j.ok !== false, j.ok === false ? 'overdue' : 'on time') + '<span class="muted">' + (j.lastAt ? ago(j.lastAt) : 'never') + '</span></div>'; }).join('') : '<div class="empty">No schedule telemetry yet.</div>') + '</div></div>' +
        '<div class="card"><div class="row"><h3 style="margin-top:0">Preflight shortcuts</h3><span class="spacer"></span><span class="muted">safe links — no changes are made</span></div><div class="ops-shortcuts"><a href="#envcheck"><b>Environment checklist</b><span>' + (missing ? missing + ' required item' + (missing === 1 ? '' : 's') + ' to resolve' : 'All required names present') + '</span></a><a href="#statushist"><b>Status history</b><span>Review the 90-day reliability trail</span></a><a href="#releases"><b>Releases &amp; CI</b><span>Inspect the latest build and workflow</span></a><a href="#audit"><b>Audit trail</b><span>See who changed configuration</span></a></div></div>';
      $('ops-refresh').addEventListener('click', loadOpsCenter);
      stamp();
    });
  }
  // 15c. Audience segments — turn the existing insights payload into clear
  // operator audiences without exposing individual listener identities.
  var audienceSegment = 'all';
  function loadAudienceSegments() {
    apiMemo('/api/admin/insights?days=' + rangeDays).then(function (d) {
      if (!d || active !== 'segments') return;
      renderAudienceSegments(d);
    }).catch(function () { if (active === 'segments') showFail(); });
  }
  function renderAudienceSegments(d) {
    // Reuse the same loader path after a filter click; memoized data keeps this
    // interaction local and avoids another Worker request.
    var s = d.segments || {}, labels = { all: 'All listeners', new: 'New this week', returning: 'Returning listeners', power: 'Power listeners', inactive: 'At risk' };
    var values = { all: s.total || s.listeners || d.sampled || 0, new: s.new_7d || s.new || s.newUsers || 0, returning: s.returning_7d || s.returning || 0, power: s.power_users || s.power || 0, inactive: s.inactive_30d || s.inactive || 0 };
    var top = Array.isArray(d.topListeners) ? d.topListeners : [], shown = audienceSegment === 'all' ? top : top.slice(0, Math.max(1, Math.round(top.length / 2)));
    setExport('audience-segments', shown);
    $('view').innerHTML = '<div class="ops-center-hero"><div><span class="ops-eyebrow">VINAX / AUDIENCE STUDIO</span><h2>Know who to design for next</h2><p class="muted">Useful cohorts for programming, messaging and retention work. Counts are aggregate and anonymous.</p></div><span class="pill">Last ' + rangeDays + ' days</span></div><div class="seg" id="aud-segs">' + Object.keys(labels).map(function (k) { return '<button data-audseg="' + k + '"' + (k === audienceSegment ? ' class="active"' : '') + '>' + labels[k] + '</button>'; }).join('') + '</div><div class="cards segment-cards">' + Object.keys(labels).filter(function (k) { return k !== 'all'; }).map(function (k) { return card(Number(values[k] || 0).toLocaleString(), labels[k]); }).join('') + '</div><div class="card"><div class="row"><h3 style="margin-top:0">' + esc(labels[audienceSegment]) + '</h3><span class="spacer"></span><button class="ghost" id="aud-export">Export visible</button></div>' + (shown.length ? '<table><thead><tr><th>Listener</th><th>Platform</th><th>Plays</th><th>Last active</th></tr></thead><tbody>' + shown.map(function (u) { return '<tr><td>' + esc(u.name || u.user_name || 'Anonymous') + '</td><td>' + platIcon(u.platform) + ' ' + esc(u.platform || 'web') + '</td><td>' + Number(u.plays || u.play_count || 0).toLocaleString() + '</td><td class="muted">' + (u.last_seen ? ago(u.last_seen) : '—') + '</td></tr>'; }).join('') + '</tbody></table>' : '<div class="empty">No listener rows in this cohort yet.</div>') + '</div>';
    Array.prototype.forEach.call(document.querySelectorAll('[data-audseg]'), function (b) { b.addEventListener('click', function () { audienceSegment = b.getAttribute('data-audseg'); renderAudienceSegments(d); }); });
    $('aud-export').addEventListener('click', downloadCsv); stamp();
  }
  // 16. Query console.
  function renderQuerySection() {
    var TABLES = ['vinax_events', 'vinax_ai_events', 'vinax_feedback', 'vinax_users', 'vinax_rooms', 'vinax_experiments', 'vinax_blocklist', 'vinax_config', 'vinax_seo_urls'];
    $('view').innerHTML = '<div class="card"><h3 style="margin-top:0">Query console <span class="muted">· read-only, whitelisted columns, newest first</span></h3>' +
      '<div class="row" style="gap:8px;flex-wrap:wrap;align-items:center"><select id="qc-table" class="inp">' + TABLES.map(function (t) { return '<option>' + t + '</option>'; }).join('') + '</select>' +
      '<select id="qc-hours" class="inp"><option value="1">1 h</option><option value="24" selected>24 h</option><option value="168">7 d</option><option value="720">30 d</option><option value="2160">90 d</option></select>' +
      inp('qc-col', '', 'column (optional)', 'style="width:150px"') + inp('qc-val', '', 'equals value', 'style="width:180px"') +
      '<select id="qc-limit" class="inp"><option>50</option><option selected>200</option><option>500</option></select><button id="qc-run">Run</button><span class="muted" id="qc-out" style="font-size:12px"></span></div></div><div id="qc-rows"></div>';
    function run() {
      var p = new URLSearchParams({ table: $('qc-table').value, hours: $('qc-hours').value, limit: $('qc-limit').value });
      if ($('qc-col').value.trim()) { p.set('col', $('qc-col').value.trim()); p.set('val', $('qc-val').value.trim()); }
      $('qc-rows').innerHTML = '<div class="empty">Running…</div>';
      fetch('/api/admin/query?' + p.toString(), { headers: { 'x-admin-token': sessionStorage.getItem(TOKEN_KEY) || '' }, cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
        if (d.error) { $('qc-rows').innerHTML = '<div class="empty">' + esc(d.error) + '</div>'; return; }
        exportRows = d.rows; exportName = d.table; $('csv').hidden = !d.rows.length;
        stampOut('qc-out', d.rows.length + ' rows' + (d.truncated ? ' (truncated — narrow the filter)' : ''));
        $('qc-rows').innerHTML = '<div class="card" style="overflow:auto"><table><thead><tr>' + d.columns.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
          (d.rows.length ? d.rows.map(function (r) { return '<tr>' + d.columns.map(function (c) { var v = r[c]; var t = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); return '<td title="' + esc(t) + '" style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(t.slice(0, 140)) + '</td>'; }).join('') + '</tr>'; }).join('') : '<tr><td colspan="' + d.columns.length + '" class="empty">No rows.</td></tr>') + '</tbody></table></div>';
      }).catch(function () { $('qc-rows').innerHTML = '<div class="empty">Query failed.</div>'; });
    }
    $('qc-run').addEventListener('click', run);
    $('qc-val').addEventListener('keydown', function (e) { if (e.key === 'Enter') run(); });
  }
  // 17. Release notes — the app's own update cards.
  function loadReleaseNotes() {
    fetch(wwwOrigin() + '/changelog.json', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
      if (active !== 'relnotes') return;
      var rel = d.releases || [];
      $('view').innerHTML = '<div class="cards">' + card(rel.length, 'Releases with cards') + card(rel[0] ? 'v' + rel[0].version : '—', 'Latest') + card(d.generatedAt ? ago(d.generatedAt) : '—', 'Built') + '</div>' +
        rel.slice(0, 40).map(function (r) { return '<div class="card"><h3 style="margin:0 0 6px">v' + esc(r.version) + (r.title ? ' <span class="muted">· ' + esc(r.title) + '</span>' : '') + '</h3><ul style="margin:0;padding-left:18px">' + r.changes.map(function (c) { return '<li style="margin:4px 0"><span class="pill">' + esc(c.type) + '</span> ' + esc(c.text) + '</li>'; }).join('') + '</ul></div>'; }).join('');
    }).catch(function () { if (active === 'relnotes') showFail('changelog.json is not on the live site yet (ships with the next build).'); });
  }
  // 18. Maintenance scheduler.
  function renderMaintWindowSection() {
    cfgEditor({
      sec: 'maintwin', key: 'maintenance-window', title: 'Maintenance scheduler', clearable: true, empty: null, saveLabel: 'Schedule',
      help: 'Pick a window and the site switches itself to maintenance mode at the start and back to live at the end — no one has to be awake. Listeners see the note. Times are in your local zone.',
      form: function (v) { v = v || {}; return lbl('Starts', inp('mw-start', isoLocal(v.start), '', 'type="datetime-local"')) + lbl('Ends', inp('mw-end', isoLocal(v.end), '', 'type="datetime-local"')) + lbl('Note shown to listeners', inp('mw-note', v.note || '', 'Back in 30 minutes — upgrading the database', 'maxlength="200" style="width:100%"')); },
      read: function () { var s = fromLocal($('mw-start').value), e = fromLocal($('mw-end').value); if (!s || !e) throw new Error('Both start and end are required'); if (Date.parse(e) <= Date.parse(s)) throw new Error('End must be after start'); return { start: s, end: e, note: $('mw-note').value.trim().slice(0, 200) }; },
      after: function (v) { if (!v || !v.start) return ''; var now = Date.now(), s = Date.parse(v.start), e = Date.parse(v.end); var state = now < s ? 'scheduled · starts ' + new Date(s).toLocaleString() : now <= e ? 'ACTIVE now · ends ' + new Date(e).toLocaleString() : 'finished ' + new Date(e).toLocaleString(); return '<div class="card"><b>Current window:</b> ' + esc(state) + '</div>'; },
    });
  }
  // 19. Minimum app version.
  function renderMinVersionSection() {
    cfgEditor({
      sec: 'minver', key: 'min-version', title: 'Minimum app version', clearable: true, empty: null, saveLabel: 'Publish minimum',
      help: 'Android builds below this build number lose the “Update later” button and must update to keep using the app. Use it only for security fixes or breaking API changes. The build number is the versionCode on the release (see Releases &amp; CI).',
      form: function (v) { return lbl('Minimum build number', inp('mv-build', v && v.build ? v.build : '', 'e.g. 5140', 'type="number" min="1" style="width:200px"')) + lbl('Reason (for the audit trail)', inp('mv-reason', v && v.reason ? v.reason : '', 'why listeners must update', 'style="width:100%" maxlength="160"')); },
      read: function () { var b = parseInt($('mv-build').value, 10); if (!(b > 0)) throw new Error('Enter a build number'); return { build: b, reason: $('mv-reason').value.trim().slice(0, 160), setAt: new Date().toISOString() }; },
    });
  }

  // ---- Promotion --------------------------------------------------------------
  // 20. Broadcast message.
  function renderBroadcastSection() {
    cfgEditor({
      sec: 'broadcast', key: 'broadcast', title: 'Broadcast message', clearable: true, empty: null, saveLabel: 'Send to everyone',
      help: 'A one-time toast every listener sees the next time the app is open (each broadcast id shows once per device). Optional in-app link (a path like <code>/later</code>). Optional window. Tick “Also push” to reach closed apps and subscribed browsers through notifications.',
      form: function (v) { v = v || {}; return '<div class="broadcast-composer"><div>' + lbl('Message', inp('bc-text', v.text || '', 'New: Listen Later — save songs for later from any menu', 'style="width:100%" maxlength="240"')) + lbl('Link (optional, in-app path)', inp('bc-link', v.link || '', '/later', 'style="width:280px"')) + '<label style="display:flex;align-items:center;gap:8px;margin-top:10px;font-size:13px"><input type="checkbox" id="bc-push" /> Also push as a notification (closed apps + browsers)</label>' + '<div class="row" style="gap:12px;flex-wrap:wrap"><div>' + lbl('From (optional)', inp('bc-start', isoLocal(v.start), '', 'type="datetime-local"')) + '</div><div>' + lbl('Until (optional)', inp('bc-end', isoLocal(v.end), '', 'type="datetime-local"')) + '</div></div></div><div class="broadcast-preview" aria-label="Broadcast preview"><span class="ops-eyebrow">LISTENER PREVIEW</span><div class="broadcast-device"><div class="broadcast-device-top">VinaX <span>now</span></div><strong id="bc-preview-text">' + esc(v.text || 'Your message will appear here') + '</strong><span id="bc-preview-link" class="muted">' + esc(v.link || 'No link') + '</span></div><p class="muted" style="font-size:11px">Preview updates as you type. Publishing remains a separate action.</p></div></div>'; },
      read: function () { var t = $('bc-text').value.trim(); if (!t) throw new Error('Message is required'); var o = { id: 'b' + Date.now().toString(36), text: t.slice(0, 240) }; var l = $('bc-link').value.trim(); if (l) { if (l.charAt(0) !== '/') throw new Error('Link must be an in-app path starting with /'); o.link = l.slice(0, 200); } var s = fromLocal($('bc-start').value), e = fromLocal($('bc-end').value); if (s) o.start = s; if (e) o.end = e; return o; },
      after: function (v) { return v && v.text ? '<div class="card"><b>Live broadcast:</b> “' + esc(v.text) + '” <span class="muted">· id ' + esc(v.id || '') + '</span></div>' : ''; },
      wire: function () {
        function paint() { var t = $('bc-preview-text'), l = $('bc-preview-link'); if (t) t.textContent = $('bc-text').value.trim() || 'Your message will appear here'; if (l) l.textContent = $('bc-link').value.trim() || 'No link'; }
        ['bc-text', 'bc-link'].forEach(function (id) { var el = $(id); if (el) el.addEventListener('input', paint); });
        paint();
      },
      // v5.19.0 — optional push through the same composer path the Notifications tool uses.
      onSaved: function (v) {
        var cb = $('bc-push'); if (!cb || !cb.checked) return;
        postApi('/api/admin/push', { title: 'VinaX', body: v.text, link: v.link || '/' }).then(function (r) {
          stampOut('broadcast-out', r && (r.ok || r.sent != null) ? 'Published ✓ · pushed to ' + (r.sent != null ? r.sent + ' devices' : 'subscribers') : 'Published ✓ · push failed' + (r && r.error ? ' — ' + r.error : ''), !(r && (r.ok || r.sent != null)));
        }).catch(function () { stampOut('broadcast-out', 'Published ✓ · push failed — network', true); });
      },
    });
  }
  // 21. Home greeting.
  function renderGreetingSection() {
    cfgEditor({
      sec: 'greeting', key: 'greeting', title: 'Home greeting line', clearable: true, empty: null,
      help: 'Replaces the line under the Home headline for everyone while the window is open (e.g. “Festival week — new Diwali mixes every day”). Outside the window the app’s own personal message returns.',
      form: function (v) { v = v || {}; return lbl('Line', inp('gr-text', v.text || '', 'Festival week — new mixes every day', 'style="width:100%" maxlength="160"')) + '<div class="row" style="gap:12px;flex-wrap:wrap"><div>' + lbl('From (optional)', inp('gr-start', isoLocal(v.start), '', 'type="datetime-local"')) + '</div><div>' + lbl('Until (optional)', inp('gr-end', isoLocal(v.end), '', 'type="datetime-local"')) + '</div></div>'; },
      read: function () { var t = $('gr-text').value.trim(); if (!t) throw new Error('Line is required'); var o = { text: t.slice(0, 160) }; var s = fromLocal($('gr-start').value), e = fromLocal($('gr-end').value); if (s) o.start = s; if (e) o.end = e; return o; },
    });
  }
  // 22. Help center FAQ.
  function renderFaqSection() {
    cfgEditor({
      sec: 'faq', key: 'support-faq', title: 'Help center FAQ', clearable: true, empty: [],
      help: 'Questions shown at the top of Help &amp; Feedback (max 30). Blocks separated by a blank line: first line the question, the rest the answer.',
      form: function (v) { var t = (Array.isArray(v) ? v : []).map(function (x) { return x.q + '\n' + x.a; }).join('\n\n'); return '<textarea id="faq-text" class="inp" rows="14" style="width:100%">' + esc(t) + '</textarea>'; },
      read: function () { return $('faq-text').value.split(/\n\s*\n/).map(function (b) { var lines = b.trim().split('\n'); var q = (lines.shift() || '').trim().slice(0, 160); var a = lines.join('\n').trim().slice(0, 1200); return q && a ? { q: q, a: a } : null; }).filter(Boolean).slice(0, 30); },
    });
  }
  // 23. Announcement composer (in-app announcement rows, picked up on open).
  function renderAnnounceSection() {
    $('view').innerHTML = '<div class="card"><h3 style="margin-top:0">Announcement composer</h3><p class="muted">An in-app announcement listeners pick up the next time they open the app (native shows it as a local notification; web shows it in the app). Retract from Notifications → Sent log.</p>' +
      lbl('Title', inp('an-title', '', 'Big update: 43 festival themes', 'style="width:100%" maxlength="80"')) + lbl('Body', '<textarea id="an-body" class="inp" rows="4" style="width:100%" maxlength="300" placeholder="What changed and why it matters"></textarea>') + lbl('Link (optional in-app path)', inp('an-link', '', '/settings', 'style="width:280px"')) +
      '<div class="row" style="gap:8px;align-items:center;margin-top:12px"><button id="an-send">Publish announcement</button><span class="muted" id="an-out" style="font-size:12px"></span></div></div>';
    $('an-send').addEventListener('click', function () {
      var title = $('an-title').value.trim(), body = $('an-body').value.trim(), link = $('an-link').value.trim();
      if (!title || !body) { stampOut('an-out', 'Title and body are required', true); return; }
      vxConfirm('Publish this announcement to every listener?', { title: 'Announcement', okText: 'Publish' }).then(function (ok) {
        if (!ok) return;
        postApi('/api/admin/push', { title: title, body: body, link: link || '/' }).then(function (r) {
          if (r && (r.ok || r.sent != null)) { stampOut('an-out', 'Published ✓'); $('an-title').value = ''; $('an-body').value = ''; }
          else stampOut('an-out', 'Failed' + (r && r.error ? ' — ' + r.error : ''), true);
        }).catch(function () { stampOut('an-out', 'Failed — network', true); });
      });
    });
  }

  // ---- Settings ---------------------------------------------------------------
  // 24. Pinned tools — the operator's own shortlist at the top of the nav.
  var PINS_KEY = 'vinax_admin_pins';
  function getPins() { try { return JSON.parse(localStorage.getItem(PINS_KEY) || '[]'); } catch (e) { return []; } }
  function applyPins() {
    var pins = getPins();
    var host = document.getElementById('nav-pins');
    if (!host) { host = document.createElement('div'); host.id = 'nav-pins'; var nav = document.getElementById('nav'); var first = nav.querySelector('.nav-group-label'); nav.insertBefore(host, first); }
    host.innerHTML = pins.length ? '<div class="nav-group-label" style="cursor:default">Pinned <span class="ng-n">' + pins.length + '</span></div>' + pins.map(function (p) { return '<button data-sec="' + esc(p) + '" data-pin="1">★ ' + esc(TITLES[p] || p) + '</button>'; }).join('') : '';
    Array.prototype.forEach.call(host.querySelectorAll('button[data-sec]'), function (b) { b.addEventListener('click', function () { setSection(b.getAttribute('data-sec')); }); });
  }
  function renderPinsSection() {
    var pins = getPins();
    var all = Object.keys(TITLES).sort(function (a, b) { return TITLES[a].localeCompare(TITLES[b]); });
    $('view').innerHTML = '<div class="card"><h3 style="margin-top:0">Pinned tools</h3><p class="muted">Pin the panels you open most; they appear at the top of the sidebar on this browser. Keyboard: ⌘K searches every tool.</p><div class="chips">' +
      all.map(function (s) { var on = pins.indexOf(s) >= 0; return '<button class="' + (on ? '' : 'ghost') + '" data-pintoggle="' + esc(s) + '" style="margin:3px">' + (on ? '★ ' : '') + esc(TITLES[s]) + '</button>'; }).join('') + '</div></div>';
    Array.prototype.forEach.call(document.querySelectorAll('[data-pintoggle]'), function (b) {
      b.addEventListener('click', function () { var s = b.getAttribute('data-pintoggle'); var p = getPins(); var i = p.indexOf(s); if (i >= 0) p.splice(i, 1); else if (p.length < 8) p.push(s); localStorage.setItem(PINS_KEY, JSON.stringify(p)); applyPins(); renderPinsSection(); });
    });
  }
  setTimeout(function () { try { applyPins(); } catch (e) { /* nav not ready */ } }, 0);

  // v5.19.0 — AI tokens & cost (needs the tokens migration; prices come from
  // the 'ai-prices' config key — never invented here).
  function loadAiCost() {
    apiMemo('/api/admin/aicost?days=' + rangeDays).then(function (d) {
      if (!d || active !== 'aicost') return;
      if (!d.configured) { showFail('Supabase is not configured.'); return; }
      var tt = d.tokensTotal || { prompt: 0, completion: 0 };
      var cost = (d.byModel || []).reduce(function (a, m) { return a + (m.cost || 0); }, 0);
      exportRows = d.byModel || []; exportName = 'ai-cost'; $('csv').hidden = !exportRows.length;
      $('view').innerHTML =
        '<div class="cards">' + card(fmtN(tt.prompt), 'Prompt tokens · ' + d.days + ' d') + card(fmtN(tt.completion), 'Completion tokens') + card(d.unpriced ? '—' : '$' + cost.toFixed(2), d.unpriced ? 'Cost · set prices below' : 'Estimated cost') + card((d.sampled || 0).toLocaleString(), 'Calls counted') + '</div>' +
        (tt.prompt + tt.completion === 0 ? '<div class="card" style="border-color:var(--warn)"><b>No token counts yet.</b> <span class="muted">Apply the tokens migration (frontend/supabase/migrations) and new calls start logging usage.</span></div>' : '') +
        '<div class="row" style="gap:14px;align-items:flex-start;flex-wrap:wrap"><div class="card" style="flex:2;min-width:320px"><h3 style="margin-top:0">By model</h3><table><thead><tr><th>Model</th><th>Calls</th><th>Prompt</th><th>Completion</th><th>Cost</th></tr></thead><tbody>' +
        ((d.byModel || []).length ? d.byModel.map(function (m) { return '<tr><td><code>' + esc(m.model) + '</code></td><td>' + fmtN(m.calls) + '</td><td>' + fmtN(m.prompt) + '</td><td>' + fmtN(m.completion) + '</td><td>' + (m.cost == null ? '<span class="muted">unpriced</span>' : '$' + m.cost.toFixed(3)) + '</td></tr>'; }).join('') : '<tr><td colspan="5" class="empty">Nothing logged in this window.</td></tr>') + '</tbody></table></div>' +
        '<div class="card" style="flex:1;min-width:260px"><h3 style="margin-top:0">Tokens per day</h3>' + dayChart((d.byDay || []).map(function (x) { return { day: x.day, n: (x.prompt || 0) + (x.completion || 0) }; }), 'n') + '</div></div>' +
        '<div id="aiprices-host"></div>';
      renderAiPricesEditor();
    }).catch(function () { if (active === 'aicost') showFail(); });
  }
  function renderAiPricesEditor() {
    var host = $('aiprices-host'); if (!host) return;
    cfgGet('ai-prices').then(function (d) {
      if (active !== 'aicost') return;
      var v = d && d.configured && d.value && typeof d.value === 'object' ? d.value : {};
      var lines = Object.keys(v).map(function (k) { return k + ' = ' + (v[k].in != null ? v[k].in : 0) + ' / ' + (v[k].out != null ? v[k].out : 0); });
      host.innerHTML = '<div class="card"><h3 style="margin-top:0">Prices <span class="muted">· USD per 1M tokens, one per line as <code>model-prefix = in / out</code></span></h3><textarea id="aip-text" class="inp" rows="6" style="width:100%;font-family:ui-monospace,monospace">' + esc(lines.join('\n')) + '</textarea><div class="row" style="gap:8px;align-items:center;margin-top:10px"><button id="aip-save">Publish prices</button><span class="muted" id="aip-out" style="font-size:12px">Longest prefix wins. Leave empty to show tokens only.</span></div></div>';
      $('aip-save').addEventListener('click', function () {
        var out = {};
        $('aip-text').value.split('\n').forEach(function (l) { var m = /^\s*([^=]+?)\s*=\s*([0-9.]+)\s*\/\s*([0-9.]+)\s*$/.exec(l); if (m) out[m[1]] = { in: parseFloat(m[2]), out: parseFloat(m[3]) }; });
        cfgSet('ai-prices', out).then(function (r) { stampOut('aip-out', r && r.ok ? 'Published ✓' : 'Publish failed', !(r && r.ok)); if (r && r.ok) { memoReset(); loadAiCost(); } }).catch(function () { stampOut('aip-out', 'Publish failed — network', true); });
      });
    }).catch(noop);
  }
  function fmtN(n) { n = Number(n) || 0; return n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n); }

  var TITLES = { workspace: 'Operations Workspace', overview: 'Overview', live: 'Live Listening', activity: 'Activity Feed', location: 'Location Analytics', world: 'World Listening', music: 'Music Analytics', insights: 'Insights', experiments: 'A/B Experiments', users: 'User Management', technical: 'Technical Monitoring', feedback: 'Feedback & Bug Reports', ai: 'AI Monitoring', rooms: 'Live Rooms', realtime: 'Real-Time', search: 'Search Analytics', engagement: 'Engagement', notify2: 'Notifications', content: 'Content Control', ailab: 'API Monitoring', songs: 'Song Management', playlists: 'Playlist Management', homescreen: 'Home Screen Management', categories: 'Categories & Genres', banners: 'Banner & Promotion', festivals: 'Festival Themes', config: 'App Configuration', retention: 'Retention Cohorts', dataquality: 'Data Quality', catalog: 'Catalog Lookup', engineprobe: 'Engine Probe', seo: 'SEO Corpus', edge: 'Edge & Endpoint Health', releases: 'Releases & CI', tables: 'Database Overview', audit: 'Audit Trail', flags: 'Feature Flags', runbook: 'Runbook', backup: 'Config Backup', trendpins: 'Trending Pins', statusnote: 'Status Note', usage: 'Feature Usage', heatmap: 'Listening Heatmap', funnel: 'Onboarding Funnel', segments: 'Audience Segments', songstats: 'Song Drilldown', skips: 'Skip Report', synonyms: 'Search Synonyms', sources: 'Catalog Sources', langorder: 'Language Order', blocklistio: 'Blocklist Import/Export', aistarters: 'AI Starter Prompts', aiquick: 'AI Quick Actions', airules: 'AI House Rules', cron: 'Cron Health', opscenter: 'Operations Center', statushist: 'Status History', envcheck: 'Environment Checklist', query: 'Query Console', relnotes: 'Release Notes', maintwin: 'Maintenance Scheduler', minver: 'Minimum App Version', broadcast: 'Broadcast Message', greeting: 'Home Greeting', faq: 'Help Center FAQ', announce: 'Announcement Composer', pins: 'Pinned Tools', aicost: 'AI Tokens & Cost' };
  var USES_RANGE = { workspace: true, location: true, world: true, music: true, technical: true, insights: true, ai: true, search: true, engagement: true, usage: true, heatmap: true, funnel: true, songstats: true, skips: true, aicost: true };
  // v5.7.5 — formal category reorganisation: which category each tool sits
  // under (drives the breadcrumb over the tool title) + collapsible category
  // headers whose open/closed state persists per browser.
  var CATS = { workspace: 'Dashboards', overview: 'Dashboards', realtime: 'Dashboards', live: 'Audience', activity: 'Audience', engagement: 'Audience', users: 'Audience', segments: 'Audience', songs: 'Catalog', playlists: 'Catalog', homescreen: 'Catalog', categories: 'Catalog', content: 'Catalog', banners: 'Promotion', festivals: 'Promotion', notify2: 'Promotion', music: 'Analytics', search: 'Analytics', location: 'Analytics', world: 'Analytics', insights: 'Analytics', experiments: 'Analytics', ai: 'AI & Engines', ailab: 'AI & Engines', technical: 'Operations', feedback: 'Operations', rooms: 'Operations', opscenter: 'Operations', config: 'Settings', retention: 'Audience', dataquality: 'Operations', catalog: 'Catalog', engineprobe: 'AI & Engines', seo: 'Analytics', edge: 'Operations', releases: 'Operations', tables: 'Operations', audit: 'Operations', flags: 'Settings', runbook: 'Settings', backup: 'Settings', trendpins: 'Catalog', statusnote: 'Operations', usage: 'Audience', heatmap: 'Audience', funnel: 'Audience', songstats: 'Catalog', skips: 'Catalog', synonyms: 'Catalog', sources: 'Catalog', langorder: 'Catalog', blocklistio: 'Catalog', aistarters: 'AI & Engines', aiquick: 'AI & Engines', airules: 'AI & Engines', cron: 'Operations', statushist: 'Operations', envcheck: 'Operations', query: 'Operations', relnotes: 'Operations', maintwin: 'Operations', minver: 'Operations', broadcast: 'Promotion', greeting: 'Promotion', faq: 'Promotion', announce: 'Promotion', pins: 'Settings', aicost: 'AI & Engines' };
  var densityButton = $('density');
  if (densityButton) {
    var compact = false;
    try { compact = localStorage.getItem('vinax.admin.compact') === '1'; } catch (e) {}
    function applyDensity() {
      document.body.classList.toggle('astra-compact', compact);
      densityButton.setAttribute('aria-pressed', String(compact));
      densityButton.textContent = compact ? 'Comfortable' : 'Compact';
    }
    applyDensity();
    densityButton.addEventListener('click', function () {
      compact = !compact;
      applyDensity();
      try { localStorage.setItem('vinax.admin.compact', compact ? '1' : '0'); } catch (e) {}
    });
  }
  var GRP_KEY = 'vinax_admin_navgroups';
  function closedGroups() { try { var v = JSON.parse(localStorage.getItem(GRP_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
  function applyNavGroups() {
    var closed = closedGroups();
    Array.prototype.forEach.call(document.querySelectorAll('#nav .nav-group-label'), function (g) {
      var off = closed.indexOf(g.getAttribute('data-group')) >= 0;
      g.classList.toggle('closed', off);
      g.setAttribute('aria-expanded', off ? 'false' : 'true');
    });
    Array.prototype.forEach.call(document.querySelectorAll('#nav button[data-sec]'), function (b) {
      var off = closed.indexOf(b.getAttribute('data-cat')) >= 0;
      // The active tool stays visible even inside a collapsed category, so
      // the sidebar always shows where you are.
      b.classList.toggle('grp-hidden', off && !b.classList.contains('active'));
    });
  }
  function toggleNavGroup(name) {
    var closed = closedGroups();
    var i = closed.indexOf(name);
    if (i >= 0) closed.splice(i, 1); else closed.push(name);
    try { localStorage.setItem(GRP_KEY, JSON.stringify(closed)); } catch (e) {}
    applyNavGroups();
  }
  function refreshActive() {
    if (active === 'workspace') window.VinaXWorkspace.mount({ api: api, days: function () { return rangeDays; }, navigate: setSection, isActive: function () { return active === 'workspace'; } });
    else if (active === 'overview') loadOverview();
    else if (active === 'live') loadLive();
    else if (active === 'activity') loadActivity();
    else if (active === 'location') loadLocation();
    else if (active === 'world') loadWorld();
    else if (active === 'music') loadMusic();
    else if (active === 'insights') loadInsights();
    else if (active === 'experiments') loadExperiments();
    else if (active === 'users') loadUsers();
    else if (active === 'technical') loadTechnical();
    else if (active === 'feedback') loadFeedback();
    else if (active === 'ai') loadAi();
    else if (active === 'rooms') loadRooms();
    else if (active === 'realtime') loadRealtime();
    else if (active === 'search') loadSearchA();
    else if (active === 'engagement') loadEngagement();
    else if (active === 'notify2') loadNotify();
    else if (active === 'content') loadContent();
    else if (active === 'ailab') loadAiLab();
    else if (active === 'songs') renderSongsSection();
    else if (active === 'playlists') renderPlaylistsSection();
    else if (active === 'homescreen') renderHomescreenSection();
    else if (active === 'categories') renderCategoriesSection();
    else if (active === 'banners') renderBannersSection();
    else if (active === 'festivals') renderFestivalsSection();
    else if (active === 'config') renderConfigSection();
    else if (active === 'retention') loadRetention();
    else if (active === 'dataquality') loadDataQuality();
    else if (active === 'catalog') renderCatalogSection();
    else if (active === 'engineprobe') renderEngineProbeSection();
    else if (active === 'seo') loadSeo();
    else if (active === 'edge') loadEdge();
    else if (active === 'releases') loadReleases();
    else if (active === 'tables') loadTables();
    else if (active === 'audit') loadAuditTrail();
    else if (active === 'flags') renderFlagsSection();
    else if (active === 'runbook') renderRunbookSection();
    else if (active === 'backup') renderBackupSection();
    else if (active === 'trendpins') renderTrendingPinsSection();
    else if (active === 'statusnote') renderStatusNoteSection();
    else if (active === 'usage') loadUsage();
    else if (active === 'heatmap') loadHeatmap();
    else if (active === 'funnel') loadFunnel();
    else if (active === 'segments') loadAudienceSegments();
    else if (active === 'songstats') renderSongStatsSection();
    else if (active === 'skips') loadSkips();
    else if (active === 'synonyms') renderSynonymsSection();
    else if (active === 'sources') renderSourcesSection();
    else if (active === 'langorder') renderLanguageOrderSection();
    else if (active === 'blocklistio') renderBlocklistIoSection();
    else if (active === 'aistarters') renderAiStartersSection();
    else if (active === 'aiquick') renderAiQuickSection();
    else if (active === 'airules') renderAiRulesSection();
    else if (active === 'cron') loadCron();
    else if (active === 'opscenter') loadOpsCenter();
    else if (active === 'statushist') loadStatusHistory();
    else if (active === 'envcheck') loadEnvCheck();
    else if (active === 'query') renderQuerySection();
    else if (active === 'relnotes') loadReleaseNotes();
    else if (active === 'maintwin') renderMaintWindowSection();
    else if (active === 'minver') renderMinVersionSection();
    else if (active === 'broadcast') renderBroadcastSection();
    else if (active === 'greeting') renderGreetingSection();
    else if (active === 'faq') renderFaqSection();
    else if (active === 'announce') renderAnnounceSection();
    else if (active === 'pins') renderPinsSection();
    else if (active === 'aicost') loadAiCost();
  }
  document.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
  });
  function formFocused() {
    var el = document.activeElement;
    return !!(el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') && $('view').contains(el));
  }
  // Sections whose state lives in this browser (localStorage) — an auto-tick
  // re-render adds nothing and used to wipe in-progress edits the moment
  // focus left a field, and reset scroll every 10 s.
  var LOCAL_SECTIONS = { songs: true, playlists: true, homescreen: true, categories: true, banners: true, festivals: true, config: true, catalog: true, engineprobe: true, edge: true, flags: true, runbook: true, backup: true, trendpins: true, statusnote: true, songstats: true, synonyms: true, sources: true, langorder: true, blocklistio: true, aistarters: true, aiquick: true, airules: true, query: true, relnotes: true, maintwin: true, minver: true, broadcast: true, greeting: true, faq: true, announce: true, pins: true, statushist: true, envcheck: true };
  function autoTick() {
    if (formFocused()) return;
    if (LOCAL_SECTIONS[active]) return;
    if (isIdle()) return; // untouched tab: stop burning the request budget
    if (active === 'workspace') { window.VinaXWorkspace.refresh(); return; }
    refreshActive();
  }
  // Request-budget fix: an admin tab left open (but untouched) all day kept
  // polling forever. After 10 idle minutes the auto-refresh pauses; any
  // mouse/key/scroll/touch wakes it and refreshes immediately.
  var lastActivity = Date.now();
  var IDLE_MS = 10 * 60_000;
  function noteActivity() {
    var wasIdle = Date.now() - lastActivity > IDLE_MS;
    lastActivity = Date.now();
    if (wasIdle && autoRefresh && !document.hidden) { refreshActive(); startAuto(); }
  }
  ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'].forEach(function (ev) {
    document.addEventListener(ev, noteActivity, { passive: true });
  });
  function isIdle() { return Date.now() - lastActivity > IDLE_MS; }
  function startAuto() { stopAuto(); if (autoRefresh && !document.hidden) autoTimer = setInterval(autoTick, refreshMs); }
  function stopAuto() { if (autoTimer) { clearInterval(autoTimer); autoTimer = null; } }
  function setSection(sec) {
    memoReset();
    active = sec;
    try { if (location.hash !== '#' + sec) location.hash = sec; localStorage.setItem('vinax_admin_sec', sec); } catch (e) {}
    Array.prototype.forEach.call(document.querySelectorAll('#nav button[data-sec]'), function (b) { b.classList.toggle('active', b.getAttribute('data-sec') === sec); });
    // Mobile: the nav is a horizontal chip rail — keep the active chip visible.
    try { var ab = document.querySelector('#nav button.active'); if (ab && ab.scrollIntoView) ab.scrollIntoView({ block: 'nearest', inline: 'center' }); } catch (e) {}
    $('secTitle').textContent = TITLES[sec] || '';
    var crumbEl = $('secCrumb');
    if (crumbEl) crumbEl.textContent = CATS[sec] || '';
    applyNavGroups();
    var v = $('view'); v.classList.remove('enter'); void v.offsetWidth; v.classList.add('enter');
    $('range').hidden = !USES_RANGE[sec];
    $('csv').hidden = true;
    $('view').innerHTML = '<div class="astra-admin-loading" role="status" aria-label="Loading panel"><p>Connecting your workspace…</p><div class="cards" aria-hidden="true"><div></div><div></div><div></div><div></div></div></div>';
    if (sec === 'users') userOffset = 0;
    refreshActive();
    startAuto();
  }
  function buildRange() {
    var opts = [[1, '24h'], [7, '7d'], [30, '30d'], [90, '90d']];
    $('range').innerHTML = opts.map(function (o) { return '<button data-d="' + o[0] + '"' + (o[0] === rangeDays ? ' class="active"' : '') + '>' + o[1] + '</button>'; }).join('');
    Array.prototype.forEach.call($('range').querySelectorAll('button'), function (b) {
      b.addEventListener('click', function () { rangeDays = parseInt(b.getAttribute('data-d'), 10); buildRange(); refreshActive(); });
    });
  }
  function setAuto(on) { autoRefresh = on; $('autoTrack').classList.toggle('on', on); document.body.classList.toggle('live', on); if (on) startAuto(); else stopAuto(); }

  // ---------- table search / sort / pagination (auto-applied to big tables) ----------
  function cellVal(r, i) {
    var c = r.cells[i]; var t = c ? c.textContent.trim() : '';
    var n = parseFloat(t.replace(/[, ]/g, ''));
    return isNaN(n) ? t.toLowerCase() : n;
  }
  function enhanceTables() {
    try {
      var tables = $('view').querySelectorAll('table:not([data-enh])');
      Array.prototype.forEach.call(tables, function (tbl) {
        tbl.setAttribute('data-enh', '1');
        var tbody = tbl.tBodies[0];
        if (!tbody) return;
        var allRows = Array.prototype.slice.call(tbody.rows).filter(function (r) { return !r.querySelector('.empty'); });
        if (allRows.length < 8) return;
        var st = { q: '', sortCol: -1, dir: 1, page: 0, per: 25 };
        var bar = document.createElement('div');
        bar.style.cssText = 'display:flex;gap:8px;align-items:center;margin:0 0 8px;flex-wrap:wrap';
        var search = document.createElement('input');
        search.type = 'search'; search.placeholder = 'Filter ' + allRows.length + ' rows…';
        search.style.cssText = 'flex:1;min-width:160px;max-width:300px;padding:7px 12px;font-size:13px';
        var prev = document.createElement('button'); prev.className = 'ghost'; prev.textContent = '‹'; prev.style.padding = '4px 13px';
        var next = document.createElement('button'); next.className = 'ghost'; next.textContent = '›'; next.style.padding = '4px 13px';
        var info = document.createElement('span'); info.className = 'muted'; info.style.fontSize = '12px';
        bar.appendChild(search); bar.appendChild(prev); bar.appendChild(next); bar.appendChild(info);
        tbl.parentNode.insertBefore(bar, tbl);
        function apply() {
          var q = st.q.toLowerCase();
          var rows = allRows.filter(function (r) { return !q || r.textContent.toLowerCase().indexOf(q) >= 0; });
          if (st.sortCol >= 0) {
            rows = rows.slice().sort(function (a, b) {
              var av = cellVal(a, st.sortCol), bv = cellVal(b, st.sortCol);
              if (av < bv) return -1 * st.dir; if (av > bv) return st.dir; return 0;
            });
          }
          var pages = Math.max(1, Math.ceil(rows.length / st.per));
          if (st.page >= pages) st.page = pages - 1;
          if (st.page < 0) st.page = 0;
          allRows.forEach(function (r) { r.style.display = 'none'; });
          var s0 = st.page * st.per;
          rows.slice(s0, s0 + st.per).forEach(function (r) { r.style.display = ''; tbody.appendChild(r); });
          info.textContent = rows.length + ' rows · page ' + (st.page + 1) + '/' + pages;
          prev.disabled = st.page <= 0; next.disabled = st.page >= pages - 1;
        }
        search.addEventListener('input', function () { st.q = search.value; st.page = 0; apply(); });
        prev.addEventListener('click', function () { st.page--; apply(); });
        next.addEventListener('click', function () { st.page++; apply(); });
        if (tbl.tHead && tbl.tHead.rows[0]) {
          Array.prototype.forEach.call(tbl.tHead.rows[0].cells, function (th, i) {
            th.style.cursor = 'pointer'; th.title = 'Click to sort';
            th.addEventListener('click', function () {
              if (st.sortCol === i) st.dir *= -1; else { st.sortCol = i; st.dir = 1; }
              apply();
            });
          });
        }
        apply();
      });
    } catch (e) { /* never break the dashboard */ }
  }

  var enhInit = false;
  function initEnhancements() {
    if (enhInit) return; enhInit = true;
    try { new MutationObserver(function () { enhanceTables(); }).observe($('view'), { childList: true }); } catch (e) {}
    try {
      var sel = document.createElement('select');
      sel.title = 'Auto-refresh interval';
      [[5000, '5s'], [10000, '10s'], [30000, '30s'], [60000, '1m']].forEach(function (o) {
        var op = document.createElement('option'); op.value = o[0]; op.textContent = 'Every ' + o[1];
        if (o[0] === refreshMs) op.selected = true; sel.appendChild(op);
      });
      sel.id = 'hdr-interval';
      sel.addEventListener('change', function () { refreshMs = parseInt(sel.value, 10); try { localStorage.setItem('vinax_admin_interval', sel.value); } catch (e) {} startAuto(); });
      var den = document.createElement('button'); den.className = 'ghost'; den.textContent = 'Density'; den.title = 'Toggle compact rows';
      den.addEventListener('click', function () { var on = document.body.classList.toggle('compact'); try { localStorage.setItem('vinax_admin_compact', on ? '1' : ''); } catch (e) {} });
      if (localStorage.getItem('vinax_admin_compact')) document.body.classList.add('compact');
      var aw = $('autoWrap'); aw.parentNode.insertBefore(sel, aw); aw.parentNode.insertBefore(den, aw);
    } catch (e) {}
    // (The mousemove 3D card tilt lived here — retired: it rotated whole
    //  tables/cards over their neighbours and added nothing but wobble.)

    // ---- Health re-check button (delegated: the box re-renders) ----
    // NOTE: the delegated th-sort that used to live here is GONE — it fought
    // enhanceTables' own per-th sorting (two handlers per click desynced the
    // sort arrows and re-appended every paginated row), which is what made
    // double-clicking a column header "break" the table.
    $('view').addEventListener('click', function (e) {
      if (e.target && e.target.id === 'hrecheck') {
        var el = document.getElementById('healthbox');
        if (el) el.innerHTML = '<div class="empty">Re-checking…</div>';
        api('/api/admin/health').then(function (h) { var b = document.getElementById('healthbox'); if (b) b.innerHTML = healthHtml(h); }).catch(noop);
      }
    });

    // (The dblclick fullscreen-zoom is retired: an accidental double-click on
    //  any table threw it into a fixed overlay that looked like the dashboard
    //  broke. Escape still clears any stale .zoomed state from old sessions.)
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') Array.prototype.forEach.call(document.querySelectorAll('.zoomed'), function (z) { z.classList.remove('zoomed'); });
    });

    // ---- JSON export of the current panel ----
    $('json').disabled = true;
    $('json').addEventListener('click', function () {
      if (!lastJson) { vxAlert('No data loaded yet — open any dashboard first.', { title: 'Export' }); return; }
      var blob = new Blob([JSON.stringify(lastJson, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = 'vinax-' + active + '-' + new Date().toISOString().slice(0, 10) + '.json'; a.click();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    });

    // ---- Copy day report ----
    $('report').addEventListener('click', function () {
      apiMemo('/api/admin/overview').then(function (d) {
        if (!d || !d.summary) return;
        var s = d.summary;
        var txt = 'VinaX day report — ' + new Date().toLocaleDateString('en-IN') + '\n' +
          'Listening now: ' + (s.active_now || 0) + '\n' +
          'Plays today: ' + (s.plays_today || 0) + ' · 7d: ' + (s.plays_7d || 0) + '\n' +
          'Users: ' + (s.total_users || 0) + ' total · +' + (s.new_today || 0) + ' today · DAU ' + (s.dau || 0) + ' / WAU ' + (s.wau || 0) + ' / MAU ' + (s.mau || 0) + '\n' +
          'Errors (24h): ' + (s.errors_24h || 0) + ' · New feedback: ' + (s.feedback_new || 0);
        try { navigator.clipboard.writeText(txt).then(function () { $('report').textContent = 'Copied'; setTimeout(function () { $('report').textContent = 'Report'; }, 1200); }); } catch (err) { vxPrompt('Copy the report text below:', { title: 'Day report', value: txt, okText: 'Done' }); }
      }).catch(noop);
    });

    // ---- Error notifications (opt-in) ----
    var notifyOn = !!localStorage.getItem('vinax_admin_notify');
    var lastErr = -1;
    function paintNotify() { $('notify').style.opacity = notifyOn ? '1' : '.45'; }
    paintNotify();
    $('notify').addEventListener('click', function () {
      notifyOn = !notifyOn;
      try { localStorage.setItem('vinax_admin_notify', notifyOn ? '1' : ''); } catch (err) {}
      if (notifyOn && typeof Notification !== 'undefined') {
        if (Notification.permission === 'default') Notification.requestPermission();
        else if (Notification.permission === 'denied') vxAlert('Notifications are blocked for this site in the browser settings.', { title: 'Notifications' });
      }
      paintNotify();
    });

    // ---- Light / dark admin theme ----
    if (localStorage.getItem('vinax_admin_light')) document.body.classList.add('lightadm');
    $('theme').addEventListener('click', function () {
      var on = document.body.classList.toggle('lightadm');
      try { localStorage.setItem('vinax_admin_light', on ? '1' : ''); } catch (err) {}
    });

    // ---- Mini KPI strip (60s pulse) + notification trigger ----
    function kpiTick() {
      apiMemo('/api/admin/overview', 'kpi:overview').then(function (d) {
        if (!d || !d.summary) return;
        var s = d.summary;
        $('kpis').innerHTML =
          '<span class="k">● <b>' + (s.active_now || 0) + '</b> now</span>' +
          '<span class="k">▶ <b>' + (s.plays_today || 0) + '</b> today</span>' +
          '<span class="k">⚠ <b>' + (s.errors_24h || 0) + '</b> errors</span>';
        if (notifyOn && lastErr >= 0 && (s.errors_24h || 0) > lastErr && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          new Notification('VinaX: new errors', { body: (s.errors_24h - lastErr) + ' new error(s) in the last day.' });
        }
        lastErr = s.errors_24h || 0;
      }).catch(noop);
    }
    kpiTick();
    setInterval(function () { if (!document.hidden && !isIdle()) kpiTick(); }, 60_000);

    // ---- Stale-data banner ----
    setInterval(function () {
      var st = $('stale');
      if (!st) return;
      st.hidden = !(autoRefresh && !formFocused() && Date.now() - lastStampAt > Math.max(3 * refreshMs, 30_000));
    }, 5000);

    // ---- Sidebar search filter (Task 5) ----
    var navSearch = document.getElementById('navSearch');
    if (navSearch) {
      navSearch.addEventListener('input', function () {
        var q = (navSearch.value || '').toLowerCase().trim();
        var nav = document.getElementById('nav');
        if (!nav) return;
        nav.classList.toggle('searching', !!q);
        // Show/hide each button by label match.
        var groupHasVisible = {};
        var currentGroup = null;
        Array.prototype.forEach.call(nav.children, function (el) {
          if (el === navSearch) return;
          if (el.hasAttribute && el.hasAttribute('data-group')) {
            currentGroup = el; groupHasVisible[currentGroup.textContent] = false;
            el.style.display = ''; // provisionally
          } else if (el.tagName === 'BUTTON') {
            var lbl = (el.textContent || '').toLowerCase();
            var match = !q || lbl.indexOf(q) >= 0;
            el.style.display = match ? '' : 'none';
            if (match && currentGroup) groupHasVisible[currentGroup.textContent] = true;
          }
        });
        // Hide empty group labels.
        Array.prototype.forEach.call(nav.querySelectorAll('[data-group]'), function (g) {
          g.style.display = groupHasVisible[g.textContent] === false ? 'none' : '';
        });
      });
      // Ctrl/Cmd+K focuses the sidebar search when the palette isn't up.
      // The existing palette handler still fires on the same key — keep both:
      // palette pops open (users get the "jump" surface promised by the badge)
      // and the sidebar search is a secondary always-visible filter.
    }
    document.addEventListener('visibilitychange', function () { if (document.hidden) stopAuto(); else { refreshActive(); startAuto(); } });
    window.addEventListener('hashchange', function () { var s = (location.hash || '').replace('#', ''); if (TITLES[s] && s !== active) setSection(s); });
    document.addEventListener('keydown', function (e) {
      var tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      var secs = ['overview', 'live', 'activity', 'location', 'music', 'insights', 'users', 'technical', 'ai', 'feedback'];
      if (e.key >= '1' && e.key <= '9') { var i = parseInt(e.key, 10) - 1; if (secs[i]) setSection(secs[i]); }
      else if (e.key === 'r' || e.key === 'R') refreshActive();
      else if (e.key === '/') { var f = $('view').querySelector('input[type=search]'); if (f) { e.preventDefault(); f.focus(); } }
    });
  }

  function start() {
    showApp(); buildRange(); initEnhancements();
    if (autoRefresh) document.body.classList.add('live');
    var initial = (location.hash || '').replace('#', '');
    setSection(TITLES[initial] ? initial : (localStorage.getItem('vinax_admin_sec') || 'overview'));
  }

  Array.prototype.forEach.call(document.querySelectorAll('#nav button[data-sec]'), function (b) { b.addEventListener('click', function () { setSection(b.getAttribute('data-sec')); }); });
  Array.prototype.forEach.call(document.querySelectorAll('#nav .nav-group-label'), function (g) { g.addEventListener('click', function () { toggleNavGroup(g.getAttribute('data-group')); }); });
  applyNavGroups();
  $('enter').addEventListener('click', function () { var t = $('token').value.trim(); if (!t) { $('loginErr').textContent = 'Enter a token.'; return; } sessionStorage.setItem(TOKEN_KEY, t); start(); });
  $('token').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('enter').click(); });
  $('logout').addEventListener('click', function () { sessionStorage.removeItem(TOKEN_KEY); showLogin(''); });
  $('refresh').addEventListener('click', refreshActive);
  $('csv').addEventListener('click', downloadCsv);
  $('autoWrap').addEventListener('click', function () { setAuto(!autoRefresh); });
  $('modal').addEventListener('click', function (e) { if (e.target === $('modal')) closeModal(); });

  // Honour the saved theme before the login card paints (initEnhancements
  // re-applies it after sign-in; this just avoids a dark flash on light).
  try { if (localStorage.getItem('vinax_admin_light')) document.body.classList.add('lightadm'); } catch (e) {}
  if (token()) start(); else showLogin('');
})();
