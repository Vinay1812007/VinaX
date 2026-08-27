/* VinaX status page — standalone, no app dependencies. Reads the public
   /api/status feed and paints per-component 90-day uptime bars. */
(function () {
  'use strict';
  var API = 'https://www.sirimillavinay.online/api/status';
  var banner = document.getElementById('banner');
  var board = document.getElementById('board');
  var err = document.getElementById('err');

  function utcDays(n) {
    var out = [];
    var now = new Date();
    var today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    for (var i = n - 1; i >= 0; i--) out.push(new Date(today - i * 86400000).toISOString().slice(0, 10));
    return out;
  }

  function fmtDay(d) {
    var dt = new Date(d + 'T00:00:00Z');
    return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }

  function stateText(c) {
    if (c.status === 'up') return 'Operational' + (c.latencyMs != null ? ' · ' + c.latencyMs + ' ms' : '');
    if (c.status === 'down') return 'Down';
    return 'No recent data';
  }

  var note = document.getElementById('note');
  function renderNote(n) {
    var text = typeof n === 'string' ? n : n && typeof n.text === 'string' ? n.text : '';
    if (!text.trim()) { note.style.display = 'none'; note.textContent = ''; return; }
    note.textContent = text.trim();
    note.style.display = 'block';
  }
  function render(data) {
    err.style.display = 'none';
    renderNote(data.note);
    document.getElementById('window').textContent = String(data.windowDays || 90);
    banner.className = data.overall === 'operational' ? 'ok' : data.overall === 'outage' ? 'bad' : '';
    banner.textContent =
      data.overall === 'operational' ? 'All Systems Operational'
      : data.overall === 'outage' ? 'Some systems are having issues'
      : 'Status data is warming up';
    var days = utcDays(data.windowDays || 90);
    board.textContent = '';
    (data.components || []).forEach(function (c) {
      var byDay = {};
      (c.days || []).forEach(function (d) { byDay[d.day] = d; });
      var comp = document.createElement('div');
      comp.className = 'comp';
      var head = document.createElement('div');
      head.className = 'head';
      var nm = document.createElement('span');
      nm.className = 'name';
      nm.textContent = c.name;
      var st = document.createElement('span');
      st.className = 'state ' + c.status;
      st.textContent = stateText(c);
      head.appendChild(nm); head.appendChild(st);
      var bars = document.createElement('div');
      bars.className = 'bars';
      days.forEach(function (d) {
        var i = document.createElement('i');
        var row = byDay[d];
        if (row && row.total > 0) {
          var ratio = row.up / row.total;
          i.className = ratio >= 1 ? 'g' : ratio >= 0.5 ? 'w' : 'r';
          i.setAttribute('data-tip', fmtDay(d) + '\n' + row.up + ' / ' + row.total + ' checks up');
        } else {
          i.setAttribute('data-tip', fmtDay(d) + '\nNo data recorded');
        }
        bars.appendChild(i);
      });
      var legend = document.createElement('div');
      legend.className = 'legend';
      var l1 = document.createElement('span'); l1.textContent = days.length + ' days ago';
      var rule1 = document.createElement('span'); rule1.className = 'rule';
      var pct = document.createElement('span'); pct.className = 'pct';
      pct.textContent = c.uptime90 != null ? c.uptime90.toFixed(2) + ' % uptime' : 'no data yet';
      var rule2 = document.createElement('span'); rule2.className = 'rule';
      var l2 = document.createElement('span'); l2.textContent = 'Today';
      legend.appendChild(l1); legend.appendChild(rule1); legend.appendChild(pct); legend.appendChild(rule2); legend.appendChild(l2);
      comp.appendChild(head); comp.appendChild(bars); comp.appendChild(legend);
      board.appendChild(comp);
    });
  }

  function load() {
    fetch(API, { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then(render)
      .catch(function () {
        err.style.display = 'block';
        banner.className = '';
        banner.textContent = 'Status feed unreachable';
      });
  }
  load();
  setInterval(load, 60000);
})();
