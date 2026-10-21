/* VinaX console — VinaX AI page.
 * Usage & health: calls, success, latency per lane (provider) and feature,
 * models, apps, errors and recent calls (/api/admin/ai, /api/admin/aiops,
 * GET /api/admin/ailab). Controls: the `ai-controls` record — emergency off,
 * per-feature switches, daily token and cost caps — read and published through
 * /api/admin/appconfig, with today's budget from /api/admin/aiops. Cost &
 * tokens: /api/admin/aicost plus the `ai-prices` table. API lab: chat and
 * media bench through POST /api/admin/ailab, model lists from /api/aimodels.
 * Engine probe: /api/admin/enginetest per provider and /api/admin/musicapi
 * for the music catalogue sources. Assistant content: the `ai-starters`,
 * `ai-quick` and `ai-rules` config keys. Provider and model names come from
 * the API and are allowed on this page. */
(function () {
  'use strict';
  var VX = window.VX, h = VX.h, ui = VX.ui, fmt = VX.fmt;

  var FEATURES = [
    ['vinaxai', 'VinaX AI chat'],
    ['assistant', 'In-app help chat'],
    ['dj', 'AI DJ — orders the next songs'],
    ['playlist', 'Playlist from a description'],
    ['curate-ranking', 'Re-ranking (Home, next song, Trending for you)'],
    ['curate-home', 'Home block order'],
    ['curate-shelves', '“Designed for you” shelves'],
    ['curate-metadata', 'Song classification (mood, energy, genre)'],
    ['search', 'Reading a described search into filters'],
    ['embed', 'Song and search embeddings (natural-language search, taste fit)'],
    ['lyrics', 'Lyric tools (romanise, translate, explain)'],
    ['tts', 'Spoken replies and the DJ voice'],
    ['transcribe', 'Dictation (speech to text)'],
    ['image', 'Image generation'],
    ['music', 'Music clip generation'],
    ['web-search', 'Web search in VinaX AI (daily cap)'],
    ['deep-research', 'Deep research in VinaX AI (daily cap)']
  ];
  var FEATURE_LABEL = {};
  FEATURES.forEach(function (f) { FEATURE_LABEL[f[0]] = f[1]; });

  var PROVIDERS = [
    { id: 'nvidia', label: 'NVIDIA', key: 'NVIDIA', env: 'NVIDIA_API_KEY' },
    { id: 'openrouter', label: 'OpenRouter', key: 'OPENROUTER', env: 'OPENROUTER_API_KEY' },
    { id: 'groq', label: 'Groq', key: 'GROQ', env: 'GROQ_API_KEY' },
    { id: 'gemini', label: 'Gemini', key: 'GEMINI', env: 'GEMINI_API_KEY' },
    { id: 'cloudflare', label: 'Cloudflare Workers AI', key: 'CLOUDFLARE', env: 'AI binding' }
  ];
  var PROVIDER_LABEL = {};
  PROVIDERS.forEach(function (p) { PROVIDER_LABEL[p.id] = p.label; });
  var LANE_PROVIDER = { dj: 'nvidia', chat: 'nvidia', deep: 'nvidia', fast: 'nvidia', scholar: 'groq', home: 'nvidia', search: 'nvidia', pro: 'nvidia', mini: 'nvidia', router: 'openrouter', maestro: 'gemini', vision: 'nvidia', vision90: 'nvidia', workers: 'cloudflare' };
  var LANES = ['chat', 'fast', 'deep', 'scholar', 'home', 'dj', 'search', 'pro', 'mini', 'router', 'maestro', 'vision', 'vision90', 'workers'];
  var BUDGET_STATE = {
    no_caps: ['No daily caps set', null],
    within: ['Within today’s caps', 'ok'],
    over_tokens: ['Over today’s token cap — AI answers “over budget” until 00:00 UTC', 'bad'],
    over_cost: ['Over today’s cost cap — AI answers “over budget” until 00:00 UTC', 'bad'],
    cost_unknown: ['Cost cap set, but some calls have no price, so today’s cost is not fully known', 'warn'],
    controls_unknown: ['The controls could not be read', 'warn']
  };
  var NOT_CONNECTED = ['Database not connected', 'AI calls are logged in the database. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the Worker.'];

  VX.page({
    id: 'ai', title: 'VinaX AI', group: 'Intelligence', icon: 'spark',
    desc: 'How the AI features are used and performing, and the switches that control them.',
    noAuto: true,
    tabs: [
      { id: 'usage', label: 'Usage & health', desc: 'AI calls, success rate and latency per provider lane, feature and model.', render: renderUsage },
      { id: 'controls', label: 'Controls', desc: 'Switch AI features on or off for every listener and cap daily spend.', render: renderControls },
      { id: 'cost', label: 'Cost & tokens', desc: 'Tokens used per model and day, priced from your price table.', render: renderCost },
      { id: 'lab', label: 'API lab', desc: 'Send a test prompt to one provider, model or lane — no failover, so you see exactly what it answers.', render: renderLab },
      { id: 'probe', label: 'Engine probe', desc: 'Check each provider key with a tiny request, and check the music catalogue sources.', render: renderProbe },
      { id: 'content', label: 'Assistant content', desc: 'Starter prompts, quick-action chips and house rules used by VinaX AI.', render: renderContent }
    ]
  });

  /* ----------------------------------------------------------- helpers */

  function stack() { return h('div.form', { style: { 'max-width': 'none' } }, Array.prototype.slice.call(arguments)); }
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function laneOf(key) { var k = String(key || ''); return k; }
  function providerOfLane(lane) { var p = LANE_PROVIDER[lane]; return p ? PROVIDER_LABEL[p] : '—'; }
  /** Rate {k,n,rate,low,high} → "12% (8–17%)" or "3 of 12" for small samples. */
  function rateText(r) {
    if (!isObj(r) || typeof r.rate !== 'number' || !(r.n > 0)) return '—';
    var band = typeof r.low === 'number' && typeof r.high === 'number' ? Math.round(r.low * 100) + '–' + Math.round(r.high * 100) + '%' : '';
    if (r.n < 30) return fmt.num(r.k) + ' of ' + fmt.num(r.n) + (band ? ' (likely ' + band + ')' : '');
    return fmt.ratio(r.rate) + (band ? ' (' + band + ')' : '');
  }
  function rateTone(r) { return isObj(r) && typeof r.rate === 'number' && r.n >= 10 ? (r.rate > 0.2 ? 'bad' : r.rate > 0.05 ? 'warn' : 'ok') : null; }
  function costText(c) {
    if (!isObj(c)) return '—';
    if (typeof c.usd !== 'number') return c.pricedCalls ? '—' : 'no prices';
    return (c.complete ? '' : '≥ ') + fmt.money(c.usd);
  }
  function daysParam(ctx) { var d = Number(ctx.params.days); return [1, 7, 30, 90].indexOf(d) >= 0 ? d : 7; }
  function daysBar(ctx, days) { return h('div.toolbar', ui.daysPicker(days, function (d) { ctx.setParam('days', d); ctx.refresh(); })); }
  /** Naive UTC "YYYY-MM-DD HH:MI:SS" → ISO */
  function utc(ts) { if (!ts) return null; var s = String(ts); return /Z|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(' ', 'T') + 'Z'; }
  function both(promises) {
    return Promise.all(promises);
  }
  function cfgRes(c) { return c.ok ? null : { ok: false, status: c.res ? c.res.status : 0, error: c.res ? c.res.error : null, message: c.message || 'Could not read the setting.' }; }

  /* ---------------------------------------------------- Usage & health */

  function renderUsage(host, ctx) {
    var days = daysParam(ctx);
    var body = h('div.page-body');
    host.appendChild(daysBar(ctx, days));
    host.appendChild(body);
    return ui.load(body, function () {
      return both([VX.api.get('/api/admin/ai', { days: days }), VX.api.get('/api/admin/aiops', { days: days }), VX.api.get('/api/admin/ailab')]).then(function (r) {
        if (!r[0].ok) return r[0];
        return { ok: true, data: { ai: r[0].data || {}, ops: r[1], lab: r[2] } };
      });
    }, function (d) {
      if (d.ai.configured === false) return ui.empty(NOT_CONNECTED[0], NOT_CONNECTED[1]);
      var m = d.ai.metrics || {};
      var ops = d.ops.ok && d.ops.data && d.ops.data.configured !== false ? d.ops.data : null;
      var lab = d.lab.ok && d.lab.data && d.lab.data.configured !== false ? d.lab.data : null;
      var total = Number(m.total) || 0;
      var tot = ops && ops.totals ? ops.totals : {};
      var blocked = tot.blocked ? (Number(tot.blocked.disabled) || 0) + (Number(tot.blocked.overBudget) || 0) : null;
      var series = VX.fillDays(m.by_day, Math.max(days, 2), 'day', ['ok', 'fail']);
      var windowText = days === 1 ? 'last 24 hours' : 'last ' + days + ' days';
      var kpis = ui.kpis([
          { label: 'AI calls', value: fmt.num(m.total), sub: windowText },
          { label: 'Success rate', value: total ? fmt.ratio(m.ok / total) : '—', sub: total ? fmt.num(m.fail) + ' failed' : null, tone: total && m.ok / total < 0.9 ? 'warn' : null },
          { label: 'Average latency', value: total ? fmt.ms(m.avg_latency_ms) : '—', sub: 'per call' },
          { label: 'Median latency', value: tot.latencyMs ? fmt.ms(tot.latencyMs.p50) : '—', sub: tot.latencyMs && tot.latencyMs.p95 != null ? 'p95 ' + fmt.ms(tot.latencyMs.p95) : null },
          { label: 'Fallback hops', value: ops ? fmt.num(tot.hops) : '—', sub: 'calls that moved to another lane', hint: 'A hop is a retry on the next lane after a failure' },
          { label: 'Refused by controls', value: blocked == null ? '—' : fmt.num(blocked), sub: 'switched off or over budget', tone: blocked ? 'warn' : null }
        ]);
      if (!total) {
        return [kpis, ui.card({ body: ui.empty('No AI calls in the ' + windowText, 'This fills in as listeners use VinaX AI, the DJ, AI search, playlists and the other AI features: calls per day, provider lanes and their latency, features, models, errors and the latest calls.') })];
      }
      return [
        kpis,
        ui.grid([
          ui.card({ title: 'Calls per day', sub: 'Succeeded and failed · UTC days', span: 2, body: ui.chart({ labels: series.labels, series: [{ name: 'Succeeded', values: series.values.ok, color: 'var(--c1)' }, { name: 'Failed', values: series.values.fail, color: 'var(--c4)' }], type: 'bar', stacked: true, height: 220, empty: 'No AI calls yet', emptyHint: 'Each AI request a listener makes is counted here.' }) }),
          ui.card({ title: 'Top errors', sub: windowText, body: ui.hbars((m.by_error || []).map(function (e) { return { label: e.error, value: e.count }; }), { empty: 'No errors', emptyHint: 'Failed calls are grouped by their error here.' }) })
        ]),
        ui.card({
          title: 'Provider lanes', sub: 'Each lane is served by one provider · ' + windowText, pad: false,
          body: ops ? laneTable(ops.byLane || []) : ui.notice('Lane details are unavailable: ' + (d.ops.message || 'the AI operations report could not be read') + '.', 'warn')
        }),
        ui.card({
          title: 'Lane health · last 24 hours', sub: lab ? 'Excludes calls the controls refused' + (lab.capped ? ' · newest 10,000 calls only' : '') : null, pad: false,
          body: lab ? labTable(lab.lanes || []) : ui.notice('Lane health is unavailable: ' + (d.lab.message || 'could not be read') + '.', 'warn')
        }),
        ui.card({
          title: 'Features', sub: 'Which part of the app made the call · ' + windowText, pad: false,
          body: ops ? featureTable(ops.byFeature || []) : featureTableBasic(m.by_feature || [])
        }),
        ui.grid([
          ui.card({ title: 'Models', sub: 'Calls per model', body: ui.hbars((m.by_model || []).map(function (x) { return { label: x.model, value: x.count }; }), { empty: 'No model calls yet' }) }),
          ui.card({ title: 'Apps', sub: 'Where the calls came from', body: ui.share((m.by_client || []).map(function (x) { return { label: x.client, value: x.count }; }), { empty: 'No calls yet' }) })
        ]),
        ui.card({
          title: 'Recent calls', sub: 'Newest 30', pad: false,
          body: ui.table({
            rows: (m.recent || []).map(function (r) { return Object.assign({}, r, { at: utc(r.ts) }); }),
            exportName: 'vinax-ai-recent', sortKey: 'at', sortDir: 'desc', dense: true,
            empty: 'No calls yet', emptyHint: 'The latest AI calls appear here.',
            columns: [
              { key: 'at', label: 'When', nowrap: true, render: function (r) { return h('span', { title: fmt.dateTime(r.at) }, fmt.ago(r.at)); } },
              { key: 'feature', label: 'Feature' },
              { key: 'model', label: 'Model', render: function (r) { return r.model ? ui.mono(r.model) : null; } },
              { key: 'ok', label: 'Result', sortVal: function (r) { return r.ok ? 1 : 0; }, render: function (r) { return ui.pill(r.ok ? 'OK' : 'Failed', r.ok ? 'ok' : 'bad'); } },
              { key: 'status', label: 'Status', align: 'right' },
              { key: 'error', label: 'Error', render: function (r) { return r.error ? fmt.trunc(r.error, 60) : null; } },
              { key: 'client', label: 'App' },
              { key: 'latency_ms', label: 'Latency', align: 'right', render: function (r) { return r.latency_ms == null ? null : fmt.ms(r.latency_ms); } }
            ]
          })
        })
      ];
    }, { skeleton: 8 });
  }

  function groupColumns(first) {
    return [first,
      { key: 'calls', label: 'Calls', align: 'right', render: function (g) { return fmt.num(g.calls); } },
      { key: 'fail', label: 'Failure rate', sortVal: function (g) { return g.failureRate && g.failureRate.rate; }, render: function (g) { var t = rateTone(g.failureRate); return t && t !== 'ok' ? ui.pill(rateText(g.failureRate), t) : rateText(g.failureRate); } },
      { key: 'p50', label: 'p50', align: 'right', sortVal: function (g) { return g.latencyMs && g.latencyMs.p50; }, render: function (g) { return g.latencyMs ? fmt.ms(g.latencyMs.p50) : null; } },
      { key: 'p95', label: 'p95', align: 'right', sortVal: function (g) { return g.latencyMs && g.latencyMs.p95; }, render: function (g) { return g.latencyMs ? fmt.ms(g.latencyMs.p95) : null; } },
      { key: 'hops', label: 'Hops', align: 'right', render: function (g) { return fmt.num(g.hops); } },
      { key: 'blocked', label: 'Refused', align: 'right', sortVal: function (g) { return g.blocked ? (g.blocked.disabled || 0) + (g.blocked.overBudget || 0) : 0; }, render: function (g) { return g.blocked ? fmt.num((g.blocked.disabled || 0) + (g.blocked.overBudget || 0)) : null; } },
      { key: 'tokens', label: 'Tokens', align: 'right', sortVal: function (g) { return g.tokens ? (g.tokens.prompt || 0) + (g.tokens.completion || 0) : 0; }, render: function (g) { return g.tokens ? fmt.compact((g.tokens.prompt || 0) + (g.tokens.completion || 0)) : null; } },
      { key: 'cost', label: 'Est. cost', align: 'right', sortVal: function (g) { return g.cost && g.cost.usd; }, render: function (g) { return costText(g.cost); } }
    ];
  }
  function laneTable(rows) {
    return ui.table({
      rows: rows, exportName: 'vinax-ai-lanes', sortKey: 'calls', sortDir: 'desc', dense: true,
      empty: 'No lane traffic yet', emptyHint: 'Each provider lane appears once it serves a call.',
      columns: [{ key: 'key', label: 'Lane', render: function (g) { return h('div', h('div.cell-main', laneOf(g.key)), h('div.cell-sub', providerOfLane(g.key))); }, sortVal: function (g) { return g.key; } }].concat(groupColumns(null).slice(1))
    });
  }
  function featureTable(rows) {
    return ui.table({
      rows: rows, exportName: 'vinax-ai-features', sortKey: 'calls', sortDir: 'desc', dense: true,
      empty: 'No feature traffic yet', emptyHint: 'Features appear once listeners use them.',
      columns: [{ key: 'key', label: 'Feature', render: function (g) { return h('div', h('div.cell-main', FEATURE_LABEL[g.key] || g.key), h('div.cell-sub', g.key)); }, sortVal: function (g) { return g.key; } }].concat(groupColumns(null).slice(1))
    });
  }
  function featureTableBasic(rows) {
    return ui.table({
      rows: rows, exportName: 'vinax-ai-features', sortKey: 'total', sortDir: 'desc', dense: true,
      empty: 'No feature traffic yet',
      columns: [
        { key: 'feature', label: 'Feature', render: function (g) { return FEATURE_LABEL[g.feature] || g.feature; } },
        { key: 'total', label: 'Calls', align: 'right', render: function (g) { return fmt.num(g.total); } },
        { key: 'ok', label: 'OK', align: 'right', render: function (g) { return fmt.num(g.ok); } },
        { key: 'fail', label: 'Failed', align: 'right', render: function (g) { return fmt.num(g.fail); } }
      ]
    });
  }
  function labTable(rows) {
    return ui.table({
      rows: rows, exportName: 'vinax-ai-lane-health', sortKey: 'calls', sortDir: 'desc', dense: true,
      empty: 'No AI calls in the last 24 hours',
      columns: [
        { key: 'lane', label: 'Lane', render: function (g) { return h('div', h('div.cell-main', g.lane), h('div.cell-sub', providerOfLane(g.lane))); } },
        { key: 'calls', label: 'Calls', align: 'right', render: function (g) { return fmt.num(g.calls); } },
        { key: 'okPct', label: 'OK', align: 'right', render: function (g) { var v = Number(g.okPct); return g.okPct == null ? null : ui.pill(fmt.pct(v), v >= 95 ? 'ok' : v >= 80 ? 'warn' : 'bad'); } },
        { key: 'p50', label: 'p50', align: 'right', render: function (g) { return fmt.ms(g.p50); } },
        { key: 'p95', label: 'p95', align: 'right', render: function (g) { return fmt.ms(g.p95); } },
        { key: 'p99', label: 'p99', align: 'right', render: function (g) { return fmt.ms(g.p99); } },
        { key: 'hops', label: 'Hops', align: 'right', render: function (g) { return fmt.num(g.hops); } },
        { key: 'emptyStreams', label: 'Empty replies', align: 'right', render: function (g) { return fmt.num(g.emptyStreams); } },
        { key: 'authErrors', label: 'Key errors', align: 'right', render: function (g) { return Number(g.authErrors) ? ui.pill(fmt.num(g.authErrors), 'bad') : fmt.num(g.authErrors); } }
      ]
    });
  }

  /* ---------------------------------------------------------- Controls */

  function parseControls(v) {
    var o = isObj(v) ? v : {};
    var features = {};
    var stored = isObj(o.features) ? o.features : {};
    Object.keys(stored).forEach(function (k) { if (typeof stored[k] === 'boolean') features[k] = stored[k]; });
    var num = function (x) { return typeof x === 'number' && isFinite(x) && x >= 0 ? x : null; };
    return { emergencyOff: o.emergencyOff === true, features: features, dailyTokenCap: num(o.dailyTokenCap), dailyCostCapUsd: num(o.dailyCostCapUsd), updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : null, updatedBy: typeof o.updatedBy === 'string' ? o.updatedBy : null };
  }

  function renderControls(host, ctx) {
    var body = h('div.page-body');
    host.appendChild(body);
    return ui.load(body, function () {
      return both([VX.config.get('ai-controls'), VX.api.get('/api/admin/aiops', { days: 1 })]).then(function (r) {
        if (!r[0].ok) return cfgRes(r[0]);
        return { ok: true, data: { cfg: r[0], ops: r[1] } };
      });
    }, function (d) { return controlsEditor(d.cfg, d.ops, ctx); }, { skeleton: 8 });
  }

  function controlsEditor(cfg, opsRes, ctx) {
    var stored = cfg.value == null ? null : parseControls(cfg.value);
    var pub = stored || parseControls(null);
    var baseStamp = stored ? stored.updatedAt : null;
    var ops = opsRes.ok && opsRes.data && opsRes.data.configured !== false ? opsRes.data : null;
    var featureKeys = FEATURES.map(function (f) { return f[0]; });
    ((ops && ops.controlFeatures) || []).forEach(function (k) { if (featureKeys.indexOf(k) < 0) featureKeys.push(k); });
    var usage = {};
    ((ops && ops.byFeature) || []).forEach(function (g) { usage[g.key] = g; });

    var draft = { emergencyOff: pub.emergencyOff, features: {} };
    featureKeys.forEach(function (k) { draft.features[k] = pub.features[k] !== false; });
    var dirtyPill = h('span');
    function markDirty() {
      var changed = draft.emergencyOff !== pub.emergencyOff || featureKeys.some(function (k) { return draft.features[k] !== (pub.features[k] !== false); }) ||
        tokenCap.value.trim() !== (pub.dailyTokenCap == null ? '' : String(pub.dailyTokenCap)) || costCap.value.trim() !== (pub.dailyCostCapUsd == null ? '' : String(pub.dailyCostCapUsd));
      VX.mount(dirtyPill, changed ? ui.pill('Unpublished changes', 'warn') : null);
    }

    // --- status
    var offCount = featureKeys.filter(function (k) { return pub.features[k] === false; }).length;
    var status = pub.emergencyOff
      ? ui.notice('AI is switched OFF for every listener' + (stored && stored.updatedAt ? ' since ' + fmt.dateTime(stored.updatedAt) : '') + '. Every AI feature answers “unavailable” until you switch it back on.', 'bad')
      : ui.notice(stored ? 'AI is on. ' + (offCount ? fmt.plural(offCount, 'feature is', 'features are') + ' switched off. ' : 'Every feature is on. ') + 'Last published ' + fmt.dateTime(stored.updatedAt) + (stored.updatedBy ? ' by ' + stored.updatedBy : '') + '.' : 'Nothing published yet: every AI feature is on and there are no daily caps.', offCount ? 'warn' : 'ok');

    // --- budget
    var budget = ops && ops.budget ? ops.budget : null;
    var bs = budget ? (BUDGET_STATE[budget.state] || [String(budget.state), null]) : null;
    var budgetCard = ui.card({
      title: 'Today’s budget', sub: budget ? 'UTC day ' + fmt.day(budget.day) + ' · resets at 00:00 UTC' : null,
      body: !budget ? ui.notice('Today’s usage is unavailable: ' + (opsRes.message || 'the AI operations report could not be read') + '.', 'warn') : [
        ui.kpis([
          { label: 'Tokens today', value: fmt.compact(budget.tokensToday), sub: budget.tokenCap == null ? 'no cap' : 'of ' + fmt.compact(budget.tokenCap) + ' · ' + fmt.pct(budget.tokenPct) },
          { label: 'Cost today', value: budget.costTodayUsd == null ? '—' : fmt.money(budget.costTodayUsd), sub: budget.costCapUsd == null ? 'no cap' : 'of ' + fmt.money(budget.costCapUsd) + (budget.costPct == null ? '' : ' · ' + fmt.pct(budget.costPct)) + (budget.costComplete ? '' : ' · some calls unpriced') },
          { label: 'Calls today', value: ops.today ? fmt.num(ops.today.calls) : '—' }
        ]),
        budget.tokenCap != null ? ui.field('Token cap used', ui.meter((budget.tokenPct || 0) / 100, budget.tokenPct >= 100 ? 'bad' : budget.tokenPct >= 80 ? 'warn' : null)) : null,
        budget.costCapUsd != null && budget.costPct != null ? ui.field('Cost cap used', ui.meter(budget.costPct / 100, budget.costPct >= 100 ? 'bad' : budget.costPct >= 80 ? 'warn' : null)) : null,
        h('p', ui.status(bs[1] || 'muted', bs[0]))
      ]
    });

    // --- emergency
    var emergency = ui.toggle('Switch every AI feature off', draft.emergencyOff, function (on) { draft.emergencyOff = on; markDirty(); paintFeatures(); });
    var emergencyCard = ui.card({
      title: 'Emergency off', tone: pub.emergencyOff ? 'bad' : null,
      sub: 'Stops every AI call at the server within about a minute. Listeners keep the rest of the app.',
      body: [emergency, h('p.field-hint', 'Use this if a provider misbehaves or spend runs away. Publish to apply.')]
    });

    // --- features
    var featureList = h('ul.list');
    var featureToggles = {};
    function paintFeatures() {
      featureKeys.forEach(function (k) {
        var t = featureToggles[k];
        t.input.disabled = draft.emergencyOff;
        VX.mount(t.stateEl, draft.emergencyOff ? ui.pill('Off (emergency)', 'bad') : draft.features[k] ? ui.pill('On', 'ok') : ui.pill('Off', 'warn'));
      });
    }
    featureKeys.forEach(function (k) {
      var g = usage[k];
      var stateEl = h('span');
      var t = ui.toggle('', draft.features[k], function (on) { draft.features[k] = on; markDirty(); paintFeatures(); }, { 'aria-label': (FEATURE_LABEL[k] || k) });
      t.stateEl = stateEl;
      featureToggles[k] = t;
      featureList.appendChild(h('li', t,
        h('div.grow', h('div.cell-main', FEATURE_LABEL[k] || k), h('div.cell-sub', k + (g ? ' · ' + fmt.plural(g.calls, 'call') + ' in 24 h' : ''))),
        stateEl));
    });
    paintFeatures();
    var featureCard = ui.card({
      title: 'Features', sub: 'A switched-off feature is refused at the server for every listener',
      actions: [
        ui.button('All on', { kind: 'ghost', small: true, onClick: function () { featureKeys.forEach(function (k) { draft.features[k] = true; featureToggles[k].input.checked = true; }); markDirty(); paintFeatures(); } }),
        ui.button('All off', { kind: 'ghost', small: true, onClick: function () { featureKeys.forEach(function (k) { draft.features[k] = false; featureToggles[k].input.checked = false; }); markDirty(); paintFeatures(); } })
      ],
      body: featureList
    });

    // --- caps
    var tokenCap = ui.input({ type: 'number', min: 0, step: 1, inputmode: 'numeric', placeholder: 'No cap', value: pub.dailyTokenCap == null ? '' : String(pub.dailyTokenCap) });
    var costCap = ui.input({ type: 'number', min: 0, step: '0.01', inputmode: 'decimal', placeholder: 'No cap', value: pub.dailyCostCapUsd == null ? '' : String(pub.dailyCostCapUsd) });
    var byName = ui.input({ maxlength: 80, placeholder: 'Optional', value: localName() });
    tokenCap.addEventListener('input', markDirty);
    costCap.addEventListener('input', markDirty);
    var pricesMissing = ops && ops.prices && ops.prices.configured === false;
    var capsCard = ui.card({
      title: 'Daily caps', sub: 'When a cap is reached, AI answers “over budget” until 00:00 UTC',
      body: h('div.form',
        h('div.form-row', { style: { 'align-items': 'start' } },
          ui.field('Token cap (prompt + completion)', tokenCap, 'Whole number. Leave blank for no cap.'),
          ui.field('Cost cap (USD)', costCap, 'Leave blank for no cap.')),
        pricesMissing ? ui.notice('No prices are set, so the cost cap cannot be measured. Add prices in Cost & tokens first.', 'warn') : null,
        ui.field('Published by', byName, 'Shown next to this publish. Remembered on this browser.'))
    });

    function readCaps() {
      var t = tokenCap.value.trim(), c = costCap.value.trim();
      var tv = t === '' ? null : Number(t), cv = c === '' ? null : Number(c);
      tokenCap.classList.toggle('invalid', tv !== null && !(isFinite(tv) && tv >= 0 && Math.floor(tv) === tv && tv <= 1e12));
      costCap.classList.toggle('invalid', cv !== null && !(isFinite(cv) && cv >= 0 && cv <= 1e6));
      if (tokenCap.classList.contains('invalid')) { tokenCap.focus(); VX.toast('The token cap must be a whole number of 0 or more, or blank.', 'bad'); return null; }
      if (costCap.classList.contains('invalid')) { costCap.focus(); VX.toast('The cost cap must be a number of 0 or more, or blank.', 'bad'); return null; }
      return { token: tv, cost: cv };
    }

    function publish() {
      var caps = readCaps();
      if (!caps) return Promise.resolve();
      var features = {};
      featureKeys.forEach(function (k) { features[k] = !!draft.features[k]; });
      var value = { emergencyOff: !!draft.emergencyOff, features: features, dailyTokenCap: caps.token, dailyCostCapUsd: caps.cost };
      var who = byName.value.trim();
      if (who) { value.updatedBy = who; saveName(who); }
      var ask = draft.emergencyOff && !pub.emergencyOff
        ? VX.confirm({ title: 'Switch AI off for every listener?', body: 'VinaX AI, the DJ, AI search, playlists, voices and every other AI feature stop answering until you switch them back on.', danger: true, confirmLabel: 'Switch AI off' })
        : Promise.resolve(true);
      return ask.then(function (yes) {
        if (!yes) return null;
        return VX.config.get('ai-controls').then(function (now) {
          if (!now.ok) { VX.toast('Could not check for newer changes: ' + now.message, 'bad'); return null; }
          var nowStamp = now.value == null ? null : parseControls(now.value).updatedAt;
          if (nowStamp !== baseStamp) {
            return VX.confirm({ title: 'The controls changed', body: 'Someone published the AI controls ' + (nowStamp ? 'at ' + fmt.dateTime(nowStamp) : '(they were cleared)') + ' after you opened this page. Publishing replaces their version with yours.', confirmLabel: 'Publish mine anyway' });
          }
          return true;
        }).then(function (go) {
          if (!go) return null;
          return VX.config.set('ai-controls', value, { silent: true }).then(function (res) {
            if (!res.ok) { VX.toast('Could not publish: ' + (res.data && res.data.reason ? String(res.data.reason).replace(/_/g, ' ') : res.message), 'bad'); return; }
            VX.toast(value.emergencyOff ? 'Published — AI is off for everyone' : 'Published AI controls', 'ok');
            ctx.refresh();
          });
        });
      });
    }
    function reset() {
      return VX.confirm({ title: 'Reset the AI controls?', body: 'This deletes the published controls: every AI feature is switched on and the daily caps are removed.', danger: true, confirmLabel: 'Reset' }).then(function (yes) {
        if (!yes) return null;
        return VX.config.set('ai-controls', null).then(function (res) { if (res.ok) ctx.refresh(); });
      });
    }

    var actions = h('div.actions',
      ui.button('Publish', { kind: 'primary', icon: 'upload', onClick: publish }),
      ui.button('Discard changes', { kind: 'ghost', onClick: function () { ctx.refresh(); } }),
      stored ? ui.button('Reset to defaults', { kind: 'danger', onClick: reset }) : null,
      dirtyPill);

    markDirty();
    return [
      status,
      ui.grid([emergencyCard, budgetCard]),
      featureCard,
      capsCard,
      ui.card({ body: actions })
    ];
  }

  function localName() { try { return localStorage.getItem('vinax_admin_name') || ''; } catch (e) { return ''; } }
  function saveName(n) { try { localStorage.setItem('vinax_admin_name', n); } catch (e) {} }

  /* ------------------------------------------------------ Cost & tokens */

  function renderCost(host, ctx) {
    var days = daysParam(ctx);
    var body = h('div.page-body');
    var prices = h('div');
    host.appendChild(daysBar(ctx, days));
    host.appendChild(body);
    host.appendChild(prices);
    return ui.load(body, function () { return VX.api.get('/api/admin/aicost', { days: days }); }, function (d) {
      if (d.configured === false) { VX.clear(prices); return ui.empty(NOT_CONNECTED[0], NOT_CONNECTED[1]); }
      var models = d.byModel || [];
      var tt = d.tokensTotal || {};
      var unpricedModels = models.filter(function (m) { return !m.priced && (m.prompt || m.completion); });
      var cost = models.reduce(function (a, m) { return a + (Number(m.cost) || 0); }, 0);
      var calls = models.reduce(function (a, m) { return a + (Number(m.calls) || 0); }, 0);
      var anyPriced = models.some(function (m) { return m.priced; });
      var series = VX.fillDays((d.byDay || []).filter(function (x) { return x.day !== 'unknown'; }), Math.max(days, 2), 'day', ['prompt', 'completion', 'cost']);
      var windowText = days === 1 ? 'last 24 hours' : 'last ' + days + ' days';
      mountPrices(prices, d, unpricedModels, ctx);
      return [
        !calls ? ui.notice('No AI calls in the ' + windowText + '. Token counts fill in as AI features are used.', 'info') : null,
        calls && d.unpriced ? ui.notice('No model has a price yet, so cost cannot be estimated. Add prices below — free models can be priced at $0.', 'warn') : null,
        ui.kpis([
          { label: 'Prompt tokens', value: fmt.compact(tt.prompt), sub: windowText },
          { label: 'Completion tokens', value: fmt.compact(tt.completion), sub: windowText },
          { label: 'Estimated cost', value: anyPriced ? fmt.money(cost) : '—', sub: unpricedModels.length ? (anyPriced ? 'at least · ' : '') + fmt.plural(unpricedModels.length, 'model') + ' without a price' : anyPriced ? 'all models priced' : 'no prices set', tone: unpricedModels.length && anyPriced ? 'warn' : null },
          { label: 'Calls', value: fmt.num(calls), sub: d.sampled >= 20000 ? 'newest 20,000 calls only' : null }
        ]),
        ui.grid([
          ui.card({ title: 'Tokens per day', sub: 'Prompt and completion · UTC days', span: 2, body: ui.chart({ labels: series.labels, series: [{ name: 'Prompt', values: series.values.prompt }, { name: 'Completion', values: series.values.completion, color: 'var(--c2)' }], type: 'bar', stacked: true, height: 220, empty: 'No tokens yet', emptyHint: 'Token counts appear once AI features are used.' }) }),
          ui.card({ title: 'Cost per day', sub: 'Priced models only', body: ui.chart({ labels: series.labels, series: [{ name: 'Cost', values: series.values.cost, color: 'var(--c3)' }], type: 'area', height: 220, format: fmt.money, empty: anyPriced ? 'No cost in this period' : 'No prices set', emptyHint: anyPriced ? null : 'Add prices below to see cost.' }) })
        ]),
        ui.card({
          title: 'By model', sub: windowText, pad: false,
          body: ui.table({
            rows: models, exportName: 'vinax-ai-cost', sortKey: 'cost', sortDir: 'desc',
            empty: 'No model usage yet', emptyHint: 'Models appear once they serve a call.',
            columns: [
              { key: 'model', label: 'Model', render: function (m) { return ui.mono(m.model); } },
              { key: 'calls', label: 'Calls', align: 'right', render: function (m) { return fmt.num(m.calls); } },
              { key: 'prompt', label: 'Prompt tokens', align: 'right', render: function (m) { return fmt.num(m.prompt); } },
              { key: 'completion', label: 'Completion tokens', align: 'right', render: function (m) { return fmt.num(m.completion); } },
              { key: 'cost', label: 'Est. cost', align: 'right', sortVal: function (m) { return m.priced ? m.cost : -1; }, render: function (m) { return m.priced ? fmt.money(m.cost) : ui.pill('No price', 'warn'); } }
            ]
          })
        })
      ];
    }, { skeleton: 6 });
  }

  function mountPrices(host, d, unpricedModels, ctx) {
    var rows = Object.keys(d.prices || {}).map(function (k) { return { prefix: k, in: String(d.prices[k].in), out: String(d.prices[k].out) }; });
    var editor = listEditor({
      items: rows, max: 200, add: 'Add a price',
      blank: function () { return { prefix: '', in: '0', out: '0' }; },
      empty: 'No prices yet', emptyHint: 'Add a row per model or model family. Without prices, cost shows as unknown.',
      row: function (it) {
        var p = ui.input({ value: it.prefix, maxlength: 120, placeholder: 'e.g. meta/llama-3.1' });
        var i = ui.input({ type: 'number', min: 0, step: 'any', value: it.in });
        var o = ui.input({ type: 'number', min: 0, step: 'any', value: it.out });
        p.addEventListener('input', function () { it.prefix = p.value; });
        i.addEventListener('input', function () { it.in = i.value; });
        o.addEventListener('input', function () { it.out = o.value; });
        it._els = [p, i, o];
        return h('div.form-row', { style: { 'align-items': 'start' } }, ui.field('Model or prefix', p), ui.field('Input $ / 1M tokens', i), ui.field('Output $ / 1M tokens', o));
      }
    });
    var fill = unpricedModels.length ? ui.button('Add ' + fmt.plural(unpricedModels.length, 'unpriced model') + ' at $0', { kind: 'ghost', small: true, onClick: function () {
      var have = {};
      editor.items().forEach(function (r) { have[r.prefix.trim()] = true; });
      unpricedModels.forEach(function (m) { if (!have[m.model] && m.model !== '(none)') editor.add({ prefix: m.model, in: '0', out: '0' }); });
    } }) : null;
    function publish() {
      var out = {}, bad = false, seen = {};
      editor.items().forEach(function (r) {
        var k = r.prefix.trim(), vi = Number(r.in), vo = Number(r.out);
        var okRow = k && k.length <= 120 && !seen[k] && r.in !== '' && r.out !== '' && isFinite(vi) && vi >= 0 && isFinite(vo) && vo >= 0;
        (r._els || []).forEach(function (el) { el.classList.toggle('invalid', !okRow); });
        if (!okRow) { bad = true; return; }
        seen[k] = true;
        out[k] = { in: vi, out: vo };
      });
      if (bad) { VX.toast('Fix the highlighted rows: each needs a unique model name and prices of 0 or more.', 'bad'); return Promise.resolve(); }
      if (!Object.keys(out).length) return clear();
      return VX.config.set('ai-prices', out).then(function (res) { if (res.ok) ctx.refresh(); });
    }
    function clear() {
      return VX.confirm({ title: 'Remove every price?', body: 'Cost estimates and the daily cost cap stop working until prices are added again.', danger: true, confirmLabel: 'Remove prices' }).then(function (yes) {
        if (!yes) return null;
        return VX.config.set('ai-prices', null).then(function (res) { if (res.ok) ctx.refresh(); });
      });
    }
    VX.mount(host, ui.card({
      title: 'Price table', sub: 'USD per million tokens. A model uses the longest matching name prefix; an exact name wins.',
      actions: [fill],
      body: stack(editor.el, h('div.actions', ui.button('Publish prices', { kind: 'primary', icon: 'upload', onClick: publish }), Object.keys(d.prices || {}).length ? ui.button('Remove all prices', { kind: 'danger', onClick: clear }) : null))
    }));
  }

  /* ----------------------------------------------------- generic lists */

  /** Editable list with add / remove / move. o = { items, max, blank(), row(item, index) → node, add, empty, emptyHint } */
  function listEditor(o) {
    var items = (o.items || []).slice();
    var wrap = h('div.editor-list');
    var count = h('span.muted.small');
    var addBtn = ui.button(o.add || 'Add', { kind: 'ghost', small: true, icon: 'plus', onClick: function () { add(o.blank()); var last = wrap.lastElementChild; var f = last && last.querySelector('input, textarea'); if (f) f.focus(); } });
    function move(i, by) { var j = i + by; if (j < 0 || j >= items.length) return; var t = items[i]; items[i] = items[j]; items[j] = t; draw(); }
    function draw() {
      if (!items.length) VX.mount(wrap, ui.empty(o.empty || 'Nothing here yet', o.emptyHint));
      else VX.mount(wrap, items.map(function (it, i) {
        return h('div.editor-row',
          o.row(it, i),
          h('div.actions',
            ui.button('Up', { kind: 'ghost', small: true, disabled: i === 0, ariaLabel: 'Move item ' + (i + 1) + ' up', onClick: function () { move(i, -1); } }),
            ui.button('Down', { kind: 'ghost', small: true, disabled: i === items.length - 1, ariaLabel: 'Move item ' + (i + 1) + ' down', onClick: function () { move(i, 1); } }),
            ui.button('', { kind: 'ghost', small: true, icon: 'trash', ariaLabel: 'Remove item ' + (i + 1), onClick: function () { items.splice(i, 1); draw(); } })));
      }));
      addBtn.disabled = items.length >= o.max;
      count.textContent = fmt.num(items.length) + ' of ' + fmt.num(o.max);
    }
    function add(it) { if (items.length >= o.max) return; items.push(it); draw(); }
    draw();
    return { el: h('div.form', { style: { 'max-width': 'none' } }, wrap, h('div.actions', addBtn, count)), items: function () { return items; }, add: add };
  }

  /* ----------------------------------------------------------- API lab */

  function parseSse(text) {
    var out = { meta: null, text: '', error: null, done: false, chars: 0 };
    String(text || '').split('\n').forEach(function (line) {
      if (line.indexOf('data:') !== 0) return;
      var j = null;
      try { j = JSON.parse(line.slice(5).trim()); } catch (e) { return; }
      if (!isObj(j)) return;
      if (isObj(j.meta)) out.meta = j.meta;
      if (typeof j.delta === 'string') out.text += j.delta;
      if (j.error) out.error = String(j.error);
      if (j.done) { out.done = true; out.chars = Number(j.chars) || out.text.length; }
    });
    return out;
  }

  /** POST /api/admin/ailab (chat) → normalised result. */
  function bench(body) {
    var t0 = Date.now();
    return VX.api.post('/api/admin/ailab', body, { timeout: 45000 }).then(function (res) {
      var ms = Date.now() - t0;
      var d = res.data || {};
      if (!res.ok) return { ok: false, ms: ms, error: d.error || res.error, detail: d.error === 'unknown_lane' ? 'This lane is not accepted by the lab' : d.error === 'unknown_model' ? 'That model is not in the provider’s free list' : res.message };
      if (typeof d.text === 'string' && d.text.indexOf('data:') >= 0) {
        var s = parseSse(d.text);
        return { ok: !s.error && s.done, ms: ms, meta: s.meta, text: s.text, chars: s.chars, error: s.error || (s.done ? null : 'stream ended early') };
      }
      if (d.error) return { ok: false, ms: ms, error: d.error, status: d.status, detail: d.head, meta: { model: d.model, provider: d.provider, lane: d.lane } };
      return { ok: false, ms: ms, error: 'unexpected reply' };
    });
  }

  function benchResult(r) {
    var meta = r.meta || {};
    var errText = r.error === 'not_configured' ? 'Key not set' + (r.detail ? ' — ' + r.detail : '') : r.error === 'stream_aborted' ? 'Stopped mid-reply (timeout or the provider dropped)' : r.error;
    return h('div.form', { style: { 'max-width': 'none' } },
      h('div.actions', ui.pill(r.ok ? 'Answered' : 'Failed', r.ok ? 'ok' : 'bad'), h('span.muted.small', [meta.name || meta.model, meta.provider ? PROVIDER_LABEL[meta.provider] || meta.provider : null, meta.lane ? 'lane ' + meta.lane : null, fmt.ms(r.ms), r.chars ? fmt.plural(r.chars, 'character') : null].filter(Boolean).join(' · '))),
      r.text ? h('div.preview-box', { style: { 'white-space': 'pre-wrap' } }, r.text) : null,
      !r.ok ? ui.notice(h('span', errText || 'Failed', r.status ? ' · upstream HTTP ' + r.status : '', r.detail && r.error !== 'not_configured' ? h('span', ' — ', h('code.mono', fmt.trunc(r.detail, 220))) : ''), 'bad') : null);
  }

  function renderLab(host, ctx) {
    var body = h('div.page-body');
    host.appendChild(body);
    return ui.load(body, function () {
      return VX.api.get('/api/aimodels').then(function (res) { return { ok: true, data: res.ok && res.data && Array.isArray(res.data.providers) ? res.data : null, res: res }; });
    }, function (catalog) {
      var list = catalog ? catalog.providers : [];
      var byId = {};
      list.forEach(function (p) { if (p && p.id) byId[p.id] = p; });
      return [
        catalog ? null : ui.notice('The live model list could not be loaded, so model pickers are empty — you can still type a model id.', 'warn'),
        providersCard(byId),
        chatBench(byId),
        mediaBench(byId)
      ];
    }, { skeleton: 6 });
  }

  function providersCard(byId) {
    var results = {};
    var cells = {};
    var rows = PROVIDERS.map(function (p) {
      var c = byId[p.id] || {};
      cells[p.id] = h('span.muted', 'Not pinged');
      return { id: p.id, label: p.label, configured: c.configured, models: (c.models || []).length, media: (c.media || []).length, tools: (c.tools || []).map(function (t) { return t.name; }).join(', ') };
    });
    function ping(id) {
      VX.mount(cells[id], ui.loading('Pinging…'));
      return bench({ provider: id, messages: [{ role: 'user', content: 'ping' }], maxTokens: 1 }).then(function (r) {
        results[id] = r;
        VX.mount(cells[id], h('span', ui.pill(r.ok ? 'OK' : 'Failed', r.ok ? 'ok' : 'bad'), ' ', h('span.muted.small', r.ok ? fmt.ms(r.ms) + (r.meta && r.meta.model ? ' · ' + r.meta.model : '') : (r.error === 'not_configured' ? 'key not set' : String(r.error || 'failed')) + (r.status ? ' · HTTP ' + r.status : ''))));
      });
    }
    var table = ui.table({
      rows: rows, exportName: false, search: false, dense: true,
      columns: [
        { key: 'label', label: 'Provider', sort: false },
        { key: 'configured', label: 'Key', sort: false, render: function (r) { return r.configured === true ? ui.pill('Set', 'ok') : r.configured === false ? ui.pill('Not set', 'warn') : ui.pill('Unknown', null); } },
        { key: 'models', label: 'Free chat models', align: 'right', sort: false, render: function (r) { return fmt.num(r.models); } },
        { key: 'media', label: 'Media models', align: 'right', sort: false, render: function (r) { return fmt.num(r.media); } },
        { key: 'tools', label: 'Tools', sort: false },
        { key: 'ping', label: 'Ping', sort: false, render: function (r) { return cells[r.id]; } },
        { key: 'act', label: '', sort: false, render: function (r) { return ui.button('Ping', { kind: 'ghost', small: true, ariaLabel: 'Ping ' + r.label, onClick: function () { return ping(r.id); } }); } }
      ]
    });
    return ui.card({
      title: 'Providers', sub: 'A one-token request to each provider’s default model — confirms the key and the endpoint answer',
      actions: [ui.button('Ping every provider', { kind: 'primary', small: true, icon: 'play', onClick: function () { return Promise.all(PROVIDERS.map(function (p) { return ping(p.id); })); } })],
      pad: false, body: table
    });
  }

  function chatBench(byId) {
    var mode = 'provider';
    var provider = ui.select(PROVIDERS.map(function (p) { return { value: p.id, label: p.label + (byId[p.id] && byId[p.id].configured === false ? ' (key not set)' : '') }; }), 'nvidia');
    var model = ui.select([], '');
    function fillModels() {
      var p = byId[provider.value] || {};
      VX.mount(model, h('option', { value: '' }, 'Default model'), (p.models || []).map(function (m) { return h('option', { value: m.id }, (m.name || m.id) + (m.vision ? ' · vision' : '')); }));
    }
    fillModels();
    provider.addEventListener('change', fillModels);
    var lane = ui.select(LANES.map(function (l) { return { value: l, label: l + ' · ' + providerOfLane(l) }; }), 'chat');
    var laneModel = ui.input({ placeholder: 'Lane default', maxlength: 128 });
    var prompt = ui.textarea({ rows: 3, maxlength: 8000, value: 'Suggest three upbeat Telugu songs for a morning walk, one line each.' });
    var system = ui.textarea({ rows: 2, maxlength: 8000, placeholder: 'Optional system prompt' });
    var maxTok = ui.input({ type: 'number', min: 1, max: 1000, step: 1, value: '300', style: { 'max-width': '160px' } });
    var provBox = h('div.form-row', { style: { 'align-items': 'start' } }, ui.field('Provider', provider), ui.field('Model', model));
    var laneBox = h('div.form-row', { hidden: true, style: { 'align-items': 'start' } }, ui.field('Lane', lane, 'The lane’s provider and pinned model.'), ui.field('Model override', laneModel, 'Optional model id on that lane.'));
    var out = h('div');
    function run() {
      var text = prompt.value.trim();
      if (!text) { prompt.classList.add('invalid'); prompt.focus(); return Promise.resolve(); }
      prompt.classList.remove('invalid');
      var n = Math.max(1, Math.min(1000, Math.floor(Number(maxTok.value) || 300)));
      var messages = [];
      if (system.value.trim()) messages.push({ role: 'system', content: system.value.trim() });
      messages.push({ role: 'user', content: text });
      var body = mode === 'provider' ? { provider: provider.value, messages: messages, maxTokens: n } : { lane: lane.value, messages: messages, maxTokens: n };
      if (mode === 'provider' && model.value) body.model = model.value;
      if (mode === 'lane' && laneModel.value.trim()) body.model = laneModel.value.trim();
      VX.mount(out, ui.loading('Waiting for the reply… (up to 30 s)'));
      return bench(body).then(function (r) { VX.mount(out, benchResult(r)); });
    }
    return ui.card({
      title: 'Chat bench', sub: 'One request, no failover — what this provider, model or lane answers right now',
      body: h('div.form', { style: { 'max-width': 'none' } },
        h('div', ui.segmented([{ value: 'provider', label: 'Provider and model' }, { value: 'lane', label: 'App lane' }], 'provider', function (v) { mode = v; provBox.hidden = v !== 'provider'; laneBox.hidden = v !== 'lane'; }, 'Bench target')),
        provBox, laneBox,
        ui.field('Prompt', prompt),
        ui.field('System prompt', system),
        h('div.form-row', { style: { 'align-items': 'start' } }, ui.field('Max tokens', maxTok, '1 to 1000.')),
        h('div.actions', ui.button('Run', { kind: 'primary', icon: 'play', onClick: run })),
        out)
    });
  }

  function mediaBench(byId) {
    var withMedia = PROVIDERS.filter(function (p) { return byId[p.id] && (byId[p.id].media || []).length; });
    if (!withMedia.length) {
      return ui.card({ title: 'Media bench', sub: 'Image and voice models', body: ui.empty('No media models available', 'Media models appear here when a provider key with free image or voice models is set.') });
    }
    var provider = ui.select(withMedia.map(function (p) { return { value: p.id, label: p.label }; }), withMedia[0].id);
    var kind = ui.select([{ value: 'image', label: 'Image' }, { value: 'speech', label: 'Speech (voice)' }], 'image');
    var model = ui.select([], '');
    var voice = ui.select([], '');
    var text = ui.textarea({ rows: 2, maxlength: 1000, value: 'A sunrise over paddy fields, warm colours, album-cover style' });
    var voiceField = ui.field('Voice', voice);
    function fill() {
      var media = ((byId[provider.value] || {}).media || []).filter(function (m) { return m.kind === kind.value; });
      VX.mount(model, media.length ? media.map(function (m) { return h('option', { value: m.id }, m.name || m.id); }) : h('option', { value: '' }, 'No ' + kind.value + ' models on this provider'));
      fillVoices();
    }
    function fillVoices() {
      var m = ((byId[provider.value] || {}).media || []).filter(function (x) { return x.id === model.value; })[0];
      var vs = (m && m.voices) || [];
      VX.mount(voice, h('option', { value: '' }, 'Default voice'), vs.map(function (v) { return h('option', { value: v }, v); }));
      voiceField.hidden = kind.value !== 'speech';
    }
    provider.addEventListener('change', fill);
    kind.addEventListener('change', function () {
      if (kind.value === 'speech' && /sunrise/.test(text.value)) text.value = 'Good morning! Here is your VinaX song of the day.';
      if (kind.value === 'image' && /Good morning/.test(text.value)) text.value = 'A sunrise over paddy fields, warm colours, album-cover style';
      fill();
    });
    model.addEventListener('change', fillVoices);
    fill();
    var out = h('div');
    function run() {
      if (!model.value) { VX.toast('Pick a model first.', 'bad'); return Promise.resolve(); }
      if (!text.value.trim()) { text.focus(); return Promise.resolve(); }
      var body = { provider: provider.value, kind: kind.value, model: model.value };
      if (kind.value === 'image') body.prompt = text.value.trim(); else { body.text = text.value.trim(); if (voice.value) body.voice = voice.value; }
      VX.mount(out, ui.loading('Running… (up to 60 s)'));
      var t0 = Date.now();
      return VX.api.post('/api/admin/ailab', body, { timeout: 70000 }).then(function (res) {
        var d = res.data || {};
        var ok = res.ok && d.ok === true;
        var img = typeof d.image === 'string' && /^data:image\/(png|jpe?g|webp|gif);base64,/.test(d.image) ? d.image : null;
        VX.mount(out, h('div.form', { style: { 'max-width': 'none' } },
          h('div.actions', ui.pill(ok ? 'Worked' : 'Failed', ok ? 'ok' : 'bad'), h('span.muted.small', [d.name || d.model, fmt.ms(d.ms != null ? d.ms : Date.now() - t0), d.status ? 'HTTP ' + d.status : null, d.bytes ? fmt.bytes(d.bytes) : null, d.voice ? 'voice ' + d.voice : null].filter(Boolean).join(' · '))),
          ok ? null : ui.notice(d.error === 'not_configured' ? 'Key not set' + (d.head ? ' — ' + d.head : '') : String(d.error || res.message || 'Failed'), 'bad'),
          img ? h('img', { src: img, alt: 'Generated test image', style: { 'max-width': '320px', width: '100%', 'border-radius': '10px' } }) : null,
          ok && kind.value === 'speech' ? h('p.muted.small', 'The voice answered; the audio itself is not sent back to the console.') : null));
      });
    }
    return ui.card({
      title: 'Media bench', sub: 'Generate one test image or voice clip on a free media model',
      body: h('div.form', { style: { 'max-width': 'none' } },
        h('div.form-row', { style: { 'align-items': 'start' } }, ui.field('Provider', provider), ui.field('Kind', kind), ui.field('Model', model), voiceField),
        ui.field('Prompt or text to speak', text),
        h('div.actions', ui.button('Run', { kind: 'primary', icon: 'play', onClick: run })),
        out)
    });
  }

  /* ------------------------------------------------------ Engine probe */

  var SOURCE_LABEL = {
    'vinax-cat': 'VinaX catalogue (this Worker)',
    'vinax-render': 'VinaX music API',
    'saavn-sumit': 'Community mirror A',
    'saavn-dev': 'Community mirror B',
    'nepotune': 'Community mirror C',
    'b4a': 'Community mirror D'
  };

  function renderProbe(host) {
    var results = {};
    var tableHost = h('div');
    var model = ui.input({ placeholder: 'Default model', maxlength: 128 });
    var provider = ui.select(PROVIDERS.map(function (p) { return { value: p.key, label: p.label }; }), 'NVIDIA');
    function probe(key, m) {
      var t0 = Date.now();
      return VX.api.get('/api/admin/enginetest', { key: key, model: m || null }, { fresh: true, timeout: 30000 }).then(function (res) {
        var d = res.data || {};
        var r = { key: key, label: (PROVIDERS.filter(function (p) { return p.key === key; })[0] || {}).label || key, model: d.model || m || '', at: new Date().toISOString() };
        if (!res.ok) {
          r.ok = false; r.ms = Date.now() - t0;
          r.result = d.error === 'env not set' ? 'Key not set (' + (d.env || 'secret') + ')' : d.error === 'unknown_model' ? 'Model not on this provider' : res.status === 429 ? 'Too many probes — wait a minute' : res.message;
        } else if (d.exception) {
          r.ok = false; r.ms = d.ms; r.status = 0; r.result = 'No answer: ' + d.exception;
        } else {
          r.ok = Number(d.status) >= 200 && Number(d.status) < 300; r.ms = d.ms; r.status = d.status; r.result = r.ok ? 'Answered' : 'Upstream HTTP ' + d.status; r.head = d.head;
          r.media = d.media || []; r.tools = d.tools || [];
        }
        results[key] = r;
        paint();
      });
    }
    function paint() {
      var rows = Object.keys(results).map(function (k) { return results[k]; });
      VX.mount(tableHost, ui.table({
        rows: rows, exportName: 'vinax-engine-probe', search: false,
        empty: 'No probes yet', emptyHint: 'Probe a provider to see whether its key works and how fast it answers.',
        onRow: openProbe,
        columns: [
          { key: 'label', label: 'Provider' },
          { key: 'model', label: 'Model', render: function (r) { return r.model ? ui.mono(r.model) : null; } },
          { key: 'ok', label: 'Result', sortVal: function (r) { return r.ok ? 1 : 0; }, render: function (r) { return h('span', ui.pill(r.ok ? 'OK' : 'Failed', r.ok ? 'ok' : 'bad'), ' ', h('span.small', r.result)); } },
          { key: 'ms', label: 'Time', align: 'right', render: function (r) { return fmt.ms(r.ms); } },
          { key: 'media', label: 'Media models', align: 'right', sortVal: function (r) { return r.media ? r.media.length : null; }, render: function (r) { return r.media ? fmt.num(r.media.length) : null; } },
          { key: 'tools', label: 'Tools', sort: false, render: function (r) { return r.tools && r.tools.length ? r.tools.map(function (t) { return t.name; }).join(', ') : null; } }
        ]
      }));
    }
    paint();
    var sources = h('div');
    VX.mount(sources, ui.empty('Not checked yet', 'Checks each catalogue source with a one-song search (takes up to 10 seconds).'));
    function checkSources() {
      return ui.load(sources, function () { return VX.api.get('/api/admin/musicapi', null, { fresh: true, timeout: 30000 }); }, function (d) {
        var rows = (d.mirrors || []).map(function (m, i) {
          var state = !m.ok ? 'down' : Number(m.songs) > 0 ? 'ok' : 'empty';
          return { label: SOURCE_LABEL[m.id] || 'Source ' + (i + 1), state: state, songs: m.songs, ms: m.ms, status: m.status, note: m.note };
        });
        var up = rows.filter(function (r) { return r.state === 'ok'; }).length;
        return [
          ui.notice(fmt.num(up) + ' of ' + fmt.plural(rows.length, 'source') + ' returned songs · checked ' + fmt.time(d.checkedAt), up ? (up === rows.length ? 'ok' : 'warn') : 'bad'),
          ui.table({
            rows: rows, exportName: false, search: false, dense: true, empty: 'No sources reported',
            columns: [
              { key: 'label', label: 'Source' },
              { key: 'state', label: 'Result', render: function (r) { return r.state === 'ok' ? ui.pill('Working', 'ok') : r.state === 'empty' ? ui.pill('Answered, no songs', 'warn') : ui.pill('Down', 'bad'); } },
              { key: 'songs', label: 'Songs', align: 'right', render: function (r) { return fmt.num(r.songs); } },
              { key: 'ms', label: 'Time', align: 'right', render: function (r) { return fmt.ms(r.ms); } },
              { key: 'status', label: 'HTTP', align: 'right' },
              { key: 'note', label: 'Note' }
            ]
          })
        ];
      });
    }
    host.appendChild(ui.card({
      title: 'Provider keys', sub: 'Asks one model to reply “OK” (8 tokens) with the provider’s key — 10 probes a minute',
      actions: [ui.button('Probe all', { kind: 'primary', small: true, icon: 'play', onClick: function () {
        return PROVIDERS.reduce(function (p, x) { return p.then(function () { return probe(x.key, ''); }); }, Promise.resolve());
      } })],
      body: [
        h('div.form-row', { style: { 'margin-bottom': '12px', 'align-items': 'end' } }, ui.field('Provider', provider), ui.field('Model', model, 'Optional — a model id from that provider.'),
          h('div.field', h('span.field-label', { 'aria-hidden': 'true' }, ' '), ui.button('Probe', { kind: 'ghost', icon: 'play', onClick: function () { return probe(provider.value, model.value.trim()); } }))),
        tableHost
      ]
    }));
    host.appendChild(ui.card({
      title: 'Music catalogue sources', sub: 'Where song search and playback data come from',
      actions: [ui.button('Check sources', { kind: 'primary', small: true, icon: 'refresh', onClick: checkSources })],
      body: sources
    }));
  }

  function openProbe(r) {
    var dr = VX.drawer({ title: r.label + ' probe' });
    VX.mount(dr.body,
      ui.dl([
        ['Result', h('span', ui.pill(r.ok ? 'OK' : 'Failed', r.ok ? 'ok' : 'bad'), ' ', r.result)],
        ['Model', r.model ? ui.mono(r.model) : '—'],
        ['Upstream status', r.status == null ? '—' : String(r.status)],
        ['Time', fmt.ms(r.ms)],
        ['Probed', fmt.dateTime(r.at)]
      ]),
      r.head ? [h('h3', 'Reply (first 220 characters)'), h('pre.json', r.head)] : null,
      r.media && r.media.length ? [h('h3', 'Free media models'), h('ul.list', r.media.map(function (m) { return h('li', ui.pill(m.kind, 'info'), h('span.grow', m.name || m.id), ui.mono(m.id)); }))] : null,
      r.tools && r.tools.length ? [h('h3', 'Tools'), h('ul.list', r.tools.map(function (t) { return h('li', h('strong', t.name), h('span.muted.small', fmt.plural((t.models || []).length, 'model'))); }))] : null);
  }

  /* ------------------------------------------------- Assistant content */

  function renderContent(host, ctx) {
    var body = h('div.page-body');
    host.appendChild(body);
    return ui.load(body, function () {
      return Promise.all(['ai-starters', 'ai-quick', 'ai-rules'].map(function (k) { return VX.config.get(k); })).then(function (list) {
        var bad = list.filter(function (r) { return !r.ok; })[0];
        return bad ? cfgRes(bad) : { ok: true, data: list };
      });
    }, function (list) { return [starters(list[0], ctx), quick(list[1], ctx), rules(list[2], ctx)]; }, { skeleton: 6 });
  }

  function statusLine(r, unsetText) {
    return r.value == null ? ui.pill(unsetText, null) : ui.pill('Published' + (r.updatedAt ? ' · ' + fmt.ago(r.updatedAt) : ''), 'ok');
  }
  function clearKey(key, what, ctx) {
    return VX.confirm({ title: 'Clear ' + what + '?', body: 'VinaX AI goes back to its built-in ' + what + '.', danger: true, confirmLabel: 'Clear' }).then(function (yes) {
      if (!yes) return null;
      return VX.config.set(key, null).then(function (res) { if (res.ok) ctx.refresh(); });
    });
  }

  function starters(r, ctx) {
    return (function () {
      var list = Array.isArray(r.value) ? r.value.filter(function (x) { return typeof x === 'string'; }) : [];
      var ed = listEditor({
        items: list.map(function (t) { return { text: t }; }), max: 24, add: 'Add a prompt',
        blank: function () { return { text: '' }; },
        empty: 'No custom starter prompts', emptyHint: 'VinaX AI shows its built-in starters. Add prompts to mix yours in.',
        row: function (it) {
          var inp = ui.input({ value: it.text, maxlength: 160, placeholder: 'e.g. Suggest 5 {lang} songs for a road trip' });
          inp.addEventListener('input', function () { it.text = inp.value; });
          it._el = inp;
          return ui.field('Prompt', inp);
        }
      });
      function publish() {
        var vals = ed.items().map(function (x) { return x.text.trim().slice(0, 160); }).filter(Boolean);
        if (!vals.length) return r.value == null ? (VX.toast('Add at least one prompt first.', 'bad'), Promise.resolve()) : clearKey('ai-starters', 'starter prompts', ctx);
        return VX.config.set('ai-starters', vals).then(function (res) { if (res.ok) ctx.refresh(); });
      }
      return ui.card({
        title: 'Starter prompts', sub: 'Suggestions VinaX AI draws from on a new chat · up to 24 · write {lang} for the listener’s language',
        actions: [statusLine(r, 'Built-in')],
        body: stack(ed.el, h('div.actions',
          ui.button('Publish', { kind: 'primary', icon: 'upload', onClick: publish }),
          r.value != null ? ui.button('Clear', { kind: 'danger', onClick: function () { return clearKey('ai-starters', 'starter prompts', ctx); } }) : null))
      });
    })();
  }

  function quick(r, ctx) {
    return (function () {
      var list = Array.isArray(r.value) ? r.value.filter(isObj) : [];
      var ed = listEditor({
        items: list.map(function (q) { return { icon: typeof q.icon === 'string' ? q.icon : '', label: typeof q.label === 'string' ? q.label : '', prompt: typeof q.prompt === 'string' ? q.prompt.replace(/\s+$/, '') : '', mode: typeof q.mode === 'string' ? q.mode : '' }; }),
        max: 8, add: 'Add a chip',
        blank: function () { return { icon: '', label: '', prompt: '', mode: '' }; },
        empty: 'No custom quick actions', emptyHint: 'VinaX AI shows its built-in eight chips. Add chips to replace them.',
        row: function (it) {
          var ic = ui.input({ value: it.icon, maxlength: 4, placeholder: '🎵' });
          var lb = ui.input({ value: it.label, maxlength: 20, placeholder: 'Road trip' });
          var pr = ui.input({ value: it.prompt, maxlength: 199, placeholder: 'Build me a road-trip playlist with ' });
          ic.addEventListener('input', function () { it.icon = ic.value; });
          lb.addEventListener('input', function () { it.label = lb.value; });
          pr.addEventListener('input', function () { it.prompt = pr.value; });
          it._els = [lb, pr];
          return h('div.form-row', { style: { 'grid-template-columns': '90px 1fr 2fr', 'align-items': 'start' } }, ui.field('Icon', ic), ui.field('Label', lb), ui.field('Prompt it fills in', pr));
        }
      });
      function publish() {
        var bad = false;
        var vals = ed.items().map(function (q) {
          var label = q.label.trim().slice(0, 20), prompt = q.prompt.trim().slice(0, 199);
          q._els[0].classList.toggle('invalid', !label);
          q._els[1].classList.toggle('invalid', !prompt);
          if (!label || !prompt) { bad = true; return null; }
          var o = { label: label, prompt: prompt + ' ' };
          if (q.icon.trim()) o.icon = q.icon.trim().slice(0, 4);
          if (q.mode) o.mode = q.mode;
          return o;
        });
        if (bad) { VX.toast('Each chip needs a label and a prompt.', 'bad'); return Promise.resolve(); }
        if (!vals.length) return r.value == null ? (VX.toast('Add at least one chip first.', 'bad'), Promise.resolve()) : clearKey('ai-quick', 'quick actions', ctx);
        return VX.config.set('ai-quick', vals).then(function (res) { if (res.ok) ctx.refresh(); });
      }
      return ui.card({
        title: 'Quick actions', sub: 'The chips on VinaX AI’s welcome screen · up to 8 · a chip only fills in the prompt',
        actions: [statusLine(r, 'Built-in')],
        body: stack(ed.el, h('div.actions',
          ui.button('Publish', { kind: 'primary', icon: 'upload', onClick: publish }),
          r.value != null ? ui.button('Clear', { kind: 'danger', onClick: function () { return clearKey('ai-quick', 'quick actions', ctx); } }) : null))
      });
    })();
  }

  function rules(r, ctx) {
    return (function () {
      var text = typeof r.value === 'string' ? r.value : '';
      var lines = text.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
      var total = h('span.muted.small');
      var ed;
      function joined() { return ed.items().map(function (x) { return x.text.trim(); }).filter(Boolean).join('\n'); }
      function count() { var n = joined().length; total.textContent = fmt.num(n) + ' / 1,200 characters'; total.className = n > 1200 ? 'small' : 'muted small'; total.style.color = n > 1200 ? 'var(--bad)' : ''; }
      ed = listEditor({
        items: lines.map(function (l) { return { text: l }; }), max: 30, add: 'Add a rule',
        blank: function () { return { text: '' }; },
        empty: 'No house rules', emptyHint: 'Rules are notes added to every VinaX AI chat: a promotion to mention, a correction, a tone note.',
        row: function (it) {
          var inp = ui.textarea({ rows: 2, maxlength: 1200, placeholder: 'e.g. When asked about new releases, mention the Weekly Fresh playlist.' });
          inp.value = it.text;
          inp.addEventListener('input', function () { it.text = inp.value.replace(/\n/g, ' '); count(); });
          return ui.field('Rule', inp);
        }
      });
      count();
      var wrapObs = new MutationObserver(count);
      wrapObs.observe(ed.el, { childList: true, subtree: true });
      ctx.onDispose(function () { wrapObs.disconnect(); });
      function publish() {
        var v = joined();
        if (v.length > 1200) { VX.toast('House rules are limited to 1,200 characters in total — shorten them first.', 'bad'); return Promise.resolve(); }
        if (!v) return r.value == null ? (VX.toast('Add at least one rule first.', 'bad'), Promise.resolve()) : clearKey('ai-rules', 'house rules', ctx);
        return VX.config.set('ai-rules', v).then(function (res) { if (res.ok) ctx.refresh(); });
      }
      return ui.card({
        title: 'House rules', sub: 'Added to the assistant’s instructions for every chat · never put secrets here',
        actions: [statusLine(r, 'None')],
        body: stack(ed.el, h('div.actions',
          ui.button('Publish', { kind: 'primary', icon: 'upload', onClick: publish }),
          r.value != null ? ui.button('Clear', { kind: 'danger', onClick: function () { return clearKey('ai-rules', 'house rules', ctx); } }) : null,
          total))
      });
    })();
  }
})();
