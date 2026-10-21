/* VinaX console — Overview page.
 * The first screen: what is happening right now (/api/admin/realtime, polled
 * every 15 s), the headline numbers and 14-day trends (/api/admin/overview),
 * and anything that needs the owner's attention (missing server secrets from
 * /api/admin/envcheck, errors, unread feedback). */
(function () {
  'use strict';
  var VX = window.VX, h = VX.h, ui = VX.ui, fmt = VX.fmt;

  VX.page({
    id: 'overview', title: 'Overview', group: 'Dashboards', icon: 'grid',
    desc: 'Live activity, headline numbers and anything that needs attention.',
    render: render
  });

  function render(host, ctx) {
    var pulse = h('div');
    var attention = h('div');
    var main = h('div.page-body');
    host.appendChild(pulse);
    host.appendChild(attention);
    host.appendChild(main);

    function loadPulse(quiet) {
      return ui.load(pulse, function () { return VX.api.get('/api/admin/realtime', null, { fresh: true }); }, function (d) {
        if (d.configured === false) return ui.notice('The database is not connected, so live numbers are unavailable. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the Worker.', 'warn');
        return ui.card({
          title: h('span.status.ok', ui.dot('live'), 'Right now'),
          sub: 'Last 5 minutes · refreshes every 15 seconds',
          actions: [ui.button('Open Live', { kind: 'ghost', small: true, onClick: function () { ctx.go('live'); } })],
          body: ui.kpis([
            { label: 'Listening now', value: fmt.num(d.liveListeners), sub: 'active in 5 min' },
            { label: 'Plays started', value: fmt.num(d.startsPerMin), sub: 'last minute' },
            { label: 'New devices', value: fmt.num(d.joins5m), sub: 'last 5 min' },
            { label: 'Errors', value: fmt.num(d.errors5m), sub: 'last 5 min', tone: d.errors5m > 0 ? 'bad' : null },
            { label: 'AI replies', value: d.aiCalls15m ? fmt.ms(d.aiP50) : '—', sub: d.aiCalls15m ? 'median · ' + (d.aiOkRate == null ? '—' : d.aiOkRate + '% ok') + ' · 15 min' : 'no AI calls in 15 min' },
            { label: 'Listen Together', value: fmt.num(d.activeRooms), sub: 'active rooms' }
          ])
        });
      }, { quiet: quiet });
    }
    loadPulse(false);
    ctx.every(15000, function () { loadPulse(true); });

    var envP = VX.api.get('/api/admin/envcheck');

    return ui.load(main, function () { return VX.api.get('/api/admin/overview'); }, function (d) {
      if (d.configured === false) return ui.empty('Database not connected', 'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the Worker, then run frontend/supabase/vinax-13.sql in the database SQL editor.');
      var sm = d.summary || {};
      var acc = d.accounts || {};
      var plays = VX.fillDays(d.playsByDay, 14, 'day', ['plays']);
      var users = VX.fillDays(d.newUsersByDay, 14, 'day', ['users']);
      var stick = sm.mau ? (sm.dau / sm.mau) : null;
      var fresh = !Number(sm.total_users) && !Number(acc.total) && !Number(sm.plays_7d);

      envP.then(function (res) { renderAttention(attention, res, sm, ctx); });

      return [
        fresh ? ui.notice('The database is new and empty. Numbers appear here as listeners open the app, sign in and play songs — nothing needs to be imported.', 'info') : null,
        ui.kpis([
          { label: 'Signed-in accounts', value: fmt.num(acc.total), sub: acc.newToday != null ? fmt.num(acc.newToday) + ' new today' : null, hint: 'Accounts created with Google sign-in' },
          { label: 'Listener devices', value: fmt.num(sm.total_users), sub: fmt.num(sm.new_today) + ' new today', hint: 'Devices that share usage data (opt-in)' },
          { label: 'Plays today', value: fmt.num(sm.plays_today), spark: plays.values.plays },
          { label: 'Plays · 7 days', value: fmt.num(sm.plays_7d) },
          { label: 'Daily active', value: fmt.num(sm.dau), sub: 'WAU ' + fmt.num(sm.wau) + ' · MAU ' + fmt.num(sm.mau) },
          { label: 'Stickiness', value: stick == null ? '—' : fmt.ratio(stick), sub: 'daily ÷ monthly active', hint: 'Share of this month’s listeners who came back today' },
          { label: 'Errors · 24h', value: fmt.num(sm.errors_24h), tone: sm.errors_24h > 0 ? 'warn' : null },
          { label: 'New feedback', value: fmt.num(sm.feedback_new), tone: sm.feedback_new > 0 ? 'warn' : null }
        ]),
        ui.grid([
          ui.card({ title: 'Plays per day', sub: 'Last 14 days (UTC)', span: 2, body: ui.chart({ labels: plays.labels, series: [{ name: 'Plays', values: plays.values.plays }], type: 'area', height: 220, empty: 'No plays yet', emptyHint: 'Fills in as listeners play songs.' }) }),
          ui.card({ title: 'New listener devices per day', sub: 'Last 14 days', body: ui.chart({ labels: users.labels, series: [{ name: 'New devices', values: users.values.users, color: 'var(--c2)' }], type: 'bar', height: 220, empty: 'No new devices yet' }) }),
          ui.card({ title: 'Top songs', sub: 'Most played · 7 days', actions: [ui.button('Music', { kind: 'ghost', small: true, onClick: function () { ctx.go('music'); } })],
            body: ui.hbars((d.topSongs || []).map(function (r) { return { label: r.song_title, sub: r.song_artist, value: r.plays }; }), { empty: 'No plays in the last 7 days', emptyHint: 'Songs appear once listeners play them.' }) }),
          ui.card({ title: 'Top countries', sub: 'Listeners · 7 days', actions: [ui.button('Places', { kind: 'ghost', small: true, onClick: function () { ctx.go('places'); } })],
            body: ui.share((d.topCountries || []).map(function (r) { return { label: fmt.country(r.country), value: r.listeners }; }), { empty: 'No locations yet' }) })
        ])
      ];
    }, { skeleton: 6 });
  }

  function renderAttention(host, res, sm, ctx) {
    var items = [];
    if (res && res.ok && res.data) {
      var miss = res.data.missingRequired || [];
      if (miss.length) items.push({ tone: 'bad', text: 'Required server secrets are missing: ' + miss.join(', ') + '.', go: ['health', 'env'] });
    }
    if (Number(sm.errors_24h) > 0) items.push({ tone: 'warn', text: fmt.plural(sm.errors_24h, 'app error') + ' reported in the last 24 hours.', go: ['health', 'errors'] });
    if (Number(sm.feedback_new) > 0) items.push({ tone: 'warn', text: fmt.plural(sm.feedback_new, 'new feedback message') + ' waiting.', go: ['feedback'] });
    if (!items.length) { VX.clear(host); return; }
    VX.mount(host, ui.card({
      title: 'Needs attention',
      tone: items.some(function (i) { return i.tone === 'bad'; }) ? 'bad' : 'warn',
      body: h('ul.list', items.map(function (i) {
        return h('li', ui.dot(i.tone), h('span.grow', i.text), ui.button('Open', { kind: 'ghost', small: true, onClick: function () { ctx.go(i.go[0], i.go[1]); } }));
      }))
    }));
  }
})();
