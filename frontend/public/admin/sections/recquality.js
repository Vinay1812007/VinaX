/*
 * 7.2.0 — Recommendation Quality (GET /api/admin/recquality).
 *
 * Opt-in telemetry only: every number describes the devices whose listener
 * turned usage sharing on, never all listeners, and the panel says so first.
 * Rates are shown with their sample count and a 95 % interval; below 30
 * samples a rate is written as "k of n" so a handful of songs never reads as
 * a precise percentage. Groups the server withholds (fewer than its device
 * minimum) show counts only. Every value is escaped through h.html / h.esc.
 */
(function () {
  'use strict';
  var KEY = 'recquality';
  var WINDOWS = [[1, '24h'], [7, '7d'], [30, '30d'], [90, '90d']];
  var days = null;

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  // 11.0 — the error state component comes from app.js; a host that does not
  // hand it over (a unit test, an older shell) still gets the message as text.
  function errState(h, msg) { return typeof h.stateError === 'function' ? h.stateError(msg) : '<div class="state state-error empty" role="alert"><div class="state-hint">' + h.esc(msg) + '</div></div>'; }
  function n0(v) { return typeof v === 'number' && isFinite(v) ? v : 0; }
  function pct(x) { return Math.round(x * 100); }
  function fmtCount(v) { return typeof v === 'number' && isFinite(v) ? v.toLocaleString() : '—'; }

  /** A rate as text: "k of n (likely a–b %)" for small samples, "r % (a–b %) · n" otherwise. */
  function rateText(r) {
    if (!isObj(r) || typeof r.rate !== 'number' || !(r.n > 0)) return '—';
    var band = (typeof r.low === 'number' && typeof r.high === 'number') ? pct(r.low) + '–' + pct(r.high) + '%' : '';
    if (r.n < 30) return n0(r.k) + ' of ' + r.n + (band ? ' (likely ' + band + ')' : '');
    return pct(r.rate) + '%' + (band ? ' (' + band + ')' : '') + ' · n=' + r.n.toLocaleString();
  }
  function secText(d) {
    if (!isObj(d) || typeof d.p50 !== 'number') return '—';
    var band = (typeof d.p50Low === 'number' && typeof d.p50High === 'number' && d.p50Low !== d.p50High) ? ' (' + Math.round(d.p50Low) + '–' + Math.round(d.p50High) + ' s)' : '';
    return Math.round(d.p50) + ' s' + band + ' · n=' + n0(d.n);
  }
  function msText(d) {
    if (!isObj(d) || typeof d.p50 !== 'number') return '—';
    return Math.round(d.p50) + ' / ' + (typeof d.p95 === 'number' ? Math.round(d.p95) + ' ms' : 'p95 needs 20+') + ' · n=' + n0(d.n);
  }
  function reasons(map) {
    if (!isObj(map)) return '';
    return Object.keys(map).map(function (k) { return k + ' ' + n0(map[k]); }).join(', ');
  }

  function windowBar(h) {
    return '<div class="seg" role="group" aria-label="Window" style="margin-bottom:var(--s-4)">' + WINDOWS.map(function (w) {
      var on = w[0] === days;
      return h.html`<button type="button" data-rq-days="${w[0]}" aria-pressed="${on ? 'true' : 'false'}">${w[1]}</button>`;
    }).join('') + '</div>';
  }

  function groupRow(h, g) {
    if (!isObj(g)) return '';
    if (g.withheld) {
      return h.html`<tr><td><code>${g.key}</code></td><td>${fmtCount(g.devices)}</td><td>${fmtCount(g.continuations)}</td><td>${fmtCount(g.exposures)}</td>` +
        h.html`<td colspan="9" class="muted">Counts only — fewer than ${g.minDevices || 3} devices, so rates are withheld.</td></tr>`;
    }
    var o = isObj(g.outcomes) ? g.outcomes : {};
    var s = isObj(g.served) ? g.served : {};
    return h.html`<tr><td><code>${g.key}</code></td><td>${fmtCount(g.devices)}</td><td>${fmtCount(g.continuations)}</td><td>${fmtCount(g.exposures)}</td>` +
      h.html`<td>${rateText(o.completion)}</td><td>${rateText(o.earlySkip)}</td><td>${rateText(o.skip)}</td><td>${rateText(o.likes)}</td><td>${rateText(o.repeats)}</td>` +
      h.html`<td>${secText(o.heardSec)}</td><td>${rateText(s.fallback)}</td><td>${s.languageViolations ? rateText(s.languageViolations.rate) : '—'}</td><td>${msText(s.latencyMs)}</td></tr>`;
  }

  function breakdown(h, title, list, minDevices) {
    var rows = Array.isArray(list) ? list : [];
    var head = '<thead><tr><th>Group</th><th>Devices</th><th>Continuations</th><th>Songs started</th><th>Completion</th><th>Early skip</th><th>Skip</th><th>Likes</th><th>Repeats</th><th>Median heard</th><th>Fallback</th><th>Language violations</th><th>Latency p50 / p95</th></tr></thead>';
    var body = rows.length ? rows.map(function (g) { return groupRow(h, isObj(g) ? Object.assign({ minDevices: minDevices }, g) : g); }).join('') : '<tr class="table-empty"><td colspan="13"><div class="state state-empty empty" role="status"><div class="state-title">No telemetry in this window</div><div class="state-hint">Recommendation telemetry arrives as listeners play suggested songs. Widen the window to look further back.</div></div></td></tr>';
    return h.html`<div class="card" style="margin-bottom:14px;overflow-x:auto"><h3 style="margin-top:0">${title}</h3>` + '<table>' + head + '<tbody>' + body + '</tbody></table></div>';
  }

  function overallTable(h, g) {
    var o = isObj(g.outcomes) ? g.outcomes : {};
    var s = isObj(g.served) ? g.served : {};
    var fb = isObj(s.fallback) ? s.fallback : null;
    var lines = [
      ['Completion rate', rateText(o.completion), 'Automatic songs played to the end'],
      ['Early-skip rate', rateText(o.earlySkip), 'Skipped with under 30 s heard'],
      ['Skip rate', rateText(o.skip), 'Any skip'],
      ['Likes', rateText(o.likes), 'Liked while it was the automatic song'],
      ['Repeats', rateText(o.repeats), 'The same song served again to the same device in this window'],
      ['Median listened', secText(o.heardSec), 'Seconds heard per automatic song, with its interval'],
      ['Fallback rate', rateText(fb) + (fb && reasons(fb.byReason) ? ' — ' + reasons(fb.byReason) : ''), 'Continuations where the AI picker was skipped or failed'],
      ['Language violations', s.languageViolations ? rateText(s.languageViolations.rate) : '—', 'Songs outside the queue language'],
      ['Discovery share', rateText(s.discovery), 'Songs by an artist the listener never played'],
      ['Diversity', isObj(s.diversity) && typeof s.diversity.mean === 'number' ? s.diversity.mean + ' distinct lead artists per continuation · n=' + n0(s.diversity.n) : 'Not reported by this app version', 'Distinct lead artists per continuation'],
      ['Request latency p50 / p95', msText(s.latencyMs), 'From asking for a continuation to having one'],
      ['Relaxed rules', reasons(s.relaxed) || '—', 'Validation rules relaxed to fill a continuation'],
    ];
    return '<div class="card" style="margin-bottom:14px"><h3 style="margin-top:0">All opt-in devices</h3><table><thead><tr><th>Measure</th><th>Value (95% interval)</th><th>What it counts</th></tr></thead><tbody>' +
      lines.map(function (l) { return h.html`<tr><td>${l[0]}</td><td>${l[1]}</td><td class="muted">${l[2]}</td></tr>`; }).join('') + '</tbody></table></div>';
  }

  function exportRows(d) {
    var out = [];
    [['alg', d.byAlg], ['picker', d.byPicker], ['variant', d.byVariant]].forEach(function (pair) {
      (Array.isArray(pair[1]) ? pair[1] : []).forEach(function (g) {
        if (!isObj(g)) return;
        var o = isObj(g.outcomes) ? g.outcomes : {};
        var s = isObj(g.served) ? g.served : {};
        var r = function (x) { return isObj(x) && typeof x.rate === 'number' ? x.rate : ''; };
        var n = function (x) { return isObj(x) ? n0(x.n) : ''; };
        out.push({ dimension: pair[0], group: g.key, devices: g.devices, continuations: g.continuations, exposures: g.exposures, withheld: !!g.withheld,
          completion: r(o.completion), completion_n: n(o.completion), early_skip: r(o.earlySkip), early_skip_n: n(o.earlySkip), skip: r(o.skip), likes: r(o.likes), repeats: r(o.repeats),
          median_heard_sec: isObj(o.heardSec) && typeof o.heardSec.p50 === 'number' ? o.heardSec.p50 : '', fallback: r(s.fallback), latency_p50_ms: isObj(s.latencyMs) && typeof s.latencyMs.p50 === 'number' ? s.latencyMs.p50 : '' });
      });
    });
    return out;
  }

  function paint(h, d) {
    if (!isObj(d)) { h.view(errState(h, 'Unexpected response from the server.')); return; }
    if (d.configured === false) { h.view('<div class="state state-empty empty" role="status"><div class="state-title">The database is not configured on this Worker</div><div class="state-hint">Bind the database to the Worker, deploy, then reload this page.</div></div>'); return; }
    var scope = h.html`<div class="card" style="margin-bottom:14px;border-color:var(--warn)"><b>Opt-in telemetry only — ${fmtCount(n0(d.devices))} devices.</b> <span class="muted">These numbers describe listeners who turned on usage sharing, not all listeners. Aggregates only: no individual listening history is read out. Groups with fewer than ${n0(d.minDevices) || 3} devices show counts only.</span></div>`;
    if (d.provisioned === false) {
      h.view(scope + windowBar(h) + h.html`<div class="card"><b>Not provisioned.</b> <span class="muted">${d.note || 'The events table cannot hold recommendation telemetry yet.'}</span></div>`);
      bind(h);
      h.stamp();
      return;
    }
    if (!isObj(d.overall)) { h.view(scope + errState(h, 'Unexpected response from the server.')); return; }
    var g = d.overall;
    var o = isObj(g.outcomes) ? g.outcomes : {};
    var s = isObj(g.served) ? g.served : {};
    var cards = '<div class="cards">' +
      h.html`<div class="card"><div class="n">${fmtCount(g.continuations)}</div><div class="l">Continuations served · ${n0(d.days)} d</div></div>` +
      h.html`<div class="card"><div class="n">${fmtCount(g.exposures)}</div><div class="l">Automatic songs started</div></div>` +
      h.html`<div class="card"><div class="n">${g.withheld ? '—' : secText(o.heardSec).split(' · ')[0]}</div><div class="l">Median listened</div></div>` +
      h.html`<div class="card"><div class="n">${g.withheld ? '—' : rateText(o.earlySkip).split(' · ')[0]}</div><div class="l">Early-skip rate</div></div>` +
      h.html`<div class="card"><div class="n">${g.withheld ? '—' : rateText(s.fallback).split(' · ')[0]}</div><div class="l">Fallback rate</div></div>` +
      '</div>';
    var notes = (d.truncated ? h.html`<p class="muted">Only the newest ${fmtCount(n0(d.sampled))} rows of this window were read; older rows are not counted.</p>` : '') +
      (g.withheld ? h.html`<div class="card" style="margin-bottom:14px"><b>Too few devices to show rates.</b> <span class="muted">${fmtCount(n0(d.devices))} opt-in devices sent recommendation telemetry in this window; rates appear from ${n0(d.minDevices) || 3}.</span></div>` : overallTable(h, g));
    h.view(scope + windowBar(h) + cards + notes +
      breakdown(h, 'By algorithm version', d.byAlg, d.minDevices) +
      breakdown(h, 'By picker', d.byPicker, d.minDevices) +
      breakdown(h, 'By experiment variant', d.byVariant, d.minDevices));
    h.setExport('rec-quality', exportRows(d));
    bind(h);
    h.stamp();
  }

  function bind(h) {
    var root = document.getElementById('view');
    if (!root) return;
    Array.prototype.forEach.call(root.querySelectorAll('[data-rq-days]'), function (b) {
      b.addEventListener('click', function () { days = parseInt(b.getAttribute('data-rq-days'), 10) || 7; load(h); });
    });
  }

  // app.js titles its own sections from a table that does not list this one;
  // fill the toolbar heading and crumb only while they are empty (text only).
  function shellTitle(h) {
    var t = h.$ ? h.$('secTitle') : null;
    if (t && !t.textContent) t.textContent = 'Recommendation Quality';
    var c = h.$ ? h.$('secCrumb') : null;
    if (c && !c.textContent) c.textContent = 'Analytics';
  }

  function load(h) {
    shellTitle(h);
    if (days === null) days = [1, 7, 30, 90].indexOf(h.days()) >= 0 ? h.days() : 7;
    return h.apiMemo('/api/admin/recquality?days=' + days).then(function (d) {
      if (!d || !h.isActive(KEY)) return;
      paint(h, d);
    }).catch(function (e) { if (h.isActive(KEY)) h.fail(e); });
  }

  window.VinaXAdminSections.register(KEY, { local: false, title: 'Recommendation Quality', load: load });
})();
