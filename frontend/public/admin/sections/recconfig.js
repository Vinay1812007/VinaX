/*
 * 7.2.0 — Recommendation Tuning (GET / POST /api/admin/recconfig).
 *
 * A versioned set of bounded weight overrides for the on-device scorer,
 * staged to nobody (off), to one variant of an A/B experiment, or to every
 * device. The server validates every key and range and refuses a publish
 * made from an older version (409); this panel shows that conflict instead
 * of retrying. Nothing here claims a weight change is an improvement: a
 * version without an attached evaluation is labelled "unvalidated — no
 * evaluation attached", and even an evaluated one is described as evidence,
 * not proof. Rollback publishes an older version as a new one.
 *
 * Editor state (`draft`) lives in this module until published or discarded;
 * the section is an editor, so the auto-refresh leaves it alone.
 * Every value is escaped through h.html / h.esc.
 */
(function () {
  'use strict';
  var KEY = 'recconfig';
  var EVAL_FALLBACK = 'node frontend/scripts/eval-recs.mjs';
  var last = null;
  var draft = null;
  var preview = false;
  var message = '';
  var problems = [];
  var conflict = null;
  var rollbackAsk = null;

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  function when(iso) { if (typeof iso !== 'string' || !iso) return '—'; var t = Date.parse(iso); return isNaN(t) ? iso : new Date(t).toLocaleString(); }
  function weights() { return last && Array.isArray(last.weights) ? last.weights.filter(function (w) { return isObj(w) && typeof w.key === 'string'; }) : []; }
  function current() { return last && isObj(last.current) ? last.current : null; }
  function currentVersion() { return last && typeof last.version === 'number' ? last.version : 0; }
  function experiments() { return last && Array.isArray(last.experiments) ? last.experiments.filter(isObj) : []; }
  function overridesOf(rec) { return rec && isObj(rec.overrides) ? rec.overrides : {}; }
  function rolloutText(r) {
    if (!isObj(r) || r.mode === 'off' || !r.mode) return 'off — no device uses it';
    if (r.mode === 'all') return 'every device';
    return 'experiment ' + (r.experimentKey || '?') + ', variant ' + (r.variant || '?');
  }
  function fmtW(v) { return v === null || v === undefined ? '—' : String(Math.round(v * 10000) / 10000); }

  function fromRecord(rec, base) {
    var values = {};
    var o = overridesOf(rec);
    Object.keys(o).forEach(function (k) { if (num(o[k]) !== null) values[k] = String(o[k]); });
    var r = rec && isObj(rec.rollout) ? rec.rollout : { mode: 'off' };
    return { base: base, dirty: false, values: values, mode: r.mode === 'all' || r.mode === 'experiment' ? r.mode : 'off', experimentKey: r.experimentKey || '', variant: r.variant || '', note: '', evalSummary: '', evalUrl: '', by: '' };
  }

  /** The proposed overrides as numbers, plus any field that is not a number. */
  function proposed() {
    var out = {};
    var bad = [];
    weights().forEach(function (w) {
      var raw = draft && typeof draft.values[w.key] === 'string' ? draft.values[w.key].trim() : '';
      if (raw === '') return;
      var v = Number(raw);
      if (!isFinite(v)) bad.push(w.key); else out[w.key] = v;
    });
    return { overrides: out, bad: bad };
  }

  function evaluationBlock(h, rec) {
    if (!rec) return '';
    var ev = isObj(rec.evaluation) ? rec.evaluation : null;
    if (!ev) return '<p><span class="pill" style="background:var(--warn-soft);color:var(--warn)">unvalidated — no evaluation attached</span></p>';
    var link = typeof ev.url === 'string' && /^https:\/\//i.test(ev.url) ? h.html` · <a href="${ev.url}" target="_blank" rel="noopener noreferrer">${ev.url}</a>` : '';
    return h.html`<p><span class="pill">evaluation attached</span> <span class="muted">${when(ev.at)}</span></p><p style="white-space:pre-wrap">${ev.summary || ''}</p>` + (link ? '<p class="muted">Report' + link + '</p>' : '');
  }

  function headerCard(h) {
    var rec = current();
    var honesty = '<p class="muted" style="margin-bottom:0">A weight change is a hypothesis, not a proven improvement. An offline evaluation is evidence, not proof: after any rollout, compare the variants in Recommendation Quality.</p>';
    if (!rec) {
      return h.html`<div class="card" id="rc-published" style="margin-bottom:14px"><h3 style="margin-top:0">Published</h3><p>Nothing published: every device uses the built-in weights (${last.baseVersion || '1.2.0'}).</p>` + honesty + '</div>';
    }
    var live = last.live === true;
    return h.html`<div class="card" id="rc-published" style="margin-bottom:14px"><h3 style="margin-top:0">Published — v${rec.version}</h3>` +
      h.html`<table><tbody><tr><td>Rollout</td><td>${rolloutText(rec.rollout)}</td></tr><tr><td>Changing devices now</td><td>${live ? 'yes — targeted devices report weights ' + (last.baseVersion || '1.2.0') + '+rc' + rec.version : 'no'}</td></tr>` +
      h.html`<tr><td>Overrides</td><td>${Object.keys(overridesOf(rec)).length}</td></tr><tr><td>Published</td><td>${when(rec.updatedAt)} by ${rec.updatedBy || 'admin'}</td></tr>` +
      h.html`<tr><td>Note</td><td style="white-space:pre-wrap">${rec.note || '—'}</td></tr></tbody></table>` +
      evaluationBlock(h, rec) + honesty + '</div>';
  }

  function rolloutFields(h) {
    var exps = experiments();
    var modeSel = '<select class="inp" id="rc-mode">' + [['off', 'Off — publish without changing any device'], ['experiment', 'One experiment variant'], ['all', 'Every device']].map(function (m) {
      return h.html`<option value="${m[0]}"${draft.mode === m[0] ? ' selected' : ''}>${m[1]}</option>`;
    }).join('') + '</select>';
    var extra = '';
    if (draft.mode === 'experiment') {
      var exp = exps.filter(function (e) { return e.key === draft.experimentKey; })[0] || null;
      var expSel = '<select class="inp" id="rc-exp"><option value="">Choose an experiment…</option>' + exps.map(function (e) {
        return h.html`<option value="${e.key}"${e.key === draft.experimentKey ? ' selected' : ''}>${e.key}${e.active ? '' : ' (paused)'}</option>`;
      }).join('') + '</select>';
      var vars = exp && Array.isArray(exp.variants) ? exp.variants.filter(isObj) : [];
      var varSel = '<select class="inp" id="rc-var"><option value="">Choose a variant…</option>' + vars.map(function (v) {
        return h.html`<option value="${v.name}"${v.name === draft.variant ? ' selected' : ''}>${v.name} (${v.pct}%)</option>`;
      }).join('') + '</select>';
      extra = ' ' + expSel + ' ' + varSel +
        (exps.length ? '' : '<p class="muted">No experiments exist yet — create one in A/B Experiments first.</p>') +
        (exp && !exp.active ? '<p style="color:var(--warn)">This experiment is paused: the config reaches no device until it is active.</p>' : '') +
        '<p class="muted">Target a treatment variant. Devices outside the experiment\'s traffic, and every other variant, keep the built-in weights, so Recommendation Quality can compare them by variant.</p>';
    }
    return '<div style="margin:12px 0"><label style="font-weight:700">Rollout</label> ' + modeSel + extra + '</div>';
  }

  function editorCard(h) {
    var cur = current();
    var pub = overridesOf(cur);
    var nextV = currentVersion() + 1;
    var rows = weights().map(function (w) {
      var val = typeof draft.values[w.key] === 'string' ? draft.values[w.key] : '';
      var touches = Array.isArray(w.touches) && w.touches.length ? w.touches.join('; ') : (w.note || '');
      return h.html`<tr><td><code>${w.key}</code></td><td>${fmtW(num(w.default))}</td><td>${num(pub[w.key]) !== null ? fmtW(pub[w.key]) : '—'}</td>` +
        h.html`<td><input class="inp" type="number" step="0.001" min="${num(w.min)}" max="${num(w.max)}" data-rc-weight="${w.key}" value="${val}" placeholder="default" aria-label="Proposed ${w.key}" style="width:100px"></td>` +
        h.html`<td class="muted">${fmtW(num(w.min))} – ${fmtW(num(w.max))}</td><td class="muted">${touches}</td></tr>`;
    }).join('');
    var stale = draft.base !== currentVersion()
      ? h.html`<p style="color:var(--warn)">You are editing from v${draft.base}, but v${currentVersion()} is now published. Publishing will be refused until you choose what to keep.</p>`
      : '';
    var probs = problems.length
      ? '<ul style="color:var(--danger)">' + problems.map(function (p) { return h.html`<li><code>${p.field || ''}</code> ${p.problem || ''}</li>`; }).join('') + '</ul>'
      : '';
    return '<div class="card" style="margin-bottom:14px"><h3 style="margin-top:0">Edit</h3>' +
      h.html`<p class="muted" style="margin-top:0">Empty = the built-in weight. Each override must stay within half to double its default; the server clamps anything outside and says so.${draft.dirty ? ' Unpublished edits.' : ''}</p>` + stale +
      '<div style="overflow-x:auto"><table><thead><tr><th>Weight</th><th>Default</th><th>Published</th><th>Proposed</th><th>Safe range</th><th>What it moves</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      rolloutFields(h) +
      h.html`<label style="display:block;margin:8px 0 4px;font-weight:700" for="rc-note">Note</label><textarea class="inp" id="rc-note" rows="2" maxlength="280" style="width:100%">${draft.note}</textarea>` +
      h.html`<label style="display:block;margin:8px 0 4px;font-weight:700" for="rc-eval">Evaluation summary <span class="muted">(optional — without one this version is published as unvalidated)</span></label><textarea class="inp" id="rc-eval" rows="3" maxlength="600" style="width:100%">${draft.evalSummary}</textarea>` +
      '<div class="row" style="gap:12px;flex-wrap:wrap;margin-top:8px">' +
      h.html`<label>Evaluation report link <input class="inp" id="rc-evalurl" placeholder="https://…" value="${draft.evalUrl}" style="width:280px"></label>` +
      h.html`<label>Your name or initials <input class="inp" id="rc-by" maxlength="40" placeholder="optional" value="${draft.by}" style="width:140px"></label></div>` +
      '<div class="row" style="gap:8px;margin-top:12px;align-items:center;flex-wrap:wrap"><button type="button" class="ghost" id="rc-preview">Preview scenario</button>' +
      h.html`<button type="button" id="rc-publish">Publish as v${nextV}</button>` +
      (draft.dirty ? '<button type="button" class="ghost" id="rc-discard">Discard edits</button>' : '') +
      h.html`<span class="muted" id="rc-out" role="status" style="font-size:12px">${message}</span></div>` + probs + '</div>';
  }

  function previewCard(h) {
    var p = proposed();
    var pub = overridesOf(current());
    var lines = weights().filter(function (w) {
      var before = num(pub[w.key]);
      var after = num(p.overrides[w.key]);
      return before !== after;
    });
    var evalCmd = (last && typeof last.evalCommand === 'string' && last.evalCommand) || EVAL_FALLBACK;
    var rows = lines.map(function (w) {
      var d = num(w.default);
      var before = num(pub[w.key]) !== null ? pub[w.key] : d;
      var raw = num(p.overrides[w.key]) !== null ? p.overrides[w.key] : d;
      var after = raw === null ? null : Math.min(num(w.max) !== null ? w.max : raw, Math.max(num(w.min) !== null ? w.min : raw, raw));
      var clampNote = after !== raw ? ' (clamped from ' + fmtW(raw) + ')' : '';
      var change = before ? Math.round(((after - before) / before) * 100) : 0;
      var touches = Array.isArray(w.touches) && w.touches.length ? w.touches.join('; ') : (w.note || '');
      return h.html`<tr><td><code>${w.key}</code></td><td>${fmtW(d)}</td><td>${fmtW(before)}</td><td>${fmtW(after)}${clampNote}</td><td>${change > 0 ? '+' : ''}${change}%</td><td class="muted">${touches}</td></tr>`;
    }).join('');
    var hasEval = !!(draft.evalSummary && draft.evalSummary.trim());
    return '<div class="card" id="rc-preview-card" style="margin-bottom:14px"><h3 style="margin-top:0">Scenario preview</h3>' +
      (p.bad.length ? h.html`<p style="color:var(--danger)">Not a number: ${p.bad.join(', ')}</p>` : '') +
      (rows ? '<table><thead><tr><th>Weight</th><th>Default</th><th>Now (published)</th><th>After</th><th>Change</th><th>Reason terms it moves</th></tr></thead><tbody>' + rows + '</tbody></table>' : '<p class="muted">No weight differs from what is published.</p>') +
      h.html`<p><b>Rollout after publishing:</b> ${rolloutText({ mode: draft.mode, experimentKey: draft.experimentKey, variant: draft.variant })}.</p>` +
      (hasEval ? '<p class="muted">An evaluation summary will be attached. It is evidence about this change, not proof that listeners will prefer it.</p>' : '<p><span class="pill" style="background:var(--warn-soft);color:var(--warn)">unvalidated — no evaluation attached</span> <span class="muted">This preview only shows which terms move; it does not predict listener outcomes.</span></p>') +
      '<p style="margin-bottom:4px"><b>Run the offline evaluation first</b> <span class="muted">(pass it these overrides as its own help describes):</span></p>' +
      h.html`<pre class="codebox" style="white-space:pre-wrap">${evalCmd}\n${JSON.stringify(p.overrides, null, 2)}</pre></div>`;
  }

  function conflictCard(h) {
    if (!conflict) return '';
    var rec = isObj(conflict.current) ? conflict.current : null;
    return '<div class="card" id="rc-conflict" role="alert" style="margin-bottom:14px;border-color:var(--danger)"><h3 style="margin-top:0">Version conflict — nothing was written</h3>' +
      (rec
        ? h.html`<p>v${rec.version} was published ${when(rec.updatedAt)} by ${rec.updatedBy || 'admin'} after you started editing from v${draft ? draft.base : '?'}. Its rollout: ${rolloutText(rec.rollout)}; ${Object.keys(overridesOf(rec)).length} override(s).</p>`
        : '<p>The published version changed after you started editing.</p>') +
      '<div class="row" style="gap:8px;flex-wrap:wrap"><button type="button" id="rc-rebase">Keep my edits on top of the newer version</button><button type="button" class="ghost" id="rc-take-theirs">Discard my edits and load it</button></div></div>';
  }

  function historyCard(h) {
    var list = last && Array.isArray(last.history) ? last.history.filter(isObj) : [];
    var cur = currentVersion();
    var rows = list.map(function (r) {
      var ask = rollbackAsk === r.version;
      var action = r.version === cur ? '<span class="muted">current</span>'
        : ask ? h.html`<span>Publish v${r.version}'s weights and rollout as v${cur + 1}?</span> <button type="button" data-rc-rollback-yes="${r.version}">Roll back</button> <button type="button" class="ghost" data-rc-rollback-no="1">Cancel</button>`
          : h.html`<button type="button" class="ghost" data-rc-rollback="${r.version}">Roll back to this</button>`;
      var ev = isObj(r.evaluation) ? 'evaluation attached' : 'unvalidated — no evaluation attached';
      return h.html`<tr><td>v${r.version}</td><td>${when(r.updatedAt)}</td><td>${r.updatedBy || 'admin'}</td><td>${rolloutText(r.rollout)}</td><td>${Object.keys(overridesOf(r)).length}</td><td>${ev}</td><td class="muted" style="white-space:pre-wrap">${r.note || ''}</td><td>` + action + '</td></tr>';
    }).join('');
    return '<div class="card" style="margin-bottom:14px;overflow-x:auto"><h3 style="margin-top:0">History <span class="muted">· last 20 versions</span></h3>' +
      (rows ? '<table><thead><tr><th>Version</th><th>Published</th><th>By</th><th>Rollout</th><th>Overrides</th><th>Evaluation</th><th>Note</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>' : '<p class="muted">No versions yet.</p>') +
      '<p class="muted" style="margin-bottom:0">Rolling back publishes the chosen version\'s weights and rollout as a new version; history is never rewritten.</p></div>';
  }

  function paint(h) {
    if (!isObj(last)) { h.view('<div class="empty">Unexpected response from the server.</div>'); return; }
    if (last.configured === false) { h.view('<div class="empty">The database is not configured on this Worker.</div>'); return; }
    if (!Array.isArray(last.weights)) { h.view('<div class="empty">Unexpected response from the server.</div>'); return; }
    if (!draft) draft = fromRecord(current(), currentVersion());
    h.view(headerCard(h) + conflictCard(h) + editorCard(h) + (preview ? previewCard(h) : '') + historyCard(h) +
      (last.experimentsRead === 'failed' ? '<p class="muted">Experiments could not be read; an experiment rollout cannot be chosen right now.</p>' : ''));
    bind(h);
    h.stamp();
  }

  function touch() { if (draft) draft.dirty = true; }

  function handleResult(h, r, what) {
    if (!r) return null;
    problems = [];
    if (r.ok && isObj(r.record)) {
      var clamps = Array.isArray(r.clamped) && r.clamped.length ? ' Clamped: ' + r.clamped.map(function (c) { return c.key + ' ' + c.requested + ' → ' + c.applied; }).join(', ') + '.' : '';
      message = what + ' v' + r.record.version + ' ✓.' + clamps + (r.record.evaluation ? '' : ' Unvalidated — no evaluation attached.') + (r.historySaved === false ? ' History could not be saved.' : '');
      draft = null; conflict = null; preview = false; rollbackAsk = null;
      return load(h);
    }
    if (r.error === 'version_conflict') {
      conflict = { version: r.version, current: r.current };
      message = 'Not published — someone else published first.';
    } else if (r.error === 'invalid' && Array.isArray(r.problems)) {
      problems = r.problems.filter(isObj);
      message = 'Not published — fix the problems below.';
    } else {
      message = 'Not published (' + (r.error || 'unknown error') + ').';
    }
    rollbackAsk = null;
    paint(h);
    return null;
  }

  function publish(h) {
    var p = proposed();
    if (p.bad.length) { problems = p.bad.map(function (k) { return { field: 'overrides.' + k, problem: 'must be a number' }; }); message = 'Not published.'; paint(h); return Promise.resolve(); }
    var body = {
      expectedVersion: draft.base,
      overrides: p.overrides,
      rollout: draft.mode === 'experiment' ? { mode: 'experiment', experimentKey: draft.experimentKey, variant: draft.variant } : { mode: draft.mode },
      note: draft.note,
      evaluation: draft.evalSummary.trim() ? { summary: draft.evalSummary.trim(), url: draft.evalUrl.trim() } : null,
      by: draft.by,
    };
    message = 'Publishing…'; paint(h);
    return h.postApi('/api/admin/recconfig', body).then(function (r) { return handleResult(h, r, 'Published'); })
      .catch(function () { message = 'Not published — network error.'; paint(h); });
  }

  function rollback(h, version) {
    message = 'Rolling back…';
    return h.postApi('/api/admin/recconfig', { action: 'rollback', toVersion: version, expectedVersion: currentVersion(), by: draft ? draft.by : '' })
      .then(function (r) { return handleResult(h, r, 'Rolled back as'); })
      .catch(function () { message = 'Not rolled back — network error.'; rollbackAsk = null; paint(h); });
  }

  function bind(h) {
    var root = document.getElementById('view');
    if (!root) return;
    var byId = function (id) { return document.getElementById(id); };
    Array.prototype.forEach.call(root.querySelectorAll('[data-rc-weight]'), function (inp) {
      inp.addEventListener('input', function () {
        var k = inp.getAttribute('data-rc-weight');
        if (String(inp.value).trim() === '') delete draft.values[k]; else draft.values[k] = String(inp.value);
        touch();
      });
    });
    var text = function (id, field) { var el = byId(id); if (el) el.addEventListener('input', function () { draft[field] = String(el.value); touch(); }); };
    text('rc-note', 'note'); text('rc-eval', 'evalSummary'); text('rc-evalurl', 'evalUrl'); text('rc-by', 'by');
    var mode = byId('rc-mode');
    if (mode) mode.addEventListener('change', function () { draft.mode = mode.value; touch(); paint(h); });
    var exp = byId('rc-exp');
    if (exp) exp.addEventListener('change', function () { draft.experimentKey = exp.value; draft.variant = ''; touch(); paint(h); });
    var v = byId('rc-var');
    if (v) v.addEventListener('change', function () { draft.variant = v.value; touch(); });
    var pv = byId('rc-preview');
    if (pv) pv.addEventListener('click', function () { preview = true; paint(h); var c = byId('rc-preview-card'); if (c && c.scrollIntoView) c.scrollIntoView({ block: 'nearest' }); });
    var pub = byId('rc-publish');
    if (pub) pub.addEventListener('click', function () { publish(h); });
    var dis = byId('rc-discard');
    if (dis) dis.addEventListener('click', function () { draft = null; conflict = null; problems = []; message = 'Edits discarded.'; paint(h); });
    var rebase = byId('rc-rebase');
    if (rebase) rebase.addEventListener('click', function () { conflict = null; message = 'Your edits now build on the newer version — review them, then publish.'; load(h, true); });
    var theirs = byId('rc-take-theirs');
    if (theirs) theirs.addEventListener('click', function () { draft = null; conflict = null; problems = []; message = ''; load(h); });
    Array.prototype.forEach.call(root.querySelectorAll('[data-rc-rollback]'), function (b) {
      b.addEventListener('click', function () { rollbackAsk = parseInt(b.getAttribute('data-rc-rollback'), 10); paint(h); });
    });
    Array.prototype.forEach.call(root.querySelectorAll('[data-rc-rollback-yes]'), function (b) {
      b.addEventListener('click', function () { rollback(h, parseInt(b.getAttribute('data-rc-rollback-yes'), 10)); });
    });
    Array.prototype.forEach.call(root.querySelectorAll('[data-rc-rollback-no]'), function (b) {
      b.addEventListener('click', function () { rollbackAsk = null; paint(h); });
    });
  }

  /** `rebase`: keep the draft's edits but move its base to the version now published. */
  // app.js titles its own sections from a table that does not list this one;
  // fill the toolbar heading and crumb only while they are empty (text only).
  function shellTitle(h) {
    var t = h.$ ? h.$('secTitle') : null;
    if (t && !t.textContent) t.textContent = 'Recommendation Tuning';
    var c = h.$ ? h.$('secCrumb') : null;
    if (c && !c.textContent) c.textContent = 'Analytics';
  }

  function load(h, rebase) {
    shellTitle(h);
    return h.api('/api/admin/recconfig').then(function (d) {
      if (!d || !h.isActive(KEY)) return;
      last = d;
      if (draft && rebase) draft.base = currentVersion();
      if (draft && !draft.dirty) draft = null; // untouched: follow what is published
      paint(h);
    }).catch(function (e) { if (h.isActive(KEY)) h.fail(e); });
  }

  window.VinaXAdminSections.register(KEY, { local: true, title: 'Recommendation Tuning', load: function (h) { return load(h, false); } });
})();
