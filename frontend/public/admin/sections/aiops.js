/*
 * 7.2.0 — AI Operations (GET /api/admin/aiops) and the AI emergency controls.
 *
 * Top: per feature and per provider lane — calls, failure rate with its 95 %
 * interval, latency p50 / p95, fallback hops, calls refused by the controls,
 * tokens and a cost estimate. A cost the price table cannot explain is shown
 * as unknown, never as $0.
 *
 * Bottom: the `ai-controls` editor (switch all AI off, per-feature switches,
 * daily token and cost caps), published through POST /api/admin/appconfig.
 * Switching AI off for everyone asks for confirmation first. Edits survive
 * the auto-refresh: they live in `draft` until published or discarded.
 * Every value is escaped through h.html / h.esc.
 */
(function () {
  'use strict';
  var KEY = 'aiops';
  var WINDOWS = [[1, '24h'], [7, '7d'], [30, '30d'], [90, '90d']];
  var FEATURES = [
    ['dj', 'AI DJ — orders the next songs'],
    ['curate-metadata', 'Song classification (mood, energy, genre)'],
    ['curate-ranking', 'Re-ranking (Home, next song, Trending for you)'],
    ['curate-home', 'Home block order'],
    ['curate-shelves', '"Designed for you" shelves'],
    ['playlist', 'Playlist from a description'],
    ['vinaxai', 'VinaX AI chat'],
    ['assistant', 'In-app help chat'],
    ['tts', 'Spoken replies and the DJ voice'],
    ['lyrics', 'Lyric tools (romanise, translate, explain)'],
    ['image', 'Image generation'],
    ['embed', 'Song and search embeddings (natural-language search, taste fit)'],
    ['search', 'Reading a described search into filters (AI search)'],
    // 10.3 — speech to text for dictation, and music clips in VinaX AI.
    ['transcribe', 'Dictation by an AI model (speech to text)'],
    ['music', 'Music clip generation in VinaX AI'],
  ];
  var days = null;
  var last = null;      // last aiops payload
  var draft = null;     // unpublished controls edit, or null
  var confirming = false;
  var message = '';

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  // 11.0 — the error state component comes from app.js; a host that does not
  // hand it over (a unit test, an older shell) still gets the message as text.
  function errState(h, msg) { return typeof h.stateError === 'function' ? h.stateError(msg) : '<div class="state state-error empty" role="alert"><div class="state-hint">' + h.esc(msg) + '</div></div>'; }
  function n0(v) { return typeof v === 'number' && isFinite(v) ? v : 0; }
  function fmtN(v) { v = n0(v); return v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'k' : String(v); }
  function when(iso) { if (typeof iso !== 'string' || !iso) return 'never'; var t = Date.parse(iso); return isNaN(t) ? iso : new Date(t).toLocaleString(); }
  function rateText(r) {
    if (!isObj(r) || typeof r.rate !== 'number' || !(r.n > 0)) return '—';
    var band = (typeof r.low === 'number' && typeof r.high === 'number') ? Math.round(r.low * 100) + '–' + Math.round(r.high * 100) + '%' : '';
    if (r.n < 30) return n0(r.k) + ' of ' + r.n + (band ? ' (likely ' + band + ')' : '');
    return Math.round(r.rate * 100) + '%' + (band ? ' (' + band + ')' : '');
  }
  function costText(c) {
    if (!isObj(c)) return 'unknown';
    if (typeof c.usd !== 'number') return 'unknown';
    var gaps = n0(c.unpricedCalls) + n0(c.unreportedCalls);
    return '$' + c.usd.toFixed(c.usd < 1 ? 4 : 2) + (c.complete ? '' : ' known · ' + gaps + ' call' + (gaps === 1 ? '' : 's') + ' unknown');
  }
  function latText(l) { return isObj(l) && typeof l.p50 === 'number' ? Math.round(l.p50) + ' / ' + (typeof l.p95 === 'number' ? Math.round(l.p95) : '—') + ' ms' : '—'; }

  function published() {
    var c = last && isObj(last.controls) && isObj(last.controls.value) ? last.controls.value : null;
    var features = {};
    FEATURES.forEach(function (f) { features[f[0]] = !(c && isObj(c.features) && c.features[f[0]] === false); });
    return {
      emergencyOff: !!(c && c.emergencyOff === true),
      features: features,
      dailyTokenCap: c && typeof c.dailyTokenCap === 'number' ? c.dailyTokenCap : null,
      dailyCostCapUsd: c && typeof c.dailyCostCapUsd === 'number' ? c.dailyCostCapUsd : null,
      updatedAt: c && typeof c.updatedAt === 'string' ? c.updatedAt : null,
      updatedBy: c && typeof c.updatedBy === 'string' ? c.updatedBy : null,
    };
  }
  function editing() { return draft || published(); }
  function ensureDraft() {
    if (!draft) { var p = published(); draft = { emergencyOff: p.emergencyOff, features: Object.assign({}, p.features), dailyTokenCap: p.dailyTokenCap, dailyCostCapUsd: p.dailyCostCapUsd, by: '', baseUpdatedAt: p.updatedAt }; }
    return draft;
  }

  function windowBar(h) {
    return '<div class="seg" role="group" aria-label="Window" style="margin-bottom:var(--s-4)">' + WINDOWS.map(function (w) {
      var on = w[0] === days;
      return h.html`<button type="button" data-ao-days="${w[0]}" aria-pressed="${on ? 'true' : 'false'}">${w[1]}</button>`;
    }).join('') + '</div>';
  }

  function groupTable(h, title, list) {
    var rows = Array.isArray(list) ? list : [];
    return h.html`<div class="card" style="margin-bottom:14px;overflow-x:auto"><h3 style="margin-top:0">${title}</h3>` +
      '<table><thead><tr><th>Name</th><th>Calls</th><th>Failure rate (95%)</th><th>Latency p50 / p95</th><th>Fallback hops</th><th>Refused by controls</th><th>Prompt tokens</th><th>Completion tokens</th><th>Cost</th></tr></thead><tbody>' +
      (rows.length ? rows.map(function (g) {
        if (!isObj(g)) return '';
        var b = isObj(g.blocked) ? g.blocked : {};
        var t = isObj(g.tokens) ? g.tokens : {};
        return h.html`<tr><td><code>${g.key}</code></td><td>${fmtN(g.calls)}</td><td>${rateText(g.failureRate)}</td><td>${latText(g.latencyMs)}</td><td>${fmtN(g.hops)}</td><td>${n0(b.disabled) + n0(b.overBudget) ? n0(b.disabled) + ' off · ' + n0(b.overBudget) + ' over budget' : '—'}</td><td>${fmtN(t.prompt)}</td><td>${fmtN(t.completion)}</td><td>${costText(g.cost)}</td></tr>`;
      }).join('') : '<tr class="table-empty"><td colspan="9"><div class="state state-empty empty" role="status"><div class="state-title">Nothing logged in this window</div><div class="state-hint">AI requests are logged here as listeners use the assistant. Widen the window to look further back.</div></div></td></tr>') + '</tbody></table></div>';
  }

  function budgetCard(h, d) {
    var b = isObj(d.budget) ? d.budget : {};
    var states = {
      no_caps: 'No daily caps are set.',
      within: 'Within the daily caps so far.',
      over_tokens: 'Over the daily token cap — AI routes refuse new calls until the day ends (UTC).',
      over_cost: 'Over the daily cost cap — AI routes refuse new calls until the day ends (UTC).',
      cost_unknown: 'Cost so far is only partly known (unpriced models or calls without token counts), so the cost cap cannot be checked exactly.',
      controls_unknown: 'The controls could not be read, so the caps are unknown.',
    };
    var tok = typeof b.tokenCap === 'number' ? fmtN(b.tokensToday) + ' of ' + fmtN(b.tokenCap) + (typeof b.tokenPct === 'number' ? ' (' + b.tokenPct + '%)' : '') : fmtN(b.tokensToday) + ' · no cap';
    var costNow = typeof b.costTodayUsd === 'number' ? '$' + b.costTodayUsd.toFixed(4) + (b.costComplete ? '' : ' known so far') : 'unknown';
    var cost = typeof b.costCapUsd === 'number' ? costNow + ' of $' + b.costCapUsd.toFixed(2) + (typeof b.costPct === 'number' ? ' (' + b.costPct + '%)' : '') : costNow + ' · no cap';
    var warn = b.state === 'over_tokens' || b.state === 'over_cost' || b.state === 'controls_unknown';
    return h.html`<div class="card" style="margin-bottom:14px${warn ? ';border-color:var(--bad)' : ''}"><h3 style="margin-top:0">Budget today <span class="muted">· ${b.day || ''} (UTC)</span></h3>` +
      h.html`<table><tbody><tr><td>Tokens</td><td>${tok}</td></tr><tr><td>Cost</td><td>${cost}</td></tr></tbody></table><p class="muted" style="margin-bottom:0">${states[b.state] || ''} Token counts come only from calls whose provider reported them.</p></div>`;
  }

  function controlsCard(h, d) {
    var c = isObj(d.controls) ? d.controls : {};
    var pub = published();
    var e = editing();
    var who = pub.updatedBy ? pub.updatedBy : 'the shared admin token';
    var status = c.read === 'failed'
      ? h.html`<p style="color:var(--bad)">The published controls could not be read (${c.error || 'database error'}). Publishing now would replace them without seeing them.</p>`
      : c.published
        ? h.html`<p class="muted" style="margin-top:0">Last published ${when(pub.updatedAt)} by ${who}. There is one shared admin token, so "by" is only what the publisher typed.</p>`
        : '<p class="muted" style="margin-top:0">No controls published yet: every AI feature is on and there are no caps.</p>';
    var rows = FEATURES.map(function (f) {
      var on = e.features[f[0]] !== false;
      var changed = on !== (pub.features[f[0]] !== false);
      return h.html`<tr><td><code>${f[0]}</code></td><td class="muted">${f[1]}</td><td><label><input type="checkbox" data-ao-feature="${f[0]}"${on ? ' checked' : ''}> ${on ? 'on' : 'off'}</label>${changed ? ' · unpublished' : ''}</td></tr>`;
    }).join('');
    var confirm = confirming
      ? '<div class="card" id="ao-confirm" role="alertdialog" aria-labelledby="ao-confirm-t" style="border-color:var(--bad);margin:12px 0">' +
        '<b id="ao-confirm-t">Switch AI off for every listener?</b><p class="muted">The DJ, VinaX AI, playlists, curation, lyric tools, speech and images all stop answering until AI is switched back on. Listeners keep the on-device experience.</p>' +
        '<div class="row" style="gap:8px"><button type="button" class="btn btn-danger" id="ao-confirm-yes">Yes, switch AI off</button><button type="button" class="ghost" id="ao-confirm-no">Cancel</button></div></div>'
      : '';
    return '<div class="card" id="ao-controls" style="margin-bottom:14px"><h3 style="margin-top:0">Emergency controls</h3>' + status +
      (pub.emergencyOff ? '<p style="color:var(--bad);font-weight:700">AI is switched OFF for every listener.</p>' : '') +
      h.html`<label style="display:flex;gap:8px;align-items:center;font-weight:700;margin:10px 0"><input type="checkbox" id="ao-off"${e.emergencyOff ? ' checked' : ''}> Switch all AI off (emergency)</label>` +
      '<table><thead><tr><th>Feature</th><th>What it is</th><th>State</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<div class="row" style="gap:12px;flex-wrap:wrap;margin-top:12px">' +
      h.html`<label>Daily token cap <input class="inp" id="ao-tokcap" type="number" min="0" step="1000" placeholder="no cap" value="${e.dailyTokenCap == null ? '' : e.dailyTokenCap}" style="width:140px"></label>` +
      h.html`<label>Daily cost cap (USD) <input class="inp" id="ao-costcap" type="number" min="0" step="0.01" placeholder="no cap" value="${e.dailyCostCapUsd == null ? '' : e.dailyCostCapUsd}" style="width:120px"></label>` +
      h.html`<label>Your name or initials <input class="inp" id="ao-by" maxlength="40" placeholder="optional" value="${draft ? draft.by : ''}" style="width:140px"></label>` +
      '</div>' + confirm +
      '<div class="row" style="gap:8px;margin-top:12px;align-items:center;flex-wrap:wrap"><button type="button" class="btn btn-primary" id="ao-publish">Publish controls</button>' +
      (draft ? '<button type="button" class="ghost" id="ao-discard">Discard changes</button>' : '') +
      h.html`<span class="muted" id="ao-out" role="status" style="font-size:12px">${message}</span></div>` +
      '<p class="muted" style="margin-bottom:0">Enforced by the Worker\'s AI router: a switched-off feature answers 503 ai_disabled and a spent cap 503 ai_over_budget. The Worker picks up a change when it next reads its config (about a minute).</p></div>';
  }

  function paint(h) {
    var d = last;
    if (!isObj(d)) { h.view(errState(h, 'Unexpected response from the server.')); return; }
    if (d.configured === false) { h.view('<div class="state state-empty empty" role="status"><div class="state-title">The database is not configured on this Worker</div><div class="state-hint">Bind the database to the Worker, deploy, then reload this page.</div></div>'); return; }
    if (!isObj(d.totals)) { h.view(errState(h, 'Unexpected response from the server.')); return; }
    var t = d.totals;
    var tk = isObj(t.tokens) ? t.tokens : {};
    var pub = published();
    var banner = pub.emergencyOff
      ? h.html`<div class="card" style="margin-bottom:14px;border-color:var(--bad)"><b style="color:var(--bad)">AI is switched off for every listener</b> <span class="muted">since ${when(pub.updatedAt)}.</span></div>`
      : '';
    var cards = '<div class="cards">' +
      h.html`<div class="card"><div class="n">${fmtN(t.calls)}</div><div class="l">AI calls · ${n0(d.days)} d</div></div>` +
      h.html`<div class="card"><div class="n">${rateText(t.failureRate)}</div><div class="l">Failure rate (95%)</div></div>` +
      h.html`<div class="card"><div class="n">${latText(t.latencyMs)}</div><div class="l">Latency p50 / p95</div></div>` +
      h.html`<div class="card"><div class="n">${fmtN(t.hops)}</div><div class="l">Fallback hops</div></div>` +
      h.html`<div class="card"><div class="n">${fmtN(n0(tk.prompt) + n0(tk.completion))}</div><div class="l">Tokens reported</div></div>` +
      h.html`<div class="card"><div class="n">${costText(t.cost).split(' known')[0]}</div><div class="l">${isObj(t.cost) && t.cost.complete ? 'Estimated cost' : 'Cost known so far'}</div></div>` +
      '</div>';
    var notes = (d.tokenColumns === false ? '<p class="muted">Token columns are not in the AI events table yet, so tokens and cost are unknown.</p>' : '') +
      (isObj(d.prices) && d.prices.configured === false ? '<p class="muted">No AI prices are set (AI Tokens &amp; Cost), so every cost is unknown.</p>' : '') +
      (d.truncated ? h.html`<p class="muted">Only the newest ${fmtN(d.sampled)} calls of this window were read.</p>` : '');
    h.view(banner + windowBar(h) + cards + notes + budgetCard(h, d) + groupTable(h, 'By feature', d.byFeature) + groupTable(h, 'By provider lane', d.byLane) + controlsCard(h, d));
    bind(h);
    h.stamp();
  }

  function readDraftFields() {
    var dr = ensureDraft();
    var tok = document.getElementById('ao-tokcap');
    var cost = document.getElementById('ao-costcap');
    var by = document.getElementById('ao-by');
    var tv = tok ? String(tok.value).trim() : '';
    var cv = cost ? String(cost.value).trim() : '';
    dr.dailyTokenCap = tv === '' ? null : Math.max(0, Math.floor(Number(tv)));
    dr.dailyCostCapUsd = cv === '' ? null : Math.max(0, Number(cv));
    dr.by = by ? String(by.value).trim().slice(0, 40) : '';
    return dr;
  }

  function valueOf(dr) {
    var features = {};
    FEATURES.forEach(function (f) { features[f[0]] = dr.features[f[0]] !== false; });
    var v = { emergencyOff: !!dr.emergencyOff, features: features, dailyTokenCap: dr.dailyTokenCap, dailyCostCapUsd: dr.dailyCostCapUsd, updatedAt: new Date().toISOString() };
    if (dr.by) v.updatedBy = dr.by;
    return v;
  }

  function publish(h) {
    var dr = readDraftFields();
    if ((dr.dailyTokenCap !== null && !isFinite(dr.dailyTokenCap)) || (dr.dailyCostCapUsd !== null && !isFinite(dr.dailyCostCapUsd))) {
      message = 'Caps must be numbers (or empty for no cap).'; paint(h); return Promise.resolve();
    }
    if (dr.emergencyOff && !published().emergencyOff && !confirming) { confirming = true; message = ''; paint(h); return Promise.resolve(); }
    confirming = false;
    message = 'Checking for newer controls…'; paint(h);
    // Refuse to overwrite controls someone else published after this panel loaded.
    return h.api('/api/admin/appconfig?key=ai-controls').then(function (cur) {
      if (cur === null) return null; // signed out
      var stored = cur && isObj(cur.value) && typeof cur.value.updatedAt === 'string' ? cur.value.updatedAt : null;
      if (cur && stored !== dr.baseUpdatedAt) {
        message = 'Someone published controls at ' + when(stored) + ' after you started editing. Nothing was published — discard your changes to see theirs.';
        paint(h);
        return null;
      }
      return send(h, dr);
    }, function () { return send(h, dr); });
  }

  function send(h, dr) {
    message = 'Publishing…'; paint(h);
    return h.postApi('/api/admin/appconfig', { key: 'ai-controls', value: valueOf(dr) }).then(function (r) {
      if (!r) return;
      if (r.ok) { draft = null; message = 'Published ✓ — the Worker applies it within about a minute.'; return load(h, true); }
      message = r.error === 'unknown_key'
        ? 'This Worker does not accept ai-controls yet (it needs the build that enforces them). Nothing was published.'
        : 'Publish failed (' + (r.error || 'unknown error') + '). Nothing was published.';
      paint(h);
    }).catch(function () { message = 'Publish failed — network. Nothing was published.'; paint(h); });
  }

  function bind(h) {
    var root = document.getElementById('view');
    if (!root) return;
    Array.prototype.forEach.call(root.querySelectorAll('[data-ao-days]'), function (b) {
      b.addEventListener('click', function () { days = parseInt(b.getAttribute('data-ao-days'), 10) || 7; load(h, true); });
    });
    Array.prototype.forEach.call(root.querySelectorAll('[data-ao-feature]'), function (cb) {
      cb.addEventListener('change', function () { readDraftFields().features[cb.getAttribute('data-ao-feature')] = cb.checked; confirming = false; paint(h); });
    });
    var off = document.getElementById('ao-off');
    if (off) off.addEventListener('change', function () { readDraftFields().emergencyOff = off.checked; confirming = false; paint(h); });
    ['ao-tokcap', 'ao-costcap', 'ao-by'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('input', function () { readDraftFields(); });
    });
    var pubBtn = document.getElementById('ao-publish');
    if (pubBtn) pubBtn.addEventListener('click', function () { publish(h); });
    var yes = document.getElementById('ao-confirm-yes');
    if (yes) yes.addEventListener('click', function () { publish(h); });
    var no = document.getElementById('ao-confirm-no');
    if (no) no.addEventListener('click', function () { confirming = false; message = 'Not published.'; paint(h); });
    var discard = document.getElementById('ao-discard');
    if (discard) discard.addEventListener('click', function () { draft = null; confirming = false; message = ''; load(h, true); });
  }

  // app.js titles its own sections from a table that does not list this one;
  // fill the toolbar heading and crumb only while they are empty (text only).
  function shellTitle(h) {
    var t = h.$ ? h.$('secTitle') : null;
    if (t && !t.textContent) t.textContent = 'AI Operations';
    var c = h.$ ? h.$('secCrumb') : null;
    if (c && !c.textContent) c.textContent = 'AI & Engines';
  }

  function load(h, force) {
    shellTitle(h);
    if (days === null) days = [1, 7, 30, 90].indexOf(h.days()) >= 0 ? h.days() : 7;
    var read = force ? h.api : h.apiMemo;
    return read('/api/admin/aiops?days=' + days).then(function (d) {
      if (!d || !h.isActive(KEY)) return;
      last = d;
      if (draft && isObj(d.controls) && isObj(d.controls.value) && d.controls.value.updatedAt !== draft.baseUpdatedAt) {
        message = 'The published controls changed since you started editing (' + when(d.controls.value.updatedAt) + '). Discard your changes to see them.';
      }
      paint(h);
    }).catch(function (e) { if (h.isActive(KEY)) h.fail(e); });
  }

  window.VinaXAdminSections.register(KEY, { local: false, title: 'AI Operations', load: function (h) { return load(h, false); } });
})();
