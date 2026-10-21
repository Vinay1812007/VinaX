/* VinaX console — Recommendations page.
 * Quality: how automatic songs (continuations) land — completion, skips,
 * likes, repeats, fallback and latency — overall and per algorithm, picker
 * and experiment variant, from opt-in telemetry (/api/admin/recquality).
 * Tuning: versioned, bounded weight overrides for the on-device scorer with
 * a staged rollout (off / one experiment variant / everyone), optimistic
 * concurrency, history and rollback (/api/admin/recconfig).
 * Experiments: create, edit, pause and delete A/B experiments and see their
 * per-variant numbers (/api/admin/experiments). */
(function () {
  'use strict';
  var VX = window.VX, h = VX.h, ui = VX.ui, fmt = VX.fmt;

  VX.page({
    id: 'recs', title: 'Recommendations', group: 'Intelligence', icon: 'target',
    desc: 'How well automatic song picks land, the weights behind them, and A/B experiments.',
    noAuto: true,
    tabs: [
      { id: 'quality', label: 'Quality', desc: 'How automatic songs land with listeners who share usage data.', render: renderQuality },
      { id: 'tuning', label: 'Tuning', desc: 'Adjust the recommendation weights and roll them out to nobody, one experiment variant or everyone.', render: renderTuning },
      { id: 'experiments', label: 'Experiments', desc: 'A/B experiments split devices into variants so changes can be compared.', render: renderExperiments }
    ]
  });

  var NOT_CONNECTED = ['Database not connected', 'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the Worker.'];

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function rateText(r) {
    if (!isObj(r) || typeof r.rate !== 'number' || !(r.n > 0)) return '—';
    var band = typeof r.low === 'number' && typeof r.high === 'number' ? Math.round(r.low * 100) + '–' + Math.round(r.high * 100) + '%' : '';
    if (r.n < 30) return fmt.num(r.k) + ' of ' + fmt.num(r.n) + (band ? ' (likely ' + band + ')' : '');
    return fmt.ratio(r.rate) + (band ? ' (' + band + ')' : '');
  }
  /** Short rate for dense tables; the interval is in the tooltip. */
  function rateCell(r) {
    if (!isObj(r) || typeof r.rate !== 'number' || !(r.n > 0)) return null;
    return h('span', { title: rateText(r) + ' · n=' + fmt.num(r.n) }, r.n < 30 ? fmt.num(r.k) + ' of ' + fmt.num(r.n) : fmt.ratio(r.rate));
  }
  function rateVal(r) { return isObj(r) && typeof r.rate === 'number' ? r.rate : null; }
  function secText(d) {
    if (!isObj(d) || typeof d.p50 !== 'number') return '—';
    var band = typeof d.p50Low === 'number' && typeof d.p50High === 'number' && d.p50Low !== d.p50High ? ' (' + Math.round(d.p50Low) + '–' + Math.round(d.p50High) + ' s)' : '';
    return Math.round(d.p50) + ' s' + band;
  }
  function msText(d) {
    if (!isObj(d) || typeof d.p50 !== 'number') return '—';
    return fmt.ms(d.p50) + ' / ' + (typeof d.p95 === 'number' ? fmt.ms(d.p95) : 'p95 needs 20+');
  }
  function mapText(m) {
    if (!isObj(m)) return '';
    return Object.keys(m).filter(function (k) { return Number(m[k]) > 0; }).map(function (k) { return k.replace(/_/g, ' ') + ' ' + fmt.num(m[k]); }).join(', ');
  }
  function daysParam(ctx) { var d = Number(ctx.params.days); return [1, 7, 30, 90].indexOf(d) >= 0 ? d : 7; }
  function w4(v) { return v == null || !isFinite(Number(v)) ? '—' : String(Math.round(Number(v) * 10000) / 10000); }

  /* ----------------------------------------------------------- Quality */

  function renderQuality(host, ctx) {
    var days = daysParam(ctx);
    var body = h('div.page-body');
    host.appendChild(h('div.toolbar', ui.daysPicker(days, function (d) { ctx.setParam('days', d); ctx.refresh(); })));
    host.appendChild(body);
    return ui.load(body, function () { return VX.api.get('/api/admin/recquality', { days: days }); }, function (d) {
      if (d.configured === false) return ui.empty(NOT_CONNECTED[0], NOT_CONNECTED[1]);
      if (d.provisioned === false) return ui.notice('Recommendation telemetry is not set up in the database: ' + (d.note || 'the events table has no meta column') + ' Run frontend/supabase/vinax-13.sql in the SQL editor.', 'warn');
      var g = d.overall || {};
      var o = isObj(g.outcomes) ? g.outcomes : {};
      var s = isObj(g.served) ? g.served : {};
      var windowText = days === 1 ? 'last 24 hours' : 'last ' + days + ' days';
      var min = d.minDevices || 3;
      var empty = !Number(g.continuations) && !Number(g.exposures);
      var fb = isObj(s.fallback) ? s.fallback : null;
      return [
        ui.notice('Only devices whose listener turned on usage sharing are counted (' + fmt.plural(d.devices, 'device') + ' in the ' + windowText + '). Rates show a 95% interval; under 30 samples they read “k of n”. Groups with fewer than ' + min + ' devices show counts only.', 'info'),
        d.truncated ? ui.notice('Only the newest ' + fmt.num(d.sampled) + ' events were read — busy windows are undercounted.', 'warn') : null,
        empty ? ui.empty('No recommendation data yet', 'This fills in as opted-in listeners play automatic songs (the songs VinaX picks after their queue ends).') : null,
        empty ? null : ui.kpis([
          { label: 'Devices', value: fmt.num(d.devices), sub: 'opted in · ' + windowText },
          { label: 'Continuations', value: fmt.num(g.continuations), sub: 'times VinaX picked what plays next' },
          { label: 'Songs started', value: fmt.num(g.exposures), sub: 'automatic songs that began' },
          { label: 'Completion', value: g.withheld ? 'Withheld' : rateVal(o.completion) == null ? '—' : fmt.ratio(o.completion.rate), sub: g.withheld ? 'fewer than ' + min + ' devices' : 'played to the end' },
          { label: 'Early skips', value: g.withheld ? 'Withheld' : rateVal(o.earlySkip) == null ? '—' : fmt.ratio(o.earlySkip.rate), sub: 'skipped within 30 s', tone: rateVal(o.earlySkip) > 0.35 ? 'warn' : null, inverse: true },
          { label: 'Median listened', value: g.withheld ? 'Withheld' : isObj(o.heardSec) && typeof o.heardSec.p50 === 'number' ? Math.round(o.heardSec.p50) + ' s' : '—', sub: 'per automatic song' }
        ]),
        empty || g.withheld ? null : ui.card({
          title: 'All opt-in devices', sub: windowText,
          body: ui.table({
            rows: [
              { m: 'Completion rate', v: rateText(o.completion), w: 'Automatic songs played to the end' },
              { m: 'Early-skip rate', v: rateText(o.earlySkip), w: 'Skipped with under ' + (d.earlySkipSec || 30) + ' s heard' },
              { m: 'Skip rate', v: rateText(o.skip), w: 'Any skip' },
              { m: 'Likes', v: rateText(o.likes), w: 'Liked while it was the automatic song' },
              { m: 'Repeats', v: rateText(o.repeats), w: 'The same song served again to the same device in this window' },
              { m: 'Median listened', v: secText(o.heardSec), w: 'Seconds heard per automatic song, with its interval' },
              { m: 'Fallback rate', v: rateText(fb) + (fb && mapText(fb.byReason) ? ' — ' + mapText(fb.byReason) : ''), w: 'Continuations where the AI picker was skipped or failed' },
              { m: 'Language violations', v: s.languageViolations ? rateText(s.languageViolations.rate) : '—', w: 'Songs outside the queue language' },
              { m: 'Discovery share', v: rateText(s.discovery), w: 'Songs by an artist the listener never played' },
              { m: 'Diversity', v: isObj(s.diversity) && typeof s.diversity.mean === 'number' ? fmt.num(s.diversity.mean) + ' artists' : '—', w: 'Distinct lead artists per continuation' },
              { m: 'Request latency p50 / p95', v: msText(s.latencyMs), w: 'From asking for a continuation to having one' },
              { m: 'Relaxed rules', v: mapText(s.relaxed) || '—', w: 'Rules relaxed to fill a continuation' }
            ],
            exportName: 'vinax-rec-quality-overall', search: false, pageSize: 20,
            columns: [
              { key: 'm', label: 'Measure', sort: false },
              { key: 'v', label: 'Value (95% interval)', sort: false },
              { key: 'w', label: 'What it counts', sort: false, render: function (r) { return h('span.muted', r.w); } }
            ]
          })
        }),
        empty ? null : breakdown('By algorithm', 'Which ranking algorithm picked the songs', d.byAlg, 'alg', min),
        empty ? null : breakdown('By picker', 'On-device picker or the AI picker', d.byPicker, 'picker', min),
        empty ? null : breakdown('By experiment variant', 'Compare variants of a running experiment here', d.byVariant, 'variant', min)
      ];
    }, { skeleton: 6 });
  }

  function breakdown(title, sub, list, name, min) {
    var rows = (list || []).filter(isObj);
    var r = function (g, k) { return g.withheld || !isObj(g.outcomes) ? null : g.outcomes[k]; };
    return ui.card({
      title: title, sub: sub + ' · hover a rate for its 95% interval', pad: false,
      body: ui.table({
        rows: rows, exportName: 'vinax-rec-quality-' + name, sortKey: 'exposures', sortDir: 'desc', dense: true,
        empty: 'No groups in this window', emptyHint: 'Groups appear once automatic songs are played.',
        columns: [
          { key: 'key', label: 'Group', render: function (g) { return h('div', h('div.cell-main', g.key), g.withheld ? h('div.cell-sub', 'counts only') : null); } },
          { key: 'devices', label: 'Devices', align: 'right', render: function (g) { return fmt.num(g.devices); } },
          { key: 'continuations', label: 'Picks', align: 'right', render: function (g) { return fmt.num(g.continuations); } },
          { key: 'exposures', label: 'Songs started', align: 'right', render: function (g) { return fmt.num(g.exposures); } },
          { key: 'completion', label: 'Completion', sortVal: function (g) { return rateVal(r(g, 'completion')); }, render: function (g) { return g.withheld ? h('span.muted', { title: 'Fewer than ' + min + ' devices' }, 'withheld') : rateCell(r(g, 'completion')); }, csv: function (g) { return rateVal(r(g, 'completion')); } },
          { key: 'earlySkip', label: 'Early skip', sortVal: function (g) { return rateVal(r(g, 'earlySkip')); }, render: function (g) { return g.withheld ? null : rateCell(r(g, 'earlySkip')); }, csv: function (g) { return rateVal(r(g, 'earlySkip')); } },
          { key: 'skip', label: 'Skip', sortVal: function (g) { return rateVal(r(g, 'skip')); }, render: function (g) { return g.withheld ? null : rateCell(r(g, 'skip')); }, csv: function (g) { return rateVal(r(g, 'skip')); } },
          { key: 'likes', label: 'Likes', sortVal: function (g) { return rateVal(r(g, 'likes')); }, render: function (g) { return g.withheld ? null : rateCell(r(g, 'likes')); }, csv: function (g) { return rateVal(r(g, 'likes')); } },
          { key: 'heard', label: 'Median heard', sortVal: function (g) { var x = r(g, 'heardSec'); return x ? x.p50 : null; }, render: function (g) { var x = r(g, 'heardSec'); return g.withheld || !x || typeof x.p50 !== 'number' ? null : h('span', { title: secText(x) }, Math.round(x.p50) + ' s'); } },
          { key: 'fallback', label: 'Fallback', sortVal: function (g) { return g.served ? rateVal(g.served.fallback) : null; }, render: function (g) { return g.withheld || !g.served ? null : rateCell(g.served.fallback); } },
          { key: 'latency', label: 'Latency p50 / p95', sortVal: function (g) { return g.served && g.served.latencyMs ? g.served.latencyMs.p50 : null; }, render: function (g) { return g.withheld || !g.served ? null : msText(g.served.latencyMs); } }
        ]
      })
    });
  }

  /* ------------------------------------------------------------ Tuning */

  function rolloutText(r) {
    if (!isObj(r) || !r.mode || r.mode === 'off') return 'Off — no device uses it';
    if (r.mode === 'all') return 'Every device';
    return 'Experiment ' + (r.experimentKey || '?') + ', variant ' + (r.variant || '?');
  }

  function renderTuning(host, ctx) {
    var body = h('div.page-body');
    host.appendChild(body);
    return ui.load(body, function () { return VX.api.get('/api/admin/recconfig', null, { fresh: true }); }, function (d) {
      if (d.configured === false) return ui.empty(NOT_CONNECTED[0], NOT_CONNECTED[1]);
      return tuning(d, ctx);
    }, { skeleton: 8 });
  }

  function tuning(d, ctx) {
    var weights = (d.weights || []).filter(function (w) { return isObj(w) && typeof w.key === 'string'; });
    var cur = isObj(d.current) ? d.current : null;
    var version = Number(d.version) || 0;
    var pubO = cur && isObj(cur.overrides) ? cur.overrides : {};
    var exps = (d.experiments || []).filter(isObj);
    var base = d.baseVersion || '—';
    var evalCmd = d.evalCommand || 'node frontend/scripts/eval-recs.mjs';
    var draft = { base: version, values: {}, mode: cur && cur.rollout && cur.rollout.mode ? cur.rollout.mode : 'off', exp: cur && cur.rollout ? cur.rollout.experimentKey || '' : '', variant: cur && cur.rollout ? cur.rollout.variant || '' : '' };
    Object.keys(pubO).forEach(function (k) { if (isFinite(Number(pubO[k]))) draft.values[k] = String(pubO[k]); });

    // ---- published
    var ev = cur && isObj(cur.evaluation) ? cur.evaluation : null;
    var published = ui.card({
      title: cur ? 'Published — version ' + cur.version : 'Published',
      sub: 'Built-in weights ' + base,
      body: cur ? [
        ui.dl([
          ['Rollout', rolloutText(cur.rollout)],
          ['Changing devices now', d.live ? ui.pill('Yes — targeted devices report weights ' + base + '+rc' + cur.version, 'ok') : ui.pill('No', null)],
          ['Overrides', fmt.plural(Object.keys(pubO).length, 'weight')],
          ['Published', fmt.dateTime(cur.updatedAt) + ' by ' + (cur.updatedBy || 'admin')],
          ['Note', cur.note ? h('span', { style: { 'white-space': 'pre-wrap' } }, cur.note) : '—'],
          ['Evaluation', ev ? h('div', ui.pill('Evaluation attached', 'ok'), ' ', h('span.muted.small', fmt.dateTime(ev.at)), h('p', { style: { 'white-space': 'pre-wrap', margin: '6px 0 0' } }, ev.summary || ''), ev.url && /^https:\/\//i.test(ev.url) ? h('a', { href: ev.url, target: '_blank', rel: 'noopener noreferrer' }, 'Report') : null) : ui.pill('Unvalidated — no evaluation attached', 'warn')]
        ]),
        d.experimentsRead === 'failed' ? ui.notice('Experiments could not be read, so an experiment rollout may show as not live.', 'warn') : null
      ] : [h('p.muted', 'Nothing published yet — every device uses the built-in weights (' + base + '). Edit the weights below and publish to change that.')]
    });

    // ---- editor
    var inputs = {};
    var changesHost = h('div');
    function proposed() {
      var out = {}, bad = [], clampedKeys = [];
      weights.forEach(function (w) {
        var raw = (draft.values[w.key] || '').trim();
        if (raw === '') return;
        var v = Number(raw);
        if (!isFinite(v)) { bad.push(w.key); return; }
        if (v < w.min || v > w.max) clampedKeys.push(w.key);
        out[w.key] = v;
      });
      return { overrides: out, bad: bad, outOfRange: clampedKeys };
    }
    function paintChanges() {
      var p = proposed();
      weights.forEach(function (w) {
        var el = inputs[w.key];
        el.classList.toggle('invalid', p.bad.indexOf(w.key) >= 0 || p.outOfRange.indexOf(w.key) >= 0);
      });
      var keys = Object.keys(p.overrides);
      var rows = keys.map(function (k) {
        var w = weights.filter(function (x) { return x.key === k; })[0];
        var f = w && w.default ? p.overrides[k] / w.default : null;
        return h('li', ui.mono(k), h('span.grow', w4(w && w.default) + ' → ' + w4(p.overrides[k]) + (f != null ? ' (×' + (Math.round(f * 100) / 100) + ')' : '')),
          p.outOfRange.indexOf(k) >= 0 ? ui.pill('Outside ' + w4(w.min) + '–' + w4(w.max) + ' — will be clamped', 'warn') : null);
      });
      VX.mount(changesHost, keys.length ? h('ul.list', rows) : h('p.muted', 'No overrides — every weight uses its built-in default.'));
    }
    var weightRows = weights.map(function (w) {
      var inp = ui.input({ type: 'number', step: '0.001', min: w.min, max: w.max, placeholder: 'default', value: draft.values[w.key] || '', 'aria-label': 'Proposed ' + w.key, style: { width: '110px' } });
      inp.addEventListener('input', function () { draft.values[w.key] = inp.value; paintChanges(); });
      inputs[w.key] = inp;
      return w;
    });
    var table = ui.table({
      rows: weightRows, exportName: 'vinax-rec-weights', pageSize: 50, dense: true, search: 'Filter weights…',
      columns: [
        { key: 'key', label: 'Weight', render: function (w) { return h('div', ui.mono(w.key), (w.touches && w.touches.length) || w.note ? h('div.cell-sub', (w.touches || []).join('; ') || w.note) : null); } },
        { key: 'default', label: 'Default', align: 'right', render: function (w) { return w4(w.default); } },
        { key: 'published', label: 'Published', align: 'right', sortVal: function (w) { return pubO[w.key]; }, render: function (w) { return pubO[w.key] == null ? null : w4(pubO[w.key]); } },
        { key: 'proposed', label: 'Proposed', sort: false, render: function (w) { return inputs[w.key]; }, csv: function (w) { return draft.values[w.key] || ''; } },
        { key: 'range', label: 'Allowed', sort: false, render: function (w) { return h('span.muted', w4(w.min) + ' – ' + w4(w.max)); }, csv: function (w) { return w.min + '..' + w.max; } }
      ]
    });

    // ---- rollout
    var modeSel = ui.select([{ value: 'off', label: 'Off — save without changing any device' }, { value: 'experiment', label: 'One experiment variant' }, { value: 'all', label: 'Every device' }], draft.mode);
    var expSel = ui.select([], '');
    var varSel = ui.select([], '');
    var expBox = h('div.form-row', { style: { 'align-items': 'start' } });
    var expNote = h('div');
    function fillExp() {
      VX.mount(expSel, h('option', { value: '' }, exps.length ? 'Choose an experiment…' : 'No experiments yet'), exps.map(function (e) { return h('option', { value: e.key, selected: e.key === draft.exp }, e.key + (e.name ? ' — ' + e.name : '') + (e.active ? '' : ' (paused)')); }));
      fillVar();
    }
    function fillVar() {
      var e = exps.filter(function (x) { return x.key === draft.exp; })[0];
      VX.mount(varSel, h('option', { value: '' }, 'Choose a variant…'), ((e && e.variants) || []).map(function (v) { return h('option', { value: v.name, selected: v.name === draft.variant }, v.name + ' (' + fmt.num(v.pct) + '%)'); }));
      VX.mount(expNote,
        !exps.length ? ui.notice(h('span', 'No experiments exist yet. ', ui.button('Create one', { kind: 'ghost', small: true, onClick: function () { ctx.go('recs', 'experiments'); } })), 'info') : null,
        e && !e.active ? ui.notice('This experiment is paused, so the weights reach no device until it is running.', 'warn') : null,
        ui.notice('Target a treatment variant. Devices outside the experiment, and every other variant, keep the built-in weights, so Quality can compare them by variant.', 'info'));
    }
    function paintMode() { expBox.hidden = draft.mode !== 'experiment'; expNote.hidden = draft.mode !== 'experiment'; }
    VX.mount(expBox, ui.field('Experiment', expSel), ui.field('Variant', varSel));
    modeSel.addEventListener('change', function () { draft.mode = modeSel.value; paintMode(); });
    expSel.addEventListener('change', function () { draft.exp = expSel.value; draft.variant = ''; fillVar(); });
    varSel.addEventListener('change', function () { draft.variant = varSel.value; });
    fillExp(); paintMode();

    var note = ui.textarea({ rows: 2, maxlength: 280, placeholder: 'What changed and why' });
    var evalSummary = ui.textarea({ rows: 3, maxlength: 600, placeholder: 'Paste the result of the offline evaluation (optional)' });
    var evalUrl = ui.input({ type: 'url', maxlength: 300, placeholder: 'https://… (optional link to the full report)' });
    var by = ui.input({ maxlength: 40, placeholder: 'admin', value: localName() });
    var problemsHost = h('div');

    function publish() {
      var p = proposed();
      if (p.bad.length) { VX.toast('Not a number: ' + p.bad.join(', '), 'bad'); return Promise.resolve(); }
      var rollout = { mode: draft.mode };
      if (draft.mode === 'experiment') {
        if (!draft.exp || !draft.variant) { VX.toast('Choose the experiment and the variant to target.', 'bad'); return Promise.resolve(); }
        rollout.experimentKey = draft.exp; rollout.variant = draft.variant;
      }
      if (draft.mode !== 'off' && !Object.keys(p.overrides).length) { VX.toast('Set at least one weight before rolling out.', 'bad'); return Promise.resolve(); }
      var url = evalUrl.value.trim();
      if (url && !/^https:\/\//i.test(url)) { evalUrl.classList.add('invalid'); VX.toast('The report link must start with https://', 'bad'); return Promise.resolve(); }
      evalUrl.classList.remove('invalid');
      var summary = evalSummary.value.trim();
      if (url && !summary) { VX.toast('Add a short evaluation summary with the report link.', 'bad'); return Promise.resolve(); }
      var who = by.value.trim();
      if (who) saveName(who);
      var payload = {
        expectedVersion: draft.base,
        overrides: p.overrides,
        rollout: rollout,
        note: note.value.trim(),
        evaluation: summary ? (url ? { summary: summary, url: url } : { summary: summary }) : null,
        by: who || 'admin'
      };
      var ask = draft.mode === 'all'
        ? VX.confirm({ title: 'Change recommendations for everyone?', body: 'Every device starts using these ' + fmt.plural(Object.keys(p.overrides).length, 'weight') + ' within a few minutes.' + (summary ? '' : ' No evaluation is attached — run ' + evalCmd + ' first if you can.'), confirmLabel: 'Publish to everyone' })
        : Promise.resolve(true);
      return ask.then(function (yes) {
        if (!yes) return null;
        return VX.api.post('/api/admin/recconfig', payload).then(function (res) { return handleResult(res, ctx, problemsHost, draft); });
      });
    }

    var editor = ui.card({
      title: 'Edit weights', sub: 'Leave a field blank to keep its default. Each weight may move between half and double its default.',
      body: [
        table,
        h('div.form', { style: { 'max-width': 'none', 'margin-top': '14px' } },
          h('div.field', h('span.field-label', 'Changes from the defaults'), changesHost),
          ui.field('Rollout', modeSel),
          expBox, expNote,
          ui.field('Note', note, 'Up to 280 characters. Shown in the history.'),
          ui.field('Evaluation summary', evalSummary, h('span', 'Run ', h('code.mono', evalCmd), ' and paste what it reports.')),
          ui.field('Report link', evalUrl),
          ui.field('Published by', by),
          problemsHost,
          h('div.actions',
            ui.button('Publish version ' + (version + 1), { kind: 'primary', icon: 'upload', onClick: publish }),
            ui.button('Discard changes', { kind: 'ghost', onClick: function () { ctx.refresh(); } }),
            ui.button('Copy eval command', { kind: 'ghost', icon: 'copy', onClick: function () { return copy(evalCmd); } })))
      ]
    });
    paintChanges();

    // ---- history
    var hist = (d.history || []).filter(isObj);
    var history = ui.card({
      title: 'History', sub: 'Newest first · rollback publishes an older version again as a new version', pad: false,
      body: ui.table({
        rows: hist, exportName: 'vinax-rec-config-history', sortKey: 'version', sortDir: 'desc',
        empty: 'No versions yet', emptyHint: 'Each publish is kept here (up to 20) so you can roll back.',
        onRow: function (r) { openVersion(r, weights); },
        columns: [
          { key: 'version', label: 'Version', nowrap: true, render: function (r) { return h('span', 'v' + r.version, r.version === version ? h('span', ' ', ui.pill('current', 'accent')) : null); } },
          { key: 'updatedAt', label: 'Published', nowrap: true, render: function (r) { return fmt.dateTime(r.updatedAt); } },
          { key: 'updatedBy', label: 'By' },
          { key: 'rollout', label: 'Rollout', sortVal: function (r) { return rolloutText(r.rollout); }, render: function (r) { return rolloutText(r.rollout); } },
          { key: 'n', label: 'Overrides', align: 'right', sortVal: function (r) { return Object.keys(r.overrides || {}).length; }, render: function (r) { return fmt.num(Object.keys(r.overrides || {}).length); } },
          { key: 'note', label: 'Note', render: function (r) { return r.note ? fmt.trunc(r.note, 60) : null; } },
          { key: 'evaluation', label: 'Evaluation', sortVal: function (r) { return r.evaluation ? 1 : 0; }, render: function (r) { return r.evaluation ? ui.pill('Attached', 'ok') : ui.pill('None', 'warn'); } },
          { key: 'act', label: '', sort: false, render: function (r) { return r.version === version ? null : ui.button('Roll back', { kind: 'ghost', small: true, ariaLabel: 'Roll back to version ' + r.version, onClick: function () { return rollback(r, version, ctx); } }); } }
        ]
      })
    });

    return [published, editor, history];
  }

  function handleResult(res, ctx, host, draft) {
    var d = res.data || {};
    if (res.ok && d.ok) {
      var clamped = d.clamped || [];
      VX.toast('Published version ' + (d.record ? d.record.version : ''), 'ok');
      if (clamped.length) VX.toast('Clamped: ' + clamped.map(function (c) { return c.key + ' ' + w4(c.requested) + ' → ' + w4(c.applied); }).join(', '), 'warn');
      if (d.historySaved === false) VX.toast('Published, but the history entry could not be saved.', 'warn');
      ctx.refresh();
      return;
    }
    if (d.error === 'version_conflict') {
      VX.mount(host, ui.notice(h('span', 'Version ' + (d.version == null ? '?' : d.version) + ' was published after you opened this page, so nothing was saved. ',
        ui.button('Load the latest (discard mine)', { kind: 'ghost', small: true, onClick: function () { ctx.refresh(); } }), ' ',
        d.version != null ? ui.button('Keep my edits and publish over it', { kind: 'ghost', small: true, onClick: function () { draft.base = d.version; VX.clear(host); VX.toast('Your edits now build on version ' + d.version + ' — press Publish again.', 'ok'); } }) : null), 'warn'));
      return;
    }
    if (d.error === 'invalid' && Array.isArray(d.problems)) {
      VX.mount(host, ui.notice(h('div', h('strong', 'The server refused this version:'), h('ul', d.problems.map(function (p) { return h('li', ui.mono(p.field || ''), ' ', p.problem || ''); }))), 'bad'));
      return;
    }
    VX.toast('Could not publish: ' + res.message, 'bad');
  }

  function rollback(r, version, ctx) {
    var note = ui.textarea({ rows: 2, maxlength: 200, placeholder: 'Why (optional)' });
    return new Promise(function (resolve) {
      VX.modal({
        title: 'Roll back to version ' + r.version + '?',
        body: [h('p', 'Publishes version ' + r.version + '’s weights and rollout (' + rolloutText(r.rollout) + ') again as version ' + (version + 1) + '. Nothing is deleted.'), ui.field('Note', note)],
        onClose: function () { resolve(); },
        actions: [
          { label: 'Cancel', kind: 'ghost' },
          { label: 'Roll back', kind: 'primary', onClick: function (close) {
            var body = { action: 'rollback', toVersion: r.version, expectedVersion: version, by: localName() || 'admin' };
            if (note.value.trim()) body.note = note.value.trim();
            return VX.api.post('/api/admin/recconfig', body).then(function (res) {
              var d = res.data || {};
              if (res.ok && d.ok) { VX.toast('Rolled back — now version ' + (d.record ? d.record.version : ''), 'ok'); close(); ctx.refresh(); return; }
              if (d.error === 'version_conflict') { VX.toast('Someone published in the meantime — reload and try again.', 'bad'); close(); ctx.refresh(); return; }
              if (d.error === 'invalid') { VX.toast('Cannot roll back: ' + (d.problems || []).map(function (p) { return p.field + ' ' + p.problem; }).join('; '), 'bad'); return; }
              VX.toast(d.error === 'version_not_found' ? 'That version is no longer in the history.' : 'Could not roll back: ' + res.message, 'bad');
            });
          } }
        ]
      });
    });
  }

  function openVersion(r, weights) {
    var dr = VX.drawer({ title: 'Version ' + r.version });
    var o = r.overrides || {};
    var def = {};
    weights.forEach(function (w) { def[w.key] = w.default; });
    VX.mount(dr.body,
      ui.dl([
        ['Rollout', rolloutText(r.rollout)],
        ['Published', fmt.dateTime(r.updatedAt) + ' by ' + (r.updatedBy || 'admin')],
        ['Note', r.note || '—'],
        ['Evaluation', r.evaluation ? r.evaluation.summary || '—' : 'None attached']
      ]),
      h('h3', 'Overrides'),
      Object.keys(o).length ? h('ul.list', Object.keys(o).map(function (k) { return h('li', ui.mono(k), h('span.grow', w4(def[k]) + ' → ' + w4(o[k]))); })) : h('p.muted', 'No overrides — the built-in weights.'));
  }

  function copy(text) {
    var done = function () { VX.toast('Copied', 'ok'); };
    try { return navigator.clipboard.writeText(text).then(done, function () { VX.toast('Copy failed — select the text instead.', 'bad'); }); } catch (e) { VX.toast('Copy failed — select the text instead.', 'bad'); return Promise.resolve(); }
  }
  function localName() { try { return localStorage.getItem('vinax_admin_name') || ''; } catch (e) { return ''; } }
  function saveName(n) { try { localStorage.setItem('vinax_admin_name', n); } catch (e) {} }

  /* ------------------------------------------------------- Experiments */

  function renderExperiments(host, ctx) {
    var body = h('div.page-body');
    host.appendChild(body);
    return ui.load(body, function () { return VX.api.get('/api/admin/experiments', null, { fresh: true }); }, function (d) {
      if (d.configured === false) return ui.empty('Experiments are not available', 'The database is not connected or the experiments table is missing. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY and run frontend/supabase/vinax-13.sql.');
      var list = (d.experiments || []).filter(isObj);
      var running = list.filter(function (e) { return e.active; }).length;
      var unavailable = Array.isArray(d.unavailable) && d.unavailable.indexOf('metrics') >= 0;
      return [
        ui.kpis([
          { label: 'Experiments', value: fmt.num(list.length) },
          { label: 'Running', value: fmt.num(running) },
          { label: 'Paused', value: fmt.num(list.length - running) },
          { label: 'Events compared', value: d.sampledEvents == null ? '—' : fmt.num(d.sampledEvents), sub: 'plays, completes and skips · 14 days' }
        ]),
        unavailable ? ui.notice('Per-variant numbers are unavailable right now (the events could not be read).', 'warn') : null,
        ui.card({
          title: 'Experiments', sub: 'Click one for its per-variant numbers', pad: false,
          actions: [ui.button('New experiment', { kind: 'primary', small: true, icon: 'plus', onClick: function () { editExperiment(null, list, ctx); } })],
          body: ui.table({
            rows: list, exportName: 'vinax-experiments', sortKey: 'created_at', sortDir: 'desc',
            empty: 'No experiments yet', emptyHint: 'Create one to split devices into variants, then target a variant from Tuning and compare them in Quality.',
            onRow: function (e) { openExperiment(e, list, ctx); },
            columns: [
              { key: 'key', label: 'Experiment', render: function (e) { return h('div', h('div.cell-main', e.name || e.key), e.name ? h('div.cell-sub', e.key) : null); } },
              { key: 'active', label: 'Status', sortVal: function (e) { return e.active ? 1 : 0; }, render: function (e) { return ui.pill(e.active ? 'Running' : 'Paused', e.active ? 'ok' : null); } },
              { key: 'variants', label: 'Variants', sortVal: function (e) { return (e.variants || []).length; }, render: function (e) { return variantText(e.variants); }, csv: function (e) { return variantText(e.variants); } },
              { key: 'devices', label: 'Devices', align: 'right', sortVal: function (e) { return sumDevices(e); }, render: function (e) { return e.metrics ? fmt.num(sumDevices(e)) : null; } },
              { key: 'created_at', label: 'Created', nowrap: true, render: function (e) { return fmt.date(e.created_at); } },
              { key: 'act', label: '', sort: false, render: function (e) {
                return h('div.actions',
                  ui.button(e.active ? 'Pause' : 'Start', { kind: 'ghost', small: true, ariaLabel: (e.active ? 'Pause ' : 'Start ') + e.key, onClick: function () { return toggle(e, ctx); } }),
                  ui.button('', { kind: 'ghost', small: true, icon: 'edit', ariaLabel: 'Edit ' + e.key, onClick: function () { editExperiment(e, list, ctx); } }),
                  ui.button('', { kind: 'ghost', small: true, icon: 'trash', ariaLabel: 'Delete ' + e.key, onClick: function () { return remove(e, ctx); } }));
              } }
            ]
          })
        }),
        ui.notice('Each device lands in the same variant every time (from its id). Variant shares can add up to less than 100% — the rest of the devices are not in the experiment.', 'info')
      ];
    }, { skeleton: 6 });
  }

  function variantText(vs) { return (vs || []).map(function (v) { return v.name + ' ' + fmt.num(v.pct) + '%'; }).join(' · ') || '—'; }
  function sumDevices(e) { return (e.metrics || []).reduce(function (a, m) { return a + (Number(m.devices) || 0); }, 0); }

  function toggle(e, ctx) {
    var to = !e.active;
    return VX.api.post('/api/admin/experiments', { action: 'toggle', key: e.key, active: to }).then(function (res) {
      if (!res.ok) { VX.toast('Could not ' + (to ? 'start' : 'pause') + ' ' + e.key + ': ' + res.message, 'bad'); return; }
      VX.toast(to ? 'Started ' + e.key : 'Paused ' + e.key, 'ok');
      ctx.refresh();
    });
  }

  function remove(e, ctx) {
    return VX.confirm({ title: 'Delete experiment ' + e.key + '?', body: 'Devices stop being split for it. A Tuning rollout that targets it stops reaching anyone. This cannot be undone.', danger: true, typed: e.key, confirmLabel: 'Delete' }).then(function (yes) {
      if (!yes) return null;
      return VX.api.post('/api/admin/experiments', { action: 'delete', key: e.key }).then(function (res) {
        if (!res.ok) { VX.toast('Could not delete ' + e.key + ': ' + res.message, 'bad'); return; }
        VX.toast('Deleted ' + e.key, 'ok');
        ctx.refresh();
      });
    });
  }

  function openExperiment(e, list, ctx) {
    var dr = VX.drawer({ title: e.name || e.key });
    VX.mount(dr.body,
      ui.dl([
        ['Key', ui.mono(e.key)],
        ['Status', ui.pill(e.active ? 'Running' : 'Paused', e.active ? 'ok' : null)],
        ['Created', fmt.dateTime(e.created_at)],
        ['Variants', variantText(e.variants)]
      ]),
      h('h3', 'Last 14 days by variant'),
      e.metrics ? ui.table({
        rows: e.metrics, exportName: 'vinax-experiment-' + e.key, search: false,
        empty: 'No devices yet', emptyHint: 'Numbers appear once devices in this experiment play songs.',
        columns: [
          { key: 'variant', label: 'Variant' },
          { key: 'pct', label: 'Share', align: 'right', render: function (m) { return fmt.pct(m.pct); } },
          { key: 'devices', label: 'Devices', align: 'right', render: function (m) { return fmt.num(m.devices); } },
          { key: 'playsPerDevice', label: 'Plays / device', align: 'right', render: function (m) { return fmt.num(m.playsPerDevice); } },
          { key: 'skipRatePct', label: 'Skip rate', align: 'right', render: function (m) { return m.skipRatePct == null ? null : fmt.pct(m.skipRatePct); } }
        ]
      }) : ui.notice('Per-variant numbers are unavailable right now.', 'warn'),
      h('p.muted.small', 'Devices are counted from every play, complete and skip in the last 14 days, including while the experiment is paused. For recommendation quality per variant, see the Quality tab.'),
      h('div.actions',
        ui.button('Quality by variant', { kind: 'ghost', small: true, onClick: function () { dr.close(); ctx.go('recs', 'quality'); } }),
        ui.button('Edit', { kind: 'ghost', small: true, icon: 'edit', onClick: function () { dr.close(); editExperiment(e, list, ctx); } })));
  }

  function editExperiment(e, list, ctx) {
    var isNew = !e;
    var key = ui.input({ maxlength: 40, placeholder: 'e.g. novelty-boost', value: e ? e.key : '', readOnly: !isNew, pattern: '[a-z0-9-]+' });
    var name = ui.input({ maxlength: 80, placeholder: 'What it tests', value: e && e.name ? e.name : '' });
    var active = ui.toggle('Running — devices are split as soon as it is saved', e ? e.active : false);
    var vars = (e && e.variants && e.variants.length ? e.variants : [{ name: 'control', pct: 50 }, { name: 'treatment', pct: 50 }]).map(function (v) { return { name: v.name, pct: String(v.pct) }; });
    var varHost = h('div.editor-list');
    var totalEl = h('p.field-hint');
    var errHost = h('div');
    function drawVars() {
      VX.mount(varHost, vars.map(function (v, i) {
        var n = ui.input({ maxlength: 24, value: v.name, 'aria-label': 'Variant ' + (i + 1) + ' name' });
        var p = ui.input({ type: 'number', min: 1, max: 100, step: 1, value: v.pct, 'aria-label': 'Variant ' + (i + 1) + ' share in percent', style: { width: '90px' } });
        n.addEventListener('input', function () { v.name = n.value; });
        p.addEventListener('input', function () { v.pct = p.value; total(); });
        v._els = [n, p];
        return h('div.editor-row', h('div.form-row', { style: { 'align-items': 'start' } }, ui.field('Variant name', n), ui.field('Share %', p)),
          ui.button('', { kind: 'ghost', small: true, icon: 'trash', ariaLabel: 'Remove variant ' + (i + 1), disabled: vars.length <= 2, onClick: function () { vars.splice(i, 1); drawVars(); } }));
      }));
      addBtn.disabled = vars.length >= 6;
      total();
    }
    function total() {
      var t = vars.reduce(function (a, v) { return a + (Math.floor(Number(v.pct)) || 0); }, 0);
      totalEl.textContent = 'Total ' + t + '% of devices' + (t < 100 ? ' — the other ' + (100 - t) + '% are not in the experiment' : t > 100 ? ' — must be 100% or less' : '');
      totalEl.style.color = t > 100 ? 'var(--bad)' : '';
    }
    var addBtn = ui.button('Add a variant', { kind: 'ghost', small: true, icon: 'plus', onClick: function () { vars.push({ name: 'variant-' + (vars.length + 1), pct: '0' }); drawVars(); } });
    drawVars();
    function save(close) {
      var k = key.value.trim().toLowerCase();
      var bad = false;
      key.classList.toggle('invalid', !/^[a-z0-9-]{1,40}$/.test(k));
      if (!/^[a-z0-9-]{1,40}$/.test(k)) bad = true;
      var seen = {};
      var clean = vars.map(function (v) {
        var nm = v.name.trim().slice(0, 24), pc = Math.floor(Number(v.pct));
        var okV = nm && !seen[nm] && pc >= 1 && pc <= 100;
        v._els[0].classList.toggle('invalid', !nm || !!seen[nm]);
        v._els[1].classList.toggle('invalid', !(pc >= 1 && pc <= 100));
        if (!okV) bad = true;
        seen[nm] = true;
        return { name: nm, pct: pc };
      });
      var sum = clean.reduce(function (a, v) { return a + (v.pct || 0); }, 0);
      if (bad || clean.length < 2 || sum > 100) {
        VX.mount(errHost, ui.notice(!/^[a-z0-9-]{1,40}$/.test(k) ? 'The key may use only lowercase letters, digits and dashes (up to 40).' : sum > 100 ? 'The variant shares add up to more than 100%.' : 'Each variant needs a unique name and a share of 1–100%. At least two variants.', 'bad'));
        return Promise.resolve();
      }
      var replacing = isNew && list.some(function (x) { return x.key === k; });
      var go = replacing ? VX.confirm({ title: 'Replace experiment ' + k + '?', body: 'An experiment with this key exists. Saving replaces its name, variants and status.', danger: true, confirmLabel: 'Replace' }) : Promise.resolve(true);
      return go.then(function (yes) {
        if (!yes) return null;
        var body = { action: 'save', key: k, name: name.value.trim() || null, variants: clean, active: !!active.input.checked };
        if (body.name == null) delete body.name;
        return VX.api.post('/api/admin/experiments', body).then(function (res) {
          if (!res.ok) { VX.mount(errHost, ui.notice(res.error === 'need_two_variants' ? 'The server needs at least two valid variants.' : 'Could not save: ' + res.message, 'bad')); return; }
          VX.toast(isNew ? 'Created ' + k : 'Saved ' + k, 'ok');
          close();
          ctx.refresh();
        });
      });
    }
    VX.modal({
      title: isNew ? 'New experiment' : 'Edit ' + e.key, wide: true,
      body: h('div.form', { style: { 'max-width': 'none' } },
        h('div.form-row', { style: { 'align-items': 'start' } }, ui.field('Key', key, isNew ? 'Lowercase letters, digits and dashes. Cannot be changed later.' : 'The key cannot be changed.'), ui.field('Name', name)),
        h('div.field', h('span.field-label', 'Variants'), varHost, h('div.actions', addBtn), totalEl),
        active,
        !isNew && e.active ? ui.notice('Changing the shares of a running experiment moves some devices to another variant.', 'warn') : null,
        errHost),
      actions: [
        { label: 'Cancel', kind: 'ghost' },
        { label: isNew ? 'Create' : 'Save', kind: 'primary', onClick: function (close) { return save(close); } }
      ]
    });
  }
})();
