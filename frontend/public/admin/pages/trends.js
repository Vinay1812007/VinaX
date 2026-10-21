/* VinaX console — Trends page.
 * Trend operations from /api/admin/trends: every trend source with its status
 * and the reason when it is off, freshness per region, quota used today,
 * stored-data age, match confidence and the run history ("Run now" posts
 * {action:'run'}); the review queue (accept / reject / correct a proposed
 * catalogue match); editorial picks (validate + import CSV/JSON, withdraw).
 * The GET answers 503 (not 502) with a db_* code when the trend tables are
 * missing. Trending pins are the remote config key 'trending-pins' (string[],
 * ≤6, 2–40 chars each), shown next to what /api/trending-searches serves now. */
(function () {
  'use strict';
  var VX = window.VX, h = VX.h, ui = VX.ui, fmt = VX.fmt;

  VX.page({
    id: 'trends', title: 'Trends', group: 'Music', icon: 'flame', noAuto: true,
    desc: 'Trend sources, the match review queue, editorial picks and the pinned trending searches.',
    tabs: [
      { id: 'sources', label: 'Sources', desc: 'Is every trend source running, fresh and within its quota?', render: renderSources },
      { id: 'review', label: 'Review queue', desc: 'Trending items the matcher was not sure about. Accept, reject or correct each one.', render: renderReview },
      { id: 'editorial', label: 'Editorial picks', desc: 'Hand-picked trending songs with an evidence link and an expiry date.', render: renderEditorial },
      { id: 'pins', label: 'Trending pins', desc: 'Searches shown first in the “Trending” chips under the search bar.', render: renderPins }
    ]
  });

  var API = '/api/admin/trends';
  var REVIEWER_KEY = 'vinax_admin_reviewer';

  var TREND_ERRORS = {
    bad_id: 'That item id is not valid.',
    unknown_decision: 'Unknown decision.',
    not_found: 'That item no longer exists — reload the queue.',
    nothing_to_accept: 'This item has no proposed song to accept. Use Correct and enter a catalogue id.',
    bad_catalog_id: 'That catalogue id is not valid (2–40 letters, digits, _ or -).',
    catalog_unavailable: 'The catalogue could not be reached to check that id. Try again shortly.',
    catalog_error: 'The catalogue returned an error for that id.',
    catalog_id_not_found: 'No song with that catalogue id exists.',
    db_write_failed: 'The database did not save the change.',
    db_not_found: VX.errorText('db_schema_missing'),
    db_unavailable: VX.errorText('db_unavailable'),
    unknown_source: 'Unknown trend source.',
    bad_region: 'Region must be a two-letter country code.',
    unknown_action: 'The server did not understand that request.'
  };
  function errText(res) { return TREND_ERRORS[res.error] || res.message; }

  function reviewer() { try { return (localStorage.getItem(REVIEWER_KEY) || '').slice(0, 60); } catch (e) { return ''; } }
  function setReviewer(v) { try { localStorage.setItem(REVIEWER_KEY, String(v || '').slice(0, 60)); } catch (e) {} }
  function withReviewer(body) { var r = reviewer().trim(); if (r) body.reviewer = r; return body; }

  /** Shared GET loader: shows the "not connected" notice and the 503 error with retry. */
  function loadTrends(host, render) {
    return ui.load(host, function () { return VX.api.get(API, null, { fresh: true }); }, function (d) {
      if (d.configured === false) return ui.notice('The database is not connected, so trend data cannot be stored. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the Worker.', 'warn');
      return render(d);
    }, { skeleton: 6 });
  }

  function safeUrl(u) { return typeof u === 'string' && /^https:\/\//i.test(u) ? u : null; }
  function extLink(url, text) {
    var u = safeUrl(url);
    return u ? h('a', { href: u, target: '_blank', rel: 'noopener noreferrer' }, text || u, ' ', VX.icon('external')) : h('span.muted', url ? 'Not an https link' : '—');
  }
  function confPill(c) {
    var n = Number(c);
    if (!isFinite(n)) return ui.pill('—');
    return ui.pill(fmt.ratio(n) + ' sure', n >= 0.8 ? 'ok' : n >= 0.5 ? 'warn' : 'bad');
  }

  /* -------------------------------------------------------- sources */

  function sourceState(p, f) {
    if (p.status === 'disabled') return { tone: 'muted', label: 'Disabled' };
    if (p.status === 'not_configured') return { tone: 'warn', label: 'Not configured' };
    if (p.status !== 'ok') return { tone: 'warn', label: String(p.status || 'Unknown') };
    if (p.kind === 'editorial') return { tone: 'ok', label: 'Ready' };
    if (!f || !f.lastSuccessAt) return { tone: 'warn', label: 'No successful run yet' };
    if (f.lastError && (!f.lastSuccessAt || f.lastError.at > f.lastSuccessAt)) return { tone: 'bad', label: 'Last run failed' };
    return f.stale ? { tone: 'warn', label: 'Stale' } : { tone: 'ok', label: 'Fresh' };
  }

  function runNow(body, after) {
    return VX.api.post(API, Object.assign({ action: 'run' }, body || {}), { timeout: 60000 }).then(function (res) {
      if (!res.ok) { VX.toast('Run failed: ' + errText(res), 'bad'); return res; }
      var d = res.data || {};
      var runs = d.runs || [], notRun = d.notRun || [];
      var failed = runs.filter(function (r) { return r.status === 'error'; });
      VX.modal({
        title: runs.length ? 'Run finished' : 'Nothing ran',
        body: [
          runs.length ? ui.table({
            columns: [
              { key: 'source', label: 'Source' }, { key: 'region', label: 'Region' },
              { key: 'status', label: 'Result', render: function (r) { return ui.pill(r.status === 'ok' ? 'OK' : r.status === 'skipped' ? 'Skipped' : 'Failed', r.status === 'ok' ? 'ok' : r.status === 'skipped' ? null : 'bad'); } },
              { key: 'fetched', label: 'Fetched', align: 'right', render: function (r) { return fmt.num(r.fetched); } },
              { key: 'matched', label: 'Matched', align: 'right', render: function (r) { return fmt.num(r.matched); } },
              { key: 'review', label: 'To review', align: 'right', render: function (r) { return fmt.num(r.review); } },
              { key: 'reason', label: 'Note', render: function (r) { return r.duplicateSnapshot ? 'Same chart as last time — nothing new' : (r.reason || ''); } }
            ], rows: runs, exportName: false, search: false
          }) : null,
          notRun.length ? h('div', h('h3', 'Did not run'), h('ul.list', notRun.map(function (n) { return h('li', ui.pill(n.source || '—'), h('span.grow', n.reason || n.status || 'Not run')); }))) : null,
          !runs.length && !notRun.length ? h('p', 'No trend source is configured.') : null
        ],
        actions: [{ label: 'Close', kind: 'primary' }],
        wide: true
      });
      VX.toast(failed.length ? fmt.plural(failed.length, 'source') + ' failed' : 'Run finished', failed.length ? 'bad' : 'ok');
      if (after) after();
      return res;
    });
  }

  function renderSources(host, ctx) {
    var body = h('div.page-body');
    host.appendChild(body);
    return loadTrends(body, function (d) {
      var providers = d.providers || [], freshness = d.freshness || [], quota = d.quota || [];
      var policy = d.policy || {}, ret = d.retention || {}, matches = d.matches || {}, by = matches.byStatus || {};
      var rows = [];
      providers.forEach(function (p) {
        var fr = freshness.filter(function (f) { return f.source === p.id; });
        var q = quota.filter(function (x) { return x.source === p.id; })[0] || {};
        (fr.length ? fr : [null]).forEach(function (f) { rows.push({ p: p, f: f, q: q }); });
      });
      var running = providers.filter(function (p) { return p.status === 'ok'; }).length;
      var stale = freshness.filter(function (f) { return f.stale; }).length;
      var activeEd = (d.editorial || []).filter(function (e) { return e.state === 'active' || e.state === 'expiring'; }).length;
      var queue = (d.reviewQueue || []).length;
      var conf = matches.confidence || [];

      return [
        ui.kpis([
          { label: 'Sources running', value: fmt.num(running) + ' of ' + fmt.num(providers.length), tone: providers.length && !running ? 'warn' : null },
          { label: 'Stale regions', value: fmt.num(stale), sub: 'no fresh chart in ' + fmt.num(policy.staleAfterHours) + ' h', tone: stale ? 'warn' : null },
          { label: 'Waiting for review', value: fmt.num(queue), tone: queue ? 'warn' : null },
          { label: 'Editorial picks live', value: fmt.num(activeEd) },
          { label: 'Oldest stored chart', value: ret.oldestStoredDays == null ? '—' : fmt.plural(ret.oldestStoredDays, 'day'), sub: 'kept for ' + fmt.num(ret.limitDays || policy.retentionDays) + ' days' }
        ]),
        ui.card({
          title: 'Trend sources', sub: 'One row per source and region. Regions: ' + ((policy.regions || []).join(', ') || '—'), pad: false,
          actions: [ui.button('Run all now', { kind: 'primary', small: true, icon: 'play', onClick: function () { return runNow({}, function () { ctx.refresh(); }); } })],
          body: ui.table({
            columns: [
              { key: 'label', label: 'Source', sortVal: function (r) { return r.p.label; }, render: function (r) { return h('div', h('div.cell-main', r.p.label || r.p.id), h('div.cell-sub', r.p.id + ' · ' + (r.p.kind === 'editorial' ? 'editorial' : 'public chart'))); } },
              { key: 'state', label: 'Status', sortVal: function (r) { return sourceState(r.p, r.f).label; }, render: function (r) {
                var st = sourceState(r.p, r.f);
                return h('div', ui.pill(st.label, st.tone === 'muted' ? null : st.tone), r.p.reason ? h('div.cell-sub', r.p.reason) : null);
              } },
              { key: 'region', label: 'Region', sortVal: function (r) { return r.f ? r.f.region : ''; }, render: function (r) { return r.f ? r.f.region : '—'; } },
              { key: 'last', label: 'Last success', sortVal: function (r) { return r.f && r.f.lastSuccessAt; }, render: function (r) { return r.f && r.f.lastSuccessAt ? h('span', { title: fmt.dateTime(r.f.lastSuccessAt) }, fmt.ago(r.f.lastSuccessAt)) : 'Never'; } },
              { key: 'snap', label: 'Latest chart', sort: false, render: function (r) { var s = r.f && r.f.latestSnapshot; return s ? fmt.plural(s.item_count, 'item') + ' · ' + fmt.ago(s.observed_at) : '—'; } },
              { key: 'err', label: 'Last error', sort: false, render: function (r) { var e = r.f && r.f.lastError; return e ? h('div', h('span.status.bad', e.error || 'Error'), h('div.cell-sub', fmt.ago(e.at) + ' · ' + fmt.plural(e.attempts, 'attempt'))) : '—'; } },
              { key: 'quota', label: 'Quota today', sort: false, render: function (r) {
                if (r.q.dailyBudget == null) return h('span.muted', 'Unmetered');
                var used = Number(r.q.usedToday) || 0, cap = Number(r.q.dailyBudget) || 0;
                return h('div', { style: { display: 'grid', gap: '4px', minWidth: '110px' } }, h('span', fmt.num(used) + ' / ' + fmt.num(cap) + ' units'), ui.meter(cap ? used / cap : 0, cap && used / cap > 0.85 ? 'warn' : null));
              } },
              { key: 'run', label: '', sort: false, render: function (r) {
                if (r.p.status !== 'ok' || r.p.kind === 'editorial') return null;
                return ui.button('Run', { kind: 'ghost', small: true, icon: 'play', ariaLabel: 'Run ' + r.p.id + (r.f ? ' ' + r.f.region : ''), onClick: function () { return runNow(r.f ? { source: r.p.id, region: r.f.region } : { source: r.p.id }, function () { ctx.refresh(); }); } });
              } }
            ],
            rows: rows, exportName: false, search: false,
            empty: 'No trend sources reported', emptyHint: 'Sources are listed once the Worker is configured.'
          })
        }),
        ui.grid([
          ui.card({ title: 'Match confidence', sub: 'How sure the matcher was when it linked a trending item to a catalogue song. Below ' + fmt.ratio(policy.autoMatchThreshold) + ' goes to review.',
            body: ui.hbars(conf.some(function (c) { return Number(c.count) > 0; }) ? conf.map(function (c) { return { label: c.range, value: c.count }; }) : [], { empty: 'No matches yet', emptyHint: 'Appears after the first successful run.' }) }),
          ui.card({ title: 'Match decisions', sub: fmt.plural(matches.total, 'match', 'matches') + ' stored',
            body: Number(matches.total) ? ui.share([
              { label: 'Matched automatically', value: by.matched }, { label: 'Waiting for review', value: by.review },
              { label: 'Accepted', value: by.accepted }, { label: 'Corrected', value: by.corrected }, { label: 'Rejected', value: by.rejected }
            ]) : ui.empty('No matches yet', 'Appears after the first successful run.') })
        ], 2),
        ui.card({ title: 'Run history', sub: 'The newest 60 runs', pad: false,
          body: ui.table({
            columns: [
              { key: 'started_at', label: 'Started', render: function (r) { return h('span', { title: fmt.dateTime(r.started_at) }, fmt.ago(r.started_at)); } },
              { key: 'source', label: 'Source' }, { key: 'region', label: 'Region' },
              { key: 'trigger', label: 'Trigger' },
              { key: 'status', label: 'Result', render: function (r) { return h('div', ui.pill(r.ok ? 'OK' : String(r.status || 'Failed'), r.ok ? 'ok' : 'bad'), r.error ? h('div.cell-sub', r.error) : null); } },
              { key: 'items_fetched', label: 'Fetched', align: 'right', render: function (r) { return fmt.num(r.items_fetched); } },
              { key: 'matched', label: 'Matched', align: 'right', render: function (r) { return fmt.num(r.matched); } },
              { key: 'queued_for_review', label: 'To review', align: 'right', render: function (r) { return fmt.num(r.queued_for_review); } },
              { key: 'quota_units', label: 'Units', align: 'right', render: function (r) { return fmt.num(r.quota_units); } }
            ],
            rows: d.runs || [], sortKey: 'started_at', exportName: 'vinax-trend-runs', pageSize: 15,
            empty: 'No runs yet', emptyHint: 'The scheduled job runs the sources automatically; use “Run all now” to start one.'
          }) })
      ];
    });
  }

  /* --------------------------------------------------------- review */

  function review(item, decision, extra) {
    var body = withReviewer(Object.assign({ action: 'review', id: Number(item.id), decision: decision }, extra || {}));
    return VX.api.post(API, body, { timeout: 30000 }).then(function (res) {
      if (res.ok) VX.toast(decision === 'accept' ? 'Accepted' : decision === 'reject' ? 'Rejected' : 'Corrected', 'ok');
      else VX.toast('Could not save: ' + errText(res), 'bad');
      return res;
    });
  }

  function correctDialog(item, done) {
    var input = ui.input({ placeholder: 'Catalogue song id', maxlength: '40', value: item.catalog_id || '' });
    var note = ui.input({ placeholder: 'Optional note', maxlength: '300' });
    var cands = (item.candidates || []).filter(function (c) { return c && c.id; });
    var msg = h('p.field-hint', { role: 'status' });
    VX.modal({
      title: 'Correct the match',
      body: [
        h('p', 'Trending item: ', h('strong', (item.observation && item.observation.title) || item.source_item_id || '—')),
        cands.length ? h('div.field', h('span.field-label', 'Pick a candidate'), h('ul.list', cands.slice(0, 8).map(function (c) {
          return h('li', h('div.grow', h('div.cell-main', c.title || '—'), h('div.cell-sub', (c.artist || '') + (c.album ? ' · ' + c.album : '') + ' · ' + c.id)),
            confPill(c.confidence),
            ui.button('Use', { kind: 'ghost', small: true, onClick: function () { input.value = c.id; input.focus(); } }));
        }))) : null,
        ui.field('Catalogue id', input, 'The song id from Catalog → Catalog lookup.'),
        ui.field('Note', note),
        msg
      ],
      actions: [
        { label: 'Cancel', kind: 'ghost' },
        { label: 'Save correction', kind: 'primary', onClick: function (close) {
          var id = input.value.trim();
          if (!/^[A-Za-z0-9_-]{2,40}$/.test(id)) { input.classList.add('invalid'); msg.textContent = 'Enter a catalogue id (2–40 letters, digits, _ or -).'; return null; }
          var extra = { catalogId: id };
          if (note.value.trim()) extra.note = note.value.trim().slice(0, 300);
          return review(item, 'correct', extra).then(function (res) { if (res.ok) { close(); done(); } else msg.textContent = errText(res); });
        } }
      ]
    });
  }

  function renderReview(host, ctx) {
    var who = ui.input({ placeholder: 'owner', value: reviewer(), maxlength: '60', 'aria-label': 'Your name for the review history' });
    who.addEventListener('change', function () { setReviewer(who.value.trim()); });
    host.appendChild(h('div.toolbar', ui.field('Decisions are saved as', who, null, { inline: true })));
    var body = h('div.page-body');
    host.appendChild(body);
    return loadTrends(body, function (d) {
      var q = d.reviewQueue || [];
      return [
        ui.card({ title: 'Review queue', sub: q.length ? fmt.plural(q.length, 'item') + ' waiting for a decision' : 'Nothing to review', pad: false,
          body: ui.table({
            columns: [
              { key: 'title', label: 'Trending item', sortVal: function (r) { return r.observation ? r.observation.title : r.source_item_id; }, render: function (r) {
                var o = r.observation || {};
                return h('div', h('div.cell-main', o.title || r.source_item_id || '—'),
                  h('div.cell-sub', [r.source, o.region, o.source_rank ? '#' + o.source_rank : null, o.credit].filter(Boolean).join(' · ')),
                  safeUrl(o.url) ? h('div.cell-sub', extLink(o.url, 'Open source')) : null);
              } },
              { key: 'catalog_title', label: 'Proposed song', render: function (r) {
                if (!r.catalog_id) return h('span.muted', 'No proposal');
                return h('div', h('div.cell-main', r.catalog_title || r.catalog_id), h('div.cell-sub', (r.catalog_artist || '') + ' · ', ui.mono(r.catalog_id)));
              } },
              { key: 'mapping_confidence', label: 'Confidence', align: 'right', render: function (r) { return confPill(r.mapping_confidence); } },
              { key: 'last_seen_at', label: 'Seen', render: function (r) { return fmt.ago(r.last_seen_at || r.first_seen_at); } },
              { key: 'act', label: '', sort: false, render: function (r) {
                return h('div.actions',
                  ui.button('Accept', { kind: 'primary', small: true, disabled: !r.catalog_id, title: r.catalog_id ? 'Link this trend to the proposed song' : 'No proposed song — use Correct', onClick: function () { return review(r, 'accept').then(function (res) { if (res.ok) ctx.refresh(); }); } }),
                  ui.button('Correct', { kind: 'ghost', small: true, onClick: function () { correctDialog(r, function () { ctx.refresh(); }); } }),
                  ui.button('Reject', { kind: 'ghost', small: true, onClick: function () { return review(r, 'reject').then(function (res) { if (res.ok) ctx.refresh(); }); } }));
              } }
            ],
            rows: q, exportName: 'vinax-trend-review', pageSize: 20,
            empty: 'The queue is empty', emptyHint: 'Items land here when a trend run cannot match a song with at least ' + fmt.ratio((d.policy || {}).autoMatchThreshold || 0.8) + ' confidence.'
          }) }),
        ui.card({ title: 'Recent decisions', sub: 'The last 20 reviewed items', pad: false,
          body: ui.table({
            columns: [
              { key: 'reviewed_at', label: 'When', render: function (r) { return fmt.ago(r.reviewed_at); } },
              { key: 'title', label: 'Trending item', sortVal: function (r) { return r.observation ? r.observation.title : r.source_item_id; }, render: function (r) { return (r.observation && r.observation.title) || r.source_item_id || '—'; } },
              { key: 'status', label: 'Decision', render: function (r) { return ui.pill(cap(r.status), r.status === 'rejected' ? 'bad' : 'ok'); } },
              { key: 'catalog_title', label: 'Song', render: function (r) { return r.catalog_id ? (r.catalog_title || r.catalog_id) : '—'; } },
              { key: 'reviewed_by', label: 'By' }
            ],
            rows: d.recentDecisions || [], exportName: 'vinax-trend-decisions', search: false,
            empty: 'No decisions yet', emptyHint: 'Accepted, rejected and corrected items are listed here.'
          }) })
      ];
    });
  }

  /* ------------------------------------------------------ editorial */

  var CSV_HEADER = 'title,artist,catalog_id,region,language,position,evidence_url,starts_at,expires_at,note';

  function stateTone(s) { return s === 'active' ? 'ok' : s === 'expiring' ? 'warn' : s === 'upcoming' ? 'info' : null; }

  function renderEditorial(host, ctx) {
    var listHost = h('div');
    var importHost = h('div');
    host.appendChild(h('div.page-body', importHost, listHost));
    buildImport(importHost, ctx);
    return loadTrends(listHost, function (d) {
      var rows = d.editorial || [];
      return ui.card({ title: 'Editorial picks', sub: 'Withdrawn and expired picks stay listed for the record', pad: false,
        body: ui.table({
          columns: [
            { key: 'position', label: '#', align: 'right', width: '44px' },
            { key: 'title', label: 'Song', render: function (r) { return h('div', h('div.cell-main', r.title || '—'), h('div.cell-sub', [r.artist, r.catalog_id].filter(Boolean).join(' · '))); } },
            { key: 'region', label: 'Region' },
            { key: 'language', label: 'Language', render: function (r) { return r.language ? cap(r.language) : '—'; } },
            { key: 'state', label: 'State', render: function (r) { return ui.pill(cap(r.state), stateTone(r.state)); } },
            { key: 'starts_at', label: 'Runs', render: function (r) { return fmt.date(r.starts_at) + ' → ' + fmt.date(r.expires_at); } },
            { key: 'evidence_url', label: 'Evidence', sort: false, render: function (r) { return extLink(r.evidence_url, 'Link'); } },
            { key: 'act', label: '', sort: false, render: function (r) {
              if (r.state === 'withdrawn' || r.state === 'expired') return null;
              return ui.button('Withdraw', { kind: 'ghost', small: true, onClick: function () {
                return VX.confirm({ title: 'Withdraw this pick?', body: '“' + (r.title || '') + '” stops counting as trending right away. This cannot be undone — import it again to bring it back.', danger: true, confirmLabel: 'Withdraw' }).then(function (yes) {
                  if (!yes) return null;
                  return VX.api.post(API, { action: 'withdraw', editorialId: Number(r.id) }).then(function (res) {
                    if (res.ok) { VX.toast('Withdrawn', 'ok'); ctx.refresh(); } else VX.toast('Could not withdraw: ' + errText(res), 'bad');
                  });
                });
              } });
            } }
          ],
          rows: rows, exportName: 'vinax-editorial-picks',
          empty: 'No editorial picks yet', emptyHint: 'Import a CSV or JSON file above to add hand-picked trending songs.'
        }) });
    });
  }

  function buildImport(host, ctx) {
    var format = 'csv';
    var text = ui.textarea({ rows: 8, placeholder: CSV_HEADER + '\nNaatu Naatu,Rahul Sipligunj,,IN,telugu,1,https://example.com/chart,2026-10-21,2026-11-04,', 'aria-label': 'Editorial picks to import', spellcheck: 'false', class: 'mono' });
    var file = h('input', { type: 'file', accept: '.csv,.json,text/csv,application/json', 'aria-label': 'Choose a CSV or JSON file' });
    var result = h('div');
    var seg = ui.segmented([{ value: 'csv', label: 'CSV' }, { value: 'json', label: 'JSON' }], format, function (v) { format = v; }, 'File format');
    file.addEventListener('change', function () {
      var f = file.files && file.files[0];
      if (!f) return;
      if (f.size > 512 * 1024) { VX.toast('That file is larger than 512 KB — import at most 200 rows at a time.', 'bad'); return; }
      var r = new FileReader();
      r.onload = function () {
        text.value = String(r.result || '');
        var isJson = /\.json$/i.test(f.name) || /^\s*[[{]/.test(text.value);
        format = isJson ? 'json' : 'csv';
        VX.$$('button', seg).forEach(function (b) { b.setAttribute('aria-checked', String(b.textContent.toLowerCase() === format)); });
      };
      r.readAsText(f);
    });
    function send(action) {
      var data = text.value.trim();
      if (!data) { VX.toast('Paste CSV or JSON, or choose a file, first.', 'bad'); text.focus(); return null; }
      return VX.api.post(API, withReviewer({ action: action, format: format, data: data }), { timeout: 60000 }).then(function (res) {
        var d = res.data || {};
        if (action === 'import' && res.ok) {
          VX.mount(result, ui.notice('Imported ' + fmt.plural(d.inserted, 'pick') + (d.alreadyImported ? ' · ' + fmt.num(d.alreadyImported) + ' were already there' : '') + '.', 'ok'));
          VX.toast('Imported', 'ok');
          text.value = '';
          setTimeout(function () { ctx.refresh(); }, 600);
          return;
        }
        if (Array.isArray(d.issues)) { VX.mount(result, issuesView(d, action)); return; }
        VX.mount(result, ui.notice('Could not ' + (action === 'import' ? 'import' : 'check') + ': ' + errText(res), 'bad'));
      });
    }
    var tpl = ui.button('CSV template', { kind: 'ghost', small: true, icon: 'download', onClick: function () {
      VX.download.blob('vinax-editorial-template.csv', new Blob([CSV_HEADER + '\n'], { type: 'text/csv;charset=utf-8' }));
    } });
    VX.mount(host, ui.card({
      title: 'Import editorial picks', sub: 'Required: title, evidence_url (https), expires_at, plus artist or catalog_id. At most 200 rows; picks expire within 90 days of their start.',
      actions: [tpl],
      body: h('div.form', { style: { maxWidth: 'none' } },
        h('div.toolbar', seg, file),
        text,
        h('div.actions',
          ui.button('Check file', { kind: 'ghost', icon: 'check', onClick: function () { return send('validate-import'); } }),
          ui.button('Import', { kind: 'primary', icon: 'upload', onClick: function () { return send('import'); } }),
          h('span.muted.small', 'Import is all-or-nothing: if any row has a problem, nothing is added.')),
        result)
    }));
  }

  function issuesView(d, action) {
    var issues = d.issues || [];
    var head = issues.length
      ? ui.notice(fmt.plural(issues.length, 'problem') + ' found in ' + fmt.plural(d.rows, 'row') + (action === 'import' ? ' — nothing was imported.' : '. Fix them, then check again.'), 'bad')
      : ui.notice('All ' + fmt.plural(d.valid, 'row') + ' are valid. Press Import to add them.', 'ok');
    return h('div.page-body', head,
      issues.length ? ui.table({
        columns: [
          { key: 'row', label: 'Row', align: 'right', render: function (r) { return r.row ? fmt.num(r.row) : 'File'; } },
          { key: 'field', label: 'Field', render: function (r) { return r.field ? ui.mono(r.field) : '—'; } },
          { key: 'message', label: 'Problem' }
        ], rows: issues, exportName: false, search: false, pageSize: 10
      }) : null,
      (d.preview || []).length ? ui.card({ title: 'Preview', sub: 'First ' + fmt.num((d.preview || []).length) + ' rows as they will be saved', pad: false,
        body: ui.table({
          columns: [
            { key: 'position', label: '#', align: 'right' },
            { key: 'title', label: 'Title' }, { key: 'artist', label: 'Artist' }, { key: 'region', label: 'Region' },
            { key: 'language', label: 'Language' },
            { key: 'expires_at', label: 'Expires', render: function (r) { return fmt.date(r.expires_at); } }
          ], rows: d.preview, exportName: false, search: false, pageSize: 10
        }) }) : null);
  }

  /* ----------------------------------------------------------- pins */

  function cleanPins(list) {
    var seen = {};
    return list.map(function (s) { return String(s || '').trim().slice(0, 40); })
      .filter(function (s) { var k = s.toLowerCase(); if (s.length < 2 || seen[k]) return false; seen[k] = true; return true; })
      .slice(0, 6);
  }

  function renderPins(host, ctx) {
    var body = h('div.page-body');
    host.appendChild(body);
    var liveP = VX.api.get('/api/trending-searches', null, { fresh: true, noAuthRedirect: true });
    return ui.load(body, function () { return cfgLoad('trending-pins'); }, function (cfg) {
      var saved = Array.isArray(cfg.value) ? cfg.value.filter(function (x) { return typeof x === 'string'; }) : [];
      var inputs = [];
      var list = h('div.editor-list');
      var preview = h('div.actions');
      var live = h('div', ui.loading('Checking what listeners see…'));
      for (var i = 0; i < 6; i++) {
        var inp = ui.input({ maxlength: '40', value: saved[i] || '', placeholder: i === 0 ? 'e.g. Diwali songs' : 'Optional', 'aria-label': 'Pin ' + (i + 1) });
        inp.addEventListener('input', onInput);
        inputs.push(inp);
        list.appendChild(h('div.toolbar', h('span.muted.small', { style: { width: '18px', 'text-align': 'right' } }, String(i + 1)), h('div.grow', inp)));
      }
      function onInput() {
        var pins = cleanPins(inputs.map(function (x) { return x.value; }));
        VX.mount(preview, pins.length ? pins.map(function (p) { return ui.pill(p, 'accent'); }) : h('span.muted', 'No pins — only community searches are shown.'));
      }
      onInput();
      liveP.then(function (res) {
        var q = res.ok && res.data && Array.isArray(res.data.queries) ? res.data.queries : null;
        if (!q) return VX.mount(live, ui.notice('Could not read the public trending list right now.', 'warn'));
        VX.mount(live, q.length ? h('div.actions', q.map(function (x) { return ui.pill(x, saved.some(function (p) { return p.toLowerCase() === String(x).toLowerCase(); }) ? 'accent' : null); })) : ui.empty('No trending chips yet', 'Pins and popular community searches (from the last 7 days) appear here.'));
      });
      return ui.grid([
        ui.card({ title: 'Pinned searches', sub: 'Up to 6, each 2–40 characters. Shown first; popular community searches fill the remaining chips.' + (cfg.updatedAt ? ' Last published ' + fmt.ago(cfg.updatedAt) + '.' : ''),
          body: h('div.form',
            list,
            h('div.field', h('span.field-label', 'Preview'), h('div.preview-box', preview)),
            h('div.actions',
              ui.button('Publish pins', { kind: 'primary', icon: 'check', onClick: function () {
                var pins = cleanPins(inputs.map(function (x) { return x.value; }));
                return VX.config.set('trending-pins', pins).then(function (res) { if (res.ok) ctx.refresh(); });
              } }),
              ui.button('Clear pins', { kind: 'ghost', icon: 'trash', disabled: !saved.length && cfg.value == null, onClick: function () {
                return VX.confirm({ title: 'Remove all pins?', body: 'The trending chips will show only community searches.', danger: true, confirmLabel: 'Clear pins' }).then(function (yes) {
                  if (!yes) return null;
                  return VX.config.set('trending-pins', null).then(function (res) { if (res.ok) ctx.refresh(); });
                });
              } }),
              h('span.muted.small', 'Listeners see changes within about 10 minutes.'))) }),
        ui.card({ title: 'What listeners see now', sub: 'The live “Trending” chips, highlighted where they are your pins', body: live })
      ], 2);
    }, { skeleton: 4 });
  }

  /** VX.config.get as a ui.load fetcher: { ok, data: { value, updatedAt } } or an error result. */
  function cfgLoad(key) {
    return VX.config.get(key).then(function (r) {
      if (r.ok) return { ok: true, status: 200, data: r };
      var failed = r.res && !r.res.ok;
      return { ok: false, status: failed ? r.res.status : 503, error: failed ? r.res.error : 'db_unconfigured', message: r.message || 'Could not read the setting.' };
    });
  }

  function cap(s) { s = String(s == null ? '' : s); return s ? s.charAt(0).toUpperCase() + s.slice(1) : '—'; }
})();
