/*
 * 7.2.0 — Trend Operations (Catalog). Reads and drives /api/admin/trends.
 *
 * What the owner can do here: see every trend source's status and why, the
 * last successful refresh and the last error per region, stale data, quota
 * used today against the ceiling, how long stored data has been kept, the
 * match confidence distribution; work the review queue (accept the proposed
 * catalogue song, reject the item, or correct it to another catalogue id —
 * every decision is kept in the item's history); validate and import
 * editorial entries (CSV or JSON, evidence link required, dated, expiring);
 * withdraw an editorial entry; run the sources now.
 *
 * Every value written into the page goes through h.html (each interpolation
 * escaped) and links are only rendered for https:// addresses. The panel is
 * `local`: the auto-refresh tick leaves it alone so an import in progress is
 * never wiped; "Reload panel" or the console's refresh reloads it.
 */
(function () {
  'use strict';

  var KEY = 'trends';
  var ctx = { h: null, reviewer: '', importFormat: 'csv', importText: '' };

  function when(iso) {
    if (!iso) return '—';
    var t = Date.parse(iso);
    return isFinite(t) ? new Date(t).toLocaleString() : '—';
  }
  function ago(iso) {
    if (!iso) return 'never';
    var s = Math.round((Date.now() - Date.parse(iso)) / 1000);
    if (!isFinite(s)) return '—';
    if (s < 90) return s + 's ago';
    if (s < 5400) return Math.round(s / 60) + ' min ago';
    if (s < 129600) return Math.round(s / 3600) + ' h ago';
    return Math.round(s / 86400) + ' days ago';
  }
  function safeUrl(u) { return typeof u === 'string' && /^https:\/\//i.test(u) ? u : null; }
  function pct(n) { return Math.round((Number(n) || 0) * 100) + '%'; }

  function link(h, url, text) {
    var u = safeUrl(url);
    return u ? h.html`<a href="${u}" target="_blank" rel="noopener noreferrer">${text}</a>` : h.html`${text}`;
  }
  function card(h, n, label) { return h.html`<div class="card"><div class="n">${n}</div><div class="l">${label}</div></div>`; }
  function out(id, text, isErr) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.style.color = isErr ? 'var(--danger)' : '';
  }

  function statusWord(p, f) {
    if (p.status !== 'ok') return p.status === 'not_configured' ? 'not configured' : p.status;
    if (!f || !f.lastSuccessAt) return 'no successful run yet';
    return f.stale ? 'stale' : 'ok';
  }

  function renderSources(h, d) {
    var rows = '';
    (d.providers || []).forEach(function (p) {
      var fresh = (d.freshness || []).filter(function (f) { return f.source === p.id; });
      var quota = (d.quota || []).filter(function (q) { return q.source === p.id; })[0] || {};
      var list = fresh.length ? fresh : [null];
      list.forEach(function (f) {
        // Fragments are concatenated, never interpolated into another h.html (that would escape the markup).
        rows += h.html`<tr><td><b>${p.label}</b><div class="muted" style="font-size:11px">${p.id} · ${p.kind}</div></td><td><span class="pill">${statusWord(p, f)}</span>` +
          (p.reason ? h.html`<div class="muted" style="font-size:11px;max-width:360px">${p.reason}</div>` : '') +
          h.html`</td><td>${f ? f.region : '—'}</td><td>` +
          (f && f.lastSuccessAt ? h.html`${ago(f.lastSuccessAt)}<div class="muted" style="font-size:11px">${when(f.lastSuccessAt)}</div>` : 'never') +
          '</td><td>' +
          (f && f.latestSnapshot ? h.html`${f.latestSnapshot.item_count} items · ${ago(f.latestSnapshot.observed_at)}` : '—') +
          '</td><td>' +
          (f && f.lastError ? h.html`<span style="color:var(--danger)">${f.lastError.error || 'error'}</span><div class="muted" style="font-size:11px">${when(f.lastError.at)} · ${f.lastError.attempts} attempt(s)</div>` : '—') +
          '</td><td>' +
          (quota.dailyBudget == null ? 'unmetered' : h.html`${quota.usedToday || 0} / ${quota.dailyBudget} units`) +
          h.html`</td><td>${p.derivedMetricsAllowed ? 'allowed' : 'off'}</td></tr>`;
      });
    });
    return h.html`<div class="card"><h3 style="margin-top:0">Sources <span class="muted">· stale after ${d.policy ? d.policy.staleAfterHours : 18} h without a successful run</span></h3>
      <table><thead><tr><th>Source</th><th>Status</th><th>Region</th><th>Last success</th><th>Latest snapshot</th><th>Last error</th><th>Quota today</th><th>Rank change</th></tr></thead><tbody>` + rows + '</tbody></table></div>';
  }

  function renderConfidence(h, d) {
    var m = d.matches || { byStatus: {}, confidence: [], total: 0 };
    var total = m.total || 0;
    var bars = (m.confidence || []).map(function (b) {
      var w = total ? Math.round((b.count / total) * 100) : 0;
      return h.html`<tr><td>${b.range}</td><td><span class="btrack" style="display:inline-block;width:160px;vertical-align:middle;margin-right:8px"><span class="bfill" style="display:block;width:${w}%"></span></span>${b.count}</td></tr>`;
    }).join('');
    var pills = Object.keys(m.byStatus || {}).map(function (k) { return h.html`<span class="pill">${k}: ${m.byStatus[k]}</span>`; }).join(' ');
    return h.html`<div class="card"><h3 style="margin-top:0">Match confidence <span class="muted">· automatic matches need ${d.policy ? d.policy.autoMatchThreshold : 0.8} or more and no close rival</span></h3>
      <div class="chips" style="margin-bottom:8px">` + (pills || h.html`<span class="muted">No matches yet.</span>`) + '</div><table><tbody>' + bars + '</tbody></table></div>';
  }

  function renderQueue(h, d) {
    var q = d.reviewQueue || [];
    var rows = q.map(function (m) {
      var o = m.observation || {};
      var cands = (Array.isArray(m.candidates) ? m.candidates : []).map(function (c) {
        return h.html`<div style="font-size:12px">${c.title} — ${c.artist || '?'} <span class="muted">(${c.id} · ${pct(c.confidence)} · ${c.method})</span></div>`;
      }).join('');
      return '<tr><td style="max-width:280px">' + link(h, o.url, o.title || m.source_item_id) +
        h.html`<div class="muted" style="font-size:11px">${m.source} · #${o.source_rank || '?'} · ${o.region || ''} · seen ${ago(m.last_seen_at)}</div></td><td style="max-width:260px">` +
        (m.catalog_id
          ? h.html`${m.catalog_title || ''} — ${m.catalog_artist || ''}<div class="muted" style="font-size:11px">${m.catalog_id} · ${pct(m.mapping_confidence)} · ${m.method}</div>`
          : '<span class="muted">no proposal</span>') +
        h.html`</td><td><span class="pill">${(m.reason || 'review').replace(/_/g, ' ')}</span></td><td style="max-width:280px">` +
        (cands || '<span class="muted">none</span>') +
        h.html`</td><td style="white-space:nowrap"><button data-tr="review" data-decision="accept" data-id="${m.id}"` + (m.catalog_id ? '' : ' disabled') + h.html`>Accept</button>
          <button class="ghost" data-tr="review" data-decision="reject" data-id="${m.id}">Reject</button>
          <div class="row" style="gap:6px;margin-top:6px"><input class="inp" id="tr-cid-${m.id}" placeholder="catalogue id" style="width:120px" /><button class="ghost" data-tr="review" data-decision="correct" data-id="${m.id}">Correct</button></div>
          <div class="muted" id="tr-q-${m.id}" style="font-size:11px"></div></td></tr>`;
    }).join('');
    return h.html`<div class="card"><h3 style="margin-top:0">Review queue <span class="muted">· ambiguous and unmatched items — never shown to listeners until accepted or corrected</span></h3>
      <div class="row" style="gap:8px;margin-bottom:8px"><label class="muted" for="tr-reviewer" style="font-size:12px">Reviewer</label><input class="inp" id="tr-reviewer" value="${ctx.reviewer}" placeholder="your name (kept in each item's history)" style="width:240px" /></div>
      <table><thead><tr><th>Source item</th><th>Proposed song</th><th>Why</th><th>Candidates</th><th>Decision</th></tr></thead><tbody>` +
      (rows || h.html`<tr><td colspan="5" class="empty">Nothing waiting for review.</td></tr>`) + '</tbody></table></div>';
  }

  function renderDecisions(h, d) {
    var rows = (d.recentDecisions || []).map(function (m) {
      var hist = Array.isArray(m.history) ? m.history : [];
      var last = hist[hist.length - 1] || {};
      var from = last.from || {};
      var to = last.to || {};
      return h.html`<tr><td>${when(m.reviewed_at)}</td><td>${m.reviewed_by || '—'}</td><td>${last.action || m.status}</td><td>${(m.observation && m.observation.title) || m.source_item_id}</td><td>${from.catalogId || '—'} → ${to.catalogId || '—'}</td><td>${last.note || ''}</td></tr>`;
    }).join('');
    if (!rows) return '';
    return h.html`<div class="card"><h3 style="margin-top:0">Recent decisions</h3><table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Item</th><th>Catalogue id</th><th>Note</th></tr></thead><tbody>` + rows + '</tbody></table></div>';
  }

  function renderEditorial(h, d) {
    var rows = (d.editorial || []).map(function (e) {
      var canWithdraw = e.state === 'active' || e.state === 'upcoming' || e.state === 'expiring';
      return h.html`<tr>
        <td><span class="pill">${e.state}</span></td>
        <td>${e.title}<div class="muted" style="font-size:11px">${e.artist || ''}${e.catalog_id ? ' · ' + e.catalog_id : ''}</div></td>
        <td>${e.region}${e.language ? ' · ' + e.language : ''}</td>
        <td>${when(e.starts_at)}<div class="muted" style="font-size:11px">until ${when(e.expires_at)}</div></td>
        <td>` + link(h, e.evidence_url, 'evidence') + h.html`</td>
        <td>${e.imported_by || '—'}<div class="muted" style="font-size:11px">${when(e.imported_at)}</div></td><td>` +
        (canWithdraw ? h.html`<button class="ghost" data-tr="withdraw" data-id="${e.id}">Withdraw</button>` : '') + '</td></tr>';
    }).join('');
    var expiring = (d.editorial || []).filter(function (e) { return e.state === 'expiring'; }).length;
    return h.html`<div class="card"><h3 style="margin-top:0">Editorial import <span class="muted">· labelled as editorial wherever it appears; never presented as a public chart</span></h3>
      <p class="muted" style="margin-top:0;font-size:12px">CSV header: <code>title,artist,catalog_id,region,language,position,evidence_url,starts_at,expires_at,note</code>. Required: title, an https evidence link, an expiry (at most 90 days after the start), and an artist or a catalogue id. JSON: an array of objects with the same fields. One invalid row and nothing is imported.</p>
      <div class="row" style="gap:8px;margin-bottom:8px"><select class="inp" id="tr-format" style="width:110px"><option value="csv" ${ctx.importFormat === 'csv' ? 'selected' : ''}>CSV</option><option value="json" ${ctx.importFormat === 'json' ? 'selected' : ''}>JSON</option></select>
      <button data-tr="validate">Validate</button><button data-tr="import">Import</button><span class="muted" id="tr-import-msg" style="font-size:12px"></span></div>
      <textarea class="inp" id="tr-import" rows="6" placeholder="Paste CSV or JSON here…">${ctx.importText}</textarea>
      <div id="tr-import-out"></div></div>
      <div class="card"><h3 style="margin-top:0">Editorial entries <span class="muted">· ${expiring} expiring within 72 h</span></h3>
      <table><thead><tr><th>State</th><th>Song</th><th>Region</th><th>Window</th><th>Evidence</th><th>Imported</th><th></th></tr></thead><tbody>` +
      (rows || h.html`<tr><td colspan="7" class="empty">No editorial entries.</td></tr>`) + '</tbody></table></div>';
  }

  function renderRuns(h, d) {
    var rows = (d.runs || []).slice(0, 30).map(function (r) {
      return h.html`<tr><td>${when(r.started_at)}</td><td>${r.source}</td><td>${r.region}</td><td>${r.trigger}</td><td>${r.status}${r.duplicate_snapshot ? ' (already stored)' : ''}</td><td>${r.attempts}</td><td>${r.items_fetched} / ${r.items_inserted}</td><td>${r.matched} / ${r.queued_for_review}</td><td>${r.quota_units}</td><td style="max-width:260px;color:${r.status === 'error' ? 'var(--danger)' : 'inherit'}">${r.error || ''}</td></tr>`;
    }).join('');
    return h.html`<div class="card"><h3 style="margin-top:0">Recent runs</h3><table><thead><tr><th>Started</th><th>Source</th><th>Region</th><th>By</th><th>Status</th><th>Attempts</th><th>Fetched / new</th><th>Matched / review</th><th>Units</th><th>Error</th></tr></thead><tbody>` +
      (rows || h.html`<tr><td colspan="10" class="empty">No runs yet — the scheduled job has not run, or the migration is missing.</td></tr>`) + '</tbody></table></div>';
  }

  function render(h, d) {
    var intro = h.html`<div class="card"><h3 style="margin-top:0">Trend Operations</h3>
      <p class="muted" style="margin-top:0">Public charts and editorial entries, matched to catalogue songs. Listeners only ever see confident or reviewed matches, each labelled with its source and evidence link. Metadata only: no audio is fetched from any source.</p>
      <div class="row" style="gap:8px;flex-wrap:wrap"><button data-tr="run">Run sources now</button><button class="ghost" data-tr="reload">Reload panel</button><span class="muted" id="tr-run-out" style="font-size:12px"></span></div></div>`;
    if (d.configured === false) {
      h.view(intro + h.html`<div class="card"><p>The database is not configured, so nothing can be stored or shown. Provider status:</p></div>` + renderSources(h, d));
      return;
    }
    var providers = d.providers || [];
    var live = (d.freshness || []).filter(function (f) { var p = providers.filter(function (x) { return x.id === f.source; })[0]; return p && p.status === 'ok' && f.lastSuccessAt && !f.stale; }).length;
    var configured = (d.freshness || []).filter(function (f) { var p = providers.filter(function (x) { return x.id === f.source; })[0]; return p && p.status === 'ok'; }).length;
    var by = (d.matches && d.matches.byStatus) || {};
    var video = (d.quota || []).filter(function (q) { return q.dailyBudget != null; })[0];
    var kpis = '<div class="cards">' + card(h, live + ' / ' + configured, 'Sources fresh') + card(h, (d.reviewQueue || []).length, 'Awaiting review') +
      card(h, (by.matched || 0) + (by.accepted || 0) + (by.corrected || 0), 'Confident matches') + card(h, video ? (video.usedToday + ' / ' + video.dailyBudget) : '—', 'Chart quota today (units)') + '</div>';
    var ret = d.retention || {};
    var retention = ret.oldestStoredDays != null && ret.oldestStoredDays >= ret.limitDays - 2
      ? h.html`<div class="card" style="border-color:var(--warn)"><b style="color:var(--warn)">Retention:</b> the oldest stored snapshot is ${ret.oldestStoredDays} days old (limit ${ret.limitDays}). The scheduled job deletes older data — check that it is running.</div>`
      : '';
    h.view(intro + kpis + retention + renderSources(h, d) + renderConfidence(h, d) + renderQueue(h, d) + renderDecisions(h, d) + renderEditorial(h, d) + renderRuns(h, d));
    h.setExport('trend-review-queue', (d.reviewQueue || []).map(function (m) {
      return { id: m.id, source: m.source, source_item_id: m.source_item_id, source_title: m.observation ? m.observation.title : '', source_url: m.observation ? m.observation.url : '', proposed_catalog_id: m.catalog_id || '', proposed_title: m.catalog_title || '', confidence: m.mapping_confidence, method: m.method, reason: m.reason || '' };
    }));
  }

  function load(h) {
    ctx.h = h;
    var title = h.$('secTitle');
    if (title) title.textContent = 'Trend Operations';
    var crumb = h.$('secCrumb');
    if (crumb) crumb.textContent = 'Catalog';
    bind(h);
    h.api('/api/admin/trends').then(function (d) {
      if (!d || !h.isActive(KEY)) return;
      render(h, d);
      h.stamp();
    }).catch(function (e) {
      if (!h.isActive(KEY)) return;
      if (e && /http 503/.test(String(e.message))) {
        h.view(h.html`<div class="card"><h3 style="margin-top:0">Trend Operations</h3><p>Unavailable — the database answered with an error. If the trend tables have never been created, run <code>frontend/supabase/migrations/2026-09-vinax-7.2-trends.sql</code> in the SQL editor. Nothing is shown as zero while the read is failing.</p></div>`);
        return;
      }
      h.fail(e);
    });
  }

  function keepDrafts() {
    var r = document.getElementById('tr-reviewer');
    var t = document.getElementById('tr-import');
    var f = document.getElementById('tr-format');
    if (r) ctx.reviewer = r.value.trim().slice(0, 60);
    if (t) ctx.importText = t.value;
    if (f) ctx.importFormat = f.value === 'json' ? 'json' : 'csv';
  }

  function renderIssues(h, res) {
    var box = document.getElementById('tr-import-out');
    if (!box) return;
    var issues = (res && res.issues) || [];
    if (!issues.length) { box.innerHTML = ''; return; }
    box.innerHTML = h.html`<table style="margin-top:8px"><thead><tr><th>Row</th><th>Field</th><th>Problem</th></tr></thead><tbody>` +
      issues.map(function (i) { return h.html`<tr><td>${i.row || 'file'}</td><td>${i.field}</td><td>${i.message}</td></tr>`; }).join('') + '</tbody></table>';
  }

  function onClick(ev) {
    var h = ctx.h;
    var btn = ev.target && ev.target.closest ? ev.target.closest('[data-tr]') : null;
    if (!btn || !h || !h.isActive(KEY) || btn.disabled) return;
    keepDrafts();
    var kind = btn.getAttribute('data-tr');
    var id = Number(btn.getAttribute('data-id'));

    if (kind === 'reload') { load(h); return; }

    if (kind === 'run') {
      out('tr-run-out', 'Running…');
      btn.disabled = true;
      h.postApi('/api/admin/trends', { action: 'run' }).then(function (r) {
        btn.disabled = false;
        if (!r) return;
        if (r.error) { out('tr-run-out', 'Failed — ' + r.error, true); return; }
        var ran = (r.runs || []).map(function (x) { return x.source + '/' + x.region + ': ' + x.status + (x.reason ? ' (' + x.reason + ')' : ''); });
        out('tr-run-out', ran.length ? ran.join(' · ') : 'Nothing ran — no source is configured.', (r.runs || []).some(function (x) { return x.status === 'error'; }));
        setTimeout(function () { if (h.isActive(KEY)) load(h); }, 1200);
      }).catch(function () { btn.disabled = false; out('tr-run-out', 'Failed — network error', true); });
      return;
    }

    if (kind === 'review') {
      var decision = btn.getAttribute('data-decision');
      var body = { action: 'review', id: id, decision: decision, reviewer: ctx.reviewer };
      if (decision === 'correct') {
        var input = document.getElementById('tr-cid-' + id);
        body.catalogId = input ? input.value.trim() : '';
        if (!body.catalogId) { out('tr-q-' + id, 'Enter the catalogue id first.', true); return; }
      }
      out('tr-q-' + id, 'Saving…');
      h.postApi('/api/admin/trends', body).then(function (r) {
        if (!r) return;
        if (r.error) { out('tr-q-' + id, 'Failed — ' + r.error.replace(/_/g, ' '), true); return; }
        load(h);
      }).catch(function () { out('tr-q-' + id, 'Failed — network error', true); });
      return;
    }

    if (kind === 'validate' || kind === 'import') {
      if (!ctx.importText.trim()) { out('tr-import-msg', 'Paste CSV or JSON first.', true); return; }
      out('tr-import-msg', kind === 'import' ? 'Importing…' : 'Checking…');
      h.postApi('/api/admin/trends', { action: kind === 'import' ? 'import' : 'validate-import', format: ctx.importFormat, data: ctx.importText, reviewer: ctx.reviewer }).then(function (r) {
        if (!r) return;
        renderIssues(h, r);
        if (r.error) { out('tr-import-msg', 'Failed — ' + r.error.replace(/_/g, ' '), true); return; }
        if (kind === 'validate' || (r.issues && r.issues.length)) {
          out('tr-import-msg', r.issues && r.issues.length ? r.issues.length + ' problem(s) — nothing was imported.' : 'All ' + r.valid + ' row(s) are valid.', !!(r.issues && r.issues.length));
          return;
        }
        ctx.importText = '';
        out('tr-import-msg', 'Imported ' + r.inserted + ' entr' + (r.inserted === 1 ? 'y' : 'ies') + (r.alreadyImported ? ', ' + r.alreadyImported + ' already present' : '') + '.');
        setTimeout(function () { if (h.isActive(KEY)) load(h); }, 800);
      }).catch(function () { out('tr-import-msg', 'Failed — network error', true); });
      return;
    }

    if (kind === 'withdraw') {
      if (btn.getAttribute('data-armed') !== '1') {
        btn.setAttribute('data-armed', '1');
        btn.textContent = 'Confirm withdraw';
        return;
      }
      btn.disabled = true;
      h.postApi('/api/admin/trends', { action: 'withdraw', editorialId: id }).then(function (r) {
        if (!r) return;
        if (r.error) { btn.disabled = false; btn.textContent = 'Failed — ' + r.error; return; }
        load(h);
      }).catch(function () { btn.disabled = false; btn.textContent = 'Failed'; });
    }
  }

  function bind(h) {
    var view = h.$('view');
    if (!view || view.getAttribute('data-tr-bound') === '1') return;
    view.setAttribute('data-tr-bound', '1');
    view.addEventListener('click', onClick);
  }

  window.VinaXAdminSections.register(KEY, { local: true, load: load });
})();
