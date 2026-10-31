/* VinaX console — Health page.
 * Is everything working? App errors, the public endpoints and
 * shell assets (/api/admin/edge), the music catalogue sources
 * (/api/admin/musicapi, on a button press), VinaX AI's providers
 * (/api/admin/ai; probes on a button press), the personal engine
 * (/api/admin/personal; jobs on a button press), releases and CI (/api/admin/releases) and
 * the server secrets checklist (/api/admin/envcheck). (13.9.1 — app errors,
 * scheduled-job footprints, data quality and the status note went with the
 * database.) */
(function () {
  'use strict';
  var VX = window.VX, h = VX.h, ui = VX.ui, fmt = VX.fmt, arr = VX.arr;

  VX.page({
    id: 'health', title: 'Health', group: 'System', icon: 'pulse', noAuto: true,
    desc: 'Is everything working: app errors, endpoints, catalogue sources, VinaX AI, releases and server secrets.',
    tabs: [
      { id: 'errors', label: 'App errors', desc: 'Errors the app reported from listeners’ devices, grouped by kind and message.', render: renderErrors },
      { id: 'edge', label: 'Endpoints', desc: 'The live web app shell, its scripts and styles, and every public endpoint, checked from the server.', render: renderEdge },
      { id: 'sources', label: 'Catalogue sources', desc: 'Where song search and playback data come from: each source checked with a one-song search.', render: renderSources },
      { id: 'ai', label: 'VinaX AI', desc: 'VinaX AI’s providers: which keys are set, what is resting and why, and a probe of each model.', render: renderAi },
      { id: 'personal', label: 'Personal engine', desc: 'The account-side recommendation engine: accounts with a taste model, events, the song pool and its embedding backlog, the pages it composed, and the jobs you can run now.', render: renderPersonal },
      { id: 'releases', label: 'Releases', desc: 'The newest Android release, recent build runs and commits on main.', render: renderReleases },
      { id: 'env', label: 'Server secrets', desc: 'Which secrets and settings the Worker has. Names only — values are never shown.', render: renderEnv }
    ]
  });

  /* ------------------------------------------------------------ helpers */

  function extLink(url, text) {
    return /^https:\/\//i.test(String(url || '')) ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, text) : text;
  }
  function agoCell(iso) { return iso ? h('span', { title: fmt.dateTime(iso) }, fmt.ago(iso)) : h('span.muted', '—'); }

  /* --------------------------------------------------- Catalogue sources */

  // 14.0.4 — the upstream list lives in the Worker secret CATALOG_UPSTREAMS;
  // the server labels each by its host, so only the two fixed rows are named here.
  var SOURCE_LABEL = {
    'vinax-cat': 'VinaX catalogue (this Worker)',
    'direct': 'Direct (JioSaavn web API)'
  };

  function renderSources(host) {
    var sources = h('div');
    VX.mount(sources, ui.empty('Not checked yet', 'Checks each catalogue source with a one-song search (takes up to 10 seconds).'));
    function checkSources() {
      return ui.load(sources, function () { return VX.api.get('/api/admin/musicapi', null, { fresh: true, timeout: 30000 }); }, function (d) {
        var rows = (d.mirrors || []).map(function (m, i) {
          var state = !m.ok ? 'down' : Number(m.songs) > 0 ? 'ok' : 'empty';
          return { label: SOURCE_LABEL[m.id] || m.label || 'Source ' + (i + 1), state: state, songs: m.songs, ms: m.ms, status: m.status, note: m.note, health: m.health || null };
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
              // 1.3 — the wrapper's own /health: each upstream it depends on, as it sees them.
              { key: 'health', label: 'Wrapper health', render: function (r) {
                var hl = r.health;
                if (!hl || !arr(hl.upstreams).length) return '—';
                return h('span', arr(hl.upstreams).map(function (u) {
                  var text = u.name + (u.latencyMs != null ? ' ' + fmt.ms(u.latencyMs) : '');
                  return ui.pill(text, !u.configured ? 'warn' : u.ok ? 'ok' : 'bad');
                }));
              } },
              { key: 'note', label: 'Note' }
            ]
          })
        ];
      });
    }
    host.appendChild(ui.card({
      title: 'Music catalogue sources', sub: 'Where song search and playback data come from',
      actions: [ui.button('Check sources', { kind: 'primary', small: true, icon: 'refresh', onClick: checkSources })],
      body: sources
    }));
    return Promise.resolve();
  }

  /* ---------------------------------------------------- Personal engine */

  // V2 1.4 — /api/admin/personal: the engine's health in one answer, and two
  // jobs on a button press (embed the backlog, rebuild co-listening).
  function renderPersonal(host) {
    var body = h('div.page-body');
    var busy = h('span.muted');
    function run(action, label) {
      busy.textContent = label + '…';
      return VX.api.post('/api/admin/personal', { action: action }, { timeout: 90000 }).then(function (res) {
        busy.textContent = '';
        if (!res.ok) { VX.toast(res.message || 'Failed', 'bad'); return; }
        var d = VX.obj(res.data);
        VX.toast(action === 'embed' ? 'Embedded ' + fmt.num(d.embedded) + ' songs · backlog ' + fmt.num(d.backlog) : 'Co-listening rebuilt · ' + fmt.plural(d.pairs, 'pair'), 'ok');
        return load();
      });
    }
    host.appendChild(h('div.toolbar',
      ui.button('Refresh', { icon: 'refresh', onClick: function () { return load(); } }),
      ui.button('Embed backlog now', { small: true, onClick: function () { return run('embed', 'Embedding'); } }),
      ui.button('Rebuild co-listening', { small: true, onClick: function () { return run('colisten', 'Rebuilding'); } }),
      busy));
    host.appendChild(body);
    function load() {
      return ui.load(body, function () { return VX.api.get('/api/admin/personal', null, { fresh: true }); }, function (d) {
        var st = VX.obj(d.stats), cfg = VX.obj(d.config), embed = VX.obj(d.embed), composer = VX.obj(d.composer);
        var num = function (v) { return v == null ? '—' : fmt.num(v); };
        var models = VX.obj(st.models);
        var model = embed.model || 'the configured model';
        var state = cfg.enabled === false ? ui.notice('The personal engine is switched off (personal-config.enabled).', 'warn')
          : !embed.configured ? ui.notice('The engine is on, but nothing can embed: ' + model + ' has no provider on this Worker. Pages still build from co-listening, the catalogue and affinities.', 'warn')
          : ui.notice('The personal engine is on. Embedding with ' + model + '.' + (composer.enabled ? ' The composer runs on ' + fmt.plural(arr(composer.candidates).length, 'model') + '.' : ' The composer is off: pages are deterministic.'), 'ok');
        return [
          state,
          ui.kpis([
            { label: 'Accounts with a model', value: num(st.accounts), sub: num(st.accountsWithVector) + ' with a vector' },
            { label: 'Events today', value: num(st.eventsDay), sub: num(st.eventsWeek) + ' this week' },
            { label: 'Songs known', value: num(st.songs), sub: num(st.songsEmbedded) + ' embedded' },
            { label: 'Embedding backlog', value: num(st.backlog), tone: Number(st.backlog) > 1000 ? 'warn' : undefined },
            { label: 'Pages today', value: num(st.pagesDay), sub: num(st.pagesComposedDay) + ' composed by the model · ' + num(st.playlistsDay) + ' playlists' },
            { label: 'Co-listening pairs', value: fmt.compact(st.colistenPairs || 0), sub: st.colistenUpdatedAt ? 'rebuilt ' + fmt.ago(st.colistenUpdatedAt) : 'never rebuilt' }
          ]),
          ui.card({
            title: 'Embedding spaces', sub: 'Rows per embedding model; a page only compares vectors of the configured one',
            body: ui.table({ rows: Object.keys(models).map(function (k) { return { model: k, rows: models[k] }; }), search: false, exportName: false, dense: true, empty: 'Nothing embedded yet',
              columns: [{ key: 'model', label: 'Model' }, { key: 'rows', label: 'Songs', align: 'right', render: function (r) { return fmt.num(r.rows); } }] })
          }),
          ui.card({
            title: 'Weights', sub: 'personal-config.weights, after clamping (0.5–2× the defaults)',
            body: ui.table({ rows: Object.keys(VX.obj(cfg.weights)).map(function (k) { return { key: k, value: cfg.weights[k] }; }), search: false, exportName: false, dense: true,
              columns: [{ key: 'key', label: 'Term' }, { key: 'value', label: 'Weight', align: 'right', render: function (r) { return r.value == null ? '—' : String(r.value); } }] })
          })
        ];
      });
    }
    return load();
  }

  /* ----------------------------------------------------------- VinaX AI */

  var REST_REASON = {
    rate: 'Rate limited', quota: 'Daily allowance spent', gone: 'Model not found', auth: 'Key refused',
    forbidden: 'Not allowed for this key', upstream: 'Provider error', timeout: 'Too slow', network: 'Unreachable',
    empty: 'Empty answer', bad_request: 'Request refused', not_configured: 'No key'
  };
  function reason(kind) { return REST_REASON[kind] || kind || '—'; }
  function untilCell(iso) { return iso ? h('span', { title: fmt.dateTime(iso) }, 'until ' + fmt.time(iso)) : null; }

  function renderAi(host) {
    var obj = VX.obj;
    var body = h('div.page-body');
    host.appendChild(h('div.toolbar', ui.button('Refresh', { icon: 'refresh', onClick: function () { return load(); } }),
      ui.muted('Rests and last errors are what this server instance has seen since it started; other instances keep their own.')));
    host.appendChild(body);
    function load() {
      return ui.load(body, function () { return VX.api.get('/api/admin/ai', null, { fresh: true }); }, function (d) {
        var st = d.settings || {};
        var providers = arr(d.providers), models = arr(d.models);
        var search = d.search || {}, voice = d.voice || {};
        var keyed = providers.filter(function (p) { return p.configured; }).length;
        var resting = models.filter(function (m) { return m.restingUntil; }).length;
        var testers = arr(st.testers).length;
        var state = st.enabled ? ui.notice('VinaX AI is on for every signed-in listener.', 'ok')
          : ui.notice(testers ? 'VinaX AI is off for listeners; ' + fmt.plural(testers, 'tester') + ' can use it.' : 'VinaX AI is switched off.', 'warn');
        var probeCells = {};
        var probeable = models.filter(function (m) { return m.configured && m.ownerEnabled; });
        var progress = h('span.muted');
        function probeOne(m) {
          var cell = probeCells[m.id];
          VX.mount(cell, ui.muted('Probing…'));
          return VX.api.post('/api/admin/ai', { model: m.id }, { timeout: 45000 }).then(function (res) {
            var r = obj(res.data);
            if (!res.ok) return VX.mount(cell, ui.pill(res.message || 'Failed', 'bad'));
            VX.mount(cell, r.ok ? ui.pill('OK · ' + fmt.ms(r.firstTokenMs), 'ok') : h('span', ui.pill(reason(r.kind), 'bad'), r.status ? ui.muted(' HTTP ' + r.status) : null));
          });
        }
        function probeAll() {
          var i = 0;
          function next() {
            if (i >= probeable.length) { progress.textContent = 'Probed ' + fmt.plural(probeable.length, 'model') + ' · ' + fmt.time(new Date().toISOString()); return Promise.resolve(); }
            var m = probeable[i];
            i += 1;
            progress.textContent = 'Probing ' + i + ' of ' + probeable.length + '…';
            return probeOne(m).then(next);
          }
          return next();
        }
        var num = function (v) { return v == null ? '—' : fmt.num(v); };
        return [
          state,
          ui.kpis([
            { label: 'Providers with a key', value: keyed + ' / ' + providers.length, tone: keyed ? null : 'bad' },
            { label: 'Models resting', value: fmt.num(resting), sub: 'of ' + fmt.num(models.length), tone: resting ? 'warn' : 'ok' },
            { label: 'Free grounded searches today', value: num(obj(search.grounding).usedToday), sub: 'of ' + fmt.num(obj(search.grounding).dailyLimit) + (obj(search.grounding).configured ? '' : ' · no Gemini key') },
            { label: 'Search API calls today', value: num(obj(search.api).usedToday), sub: obj(search.api).configured ? 'of ' + fmt.num(obj(search.api).dailyLimit) + ' · ' + obj(search.api).provider : 'not set up' }
          ]),
          ui.card({ title: 'Providers', sub: 'Keys are shown as set or missing, never their values', pad: false, body: ui.table({
            rows: providers, exportName: false, search: false, dense: true,
            columns: [
              { key: 'name', label: 'Provider' },
              { key: 'configured', label: 'Key', render: function (p) { return p.configured ? ui.pill('Set', 'ok') : ui.pill('Missing', 'warn'); } },
              { key: 'restingUntil', label: 'Whole provider resting', render: function (p) { return untilCell(p.restingUntil) || '—'; } },
              { key: 'lastError', label: 'Last error', sort: false, render: function (p) {
                var e = p.lastError;
                return e ? h('span', reason(e.kind), e.status ? ui.muted(' · HTTP ' + e.status) : null, ui.muted(' · ' + fmt.ago(e.at))) : '—';
              } }
            ]
          }) }),
          ui.card({ title: 'Models', sub: 'Probe sends each enabled model one tiny request, one model at a time. It uses a little of each provider’s free allowance, so it only runs when you press it.',
            actions: [progress, ui.button('Probe enabled models', { kind: 'primary', small: true, icon: 'refresh', disabled: !probeable.length, onClick: probeAll })],
            pad: false,
            body: ui.table({
              rows: models, exportName: 'vinax-ai-models', search: models.length > 12, dense: true,
              columns: [
                { key: 'name', label: 'Model', render: function (m) { return h('span', m.name, h('br'), ui.mono(m.id)); } },
                { key: 'provider', label: 'Provider' },
                { key: 'group', label: 'Picker', render: function (m) { return m.group ? m.group : ui.muted('Auto only'); } },
                { key: 'ownerEnabled', label: 'Switch', render: function (m) { return m.ownerEnabled ? ui.pill('On', 'ok') : ui.pill('Off'); } },
                { key: 'restingUntil', label: 'State', render: function (m) {
                  if (!m.configured) return ui.muted('No key');
                  if (m.restingUntil) return h('span', ui.pill(reason(m.restKind), 'warn'), ' ', untilCell(m.restingUntil));
                  return ui.pill('Ready', 'ok');
                } },
                { key: 'probe', label: 'Probe', sort: false, render: function (m) {
                  var cell = h('span', m.configured ? ui.button('Probe', { small: true, ariaLabel: 'Probe ' + m.name, onClick: function () { return probeOne(m); } }) : ui.muted('—'));
                  probeCells[m.id] = cell;
                  return cell;
                } }
              ]
            }) }),
          ui.card({ title: 'Voice', sub: 'Dictation, Read aloud and Live voice', body: h('div.stack',
            ui.dl([
              ['Dictation', voice.dictation ? ui.pill('Available', 'ok') : ui.pill('Needs a Groq or Gemini key', 'warn')],
              ['Read aloud', voice.readAloud ? ui.pill('Available', 'ok') : ui.pill('Needs a Groq or Gemini key', 'warn')],
              ['Live voice', voice.live ? ui.pill('Available', 'ok') : ui.pill('Needs a Gemini key', 'warn')],
              ['Voice models resting', arr(voice.resting).length ? h('span', arr(voice.resting).map(function (r) { return h('span', ui.mono(r.model), ' ', untilCell(r.until), h('br')); })) : '—']
            ])) }),
          arr(d.utility).length ? ui.card({ title: 'Utility models', sub: 'Known to VinaX AI but not chat models (guards, embeddings, document parsers, AQA), so never in the picker or Auto.', pad: false,
            body: ui.table({
              rows: arr(d.utility), exportName: 'vinax-ai-utility-models', dense: true,
              columns: [
                { key: 'name', label: 'Model', render: function (m) { return h('span', m.name, h('br'), ui.mono(m.id)); } },
                { key: 'provider', label: 'Provider' },
                { key: 'kind', label: 'Kind', render: function (m) { return ({ guard: 'Safety guard', embedding: 'Embedding', parse: 'Document parser', aqa: 'Answers from text' })[m.kind] || m.kind; } },
                { key: 'configured', label: 'Key', render: function (m) { return m.configured ? ui.pill('Set', 'ok') : ui.muted('No key'); } }
              ]
            }) }) : null,
          ui.muted('Switch VinaX AI on or off, choose testers and turn models off in Publish → App → VinaX AI. Run npm run ai:probe locally for the full model and voice table.')
        ];
      }, { skeleton: 6 });
    }
    return load();
  }

  /* --------------------------------------------------------- App errors */

  function renderErrors(host, ctx) {
    var arr = VX.arr, obj = VX.obj, num = VX.num;
    var days = num(ctx.params.days) || 7;
    host.appendChild(h('div.toolbar', ui.daysPicker(days, function (v) { ctx.setParam('days', v); ctx.refresh(); })));
    var body = h('div.page-body');
    host.appendChild(body);
    function load() {
      return ui.load(body, function () { return VX.api.get('/api/admin/analytics', { view: 'errors', days: days }, { fresh: true }); }, function (d) {
        var gate = ui.gate(d, ctx);
        if (gate) return gate;
        var e = obj(d.data);
        var byDay = arr(e.byDay), top = arr(e.top);
        function clear() {
          return VX.confirm({ title: 'Clear every reported error?', body: 'Error events are deleted from the database; plays and other events stay.', danger: true, typed: 'CLEAR', confirmLabel: 'Clear errors' }).then(function (yes) {
            if (!yes) return;
            return VX.api.post('/api/admin/analytics', { action: 'clear_errors' }).then(function (res) { VX.toast(res.ok ? fmt.plural(obj(res.data).deleted, 'error') + ' cleared' : res.message, res.ok ? 'ok' : 'bad'); if (res.ok) return load(); });
          });
        }
        return [
          ui.kpis([
            { label: 'Errors', value: fmt.compact(e.total), sub: 'last ' + fmt.plural(days, 'day'), tone: num(e.total) ? 'warn' : 'ok' },
            { label: 'Distinct', value: fmt.num(top.length), sub: 'kind + message' }
          ]),
          ui.card({ title: 'Errors by day', body: ui.chart({ labels: byDay.map(function (r) { return r.day; }), series: [{ name: 'Errors', values: byDay.map(function (r) { return num(r.hits); }), color: 'var(--c5)' }], type: 'bar', height: 180 }) }),
          ui.card({ title: 'Most frequent', pad: false,
            actions: top.length ? [ui.button('Clear errors', { kind: 'danger', small: true, icon: 'trash', onClick: clear })] : null,
            body: ui.table({
              columns: [
                { key: 'errorKind', label: 'Kind', render: function (r) { return ui.mono(r.errorKind || 'error'); } },
                { key: 'message', label: 'Message', render: function (r) { return h('span', { title: r.message }, fmt.trunc(r.message || '—', 140)); } },
                { key: 'hits', label: 'Hits', align: 'right', render: function (r) { return fmt.num(r.hits); } },
                { key: 'platforms', label: 'Platforms', sort: false, render: function (r) { return arr(r.platforms).join(', ') || null; } },
                { key: 'versions', label: 'Versions', sort: false, render: function (r) { return arr(r.versions).slice(0, 4).join(', ') || null; } },
                { key: 'lastSeen', label: 'Last seen', render: function (r) { return agoCell(r.lastSeen); } }
              ],
              rows: top, exportName: 'vinax-errors', search: top.length > 8, sortKey: 'hits', sortDir: 'desc',
              empty: 'No errors reported', emptyHint: 'The app reports errors from listeners with usage sharing on (the default).'
            }) })
        ];
      }, { skeleton: 5 });
    }
    return load();
  }

  /* ---------------------------------------------------------- Endpoints */

  function renderEdge(host, ctx) {
    var body = h('div.page-body');
    host.appendChild(h('div.toolbar', ui.button('Check again', { kind: 'primary', icon: 'refresh', onClick: function () { return load(); } }), ui.muted('About 25 requests to the live site · allowed a few times a minute')));
    host.appendChild(body);
    function load() {
      return ui.load(body, function () { return VX.api.get('/api/admin/edge', null, { fresh: true, timeout: 40000 }); }, function (d) {
        var shell = d.shell || {};
        var assets = d.assets || [];
        var eps = d.endpoints || [];
        var badAssets = assets.filter(function (a) { return !a.ok; }).length;
        var badEps = eps.filter(function (e) { return !e.ok; }).length;
        return [
          d.healthy ? ui.notice('All good — the app shell, its ' + fmt.plural(assets.length, 'file') + ' and ' + fmt.plural(eps.length, 'endpoint') + ' answered as expected.', 'ok')
            : ui.notice(fmt.plural(d.problems, 'problem') + ' found on ' + (d.origin || 'the live site') + '. Failing rows are listed first.', 'bad'),
          ui.kpis([
            { label: 'App shell', value: shell.ok ? 'OK' : shell.status ? 'HTTP ' + shell.status : 'No answer', sub: fmt.ms(shell.ms), tone: shell.ok ? 'ok' : 'bad' },
            { label: 'Build', value: shell.build || '—', sub: shell.cacheStatus ? 'cache ' + String(shell.cacheStatus).toLowerCase() : 'cache status unknown' },
            { label: 'Scripts & styles', value: fmt.num(assets.length - badAssets) + ' / ' + fmt.num(assets.length), sub: 'served correctly', tone: badAssets ? 'bad' : null },
            { label: 'Endpoints', value: fmt.num(eps.length - badEps) + ' / ' + fmt.num(eps.length), sub: 'answered as expected', tone: badEps ? 'bad' : null },
            { label: 'Checked', value: d.checkedAt ? fmt.time(d.checkedAt) : '—', sub: d.origin || null }
          ]),
          shell.error ? ui.notice('Shell: ' + shell.error, 'bad') : null,
          ui.grid([
            ui.card({ title: 'Public endpoints', sub: 'What the app calls on every visit', pad: false, body: ui.table({
              columns: [
                { key: 'ok', label: 'Result', sortVal: function (r) { return r.ok ? 1 : 0; }, render: function (r) { return r.ok ? ui.pill('OK', 'ok') : ui.pill('Failing', 'bad'); } },
                { key: 'name', label: 'Endpoint', render: function (r) { return h('div', h('div.cell-main', r.name || '—'), h('div.cell-sub', (r.method || 'GET') + ' ' + (r.path || ''))); } },
                { key: 'status', label: 'HTTP', align: 'right', render: function (r) { return r.status ? String(r.status) : 'none'; } },
                { key: 'ms', label: 'Time', align: 'right', render: function (r) { return fmt.ms(r.ms); } },
                { key: 'note', label: 'Note', render: function (r) { return r.note ? fmt.trunc(r.note, 60) : null; } }
              ],
              rows: eps.slice().sort(function (a, b) { return (a.ok ? 1 : 0) - (b.ok ? 1 : 0); }), exportName: 'vinax-endpoints', search: false,
              empty: 'No endpoints checked'
            }) }),
            ui.card({ title: 'Shell scripts and styles', sub: 'Each must be served as real JavaScript or CSS, not a web page', pad: false, body: ui.table({
              columns: [
                { key: 'ok', label: 'Result', sortVal: function (r) { return r.ok ? 1 : 0; }, render: function (r) { return r.ok ? ui.pill('OK', 'ok') : ui.pill('Broken', 'bad'); } },
                { key: 'path', label: 'File', render: function (r) { return h('div', h('div.cell-main', { title: r.path }, fmt.trunc(r.path, 48)), h('div.cell-sub', [r.kind || '—', r.contentType || 'no type', r.note].filter(Boolean).join(' · '))); } },
                { key: 'status', label: 'HTTP', align: 'right', render: function (r) { return r.status ? String(r.status) : 'none'; } },
                { key: 'ms', label: 'Time', align: 'right', render: function (r) { return fmt.ms(r.ms); } }
              ],
              rows: assets.slice().sort(function (a, b) { return (a.ok ? 1 : 0) - (b.ok ? 1 : 0); }), exportName: 'vinax-shell-assets', search: false,
              empty: 'No scripts or styles found', emptyHint: shell.ok ? 'The shell referenced no same-site files.' : 'The shell did not load, so its files could not be checked.'
            }) })
          ])
        ];
      }, { skeleton: 6 });
    }
    return load();
  }


  /* ------------------------------------------------------------ Releases */

  function runTone(r) {
    if (r.status && r.status !== 'completed') return { tone: 'info', label: r.status === 'in_progress' ? 'Running' : 'Queued' };
    if (r.conclusion === 'success') return { tone: 'ok', label: 'Passed' };
    if (r.conclusion === 'failure' || r.conclusion === 'timed_out') return { tone: 'bad', label: r.conclusion === 'failure' ? 'Failed' : 'Timed out' };
    if (r.conclusion === 'cancelled' || r.conclusion === 'skipped') return { tone: null, label: r.conclusion === 'cancelled' ? 'Cancelled' : 'Skipped' };
    return { tone: 'warn', label: r.conclusion ? String(r.conclusion).replace(/_/g, ' ') : 'Unknown' };
  }

  function renderReleases(host, ctx) {
    return ui.load(host, function () { return VX.api.get('/api/admin/releases', null, { timeout: 30000 }); }, function (d) {
      if (d.configured === false) {
        return ui.card({ title: 'GITHUB_TOKEN not set', tone: 'warn', body: [
          h('p', 'Releases, build runs and commits are read from the code repository with a server-side token. The Worker secret GITHUB_TOKEN is not set, so this tab has nothing to show.'),
          h('p.muted', { style: { 'margin-top': '8px' } }, 'Set a read-only token as the Worker secret GITHUB_TOKEN (and GITHUB_REPO if the repository moved). The Android update check also uses it.'),
          h('div.toolbar', { style: { 'margin-top': '12px' } }, ui.button('Open server secrets', { kind: 'ghost', small: true, icon: 'key', onClick: function () { ctx.go('health', 'env'); } }))
        ] });
      }
      var rel = d.release;
      var live = d.live && typeof d.live === 'object' ? d.live : null;
      var runs = d.runs || [];
      var commits = d.commits || [];
      var failing = runs.filter(function (r) { return runTone(r).tone === 'bad'; }).length;
      return [
        d.tokenRejected ? ui.notice('The code repository refused GITHUB_TOKEN — it has expired or was revoked, so runs and commits below are empty. Create a new read-only token and set it as the Worker secret GITHUB_TOKEN.', 'bad') : null,
        ui.kpis([
          { label: 'Newest release', value: rel ? rel.tag || rel.name || '—' : 'None', sub: rel && rel.name && rel.name !== rel.tag ? rel.name : null },
          { label: 'Android build offered', value: live && live.build ? fmt.num(live.build) : '—', sub: live && live.version ? 'version ' + live.version : 'update check unavailable' },
          { label: 'Minimum build', value: live && live.minBuild ? fmt.num(live.minBuild) : 'None', sub: 'older builds must update' },
          { label: 'Failed runs', value: fmt.num(failing), sub: 'of the last ' + fmt.num(runs.length), tone: failing ? 'warn' : null }
        ]),
        ui.grid([
          ui.card({ title: 'Newest release', sub: rel ? rel.tag || '' : null, body: rel ? [
            rel.notes ? h('pre.json', { style: { 'max-height': '220px' } }, rel.notes) : ui.muted('No release notes.'),
            (rel.assets || []).length ? h('ul.list', { style: { 'margin-top': '10px' } }, rel.assets.map(function (a) {
              return h('li', VX.icon('download'), h('span.grow', extLink(a.url, a.name || 'file')));
            })) : null
          ] : ui.empty('No release yet', 'The newest tagged release appears here once one is published.') }),
          ui.card({ title: 'Recent commits on main', sub: 'Newest 10', body: commits.length ? h('ul.list.feed', commits.map(function (c) {
            return h('li',
              h('span.feed-time', c.at ? fmt.ago(c.at) : '—'),
              h('div.grow', h('div.cell-main', extLink(c.url, c.message || '—')), h('div.cell-sub', (c.author || '—') + ' · ', ui.mono(c.sha))));
          })) : ui.empty('No commits returned', 'The repository answered with no commits for main.') })
        ], 2),
        ui.grid([
          ui.card({ title: 'Build and deploy runs', sub: 'Newest 20 workflow runs', span: 'full', pad: false, body: ui.table({
            columns: [
              { key: 'result', label: 'Result', sortVal: function (r) { return runTone(r).label; }, render: function (r) { var t = runTone(r); return t.tone ? ui.pill(t.label, t.tone) : ui.pill(t.label); } },
              { key: 'name', label: 'Workflow', render: function (r) { return h('div', h('div.cell-main', extLink(r.url, r.name || '—')), r.title && r.title !== r.name ? h('div.cell-sub', fmt.trunc(r.title, 80)) : null); } },
              { key: 'branch', label: 'Branch', render: function (r) { return r.branch ? ui.mono(r.branch) : null; } },
              { key: 'sha', label: 'Commit', render: function (r) { return r.sha ? ui.mono(r.sha) : null; } },
              { key: 'event', label: 'Trigger' },
              { key: 'started', label: 'Started', nowrap: true, render: function (r) { return agoCell(r.started); } },
              { key: 'took', label: 'Took', align: 'right', sortVal: function (r) { return dur(r); }, render: function (r) { var s = dur(r); return s == null ? null : fmt.dur(s); } }
            ],
            rows: runs, exportName: 'vinax-runs', search: true,
            empty: 'No workflow runs', emptyHint: 'Runs appear after the next push or scheduled workflow.'
          }) })
        ])
      ];
    }, { skeleton: 6 });
  }
  function dur(r) {
    if (!r.started || !r.finished || r.status !== 'completed') return null;
    var s = (Date.parse(r.finished) - Date.parse(r.started)) / 1000;
    return isFinite(s) && s >= 0 ? s : null;
  }

  /* ------------------------------------------------------ Server secrets */

  function renderEnv(host) {
    return ui.load(host, function () { return VX.api.get('/api/admin/envcheck', null, { fresh: true }); }, function (d) {
      var items = d.items || [];
      var missing = d.missingRequired || [];
      var groups = [];
      var byGroup = {};
      items.forEach(function (it) {
        var g = it.group || 'Other';
        if (!byGroup[g]) { byGroup[g] = []; groups.push(g); }
        byGroup[g].push(it);
      });
      var req = items.filter(function (i) { return i.required; });
      var opt = items.filter(function (i) { return !i.required; });
      var oldNames = items.filter(function (i) { return i.usingFallback; });
      if (!items.length) return ui.empty('No checklist returned', 'The Worker answered without a secrets list.');
      return [
        missing.length ? ui.notice('Missing required secrets: ' + missing.join(', ') + '. Parts of the app stop working without them.', 'bad')
          : ui.notice('Every required secret is set.', 'ok'),
        oldNames.length ? ui.notice(fmt.plural(oldNames.length, 'key is', 'keys are') + ' set under an old name: ' + oldNames.map(function (i) { return i.fallback; }).join(', ') + '. Set the new name and remove the old one.', 'warn') : null,
        ui.kpis([
          { label: 'Required', value: fmt.num(req.length - req.filter(function (i) { return !i.set; }).length) + ' / ' + fmt.num(req.length), sub: 'set', tone: missing.length ? 'bad' : 'ok' },
          { label: 'Optional', value: fmt.num(opt.filter(function (i) { return i.set; }).length) + ' / ' + fmt.num(opt.length), sub: 'set' },
          { label: 'Old names', value: fmt.num(oldNames.length), tone: oldNames.length ? 'warn' : null },
          { label: 'Checked', value: d.checkedAt ? fmt.time(d.checkedAt) : '—' }
        ]),
        ui.grid(groups.map(function (g) {
          var list = byGroup[g];
          var bad = list.some(function (i) { return i.required && !i.set; });
          return ui.card({ title: g, tone: bad ? 'bad' : null, sub: fmt.num(list.filter(function (i) { return i.set; }).length) + ' of ' + fmt.plural(list.length, 'item') + ' set', body: h('ul.list', list.map(function (i) {
            var state = i.usingFallback ? ui.pill('Old name', 'warn') : i.set ? ui.pill('Set', 'ok') : i.required ? ui.pill('Missing', 'bad') : ui.pill('Not set');
            return h('li', { style: { 'align-items': 'flex-start' } },
              h('div', { style: { 'min-width': '78px' } }, state),
              h('div.grow',
                h('div', ui.mono(i.name), i.required ? [' ', ui.pill('Required', i.set ? 'info' : 'bad')] : null),
                i.note ? h('div.cell-sub', { style: { 'margin-top': '3px' } }, i.note) : null));
          })) });
        })),
        ui.card({ title: 'How to set a secret', body: [
          h('p', 'From the repository’s backend folder, run the command below and type the value at the prompt. It applies on the Worker’s next request; nothing needs redeploying.'),
          h('pre.json', { style: { 'margin-top': '8px' } }, 'cd backend\nnpx wrangler secret put <NAME> --config worker/wrangler.toml'),
          h('p.muted.small', { style: { 'margin-top': '8px' } }, 'ASSETS_HOST and GITHUB_REPO are plain settings in worker/wrangler.toml; HANDOFF is a key-value binding declared there too.')
        ] })
      ];
    }, { skeleton: 6 });
  }
})();
