/* VinaX console — Overview page (the landing page).
 * One call, GET /api/admin/overview: the headline tiles, what needs
 * attention, the last two weeks of plays and listeners, and the platform
 * split. Shows the database setup card until the Worker has a database. */
(function () {
  'use strict';
  var VX = window.VX, h = VX.h, ui = VX.ui, fmt = VX.fmt, arr = VX.arr, obj = VX.obj, num = VX.num;

  VX.page({
    id: 'overview', title: 'Overview', group: 'System', icon: 'grid',
    desc: 'How VinaX is doing right now: listeners, plays, errors, and what needs attention.',
    render: render
  });

  function render(host, ctx) {
    return ui.load(host, function () { return VX.api.get('/api/admin/overview'); }, function (d) {
      var gate = ui.gate(d, ctx);
      if (gate) return gate;
      var k = obj(d.kpis);
      var timeline = arr(d.timeline);
      var platforms = arr(d.platforms);
      var attention = arr(d.attention);
      var schema = obj(d.schema);
      var days = timeline.map(function (r) { return r.day; });
      var plays7 = timeline.slice(-7).map(function (r) { return num(r.plays); });
      return [
        attention.length ? ui.card({ title: 'Needs attention', tone: attention.some(function (a) { return a.level === 'bad'; }) ? 'bad' : 'warn', body: h('ul.list.attention', attention.map(function (a) {
          return h('li', ui.dot(a.level === 'bad' ? 'bad' : 'warn'), h('span.grow', a.text || ''),
            a.page ? ui.button('Open', { kind: 'ghost', small: true, icon: 'chevron', onClick: function () { ctx.go(a.page, a.tab || null); } }) : null);
        })) }) : ui.notice('Nothing needs attention.' + (schema.version ? ' Database schema version ' + fmt.num(schema.version) + '.' : ''), 'ok'),
        ui.kpis([
          { label: 'Listening now', value: fmt.num(k.activeNow), sub: 'active in the last 90 s', tone: num(k.activeNow) > 0 ? 'ok' : null },
          { label: 'Plays today', value: fmt.compact(k.plays24h), sub: fmt.compact(k.plays7d) + ' in 7 days', spark: plays7 },
          { label: 'Listeners', value: fmt.compact(k.listeners), sub: fmt.num(k.newListeners24h) + ' new today' },
          { label: 'Signed-in accounts', value: fmt.compact(k.accounts), sub: fmt.num(k.newAccounts7d) + ' new this week' },
          { label: 'Daily · weekly · monthly', value: fmt.compact(k.dau) + ' · ' + fmt.compact(k.wau) + ' · ' + fmt.compact(k.mau), sub: 'active listeners' },
          { label: 'Errors (24 h)', value: fmt.num(k.errors24h), tone: num(k.errors24h) > 0 ? 'warn' : null, sub: 'reported by the app' },
          { label: 'New feedback', value: fmt.num(k.feedbackNew), tone: num(k.feedbackNew) > 0 ? 'warn' : null, hint: 'Messages waiting on the Feedback page' },
          { label: 'Push devices', value: fmt.compact(k.pushDevices), sub: fmt.num(k.roomsActive) + ' rooms live' },
          { label: 'AI calls (24 h)', value: fmt.compact(k.aiCalls24h) }
        ]),
        ui.grid([
          ui.card({ title: 'Plays and listeners', sub: 'Last ' + fmt.plural(timeline.length || 14, 'day'), span: 2, body: ui.chart({
            labels: days,
            series: [
              { name: 'Plays', values: timeline.map(function (r) { return num(r.plays); }) },
              { name: 'Listeners', values: timeline.map(function (r) { return num(r.listeners); }) }
            ],
            type: 'area', height: 240, title: 'Plays and listeners by day'
          }) }),
          ui.card({ title: 'Platforms', sub: 'Everyone in the directory', body: ui.share(platforms.map(function (p) { return { label: p.platform || 'web', value: num(p.listeners) + num(p.accounts) }; }), { title: 'Platform share' }) })
        ], 3),
        ui.grid([
          ui.card({ title: 'New listeners', sub: 'First seen, by day', body: ui.chart({ labels: days, series: [{ name: 'New listeners', values: timeline.map(function (r) { return num(r.newListeners); }), color: 'var(--c3)' }], type: 'bar', height: 180 }) }),
          ui.card({ title: 'Errors and searches', sub: 'By day', body: ui.chart({ labels: days, series: [
            { name: 'Searches', values: timeline.map(function (r) { return num(r.searches); }), color: 'var(--c2)' },
            { name: 'Errors', values: timeline.map(function (r) { return num(r.errors); }), color: 'var(--c5)' }
          ], type: 'line', height: 180 }) })
        ], 2)
      ];
    }, { skeleton: 8 });
  }
})();
