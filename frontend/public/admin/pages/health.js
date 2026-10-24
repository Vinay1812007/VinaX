/* VinaX console — Health page.
 * Is everything working? Live AI-key pings and every lane's key
 * (/api/admin/health — spends a few model tokens, so it runs once per visit
 * and on a button press, never on auto-refresh), the public endpoints and
 * shell assets (/api/admin/edge), releases and CI (/api/admin/releases) and
 * the server secrets checklist (/api/admin/envcheck). (13.9.1 — app errors,
 * scheduled-job footprints, data quality and the status note went with the
 * database.) */
(function () {
  'use strict';
  var VX = window.VX, h = VX.h, ui = VX.ui, fmt = VX.fmt;

  VX.page({
    id: 'health', title: 'Health', group: 'System', icon: 'pulse', noAuto: true,
    desc: 'Is everything working: AI keys, app errors, endpoints, releases and server secrets.',
    tabs: [
      { id: 'status', label: 'System status', desc: 'Live check of every AI key, and which lanes have a key set.', render: renderStatus },
      { id: 'errors', label: 'App errors', desc: 'Errors the app reported from listeners’ devices, grouped by kind and message.', render: renderErrors },
      { id: 'edge', label: 'Endpoints', desc: 'The live web app shell, its scripts and styles, and every public endpoint, checked from the server.', render: renderEdge },
      { id: 'releases', label: 'Releases', desc: 'The newest Android release, recent build runs and commits on main.', render: renderReleases },
      { id: 'env', label: 'Server secrets', desc: 'Which secrets and settings the Worker has. Names only — values are never shown.', render: renderEnv }
    ]
  });

  /* ------------------------------------------------------------ helpers */

  function extLink(url, text) {
    return /^https:\/\//i.test(String(url || '')) ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, text) : text;
  }
  function agoCell(iso) { return iso ? h('span', { title: fmt.dateTime(iso) }, fmt.ago(iso)) : h('span.muted', '—'); }

  /* --------------------------------------------------- System status tab */

  // One live check per visit: the result is reused for five minutes so the
  // top bar's refresh and tab switches do not spend model tokens again (the
  // route also allows only a few checks a minute).
  var healthCache = null;
  var HEALTH_TTL = 5 * 60 * 1000;

  function renderStatus(host) {
    var bar = h('div.toolbar');
    var body = h('div.page-body');
    host.appendChild(bar);
    host.appendChild(body);

    function paintBar() {
      VX.mount(bar,
        ui.button(healthCache ? 'Run checks again' : 'Run checks', { kind: 'primary', icon: 'refresh', onClick: run }),
        healthCache ? ui.muted('Checked ' + fmt.ago(healthCache.at) + ' · each check sends one tiny request to every AI provider') : ui.muted('Sends one tiny request to every AI provider.'));
    }
    function run() {
      return ui.load(body, function () { return VX.api.get('/api/admin/health', null, { fresh: true, timeout: 40000 }); }, function (d) {
        healthCache = { at: Date.now(), data: d };
        paintBar();
        return statusView(d);
      }).then(function (res) { if (res === null || (res && !res.ok)) paintBar(); });
    }
    paintBar();
    if (healthCache && Date.now() - healthCache.at < HEALTH_TTL) {
      VX.mount(body, statusView(healthCache.data));
      return Promise.resolve();
    }
    return run();
  }

  function providerLabel(row) {
    var k = String(row.key || '').split(' · ')[0];
    return k || row.provider || '—';
  }

  function statusView(d) {
    var ai = d.ai || [];
    var lanes = d.lanes || [];
    var configured = ai.filter(function (r) { return r.configured; });
    var working = configured.filter(function (r) { return r.ok; });
    var keyed = lanes.filter(function (l) { return l.keySet; });

    var aiTable = ui.table({
      columns: [
        { key: 'provider', label: 'Provider', sortVal: providerLabel, render: function (r) { return h('strong', providerLabel(r)); } },
        { key: 'state', label: 'Key', sortVal: function (r) { return !r.configured ? 'Not set' : r.ok ? 'Working' : 'Failing'; },
          render: function (r) { return !r.configured ? ui.pill('Not set', 'warn') : r.ok ? ui.pill('Working', 'ok') : ui.pill('Failing', 'bad'); } },
        { key: 'model', label: 'Test model', render: function (r) { return r.model ? ui.mono(r.model) : null; } },
        { key: 'envInUse', label: 'Secret', sortVal: function (r) { return r.envInUse || r.env; }, render: function (r) {
          var name = r.envInUse || r.env;
          if (!name) return null;
          var old = r.envInUse && r.env && r.envInUse !== r.env && r.envInUse !== 'AI';
          return h('span', ui.mono(name), old ? [' ', ui.pill('old name', 'warn')] : null);
        } },
        { key: 'lanes', label: 'Lanes', sortVal: function (r) { return (r.lanes || []).length; }, render: function (r) {
          var l = r.lanes || [];
          return l.length ? h('span', { title: l.join(', ') }, fmt.plural(l.length, 'lane')) : null;
        } },
        { key: 'note', label: 'Result', render: function (r) {
          if (r.ok) return h('span.muted', r.status ? 'HTTP ' + r.status : 'OK');
          return r.note ? h('span', fmt.trunc(r.note, 80)) : null;
        } }
      ],
      rows: ai, exportName: 'vinax-ai-keys', search: false,
      empty: 'No AI providers reported', emptyHint: 'The Worker returned no provider list.',
      onRow: function (r) { openProvider(r); }
    });

    var laneTable = ui.table({
      columns: [
        { key: 'lane', label: 'Lane', render: function (r) { return ui.mono(r.lane); } },
        { key: 'provider', label: 'Provider' },
        { key: 'keySet', label: 'Key', render: function (r) { return r.keySet ? ui.pill('Set', 'ok') : ui.pill('Not set', 'warn'); }, sortVal: function (r) { return r.keySet ? 1 : 0; } }
      ],
      rows: lanes, exportName: 'vinax-ai-lanes', search: false, dense: true, pageSize: 20,
      empty: 'No lanes reported'
    });

    return [
      ui.kpis([
        { label: 'AI keys working', value: fmt.num(working.length) + ' / ' + fmt.num(ai.length), sub: configured.length < ai.length ? fmt.num(ai.length - configured.length) + ' not set' : 'all keys set', tone: !configured.length ? 'bad' : working.length < configured.length ? 'warn' : 'ok' },
        { label: 'Lanes with a key', value: fmt.num(keyed.length) + ' / ' + fmt.num(lanes.length), tone: keyed.length < lanes.length ? 'warn' : 'ok' }
      ]),
      ui.grid([
        ui.card({ title: 'AI providers', sub: 'A 4-token test request with the model each provider’s lanes use. Click a row for details.', span: 'full', pad: false, body: aiTable }),
        ui.card({ title: 'AI lanes', sub: 'Each lane and whether its provider’s key is set.', span: 'full', pad: false, body: laneTable })
      ])
    ];
  }

  function openProvider(r) {
    var dr = VX.drawer({ title: providerLabel(r) });
    VX.mount(dr.body,
      ui.dl([
        ['Key', !r.configured ? 'Not set' : r.ok ? 'Working' : 'Failing'],
        ['Secret name', r.env ? ui.mono(r.env) : '—'],
        ['Read from', r.envInUse ? ui.mono(r.envInUse) : 'Not set'],
        ['Test model', r.model ? ui.mono(r.model) : '—'],
        ['HTTP status', r.status != null ? String(r.status) : '—'],
        ['Result', r.note || (r.ok ? 'OK' : '—')]
      ]),
      r.envInUse && r.env && r.envInUse !== r.env && r.envInUse !== 'AI' ? ui.notice('This key is set under its previous name ' + r.envInUse + '. Set it as ' + r.env + ' and remove the old one.', 'warn') : null,
      h('h3', { style: { margin: '16px 0 6px', 'font-size': '14px' } }, 'Lanes'),
      (r.lanes || []).length ? h('p', (r.lanes || []).join(', ')) : ui.muted('None'),
      (r.media || []).length ? [h('h3', { style: { margin: '16px 0 6px', 'font-size': '14px' } }, 'Media models'), h('ul.list', r.media.map(function (m) { return h('li', ui.mono(m.id), h('span.grow', m.name || ''), ui.pill(m.kind || '—')); }))] : null,
      (r.tools || []).length ? [h('h3', { style: { margin: '16px 0 6px', 'font-size': '14px' } }, 'Tools'), h('ul.list', r.tools.map(function (t) { return h('li', h('span.grow', t.name || t.id), ui.muted(fmt.plural((t.models || []).length, 'model'))); }))] : null
    );
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
