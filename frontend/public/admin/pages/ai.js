/* VinaX console — VinaX AI page.
 * API lab: chat and media bench through POST /api/admin/ailab, model lists
 * from /api/aimodels. Engine probe: /api/admin/enginetest per provider and
 * /api/admin/musicapi for the music catalogue sources. Provider and model
 * names come from the API and are allowed on this page. (13.9.1 — usage,
 * controls, cost and assistant content went with the database.) */
(function () {
  'use strict';
  var VX = window.VX, h = VX.h, ui = VX.ui, fmt = VX.fmt;

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

  VX.page({
    id: 'ai', title: 'VinaX AI', group: 'Intelligence', icon: 'spark',
    desc: 'How VinaX AI is used, and tools to test the providers, models and lanes.',
    noAuto: true,
    tabs: [
      { id: 'usage', label: 'Usage & health', desc: 'Every model call: volume, failures, latency and tokens by feature, provider and model.', render: renderUsage },
      { id: 'lab', label: 'API lab', desc: 'Send a test prompt to one provider, model or lane — no failover, so you see exactly what it answers.', render: renderLab },
      { id: 'probe', label: 'Engine probe', desc: 'Check each provider key with a tiny request, and check the music catalogue sources.', render: renderProbe }
    ]
  });

  /* ----------------------------------------------------------- helpers */
  var arr = VX.arr, obj = VX.obj, num = VX.num;

  /* ------------------------------------------------------------- Usage */

  function renderUsage(host, ctx) {
    var days = num(ctx.params.days) || 7;
    host.appendChild(h('div.toolbar', ui.daysPicker(days, function (v) { ctx.setParam('days', v); ctx.refresh(); })));
    var body = h('div.page-body');
    host.appendChild(body);
    return ui.load(body, function () { return VX.api.get('/api/admin/ai', { days: days }); }, function (d) {
      var gate = ui.gate(d, ctx);
      if (gate) return gate;
      var s = obj(d.summary);
      var total = num(s.total), ok = num(s.ok), fail = num(s.fail);
      var byDay = arr(d.byDay);
      return [
        ui.kpis([
          { label: 'Calls', value: fmt.compact(total), sub: 'last ' + fmt.plural(days, 'day') },
          { label: 'Answered', value: total ? fmt.ratio(ok / total) : '—', sub: fmt.num(fail) + ' failed', tone: !total ? null : fail / total > 0.2 ? 'bad' : fail / total > 0.05 ? 'warn' : 'ok' },
          { label: 'Latency p50 · p95', value: s.p50 != null ? fmt.ms(s.p50) + ' · ' + fmt.ms(s.p95) : '—' },
          { label: 'Prompt tokens', value: fmt.compact(s.promptTokens) },
          { label: 'Completion tokens', value: fmt.compact(s.completionTokens) }
        ]),
        ui.grid([
          ui.card({ title: 'Calls by day', span: 2, body: ui.chart({ labels: byDay.map(function (r) { return r.day; }), series: [
            { name: 'Answered', values: byDay.map(function (r) { return num(r.ok); }), color: 'var(--c3)' },
            { name: 'Failed', values: byDay.map(function (r) { return num(r.fail); }), color: 'var(--c5)' }
          ], type: 'bar', stacked: true, height: 220 }) }),
          ui.card({ title: 'Providers', body: ui.share(arr(d.byProvider).map(function (p) { return { label: PROVIDER_LABEL[p.provider] || p.provider || 'unknown', value: num(p.total) }; }), { title: 'Calls by provider', empty: 'No calls in this period' }) })
        ], 3),
        ui.grid([
          ui.card({ title: 'Features', pad: false, body: ui.table({
            columns: [
              { key: 'feature', label: 'Feature', render: function (r) { return ui.mono(r.feature || '—'); } },
              { key: 'total', label: 'Calls', align: 'right', render: function (r) { return fmt.num(r.total); } },
              { key: 'fail', label: 'Failed', align: 'right', render: function (r) { var t = num(r.total); return h('span', fmt.num(r.fail), t ? h('span.muted.small', ' (' + fmt.ratio(num(r.fail) / t) + ')') : null); } },
              { key: 'p50', label: 'p50', align: 'right', render: function (r) { return fmt.ms(r.p50); } },
              { key: 'p95', label: 'p95', align: 'right', render: function (r) { return fmt.ms(r.p95); } }
            ],
            rows: arr(d.byFeature), exportName: 'vinax-ai-features', search: false, dense: true, sortKey: 'total', sortDir: 'desc', empty: 'No calls in this period'
          }) }),
          ui.card({ title: 'Failure reasons', body: ui.hbars(arr(d.errors).map(function (e) { return { label: e.error || 'unknown', value: num(e.count) }; }), { empty: 'No failures — good', limit: 12 }) })
        ], 2),
        ui.card({ title: 'Models', sub: 'Calls and tokens per model', pad: false, body: ui.table({
          columns: [
            { key: 'model', label: 'Model', render: function (r) { return h('div', h('div.cell-main', ui.mono(r.model || 'unknown')), h('div.cell-sub', PROVIDER_LABEL[r.provider] || r.provider || '')); } },
            { key: 'calls', label: 'Calls', align: 'right', render: function (r) { return fmt.num(r.calls); } },
            { key: 'fail', label: 'Failed', align: 'right', render: function (r) { return fmt.num(r.fail); } },
            { key: 'promptTokens', label: 'Prompt tokens', align: 'right', render: function (r) { return fmt.compact(r.promptTokens); } },
            { key: 'completionTokens', label: 'Completion tokens', align: 'right', render: function (r) { return fmt.compact(r.completionTokens); } }
          ],
          rows: arr(d.byModel), exportName: 'vinax-ai-models', search: arr(d.byModel).length > 8, dense: true, sortKey: 'calls', sortDir: 'desc', empty: 'No calls in this period'
        }) }),
        ui.card({ title: 'Recent calls', sub: 'Newest 40', pad: false, body: ui.table({
          columns: [
            { key: 'at', label: 'When', nowrap: true, render: function (r) { return ui.ago(r.at); } },
            { key: 'feature', label: 'Feature', render: function (r) { return ui.mono(r.feature || '—'); } },
            { key: 'model', label: 'Model', render: function (r) { return r.model ? h('span', { title: r.model }, fmt.trunc(r.model, 40)) : null; } },
            { key: 'ok', label: 'Result', sortVal: function (r) { return r.ok ? 1 : 0; }, render: function (r) { return r.ok ? ui.pill('OK', 'ok') : ui.pill(r.error || (r.status ? 'HTTP ' + r.status : 'Failed'), 'bad'); } },
            { key: 'latencyMs', label: 'Time', align: 'right', render: function (r) { return fmt.ms(r.latencyMs); } },
            { key: 'client', label: 'Client' }
          ],
          rows: arr(d.recent), exportName: false, search: false, dense: true, pageSize: 20, empty: 'No calls yet'
        }) })
      ];
    }, { skeleton: 8 });
  }

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function providerOfLane(lane) { var p = LANE_PROVIDER[lane]; return p ? PROVIDER_LABEL[p] : '—'; }

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
})();
