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
  var refreshMs = parseInt((localStorage.getItem('vinax_admin_interval') || '10000'), 10) || 10000;

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
  function apiMemo(path) {
    return api(path).then(function (d) {
      stamp();
      var sig = JSON.stringify(d);
      if (memoCache[path] === sig) return null;
      memoCache[path] = sig;
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
      var trend = delta > 0 ? '<span style="color:#36d399">▲ ' + delta + '</span>' : (delta < 0 ? '<span style="color:#ff6b6b">▼ ' + Math.abs(delta) + '</span>' : '<span class="muted">—</span>');
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

  var WORLD_LAND=[[[-180.0,69.0],[-174.3,66.3],[-174.6,67.1],[-171.9,66.9],[-169.9,66.0],[-172.5,65.4],[-173.0,64.3],[-179.9,65.9],[-180.0,65.0],[180.0,65.0],[177.4,64.6],[179.2,62.3],[173.7,61.7],[170.3,59.9],[168.9,60.6],[163.5,59.9],[162.0,58.2],[163.2,57.6],[162.1,54.9],[160.4,54.3],[160.0,53.2],[158.5,53.0],[156.8,51.0],[155.4,55.4],[155.9,56.8],[163.7,61.1],[164.5,62.6],[160.1,60.5],[159.3,61.8],[156.7,61.4],[154.2,59.8],[155.0,59.1],[142.2,59.0],[135.1,54.7],[138.2,53.8],[139.9,54.2],[141.4,52.2],[140.1,48.4],[138.2,46.3],[134.9,43.4],[132.3,43.3],[127.5,39.8],[129.5,36.8],[129.1,35.1],[126.5,34.4],[126.1,36.7],[126.9,36.9],[124.7,38.1],[125.3,39.6],[121.1,38.9],[122.2,40.4],[121.6,40.9],[118.0,39.2],[117.5,38.7],[118.9,37.4],[122.4,37.5],[119.2,34.9],[121.9,31.7],[121.7,28.2],[118.7,24.5],[115.9,22.8],[110.8,21.4],[110.4,20.3],[108.5,21.7],[105.9,19.8],[109.3,13.4],[109.2,11.7],[105.2,8.6],[105.1,9.9],[100.1,13.4],[99.2,9.2],[103.0,5.5],[104.2,1.3],[101.4,2.8],[100.1,6.5],[98.5,8.4],[98.3,7.8],[98.8,11.4],[97.2,16.9],[95.4,15.7],[94.2,16.0],[94.3,18.2],[91.4,22.8],[87.0,21.5],[86.5,20.2],[80.3,15.9],[79.9,10.4],[77.5,8.0],[73.5,16.0],[72.6,21.4],[70.5,20.9],[66.4,25.4],[57.4,25.7],[56.5,27.1],[54.7,26.5],[51.5,27.9],[50.1,30.1],[48.0,30.0],[50.8,24.8],[51.6,25.8],[51.8,24.0],[54.0,24.1],[56.4,26.4],[56.8,24.2],[59.8,22.3],[57.7,18.9],[55.3,17.2],[48.7,14.0],[43.5,12.6],[42.7,16.8],[39.1,21.3],[38.5,23.7],[34.6,28.1],[34.9,29.5],[33.9,27.6],[32.4,29.9],[35.5,23.1],[36.9,22.0],[37.5,18.6],[43.3,12.4],[42.7,11.7],[44.6,10.4],[51.1,12.0],[51.0,10.6],[47.7,4.2],[40.3,-2.6],[39.2,-4.7],[38.8,-6.5],[40.5,-10.8],[40.8,-14.7],[39.5,-16.7],[34.8,-19.8],[35.5,-24.1],[32.6,-25.7],[32.2,-28.8],[28.2,-32.8],[19.6,-34.8],[18.2,-33.9],[18.2,-31.7],[15.2,-27.1],[14.3,-22.1],[11.8,-18.1],[13.7,-10.7],[11.9,-5.0],[8.8,-1.1],[9.4,3.7],[8.5,4.8],[5.9,4.3],[4.3,6.3],[-2.0,4.7],[-9.0,4.8],[-12.4,7.3],[-16.6,12.2],[-17.6,14.7],[-16.1,18.1],[-17.0,21.9],[-14.4,26.3],[-9.6,29.9],[-9.3,32.6],[-5.9,35.8],[-2.2,35.2],[1.5,36.6],[9.5,37.4],[11.1,36.9],[10.3,33.8],[19.1,30.3],[20.1,32.2],[21.5,32.8],[28.9,30.9],[31.0,31.6],[33.8,31.0],[36.0,34.6],[36.2,36.7],[27.6,36.7],[26.2,39.5],[29.2,41.2],[33.5,42.0],[38.3,40.9],[41.7,42.0],[36.7,45.2],[39.1,47.3],[35.0,46.3],[36.3,45.1],[33.9,44.4],[32.5,45.3],[33.3,46.1],[30.7,46.6],[27.7,42.6],[28.8,41.1],[22.6,40.3],[24.0,37.7],[23.1,37.9],[23.2,36.4],[22.5,36.4],[19.4,40.3],[19.5,41.7],[13.1,45.7],[12.3,45.4],[12.6,44.1],[18.5,40.2],[16.9,40.4],[17.1,38.9],[16.1,38.0],[15.4,40.0],[8.9,44.4],[6.5,43.1],[3.1,43.1],[3.0,41.9],[0.8,41.0],[0.1,38.7],[-2.1,36.7],[-5.4,35.9],[-6.5,36.9],[-8.9,36.9],[-9.4,43.0],[-1.4,44.0],[-1.2,46.0],[-4.6,48.7],[-1.6,48.6],[-1.9,49.8],[1.3,50.1],[4.7,53.1],[8.1,53.5],[8.8,54.0],[8.5,57.1],[10.6,57.7],[10.9,56.5],[9.6,55.5],[10.9,54.0],[19.7,54.4],[21.3,55.2],[21.6,57.4],[24.1,57.0],[24.4,58.4],[23.3,59.2],[29.1,60.0],[22.9,59.8],[21.3,60.7],[21.5,63.2],[25.4,65.1],[22.2,65.7],[21.4,64.4],[17.8,62.7],[17.1,61.3],[18.8,60.1],[16.8,58.7],[15.9,56.1],[12.9,55.4],[10.4,59.5],[8.4,58.3],[5.7,58.6],[5.0,62.0],[5.9,62.6],[19.2,69.8],[24.5,71.0],[28.2,71.2],[31.3,70.5],[30.0,70.2],[31.1,69.6],[36.5,69.1],[41.1,67.5],[41.1,66.8],[38.4,66.0],[33.2,66.6],[34.8,65.9],[34.9,64.4],[37.0,63.9],[36.5,64.8],[37.2,65.1],[39.6,64.5],[40.4,64.8],[39.8,65.5],[42.1,66.5],[44.0,66.1],[44.5,66.8],[43.5,68.6],[46.3,68.2],[46.8,67.7],[45.6,67.0],[46.3,66.7],[53.7,68.9],[54.5,68.8],[53.5,68.2],[58.8,68.9],[59.9,68.3],[61.1,68.9],[60.0,69.5],[60.6,69.9],[68.5,68.1],[69.2,68.6],[66.9,69.5],[66.7,71.0],[69.2,72.8],[72.6,72.8],[71.8,71.4],[72.8,70.4],[72.6,69.0],[73.7,68.4],[71.3,66.3],[72.4,66.2],[75.1,67.8],[74.9,69.0],[73.6,69.6],[74.4,70.6],[73.1,71.4],[74.9,72.1],[74.7,72.8],[75.7,72.3],[75.3,71.3],[76.4,71.2],[75.9,71.9],[77.6,72.3],[81.5,71.7],[80.5,73.6],[86.8,73.9],[86.0,74.5],[87.2,75.1],[100.8,76.4],[104.4,77.7],[107.2,76.5],[114.1,75.8],[109.4,74.2],[123.2,73.0],[123.3,73.7],[127.0,73.6],[131.3,70.8],[132.3,71.8],[139.9,71.5],[139.1,72.4],[140.5,72.8],[149.5,72.2],[153.0,70.8],[159.0,70.9],[160.9,69.4],[167.8,69.6],[169.6,68.7],[170.8,69.0],[170.5,70.1],[178.6,69.4],[-180.0,69.0]],[[-90.5,69.5],[-90.5,68.5],[-89.2,69.3],[-87.3,67.2],[-85.5,69.9],[-82.6,69.7],[-81.3,69.2],[-82.0,68.1],[-81.3,67.6],[-83.3,66.4],[-85.8,66.6],[-87.3,64.8],[-93.2,62.0],[-94.7,58.9],[-93.2,58.8],[-92.3,57.1],[-82.3,55.1],[-82.1,53.3],[-79.9,51.2],[-78.6,52.6],[-79.8,54.7],[-76.5,56.5],[-78.5,58.8],[-77.3,59.9],[-78.1,62.3],[-73.8,62.4],[-69.6,61.1],[-69.3,59.0],[-67.7,58.2],[-64.6,60.3],[-61.4,57.0],[-61.8,56.3],[-57.3,54.6],[-55.7,52.1],[-60.0,50.2],[-66.4,50.2],[-71.1,46.8],[-65.1,49.2],[-64.2,48.7],[-65.1,48.1],[-64.5,46.2],[-61.5,45.9],[-60.5,47.0],[-59.8,45.9],[-65.4,43.5],[-66.2,44.5],[-64.4,45.3],[-67.1,45.1],[-70.7,43.0],[-70.0,41.6],[-73.7,40.9],[-71.9,40.9],[-74.0,40.8],[-74.9,38.9],[-75.5,39.5],[-75.1,38.4],[-75.9,37.2],[-76.4,39.1],[-76.3,38.1],[-77.0,38.2],[-75.7,35.6],[-81.3,31.4],[-80.4,25.2],[-81.7,25.9],[-84.1,30.1],[-89.2,30.3],[-89.2,29.3],[-90.2,29.1],[-93.8,29.7],[-96.6,28.3],[-97.9,22.4],[-96.3,19.3],[-94.4,18.1],[-92.0,18.7],[-90.8,19.3],[-90.3,21.0],[-87.1,21.5],[-88.9,15.9],[-83.4,15.3],[-83.8,11.1],[-81.4,8.8],[-79.6,9.6],[-76.8,8.6],[-74.9,11.1],[-71.8,12.4],[-71.1,12.1],[-71.9,11.4],[-71.7,9.1],[-71.4,11.0],[-69.9,12.2],[-68.2,10.6],[-61.9,10.7],[-62.4,9.9],[-57.1,6.0],[-54.0,5.8],[-51.3,4.2],[-50.0,1.7],[-50.4,-0.1],[-48.6,-0.2],[-48.6,-1.2],[-47.8,-0.6],[-44.9,-1.6],[-44.6,-2.7],[-40.0,-2.9],[-35.6,-5.1],[-34.7,-7.3],[-35.1,-9.0],[-38.7,-13.1],[-39.3,-17.9],[-40.9,-21.9],[-47.6,-24.9],[-48.9,-28.7],[-53.8,-34.4],[-56.2,-34.9],[-58.4,-33.9],[-56.8,-36.9],[-59.2,-38.7],[-62.3,-38.8],[-62.7,-41.0],[-65.1,-41.1],[-65.0,-42.1],[-63.5,-42.6],[-65.2,-43.5],[-65.6,-45.0],[-67.3,-45.6],[-67.6,-46.3],[-65.6,-47.2],[-66.0,-48.1],[-69.1,-50.7],[-68.2,-52.4],[-70.8,-52.9],[-71.0,-53.8],[-74.9,-52.3],[-75.6,-48.7],[-74.1,-46.9],[-75.6,-46.6],[-74.4,-44.1],[-73.2,-44.5],[-72.7,-42.4],[-74.3,-43.2],[-73.2,-39.3],[-73.6,-37.2],[-71.4,-32.4],[-70.2,-19.8],[-71.5,-17.4],[-76.0,-14.6],[-79.8,-7.2],[-81.3,-6.1],[-81.4,-4.7],[-79.8,-2.7],[-81.0,-2.2],[-80.9,-1.1],[-77.1,3.8],[-78.2,8.3],[-79.6,8.9],[-80.9,7.2],[-85.7,9.9],[-87.5,13.3],[-91.2,13.9],[-94.7,16.2],[-96.6,15.7],[-103.5,18.3],[-105.5,19.9],[-106.0,22.8],[-112.2,29.0],[-113.1,31.2],[-114.8,31.8],[-114.7,30.2],[-109.4,23.2],[-110.0,22.8],[-112.2,24.7],[-112.3,26.0],[-115.1,27.7],[-114.2,28.6],[-117.3,33.0],[-120.6,34.6],[-124.4,40.3],[-123.9,45.5],[-124.7,48.2],[-122.6,47.1],[-122.8,49.0],[-127.4,50.8],[-127.8,52.3],[-134.1,58.1],[-147.1,60.9],[-151.7,59.2],[-150.6,61.3],[-158.4,56.0],[-164.8,54.4],[-157.7,57.6],[-157.0,58.9],[-162.0,58.7],[-161.9,59.6],[-163.8,59.8],[-166.1,61.5],[-164.6,63.1],[-160.8,63.8],[-161.5,64.4],[-160.8,64.8],[-165.0,64.4],[-168.1,65.7],[-164.5,66.6],[-161.7,66.1],[-166.8,68.4],[-156.6,71.4],[-136.5,68.9],[-128.1,70.5],[-125.8,69.5],[-121.5,69.8],[-113.9,68.4],[-115.3,67.9],[-108.9,67.4],[-107.8,67.9],[-108.8,68.3],[-108.2,68.7],[-106.1,68.8],[-101.5,67.6],[-97.7,68.6],[-96.1,68.2],[-96.1,67.3],[-94.2,69.1],[-96.5,70.1],[-95.2,71.9],[-91.5,70.2],[-92.4,69.7],[-90.5,69.5]],[[-27.1,83.5],[-20.8,82.7],[-31.9,82.2],[-22.1,81.7],[-23.2,81.2],[-15.8,81.9],[-12.2,81.3],[-20.0,80.2],[-17.7,80.1],[-19.7,78.8],[-19.7,77.6],[-18.5,77.0],[-21.7,76.6],[-19.8,76.1],[-19.6,75.2],[-20.7,75.2],[-19.4,74.3],[-23.6,73.3],[-22.3,72.2],[-24.8,72.3],[-21.8,70.7],[-25.5,71.4],[-25.2,70.8],[-26.4,70.2],[-22.3,70.1],[-39.8,65.5],[-42.8,62.7],[-43.4,60.1],[-48.3,60.9],[-51.6,63.6],[-54.0,67.2],[-50.9,69.9],[-54.7,69.6],[-54.4,70.8],[-51.4,70.6],[-55.8,71.7],[-54.7,72.6],[-58.6,75.5],[-68.5,76.1],[-71.4,77.0],[-66.8,77.4],[-73.3,78.0],[-65.7,79.4],[-68.0,80.1],[-62.2,81.3],[-62.6,81.8],[-50.4,82.4],[-44.5,81.7],[-46.8,82.6],[-27.1,83.5]],[[143.6,-13.8],[145.4,-15.0],[146.4,-19.0],[148.8,-20.4],[153.1,-26.1],[153.1,-30.9],[150.0,-37.4],[146.3,-39.0],[145.0,-37.9],[143.6,-38.8],[140.6,-38.0],[139.6,-36.1],[138.1,-35.6],[138.2,-34.4],[136.8,-35.3],[137.8,-32.9],[136.0,-34.9],[134.3,-32.6],[131.3,-31.5],[126.1,-32.2],[123.7,-33.9],[119.9,-34.0],[118.0,-35.1],[115.0,-34.2],[115.7,-31.6],[113.3,-26.1],[114.2,-26.3],[113.4,-24.4],[114.1,-21.8],[114.2,-22.5],[116.7,-20.7],[120.9,-19.7],[125.7,-14.2],[127.1,-13.8],[129.6,-15.0],[130.6,-12.5],[132.6,-12.1],[132.4,-11.1],[136.5,-11.9],[135.5,-15.0],[140.2,-17.7],[142.5,-10.7],[143.6,-13.8]],[[-86.6,73.2],[-85.8,72.5],[-82.3,73.8],[-80.8,72.1],[-77.8,72.8],[-74.1,71.3],[-72.2,71.6],[-67.0,69.2],[-68.8,68.7],[-61.9,66.9],[-63.9,65.0],[-68.0,66.3],[-64.7,63.4],[-65.0,62.7],[-68.8,63.7],[-66.2,61.9],[-74.8,64.7],[-77.7,64.2],[-78.6,64.6],[-77.9,65.3],[-74.0,65.5],[-72.9,67.7],[-79.0,70.2],[-84.9,70.0],[-89.9,71.2],[-89.4,73.1],[-85.8,73.8],[-86.6,73.2]],[[-180.0,-16.6],[179.4,-16.8],[178.7,-17.0],[179.4,-16.4],[-180.0,-16.6]],[[134.1,-1.2],[135.5,-3.4],[138.3,-1.7],[144.6,-3.9],[147.6,-6.1],[147.2,-7.4],[150.7,-10.6],[147.9,-10.1],[144.7,-7.6],[142.6,-9.3],[137.6,-8.4],[138.7,-7.3],[137.9,-5.4],[133.7,-3.5],[133.0,-4.1],[132.0,-2.8],[133.7,-2.2],[130.5,-0.9],[132.4,-0.4],[134.1,-1.2]],[[-68.5,83.1],[-61.9,82.6],[-67.7,81.5],[-65.5,81.5],[-71.2,79.8],[-76.9,79.3],[-75.4,78.5],[-79.8,77.2],[-77.9,76.8],[-80.6,76.2],[-89.5,76.5],[-87.8,77.2],[-88.3,77.9],[-85.0,77.5],[-88.0,78.4],[-85.1,79.3],[-86.9,80.3],[-81.8,80.5],[-87.6,80.5],[-91.6,81.9],[-68.5,83.1]],[[141.0,37.1],[140.3,35.1],[135.8,33.5],[135.1,34.6],[131.0,33.9],[132.0,33.1],[131.3,31.5],[130.2,31.4],[129.4,33.3],[132.6,35.4],[135.7,35.5],[136.7,37.3],[137.4,36.8],[139.4,38.2],[139.9,40.6],[141.4,41.4],[141.9,39.2],[141.0,37.1]],[[105.8,-5.9],[102.6,-4.2],[95.3,5.5],[97.5,5.2],[103.8,0.1],[103.4,-0.7],[106.1,-3.1],[105.8,-5.9]],[[117.9,1.8],[119.0,0.9],[117.8,0.8],[116.1,-4.0],[110.2,-2.9],[109.1,-0.5],[109.7,2.0],[111.2,1.9],[113.0,3.1],[116.7,6.9],[119.2,5.4],[117.3,3.2],[117.9,1.8]],[[57.5,70.7],[53.7,70.8],[51.5,72.0],[55.6,75.1],[68.9,76.5],[58.5,74.3],[55.4,72.4],[57.5,70.7]],[[50.1,-13.6],[50.4,-15.7],[49.7,-15.7],[47.1,-24.9],[45.4,-25.6],[44.0,-25.0],[43.3,-22.1],[44.4,-20.1],[44.4,-16.2],[47.7,-14.6],[49.2,-12.0],[50.1,-13.6]],[[-114.2,73.1],[-114.7,72.7],[-109.9,73.0],[-108.2,71.7],[-108.4,73.1],[-106.5,73.1],[-104.5,71.0],[-101.0,70.0],[-102.7,69.5],[-102.4,68.8],[-113.3,68.5],[-117.3,70.0],[-112.4,70.4],[-117.9,70.5],[-118.4,70.9],[-116.1,71.3],[-119.4,71.6],[-117.9,72.7],[-114.2,73.1]],[[-3.0,58.6],[-4.1,57.6],[-2.0,57.7],[-3.1,56.0],[1.7,52.7],[1.4,51.3],[-5.2,50.0],[-3.4,51.4],[-5.3,52.0],[-4.2,52.3],[-4.6,53.5],[-2.9,54.0],[-4.8,54.8],[-5.0,55.8],[-5.6,55.3],[-6.2,56.8],[-5.0,58.6],[-3.0,58.6]],[[-94.7,77.1],[-89.2,75.6],[-81.1,75.7],[-79.8,74.9],[-89.8,74.5],[-97.1,76.8],[-94.7,77.1]],[[125.2,1.4],[123.7,0.2],[120.2,0.2],[120.9,-1.4],[123.3,-0.6],[121.5,-1.9],[123.2,-5.3],[122.2,-5.3],[122.7,-4.5],[121.5,-4.6],[121.0,-2.6],[120.3,-2.9],[120.4,-5.5],[119.4,-5.4],[118.8,-2.8],[120.0,0.6],[125.2,1.4]],[[173.0,-40.9],[174.2,-41.3],[173.1,-43.9],[171.5,-44.2],[169.3,-46.6],[166.7,-46.2],[167.0,-45.1],[173.0,-40.9]],[[174.6,-36.2],[176.8,-37.9],[178.5,-37.7],[175.2,-41.7],[174.9,-39.9],[173.8,-39.5],[174.7,-37.4],[172.6,-34.5],[174.6,-36.2]],[[-79.7,22.8],[-74.2,20.3],[-77.8,19.9],[-77.1,20.4],[-78.7,21.6],[-81.8,22.6],[-85.0,21.9],[-82.3,23.2],[-79.7,22.8]],[[-120.5,71.4],[-123.1,70.9],[-125.9,71.9],[-123.9,73.7],[-124.9,74.3],[-115.5,73.5],[-120.5,71.4]],[[-87.0,79.7],[-85.8,79.3],[-90.8,78.2],[-96.7,80.2],[-92.4,81.3],[-87.0,79.7]],[[18.3,79.7],[21.5,79.0],[15.9,76.8],[10.4,79.7],[18.3,79.7]],[[-14.5,66.5],[-13.6,65.1],[-18.7,63.5],[-22.8,64.0],[-21.8,64.4],[-24.0,64.9],[-22.2,65.4],[-24.3,65.6],[-22.1,66.4],[-20.6,65.7],[-14.5,66.5]],[[-56.1,50.7],[-56.8,49.8],[-53.5,49.2],[-53.1,46.7],[-54.2,46.8],[-54.2,47.8],[-55.4,46.9],[-59.3,47.6],[-57.4,50.7],[-55.4,51.6],[-56.1,50.7]],[[-67.8,-53.8],[-65.1,-54.7],[-69.2,-55.5],[-74.7,-52.8],[-71.1,-54.1],[-69.3,-52.5],[-67.8,-53.8]],[[108.6,-6.8],[110.8,-6.5],[115.7,-8.4],[105.4,-6.9],[106.1,-5.9],[108.6,-6.8]],[[121.3,18.5],[122.2,18.5],[122.5,17.1],[121.7,14.3],[124.0,13.8],[124.1,12.5],[120.6,13.9],[121.0,14.5],[120.1,15.0],[119.9,16.4],[121.3,18.5]],[[-108.2,76.2],[-105.7,75.5],[-112.2,74.4],[-113.9,74.7],[-111.8,75.2],[-117.7,75.2],[-115.4,76.5],[-109.1,75.5],[-110.5,76.4],[-108.2,76.2]],[[143.9,44.2],[145.3,44.4],[145.5,43.3],[140.0,41.6],[142.0,45.6],[143.9,44.2]],[[99.9,78.9],[95.0,79.0],[91.2,80.3],[95.9,81.3],[100.2,79.8],[99.9,78.9]],[[143.6,50.7],[144.7,49.0],[143.2,49.3],[142.6,47.9],[143.5,46.1],[142.7,46.7],[142.1,46.0],[142.2,54.2],[143.6,50.7]],[[126.4,8.4],[125.4,5.6],[123.6,7.8],[121.9,7.2],[123.5,8.7],[125.5,9.0],[125.4,9.8],[126.4,8.4]],[[-6.8,52.3],[-10.0,51.8],[-9.2,52.9],[-9.7,53.9],[-6.7,55.2],[-5.7,54.6],[-6.8,52.3]],[[-100.4,73.8],[-97.4,73.8],[-98.1,73.0],[-96.5,72.6],[-96.7,71.7],[-99.3,71.4],[-102.5,72.5],[-100.4,72.7],[-101.5,73.4],[-100.4,73.8]],[[-72.6,19.9],[-68.3,18.6],[-71.4,17.6],[-74.5,18.3],[-72.3,18.7],[-73.4,19.6],[-72.6,19.9]],[[145.1,75.6],[144.3,74.8],[139.0,74.6],[137.0,75.3],[138.8,76.1],[145.1,75.6]],[[-123.5,48.5],[-125.7,48.8],[-128.4,50.8],[-125.8,50.3],[-123.5,48.5]],[[25.4,80.4],[27.4,80.1],[23.0,79.4],[17.4,80.3],[25.4,80.4]],[[-93.2,72.8],[-95.4,72.1],[-96.0,73.4],[-90.5,73.9],[-93.2,72.8]],[[145.4,-40.8],[148.3,-40.9],[147.9,-43.2],[146.0,-43.5],[144.7,-41.2],[145.4,-40.8]],[[152.0,-5.5],[150.2,-6.3],[148.3,-5.7],[150.8,-5.5],[151.5,-4.2],[152.3,-4.3],[152.0,-5.5]],[[-98.5,76.7],[-97.7,76.3],[-98.2,75.0],[-102.5,75.6],[-102.6,76.3],[-98.5,76.7]],[[124.4,-10.1],[123.5,-10.2],[125.1,-8.7],[127.3,-8.4],[124.4,-10.1]],[[81.2,6.2],[79.9,6.8],[80.1,9.8],[81.8,7.5],[81.2,6.2]],[[-100.1,78.3],[-105.2,78.4],[-104.2,78.7],[-105.5,79.3],[-100.1,78.3]],[[121.2,22.8],[120.7,22.0],[120.1,23.6],[121.5,25.3],[121.2,22.8]],[[125.5,12.2],[125.8,11.0],[125.0,11.3],[124.8,10.1],[124.3,12.6],[125.5,12.2]],[[124.0,10.3],[123.0,9.0],[122.4,9.7],[124.1,11.2],[124.0,10.3]],[[-132.7,54.0],[-131.7,54.1],[-132.1,53.0],[-131.2,52.2],[-133.1,53.4],[-132.7,54.0]],[[110.3,18.7],[108.7,18.5],[108.6,19.4],[110.8,20.1],[110.3,18.7]],[[9.2,41.2],[9.7,39.2],[8.8,38.9],[8.2,41.0],[9.2,41.2]]];

  // --- World Listening: real-time map (self-contained canvas; no external
  // libraries, so it stays CSP-safe). Draws real coastlines from an embedded
  // simplified world outline (Natural Earth 110m, Douglas-Peucker simplified)
  // on an equirectangular projection, then plots listeners at CITY level. Live
  // listeners (active in the last ~60s, /api/admin/live) pulse; the selected
  // range's cities (/api/admin/location) are the calmer base layer. Drag to
  // pan, scroll to zoom. WORLD_LAND is defined just above.
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

  function cityLL(city, cc) {
    var key = String(city || '').toLowerCase().trim();
    if (CITY_COORD[key]) return CITY_COORD[key];
    var g = GEO_CENTROID[String(cc || '').toUpperCase().slice(0, 2)];
    if (!g) return null;
    var h = 0, i;
    for (i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
    var jx = ((h % 97) / 97 - 0.5) * 7, jy = (((h >> 4) % 97) / 97 - 0.5) * 6;
    return [g[0] + jy, g[1] + jx];
  }

  function worldPoints(cities) {
    var pts = [], max = 1, i, r, ll, n;
    for (i = 0; i < cities.length; i++) {
      r = cities[i]; ll = cityLL(r.city, r.country); if (!ll) continue;
      n = r.listeners || 0; if (n > max) max = n;
      pts.push({ lat: ll[0], lon: ll[1], n: n });
    }
    return { pts: pts, max: max };
  }

  function loadWorld() {
    Promise.all([
      apiMemo('/api/admin/location?days=' + rangeDays).catch(function () { return null; }),
      apiMemo('/api/admin/live').catch(function () { return null; })
    ]).then(function (r) { if (active === 'world') renderWorld(r[0], r[1]); });
  }

  function renderWorld(loc, live) {
    loc = loc || {}; live = live || {};
    var countries = loc.countries || [];
    setExport('world-countries', countries);
    var base = worldPoints(loc.cities || []);
    var liveList = (live && live.listeners) || [];
    var livePts = [];
    liveList.forEach(function (r) {
      var ll = cityLL(r.city, r.country); if (!ll) return;
      livePts.push({ lat: ll[0], lon: ll[1], playing: !!r.playing });
    });
    var nowN = (live && live.count) || livePts.length;
    var nowRows = liveList.slice(0, 24).map(function (r) {
      var where = [r.city, r.country].filter(Boolean).map(esc).join(', ') || '<span class="muted">Unknown</span>';
      var song = r.song ? esc(r.song) + (r.artist ? ' <span class="muted">· ' + esc(r.artist) + '</span>' : '') : '<span class="muted">—</span>';
      return '<tr><td><span class="dot2 ' + (r.playing ? 'on' : 'off') + '"></span>' + esc(r.name || 'Listener') + '</td><td>' + song + '</td><td class="muted">' + where + '</td></tr>';
    }).join('');
    var list = countries.slice(0, 12).map(function (c) {
      return '<tr><td>' + esc(c.country) + '</td><td>' + c.listeners + '</td></tr>';
    }).join('') || '<tr><td colspan="2" class="empty">No data yet.</td></tr>';
    $('view').innerHTML =
      '<div style="display:flex;flex-wrap:wrap;gap:20px;align-items:flex-start">' +
        '<div style="flex:2;min-width:300px">' +
          '<canvas id="wmap" width="760" height="380" style="width:100%;height:auto;background:#0b0f1c;border-radius:16px;cursor:grab;touch-action:none;display:block"></canvas>' +
          '<p class="muted" style="margin-top:8px"><span class="dot2 on"></span> ' + nowN + ' listening now · ' + base.pts.length + ' active cities in the selected range. Drag to pan, scroll to zoom.</p>' +
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
    startMap(base.pts, livePts, base.max);
  }

  function startMap(base, livePts, maxN) {
    var cv = $('wmap'); if (!cv || !cv.getContext) return;
    var ctx = cv.getContext('2d');
    var W = cv.width, H = cv.height;
    var prev = mapState && mapState.view;
    var z = prev ? prev.z : 1, panX = prev ? prev.panX : 0, panY = prev ? prev.panY : 0;
    var dragging = false, lx = 0, ly = 0;
    if (mapState && mapState.raf) cancelAnimationFrame(mapState.raf);
    if (mapState && mapState.detach) mapState.detach();

    function clampPan() {
      var ww = W * z, wh = H * z;
      if (panX > 0) panX = 0; if (panX < W - ww) panX = W - ww;
      if (panY > 0) panY = 0; if (panY < H - wh) panY = H - wh;
    }
    function px(lon) { return (lon + 180) / 360 * (W * z) + panX; }
    function py(lat) { return (90 - lat) / 180 * (H * z) + panY; }

    function drawLand() {
      var i, j, ring, x, y, prevLon, started, lon, lat;
      for (i = 0; i < WORLD_LAND.length; i++) {
        ring = WORLD_LAND[i];
        ctx.beginPath(); started = false; prevLon = null;
        for (j = 0; j < ring.length; j++) {
          lon = ring[j][0]; lat = ring[j][1];
          if (prevLon !== null && Math.abs(lon - prevLon) > 180) started = false;
          x = px(lon); y = py(lat);
          if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
          prevLon = lon;
        }
        ctx.closePath();
        ctx.fillStyle = 'rgba(41,52,84,0.92)'; ctx.fill();
        ctx.strokeStyle = 'rgba(96,116,170,0.6)'; ctx.lineWidth = 0.8; ctx.stroke();
      }
    }
    function disc(x, y, r, fill, stroke) {
      ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fillStyle = fill; ctx.fill();
      if (stroke) { ctx.lineWidth = 1; ctx.strokeStyle = stroke; ctx.stroke(); }
    }
    function draw() {
      if (active !== 'world' || !document.body.contains(cv)) return;
      ctx.fillStyle = '#0b0f1c'; ctx.fillRect(0, 0, W, H);
      drawLand();
      var i, p, x, y, r;
      for (i = 0; i < base.length; i++) {
        p = base[i]; x = px(p.lon); y = py(p.lat);
        if (x < -20 || x > W + 20 || y < -20 || y > H + 20) continue;
        r = 2.2 + 6 * Math.sqrt((p.n || 0) / maxN);
        disc(x, y, r, 'rgba(120,150,255,0.5)', null);
      }
      var t = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
      var phase = t - Math.floor(t);
      for (i = 0; i < livePts.length; i++) {
        p = livePts[i]; x = px(p.lon); y = py(p.lat);
        if (x < -20 || x > W + 20 || y < -20 || y > H + 20) continue;
        var col = p.playing ? '255,90,160' : '120,220,255';
        var er = 4 + phase * 16;
        ctx.beginPath(); ctx.arc(x, y, er, 0, 6.2832);
        ctx.strokeStyle = 'rgba(' + col + ',' + (0.5 * (1 - phase)).toFixed(3) + ')';
        ctx.lineWidth = 2; ctx.stroke();
        disc(x, y, 4.2, 'rgba(' + col + ',0.95)', 'rgba(255,255,255,0.85)');
      }
      mapState.view = { z: z, panX: panX, panY: panY };
      mapState.raf = requestAnimationFrame(draw);
    }
    function relpt(e) {
      var b = cv.getBoundingClientRect(); var tt = e.touches ? e.touches[0] : e;
      return { x: (tt.clientX - b.left) * (W / b.width), y: (tt.clientY - b.top) * (H / b.height) };
    }
    function down(e) { dragging = true; cv.style.cursor = 'grabbing'; var p = relpt(e); lx = p.x; ly = p.y; }
    function move(e) { if (!dragging || !document.body.contains(cv)) return; var p = relpt(e); panX += (p.x - lx); panY += (p.y - ly); lx = p.x; ly = p.y; clampPan(); }
    function up() { dragging = false; cv.style.cursor = 'grab'; }
    function wheel(e) {
      e.preventDefault(); var p = relpt(e);
      var wx = (p.x - panX) / (W * z), wy = (p.y - panY) / (H * z);
      z = Math.max(1, Math.min(8, z * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      panX = p.x - wx * (W * z); panY = p.y - wy * (H * z); clampPan();
    }
    cv.addEventListener('mousedown', down);
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    cv.addEventListener('touchstart', down);
    cv.addEventListener('touchmove', function (e) { move(e); e.preventDefault(); });
    cv.addEventListener('touchend', up);
    cv.addEventListener('wheel', wheel, { passive: false });
    mapState = { raf: 0, view: { z: z, panX: panX, panY: panY }, detach: function () {
      document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
    } };
    clampPan(); draw();
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

  // ---------- Users ----------
  function renderUsers(d) {
    var s = d.summary || {};
    var U = d.users || [];
    setExport('users', U);
    var rows = U.map(function (u) {
      var loc = [u.city, u.country].filter(Boolean).map(esc).join(', ') || '<span class="muted">—</span>';
      return '<tr class="clickable" data-uid="' + esc(u.device_id) + '" data-uname="' + esc(u.name || 'Anonymous') + '"><td><span class="dot2 ' + (u.is_playing ? 'on' : 'off') + '"></span>' + esc(u.name || 'Anonymous') + '</td><td>' + loc + '</td><td><span class="pill">' + esc(u.platform || 'web') + '</span> <span class="muted">' + esc(String(u.device_id || '').slice(0, 8)) + '</span></td><td class="muted">' + date(u.first_seen) + '</td><td class="muted">' + ago(u.last_seen) + '</td><td><button class="ghost udel" data-del="' + esc(u.device_id) + '" style="padding:4px 10px;font-size:11px;color:#ff8a8a">Delete</button></td></tr>';
    }).join('');
    var canPrev = userOffset > 0;
    var canNext = U.length >= (d.limit || 50);
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
        var reason = window.prompt('Deleting this user and ALL their events.\n\nA reason is MANDATORY (kept as an audit note):');
        if (reason == null) return;
        reason = reason.trim();
        if (reason.length < 3) { window.alert('Deletion cancelled — a written reason is mandatory.'); return; }
        postApi('/api/admin/maintenance', { action: 'delete_user', device_id: b.getAttribute('data-del'), reason: reason }).then(function (r) { if (r) loadUsers(); }).catch(noop);
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
    apiMemo('/api/admin/user?deviceId=' + encodeURIComponent(deviceId)).then(function (d) {
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
        '<h2 style="margin:2px 0 2px">' + esc(name || u.name || 'Anonymous') + '</h2>' +
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
        ? '<span style="color:#36d399">OK ' + (k.status || '') + '</span>'
        : '<span style="color:#ff6b6b">FAIL ' + (k.status == null ? 'network' : k.status) + '</span>';
      var extra = k.configured ? '' : ' <span class="muted">(not configured)</span>';
      return '<tr><td>' + esc(k.key) + extra + '</td><td class="muted">' + esc((k.model || '—').split('/').pop() || '—') + '</td><td>' + badge + '</td><td class="muted">' + esc(k.note || '') + '</td></tr>';
    }).join('');
    var sb = h.supabase || {};
    var sbBadge = sb.lastEventAt
      ? '<span style="color:#36d399">last event ' + ago(sb.lastEventAt) + '</span>'
      : '<span style="color:#ff6b6b">' + esc(sb.note || 'no readable events') + '</span>';
    return '<table><thead><tr><th>Key</th><th>Model</th><th>Status</th><th>Detail</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<p class="muted" style="margin-top:8px">Supabase: ' + (sb.configured ? sbBadge : '<span style="color:#ff6b6b">not configured</span>') + '</p>';
  }
  function renderTechnical(d) {
    var s = d.summary || {};
    setExport('errors', d.errors || []);
    var errRows = (d.errors || []).map(function (e) { return '<tr><td><span class="pill">' + esc(e.error_kind) + '</span></td><td>' + esc(e.message || '—') + '</td><td>' + e.hits + '</td><td class="muted">' + ago(e.last_seen) + '</td></tr>'; }).join('');
    var vitCards = (d.vitals || []).map(function (v) {
      var val = v.p75 == null ? '—' : (v.p75 + (v.unit || ''));
      var split = v.count ? ('<span style="color:#36d399">' + v.good + ' good</span> · ' + v.ni + ' ni · <span style="color:#ff6b6b">' + v.poor + ' poor</span>') : 'no samples yet';
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
      '<h3>Data tools <span class="muted">· Supabase maintenance</span></h3><div class="row" style="flex-wrap:wrap;gap:8px">' +
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
        if (!window.confirm(msg)) return;
        el.disabled = true;
        postApi('/api/admin/maintenance', Object.assign({ action: action }, extra || {})).then(function (r) {
          el.disabled = false;
          var o = $('mt-out');
          if (o) o.textContent = r && r.ok ? 'Done ✓' : 'Failed';
          setTimeout(function () { if (o) o.textContent = ''; }, 4000);
        }).catch(function () { el.disabled = false; });
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
      return '<tr class="clickable" data-uid="' + esc(u.device_id) + '" data-uname="' + esc(u.name || 'Anonymous') + '"><td>' + esc(u.name || 'Anonymous') + '</td><td>' + u.plays + '</td></tr>';
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
          var st = x.ok ? '<span style="color:#36d399">ok</span>' : '<span style="color:#ff6b6b">' + esc(x.error || ('HTTP ' + (x.status || ''))) + '</span>';
          return '<tr><td class="muted">' + esc(ist(x.ts)) + '</td><td><span class="pill">' + esc(x.feature) + '</span></td><td class="muted">' + esc(x.model || '\u2014') + '</td><td>' + st + '</td><td>' + (x.latency_ms != null ? x.latency_ms + ' ms' : '\u2014') + '</td><td><span class="pill">' + esc(x.client || '\u2014') + '</span></td></tr>';
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
      '<h3>By model</h3>' + bars(m.by_model, function (x) { return esc(x.model); }, function (x) { return x.count; }) +
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
      return '<tr><td><span class="dot2 on"></span>' + esc(u.name || 'Anonymous') + '</td><td>' + esc([u.city, u.country].filter(Boolean).join(', ') || '—') + '</td><td>' + esc(u.current_song_title || '—') + '</td></tr>';
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
  var PN_BASES = ['https://saavn.dev/api', 'https://saavn.sumit.co/api', 'https://nepotuneapi.vercel.app/api', 'https://jiosaavn-api-privatecv8.b4a.run/api'];
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
    function tryNext() {
      if (i >= PN_BASES.length) { out.innerHTML = '<div class="empty">No results — catalog sources unavailable, try again.</div>'; return; }
      var base = PN_BASES[i]; i += 1;
      fetch(base + path, { signal: AbortSignal.timeout(6000) }).then(function (r) { return r.json(); }).then(function (j) {
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
        '<td>' + (isB ? '<span class="pill">blocked</span>' : '<button class="ghost ct-block" data-id="' + esc(t.song_id) + '" data-title="' + esc(t.song_title || '') + '" style="padding:3px 10px;font-size:11px;color:#ff8a8a">Block</button>') + '</td></tr>';
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
        if (r) loadContent(); else window.alert('Action failed');
      }).catch(noop);
    }
    $('ct-add').addEventListener('click', function () {
      var id = $('ct-id').value.trim();
      if (!id) { $('ct-out').textContent = 'Song ID required.'; return; }
      if (!window.confirm('Block this song for every listener?')) return;
      act('block', id, null, $('ct-reason').value.trim());
    });
    Array.prototype.forEach.call(document.querySelectorAll('.ct-block'), function (b) {
      b.addEventListener('click', function () {
        var reason = window.prompt('Reason for blocking (kept on record):', '') || '';
        act('block', b.getAttribute('data-id'), b.getAttribute('data-title'), reason.trim());
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('.ct-unblock'), function (b) {
      b.addEventListener('click', function () {
        if (!window.confirm('Unblock this song?')) return;
        act('unblock', b.getAttribute('data-id'));
      });
    });
    setExport('blocklist', blocked);
    stamp();
  }
  function loadContent() { apiMemo('/api/admin/content').then(function (d) { if (d && active === 'content') renderContent(d); }).catch(noop); }
  // ---------- Growth card (Overview) ----------
  function loadGrowth() {
    apiMemo('/api/admin/growth').then(function (d) {
      if (active !== 'overview' || !d) return;
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
        return '<div class="spk-bar" data-lbl="' + esc(lbl + ': ' + n) + '" style="flex:1;display:flex;flex-direction:column-reverse;height:100%;cursor:default"><div style="height:' + Math.max(4, Math.round((n / max) * 100)) + '%;background:linear-gradient(180deg, rgba(34,211,238,0.85), rgba(34,211,238,0.35));border-radius:4px 4px 0 0;transition:filter .12s"></div></div>';
      }).join('');
      var delta = d.prev14 > 0 ? Math.round(((d.last14 - d.prev14) / d.prev14) * 100) : (d.last14 > 0 ? 100 : 0);
      var dTxt = (delta >= 0 ? '+' : '') + delta + '% vs previous 14 days';
      view.insertAdjacentHTML('afterbegin',
        '<div class="card" id="growthbox" style="margin-bottom:14px;position:relative;overflow:visible"><h3 style="margin-top:0">New listeners <span class="muted">\u00b7 last 14 days \u00b7 <b>' + d.last14 + '</b> joined \u00b7 ' + esc(dTxt) + '</span></h3>' +
        '<div id="spk-wrap" style="display:flex;align-items:flex-end;gap:4px;height:64px;padding:6px 0;background:linear-gradient(180deg, transparent 40%, rgba(34,211,238,0.04))">' + bars + '</div>' +
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
    view.insertAdjacentHTML('afterbegin',
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
        return '<div class="pal-item' + (i === sel ? ' pal-sel' : '') + '" data-i="' + i + '" style="padding:9px 12px;border-radius:12px;cursor:pointer;font-size:13px;font-weight:600;' + (i === sel ? 'background:var(--grad);color:#fff' : '') + '">' + esc(it.label) + '</div>';
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
            '<td>' + (canRetract ? '<button class="ghost pn-retract" data-at="' + esc(r.created_at) + '" style="padding:3px 10px;font-size:11px;color:#ff8a8a">Retract</button>' : '') + '</td></tr>';
        }
        var parts = String(r.message || '').split('|');
        return '<tr><td><span class="pill">daily pick</span></td><td><b>' + esc(parts[1] || '') + '</b> <span class="muted">sent to ' + esc(parts[0] || '0') + ' device(s)</span></td><td class="muted">' + when + '</td><td></td></tr>';
      }).join('');
      host.innerHTML = '<h3>Sent log <span class="muted">· retracting an announcement stops app pickups; delivered web pushes can\u2019t be recalled</span></h3>' +
        '<table><thead><tr><th>Type</th><th>Content</th><th>When</th><th></th></tr></thead><tbody>' +
        (rows || '<tr><td colspan="4" class="empty">Nothing sent yet.</td></tr>') + '</tbody></table>';
      Array.prototype.forEach.call(host.querySelectorAll('.pn-retract'), function (b) {
        b.addEventListener('click', function () {
          if (!window.confirm('Retract this announcement? App users will stop receiving it on open.')) return;
          postApi('/api/admin/notifylog', { action: 'retract', created_at: b.getAttribute('data-at') }).then(function (r) {
            if (r && r.ok) loadNotifyLog();
            else window.alert('Retract failed');
          }).catch(noop);
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
      '<div class="row"><button id="sm-live">● Go live</button><button id="sm-maint" class="ghost" style="color:#ffb4b4">Enter maintenance</button><span class="muted" id="sm-out" style="font-size:12px"></span></div>' +
      '</div>');
    document.getElementById('sm-note').value = smNote;
    document.getElementById('sm-out').textContent = smOut;
    function refresh() {
      fetch('/api/site-mode?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
        smStatus = d.mode === 'maintenance' ? '· <b style="color:#ff8a8a">MAINTENANCE</b>' + (d.note ? ' — ' + esc(d.note) : '') : '· <b style="color:#7ce38b">LIVE</b>';
        var el = document.getElementById('sm-now');
        if (el) el.innerHTML = smStatus;
        stamp();
      }).catch(noop);
    }
    function setMode(mode) {
      var noteEl = document.getElementById('sm-note');
      var note = noteEl ? noteEl.value : '';
      var label = mode === 'maintenance' ? 'Put the WHOLE site into maintenance for every listener?' : 'Bring the site back live for everyone?';
      if (!window.confirm(label)) return;
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
    }
    document.getElementById('sm-live').addEventListener('click', function () { setMode('live'); });
    document.getElementById('sm-maint').addEventListener('click', function () { setMode('maintenance'); });
    refresh();
  }
  // ---------- Weekly digest (Overview) ----------
  function loadDigest() {
    apiMemo('/api/admin/digest').then(function (d) {
      if (active !== 'overview' || !d || !d.digest) return;
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
      view.insertAdjacentHTML('afterbegin',
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
      if (!window.confirm('Send this notification to ALL subscribed devices now?\n\nOpens: ' + link)) return;
      $('pn-send').disabled = true;
      $('pn-out').textContent = 'Sending…';
      postApi('/api/admin/push', { title: t, body: b, link: link }).then(function (r) {
        $('pn-send').disabled = false;
        if (!r) { $('pn-out').textContent = 'Failed'; return; }
        $('pn-out').textContent = 'Delivered to ' + (r.sent || 0) + ' of ' + (r.total || 0) + ' web device(s)' + (r.gone ? ' · ' + r.gone + ' expired removed' : '') + ' ✓ — the app picks it up on next open.';
        loadNotifyStat();
      }).catch(function () { $('pn-send').disabled = false; $('pn-out').textContent = 'Failed'; });
    });
    loadNotifyStat();
  }

  // ---------- Live Rooms ----------
  function renderRooms(d) {
    var rows = (d.rooms || []).map(function (r) {
      var live = r.members > 0 ? '<span class="dot2 on"></span>' : '<span class="dot2 off"></span>';
      var song = r.song_title ? esc(r.song_title) + (r.song_artist ? ' <span class="muted">· ' + esc(r.song_artist) + '</span>' : '') : '<span class="muted">—</span>';
      return '<tr><td>' + live + '<b>' + esc(r.code) + '</b></td><td>' + esc(r.host || '—') + '</td><td>' + r.members + '</td><td>' + song + '</td><td>' + (r.playing ? '<span class="pill">Playing</span>' : '<span class="pill">Paused</span>') + '</td><td class="muted">' + ago(r.updated_at) + '</td><td><button class="ghost rend" data-code="' + esc(r.code) + '" style="padding:4px 10px;font-size:11px;color:#ff8a8a">End</button></td></tr>';
    }).join('');
    $('view').innerHTML =
      '<div class="cards">' + card(d.active, 'Rooms live now') + card(d.listeners, 'People in rooms') + card((d.rooms || []).length, 'Rooms (last 2h)') + '</div>' +
      (rows
        ? '<h3>Listen Together rooms</h3><table><thead><tr><th>Code</th><th>Host</th><th>Members</th><th>Now playing</th><th>State</th><th>Updated</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>'
        : emptyState('empty_rooms', 'No Listen Together rooms right now', 'When listeners open a room and share the code, active + recent rooms show up here — with a one-click "end" for moderation.'));
    Array.prototype.forEach.call(document.querySelectorAll('button.rend'), function (b) {
      b.addEventListener('click', function () {
        if (!window.confirm('End room ' + b.getAttribute('data-code') + ' for everyone?')) return;
        postApi('/api/admin/maintenance', { action: 'end_room', code: b.getAttribute('data-code') }).then(function (r) { if (r) loadRooms(); }).catch(noop);
      });
    });
    setExport('rooms', d.rooms || []);
    stamp();
  }
  function loadRooms() { apiMemo('/api/admin/rooms').then(function (d) { if (d && active === 'rooms') renderRooms(d); }).catch(noop); }

  // ---------- AI Lab (streaming test bench for the seven AI lanes) ----------
  // Interactive pane: EXCLUDED from the silent auto-refresh — loadAiLab only
  // paints once and never clobbers a conversation in progress.
  var LAB_LANES = [
    // model = the lane's PINNED primary (must match functions/_lib/ai.ts LANE_MODEL).
    // v3.7.0: chat + dj re-pinned off NVIDIA gpt-oss-120b (hung >25s) to the fast
    // gpt-oss-20b on their own keys; nicknames unchanged (nickname != model).
    { lane: 'chat', name: 'FLASH', nick: 'VinaX FLASH', model: 'openai/gpt-oss-20b' },
    { lane: 'fast', name: '20B', nick: 'VinaX 20B', model: 'openai/gpt-oss-20b' },
    { lane: 'deep', name: 'SUPER', nick: 'VinaX SUPER', model: 'nvidia/llama-3.3-nemotron-super-49b-v1.5' },
    { lane: 'scholar', name: 'INSTANT', nick: 'VinaX INSTANT', model: 'llama-3.3-70b-versatile' },
    { lane: 'home', name: 'ULTRA', nick: 'VinaX ULTRA', model: 'nvidia/nemotron-3-ultra-550b-a55b' },
    { lane: 'dj', name: '120B', nick: 'VinaX 120B', model: 'openai/gpt-oss-20b' },
    { lane: 'search', name: 'NANO 3', nick: 'VinaX NANO 3', model: 'nvidia/nemotron-3-nano-30b-a3b' }
  ];
  var labLane = 'chat';
  var labHist = {}; // lane -> [{ role, content, error?, meta? }] — in memory only, gone on reload
  var labBusy = false;
  var labPingBusy = false;
  var labHealth = {}; // lane -> 'ok' | 'warn' | 'bad' — chip health dots (grey when unknown)
  var labPingedAt = ''; // 'HH:MM IST' when the last full ping sweep finished
  var labAutoPinged = false; // the first Lab open auto-pings once per page load

  function labInfo(lane) { for (var i = 0; i < LAB_LANES.length; i++) { if (LAB_LANES[i].lane === lane) return LAB_LANES[i]; } return LAB_LANES[0]; }
  function labShortModel(m) { var p = String(m || '').split('/'); return p[p.length - 1]; }
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
      host.innerHTML = '<div class="empty">No messages on this lane yet — type below. Replies come straight from the pinned engine, no failover.</div>';
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
    metaDiv.textContent = 'Contacting ' + labInfo(lane).nick + ' · ' + labShortModel(labInfo(lane).model) + '…';
    if (host) {
      var e0 = host.querySelector('.empty');
      if (e0) e0.remove();
      host.appendChild(bubble);
      host.appendChild(metaDiv);
      host.scrollTop = host.scrollHeight;
    }
    var t0 = Date.now();
    var meta = { model: labInfo(lane).model, lane: lane, ttfb: null, total: null, chars: 0, at: labNow() };
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
      body: JSON.stringify({ lane: lane, messages: outMsgs, maxTokens: 1000 })
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
    el.title = labInfo(lane).nick + ' · ' + labShortModel(labInfo(lane).model);
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
      fetch('/api/admin/ailab', {
        method: 'POST',
        headers: { 'x-admin-token': token(), 'content-type': 'application/json' },
        body: JSON.stringify({ lane: L.lane, messages: [{ role: 'user', content: 'ping' }], maxTokens: 1 })
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
  function renderAiLab() {
    var chips = LAB_LANES.map(function (L) {
      return '<button class="lab-chip' + (L.lane === labLane ? ' active' : '') + '" data-lane="' + esc(L.lane) + '">' +
        '<span class="ln"><span class="lab-dot" id="lab-dot-' + esc(L.lane) + '"></span>' + esc(L.name) + ' · ' + esc(L.lane) + '</span>' +
        '<span class="lm">' + esc(L.nick) + ' · ' + esc(labShortModel(L.model)) + '</span></button>';
    }).join('');
    $('view').innerHTML =
      '<div class="card" id="lab-root" style="max-width:860px">' +
      '<h3 style="margin-top:0">AI Lab <span class="muted">· each lane answers with its own key + pinned model — no failover, failures show honestly</span></h3>' +
      '<div class="lab-chips">' + chips + '</div>' +
      '<div class="row" style="margin-bottom:10px;flex-wrap:wrap"><button class="ghost" id="lab-ping">Ping all seven</button><span id="lab-ping-at" class="lab-ping-at"></span><span id="lab-pings" class="chips" style="margin:0"></span></div>' +
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
      });
    });
    $('lab-send').addEventListener('click', labSend);
    $('lab-clear').addEventListener('click', function () { labHist[labLane] = []; labPaintMsgs(); });
    $('lab-ping').addEventListener('click', labPingAll);
    $('lab-in').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); labSend(); }
    });
    labPaintDots();
    labPaintPingAt();
    // First open of the Lab auto-checks lane health once — dots fill in
    // without a click; later refreshes never repaint the chat.
    if (!labAutoPinged) { labAutoPinged = true; labPingAll(); }
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
      '<p class="muted" style="font-size:12.5px">Feeds from: <code style="color:#a78bfa">' + esc(endpoints[songsTab]) + '</code></p>' +
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

  // ---------- Home Screen Management (functional, localStorage-backed) ----------
  var HOME_CFG_KEY = 'vinax_admin_home_config';
  function loadHomeCfg() {
    try {
      var raw = localStorage.getItem(HOME_CFG_KEY);
      if (raw) { var j = JSON.parse(raw); if (Array.isArray(j)) return j; }
    } catch (e) {}
    return HOME_SHELVES_CATALOG.map(function (s, i) { return { id: s.id, name: s.name, order: i, enabled: true }; });
  }
  function saveHomeCfg(cfg) { try { localStorage.setItem(HOME_CFG_KEY, JSON.stringify(cfg)); return true; } catch (e) { return false; } }
  var hsCfg = null;
  function renderHomescreenSection() {
    if (!hsCfg) hsCfg = loadHomeCfg();
    hsCfg.sort(function (a, b) { return a.order - b.order; });
    var known = {}; hsCfg.forEach(function (s) { known[s.id] = true; });
    var addable = HOME_SHELVES_CATALOG.filter(function (s) { return !known[s.id]; });
    var rows = hsCfg.map(function (s, i) {
      return html`<div class="hs-row${s.enabled ? '' : ' disabled'}" data-id="${s.id}">` +
        '<span class="hs-ord">' + (i + 1) + '</span>' +
        html`<input class="hs-name" value="${s.name}" data-hn="${s.id}" />` +
        '<span class="muted" style="font-size:11px">' + esc((HOME_SHELVES_CATALOG.filter(function(c){return c.id===s.id;})[0] || {source:'custom'}).source) + '</span>' +
        '<span class="row" style="gap:4px"><button class="ghost hs-up" data-id="' + esc(s.id) + '" style="padding:3px 8px">▲</button><button class="ghost hs-dn" data-id="' + esc(s.id) + '" style="padding:3px 8px">▼</button></span>' +
        '<span class="row" style="gap:8px"><label class="switch"><span class="track ' + (s.enabled ? 'on' : '') + '"><span class="knob"></span></span><input type="checkbox" hidden class="hs-tog" data-id="' + esc(s.id) + '"' + (s.enabled ? ' checked' : '') + ' /></label><button class="ghost hs-del" data-id="' + esc(s.id) + '" style="padding:3px 10px;color:#ff8a8a">Remove</button></span>' +
        '</div>';
    }).join('');
    var addOpts = addable.map(function (s) { return '<option value="' + esc(s.id) + '">' + esc(s.name) + '</option>'; }).join('');
    $('view').innerHTML =
      '<div class="stub-banner"><h4>Preview mode — no backend yet</h4>' +
      '<p>Config is saved locally to <code>' + HOME_CFG_KEY + '</code>. TODO: wire <b>GET/PUT /api/admin/home-config</b> so this preview propagates to every client via /api/config.</p></div>' +
      '<div class="card" style="margin-bottom:14px"><h3 style="margin-top:0">Home shelves</h3>' +
      (rows || emptyState('empty_activity','No shelves configured','Click "Add section" below to seed one from the catalog.')) +
      '<div class="row" style="margin-top:12px;gap:8px">' +
        (addOpts ? '<select id="hs-add-pick" style="padding:8px 12px;border-radius:10px;border:1px solid #2a2a38;background:#13131c;color:#fff">' + addOpts + '</select><button id="hs-add">+ Add section</button>' : '<span class="muted" style="font-size:12px">All catalog shelves are added.</span>') +
        '<span class="spacer" style="flex:1"></span>' +
        '<button id="hs-save">Save config</button>' +
        '<button class="ghost" id="hs-reset">Reset</button>' +
        '<span class="muted" id="hs-out" style="font-size:12px"></span>' +
      '</div></div>' +
      '<h3>Saved JSON <span class="muted">· copy for a future config-table upload</span></h3>' +
      '<pre id="hs-json" style="background:#0d0d15;border:1px solid #23232f;border-radius:12px;padding:14px;font-size:12px;overflow:auto;max-height:280px">' + esc(JSON.stringify(hsCfg, null, 2)) + '</pre>';
    Array.prototype.forEach.call(document.querySelectorAll('.hs-up'), function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-id');
        var i = hsCfg.findIndex(function (s) { return s.id === id; });
        if (i > 0) { hsCfg[i].order = i - 1; hsCfg[i - 1].order = i; hsCfg = hsCfg.slice(); renderHomescreenSection(); }
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('.hs-dn'), function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-id');
        var i = hsCfg.findIndex(function (s) { return s.id === id; });
        if (i >= 0 && i < hsCfg.length - 1) { hsCfg[i].order = i + 1; hsCfg[i + 1].order = i; renderHomescreenSection(); }
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('.hs-tog'), function (chk) {
      var track = chk.parentNode.querySelector('.track');
      track.addEventListener('click', function () {
        var id = chk.getAttribute('data-id');
        var s = hsCfg.filter(function (x) { return x.id === id; })[0];
        if (s) { s.enabled = !s.enabled; renderHomescreenSection(); }
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('.hs-del'), function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-id');
        hsCfg = hsCfg.filter(function (s) { return s.id !== id; });
        hsCfg.forEach(function (s, i) { s.order = i; });
        renderHomescreenSection();
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('.hs-name'), function (inp) {
      inp.addEventListener('input', function () {
        var id = inp.getAttribute('data-hn');
        var s = hsCfg.filter(function (x) { return x.id === id; })[0];
        if (s) s.name = inp.value;
      });
    });
    var addBtn = $('hs-add');
    if (addBtn) addBtn.addEventListener('click', function () {
      var picked = $('hs-add-pick').value;
      var src = HOME_SHELVES_CATALOG.filter(function (s) { return s.id === picked; })[0];
      if (!src) return;
      hsCfg.push({ id: src.id, name: src.name, order: hsCfg.length, enabled: true });
      renderHomescreenSection();
    });
    $('hs-save').addEventListener('click', function () {
      var ok = saveHomeCfg(hsCfg);
      $('hs-out').textContent = ok ? 'Saved locally ✓' : 'Save failed';
      setTimeout(function () { $('hs-out').textContent = ''; }, 3000);
    });
    $('hs-reset').addEventListener('click', function () {
      if (!window.confirm('Reset to catalog defaults?')) return;
      try { localStorage.removeItem(HOME_CFG_KEY); } catch (e) {}
      hsCfg = null; renderHomescreenSection();
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
            '<button class="ghost" disabled title="Backend endpoint required — /api/admin/categories" style="padding:3px 10px;font-size:11px;color:#ff8a8a">Delete</button>' +
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

  // ---------- Banner & Promotion Management ----------
  var BN_KEY = 'vinax_admin_banners';
  var bnPreview = { title: '', subtitle: '', linkType: 'song', linkId: '', start: '', end: '', img: '' };
  function renderBannersSection() {
    var saved = [];
    try { var raw = localStorage.getItem(BN_KEY); if (raw) saved = JSON.parse(raw) || []; } catch (e) {}
    var savedRows = saved.map(function (b, i) {
      return html`<tr><td>${b.title}</td><td class="muted">${b.subtitle}</td><td><span class="pill">${b.linkType}</span> ${b.linkId}</td><td class="muted">${b.start || '—'} → ${b.end || '—'}</td>` +
        '<td><button class="ghost bn-del" data-i="' + i + '" style="padding:3px 10px;font-size:11px;color:#ff8a8a">Delete</button></td></tr>';
    }).join('');
    $('view').innerHTML =
      '<div class="stub-banner"><h4>Local preview only</h4>' +
      '<p>Banner metadata is stashed in <code>' + BN_KEY + '</code>. Upload converts to base64 for preview — no bytes leave the browser. TODO: <b>POST /api/admin/banners</b> for real publish + object-storage upload.</p></div>' +
      '<div class="card" style="margin-bottom:14px"><h3 style="margin-top:0">Compose</h3>' +
      '<div class="row" style="flex-wrap:wrap;gap:10px">' +
        '<input id="bn-title" type="text" placeholder="Title" value="' + esc(bnPreview.title) + '" style="max-width:280px" />' +
        '<input id="bn-sub" type="text" placeholder="Subtitle" value="' + esc(bnPreview.subtitle) + '" style="max-width:280px" />' +
      '</div>' +
      '<div class="row" style="flex-wrap:wrap;gap:10px;margin-top:8px">' +
        '<select id="bn-type" style="padding:10px 12px;border-radius:10px;border:1px solid #2a2a38;background:#13131c;color:#fff">' +
          ['song','album','playlist','artist'].map(function (t) { return '<option value="' + t + '"' + (bnPreview.linkType === t ? ' selected' : '') + '>' + t + '</option>'; }).join('') +
        '</select>' +
        '<input id="bn-id" type="text" placeholder="Link ID" value="' + esc(bnPreview.linkId) + '" style="max-width:220px" />' +
        '<input id="bn-start" type="date" value="' + esc(bnPreview.start) + '" style="padding:9px 12px;border-radius:10px;border:1px solid #2a2a38;background:#13131c;color:#fff" />' +
        '<input id="bn-end" type="date" value="' + esc(bnPreview.end) + '" style="padding:9px 12px;border-radius:10px;border:1px solid #2a2a38;background:#13131c;color:#fff" />' +
      '</div>' +
      '<div class="row" style="margin-top:10px"><input id="bn-file" type="file" accept="image/*" /><span class="muted" style="font-size:12px">Converted to base64 preview only</span></div>' +
      '<h3>Preview</h3>' +
      '<div class="bn-preview" id="bn-prev">' +
        (bnPreview.img ? '<img src="' + esc(bnPreview.img) + '" alt="" style="max-height:80px;border-radius:8px;margin-bottom:8px" />' : '') +
        '<h4>' + esc(bnPreview.title || 'Your banner title') + '</h4><p>' + esc(bnPreview.subtitle || 'A helpful subtitle appears here') + '</p></div>' +
      '<div class="row" style="margin-top:12px"><button id="bn-save">Save (preview only)</button><span class="muted" id="bn-out" style="font-size:12px"></span></div></div>' +
      '<h3>Saved banners (' + saved.length + ')</h3>' +
      (savedRows ? '<table><thead><tr><th>Title</th><th>Subtitle</th><th>Link</th><th>Schedule</th><th></th></tr></thead><tbody>' + savedRows + '</tbody></table>'
        : emptyState('empty_activity','No banners yet','Compose one above and click "Save" to stash it locally.')) +
      '<h3>Saved JSON</h3><pre style="background:#0d0d15;border:1px solid #23232f;border-radius:12px;padding:14px;font-size:12px;overflow:auto;max-height:220px">' + esc(JSON.stringify(saved, null, 2)) + '</pre>';
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
      if (!bnPreview.title.trim()) { $('bn-out').textContent = 'Title required.'; return; }
      var next = saved.concat([{ title: bnPreview.title, subtitle: bnPreview.subtitle, linkType: bnPreview.linkType, linkId: bnPreview.linkId, start: bnPreview.start, end: bnPreview.end, savedAt: new Date().toISOString() }]);
      try { localStorage.setItem(BN_KEY, JSON.stringify(next)); $('bn-out').textContent = 'Saved locally ✓'; setTimeout(renderBannersSection, 400); }
      catch (e) { $('bn-out').textContent = 'Save failed (storage full?)'; }
    });
    Array.prototype.forEach.call(document.querySelectorAll('.bn-del'), function (b) {
      b.addEventListener('click', function () {
        var i = parseInt(b.getAttribute('data-i'), 10);
        saved.splice(i, 1);
        try { localStorage.setItem(BN_KEY, JSON.stringify(saved)); } catch (e) {}
        renderBannersSection();
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
      '<div class="row" style="align-items:center;gap:12px;margin-bottom:12px"><img src="/icons/icon.svg" alt="" style="width:56px;height:56px;border-radius:14px;background:#fff2;padding:6px" /><button class="ghost" disabled title="Backend endpoint required — /api/admin/config">Change logo</button></div>' +
      '<div class="row" style="gap:10px;flex-wrap:wrap"><label style="font-size:12px;color:#8a8a99">Theme color</label><input id="cfg-color" type="color" value="' + esc(cfg.theme) + '" style="width:44px;height:34px;padding:0;border-radius:8px;border:1px solid #2a2a38;background:#13131c" /></div>' +
      '<p class="muted" style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;margin:14px 0 6px">Accent</p>' +
      '<div class="sw" id="cfg-sw">' + ACCENTS.map(function (a) {
        return '<button data-acc="' + a + '"' + (cfg.accent === a ? ' class="on"' : '') + ' style="background:' + ACCENT_COLORS[a] + '" title="' + a + '"></button>';
      }).join('') + '</div></div>' +
      '<div class="card" style="margin-bottom:14px"><h3 style="margin-top:0">Defaults</h3>' +
      '<label style="font-size:12px;color:#8a8a99">Default homepage shelves</label>' +
      '<textarea id="cfg-shelves" rows="5" style="width:100%;padding:10px 12px;border-radius:10px;border:1px solid #2a2a38;background:#13131c;color:#fff;font-size:13px;margin-top:4px">' + esc(cfg.defaultShelves) + '</textarea>' +
      '<div class="row" style="gap:10px;margin-top:10px;flex-wrap:wrap"><label style="font-size:12px;color:#8a8a99">Default language</label>' +
      '<select id="cfg-lang" style="padding:8px 12px;border-radius:10px;border:1px solid #2a2a38;background:#13131c;color:#fff">' +
        LANGUAGES_STATIC.map(function (l) { return '<option value="' + l + '"' + (cfg.defaultLang === l ? ' selected' : '') + '>' + (l.charAt(0).toUpperCase() + l.slice(1)) + '</option>'; }).join('') +
      '</select></div>' +
      '<label style="font-size:12px;color:#8a8a99;display:block;margin-top:10px">Default playlists</label>' +
      '<textarea id="cfg-pls" rows="4" style="width:100%;padding:10px 12px;border-radius:10px;border:1px solid #2a2a38;background:#13131c;color:#fff;font-size:13px;margin-top:4px">' + esc(cfg.defaultPlaylists) + '</textarea></div>' +
      '<div class="card" id="cfg-mm-box" style="margin-bottom:14px"><h3 style="margin-top:0">Maintenance mode message</h3>' +
      '<p class="muted" style="font-size:12px">Reads / writes to <code>/api/admin/site-mode</code> via /api/admin/maintenance.</p>' +
      '<textarea id="cfg-mm" rows="3" style="width:100%;padding:10px 12px;border-radius:10px;border:1px solid #2a2a38;background:#13131c;color:#fff;font-size:13px" placeholder="Loading current…"></textarea>' +
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
      if (!window.confirm('Reset config to defaults?')) return;
      try { localStorage.removeItem(CFG_KEY); } catch (e) {}
      renderConfigSection();
    });
    stamp();
  }

  var TITLES = { overview: 'Overview', live: 'Live Listening', activity: 'Activity Feed', location: 'Location Analytics', world: 'World Listening', music: 'Music Analytics', insights: 'Insights', users: 'User Management', technical: 'Technical Monitoring', feedback: 'Feedback & Bug Reports', ai: 'AI Monitoring', rooms: 'Live Rooms', realtime: 'Real-Time', search: 'Search Analytics', engagement: 'Engagement', notify2: 'Notifications', content: 'Content Control', ailab: 'AI Lab', songs: 'Song Management', playlists: 'Playlist Management', homescreen: 'Home Screen Management', categories: 'Categories & Genres', banners: 'Banner & Promotion', config: 'App Configuration' };
  var USES_RANGE = { location: true, world: true, music: true, technical: true, insights: true, ai: true, search: true, engagement: true };
  function refreshActive() {
    if (active === 'overview') loadOverview();
    else if (active === 'live') loadLive();
    else if (active === 'activity') loadActivity();
    else if (active === 'location') loadLocation();
    else if (active === 'world') loadWorld();
    else if (active === 'music') loadMusic();
    else if (active === 'insights') loadInsights();
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
    else if (active === 'config') renderConfigSection();
  }
  document.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
  });
  function formFocused() {
    var el = document.activeElement;
    return !!(el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') && $('view').contains(el));
  }
  function autoTick() {
    if (formFocused()) return;
    refreshActive();
  }
  function startAuto() { stopAuto(); if (autoRefresh && !document.hidden) autoTimer = setInterval(autoTick, refreshMs); }
  function stopAuto() { if (autoTimer) { clearInterval(autoTimer); autoTimer = null; } }
  function setSection(sec) {
    memoReset();
    active = sec;
    try { if (location.hash !== '#' + sec) location.hash = sec; localStorage.setItem('vinax_admin_sec', sec); } catch (e) {}
    Array.prototype.forEach.call(document.querySelectorAll('#nav button[data-sec]'), function (b) { b.classList.toggle('active', b.getAttribute('data-sec') === sec); });
    $('secTitle').textContent = TITLES[sec] || '';
    var v = $('view'); v.classList.remove('enter'); void v.offsetWidth; v.classList.add('enter');
    $('range').hidden = !USES_RANGE[sec];
    $('csv').hidden = true;
    $('view').innerHTML = '<div class="empty">Loading…</div>';
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
      sel.style.cssText = 'padding:7px 11px;border-radius:999px;border:1px solid #2a2a38;background:#13131c;color:#cfcfda;font-size:12px;cursor:pointer';
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

    // ---- Sortable table columns ----
    $('view').addEventListener('click', function (e) {
      if (e.target && e.target.id === 'hrecheck') {
        var el = document.getElementById('healthbox');
        if (el) el.innerHTML = '<div class="empty">Re-checking…</div>';
        api('/api/admin/health').then(function (h) { var b = document.getElementById('healthbox'); if (b) b.innerHTML = healthHtml(h); }).catch(noop);
        return;
      }
      var th = e.target && e.target.closest ? e.target.closest('th') : null;
      if (!th) return;
      var table = th.closest('table'); var tbody = table && table.querySelector('tbody');
      if (!tbody || tbody.querySelector('.empty')) return;
      var idx = Array.prototype.indexOf.call(th.parentNode.children, th);
      var dir = th.classList.contains('s-asc') ? -1 : 1;
      Array.prototype.forEach.call(th.parentNode.children, function (h) { h.classList.remove('s-asc', 's-desc'); });
      th.classList.add(dir === 1 ? 's-asc' : 's-desc');
      var rows = Array.prototype.slice.call(tbody.rows);
      rows.sort(function (a, b) {
        var av = (a.cells[idx] ? a.cells[idx].textContent : '').trim();
        var bv = (b.cells[idx] ? b.cells[idx].textContent : '').trim();
        var an = parseFloat(av.replace(/[^0-9.\-]/g, '')), bn = parseFloat(bv.replace(/[^0-9.\-]/g, ''));
        if (!isNaN(an) && !isNaN(bn) && av !== '' && bv !== '') return (an - bn) * dir;
        return av.localeCompare(bv) * dir;
      });
      rows.forEach(function (r) { tbody.appendChild(r); });
    });

    // ---- Double-click any card or table → fullscreen zoom (Esc closes) ----
    // Never from form fields/buttons: double-clicking to select text in a
    // filter box used to pop the whole panel into the overlay by accident.
    $('view').addEventListener('dblclick', function (e) {
      var t = e.target;
      if (t && t.closest && t.closest('input, textarea, select, button, a, label, [contenteditable]')) return;
      var z = t && t.closest ? t.closest('.card, table') : null;
      if (z) z.classList.toggle('zoomed');
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') Array.prototype.forEach.call(document.querySelectorAll('.zoomed'), function (z) { z.classList.remove('zoomed'); });
    });

    // ---- JSON export of the current panel ----
    $('json').disabled = true;
    $('json').addEventListener('click', function () {
      if (!lastJson) { window.alert('No data loaded yet — open any dashboard first.'); return; }
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
        try { navigator.clipboard.writeText(txt).then(function () { $('report').textContent = '✓'; setTimeout(function () { $('report').textContent = '📋'; }, 1200); }); } catch (err) { window.prompt('Copy report:', txt); }
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
        else if (Notification.permission === 'denied') window.alert('Notifications are blocked for this site in the browser settings.');
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
      apiMemo('/api/admin/overview').then(function (d) {
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
    setInterval(kpiTick, 60_000);

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
  $('enter').addEventListener('click', function () { var t = $('token').value.trim(); if (!t) { $('loginErr').textContent = 'Enter a token.'; return; } sessionStorage.setItem(TOKEN_KEY, t); start(); });
  $('token').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('enter').click(); });
  $('logout').addEventListener('click', function () { sessionStorage.removeItem(TOKEN_KEY); showLogin(''); });
  $('refresh').addEventListener('click', refreshActive);
  $('csv').addEventListener('click', downloadCsv);
  $('autoWrap').addEventListener('click', function () { setAuto(!autoRefresh); });
  $('modal').addEventListener('click', function (e) { if (e.target === $('modal')) closeModal(); });

  if (token()) start(); else showLogin('');
})();
