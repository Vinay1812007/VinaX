/* VinaX console — Dashboard (the landing page).
 * One call, GET /api/admin/overview?days=: what needs attention, the
 * headline numbers (signed-in users only), and four charts that follow the
 * date range in the top bar. Every card and chart opens the page behind it
 * with the matching filter already applied. */
(function () {
  'use strict';
  var VX = window.VX, h = VX.h, ui = VX.ui, fmt = VX.fmt, arr = VX.arr, obj = VX.obj, num = VX.num;

  VX.page({
    id: 'dashboard', title: 'Dashboard', group: 'Home', icon: 'grid', order: 1, range: true,
    desc: 'What is happening in VinaX today, and anything that needs you.',
    keywords: 'overview home summary attention',
    render: render
  });

  /** Days to ask for: a custom range reaches back from today to its start. */
  function daysFor(range) {
    if (range.key === 'custom' && range.from) {
      var back = Math.round((Date.parse(VX.time.today() + 'T00:00:00Z') - Date.parse(range.from + 'T00:00:00Z')) / 86400000) + 1;
      return Math.max(1, Math.min(90, back));
    }
    return range.days || 7;
  }

  function render(host, ctx) {
    var range = ctx.range;
    return ui.load(host, function () { return VX.api.get('/api/admin/overview', { days: daysFor(range) }); }, function (d) {
      var gate = ui.gate(d, ctx);
      if (gate) return gate;
      var k = obj(d.kpis);
      var timeline = arr(d.timeline);
      if (range.key === 'custom' && range.from && range.to) timeline = timeline.filter(function (r) { return r.day >= range.from && r.day <= range.to; });
      var platforms = arr(d.platforms);
      var days = timeline.map(function (r) { return r.day; });
      var span = range.key === 'custom' ? range.label : range.label.toLowerCase();
      var go = function (page, tab, params) { return function () { ctx.go(page, tab || null, params || {}); }; };
      var series = function (key) { return timeline.map(function (r) { return num(r[key]); }); };

      var attention = arr(d.attention).map(function (a) {
        return { id: a.id || a.text, level: a.level, text: a.text, action: a.page ? { label: a.action || 'Open', onClick: go(a.page, a.tab, a.params) } : null };
      });

      return [
        ui.card({ title: 'Needs your attention', body: ui.attention(attention) }),
        h('h3.subhead.dash-head', 'Right now and today'),
        ui.stats([
          { label: 'Listening right now', value: fmt.num(k.activeNow), sub: fmt.num(k.playingNow) + ' playing a song', tone: num(k.activeNow) ? 'ok' : null,
            info: 'Signed-in people who had the app open in the last 90 seconds.', onClick: go('live', 'now') },
          { label: 'Plays today', value: fmt.num(k.playsToday), delta: VX.change(k.playsToday, k.playsYesterday), deltaLabel: 'vs yesterday',
            info: 'Songs played today (India time) by signed-in users.', onClick: go('song-stats', 'top-songs', { range: '1' }) },
          { label: 'Total users', value: fmt.num(k.users != null ? k.users : k.accounts),
            info: 'Everyone who has ever signed in to VinaX with Google.', onClick: go('users') },
          { label: 'New users this week', value: fmt.num(k.newAccounts7d), delta: VX.change(k.newAccounts7d, k.newAccountsPrev7d), deltaLabel: 'vs last week',
            info: 'People who signed in with Google for the first time in the last 7 days.', onClick: go('users', null, { joined: '7', sort: 'joined' }) }
        ]),
        h('h3.subhead.dash-head', 'How many people use the app'),
        ui.stats([
          { label: 'Active today', value: fmt.num(k.dau), delta: VX.change(k.dau, k.dauPrev), deltaLabel: 'vs the day before',
            info: 'Signed-in people who used the app in the last 24 hours.', onClick: go('users', null, { active: '1' }) },
          { label: 'Active this week', value: fmt.num(k.wau), delta: VX.change(k.wau, k.wauPrev), deltaLabel: 'vs last week',
            info: 'Signed-in people who used the app in the last 7 days.', onClick: go('users', null, { active: '7' }) },
          { label: 'Active this month', value: fmt.num(k.mau), delta: VX.change(k.mau, k.mauPrev), deltaLabel: 'vs last month',
            info: 'Signed-in people who used the app in the last 30 days.', onClick: go('users', null, { active: '30' }) }
        ]),
        h('h3.subhead.dash-head', 'Things to keep an eye on'),
        ui.stats([
          { label: 'App errors (24 h)', value: fmt.num(k.errors24h), delta: VX.change(k.errors24h, k.errorsPrev24h), deltaLabel: 'vs the day before', inverse: true,
            tone: num(k.errors24h) > 20 ? 'bad' : num(k.errors24h) > 0 ? 'warn' : null,
            info: 'Problems the app reported in the last 24 hours, such as a song that would not download. Counts every report.', onClick: go('health', 'errors', { range: '1' }) },
          { label: 'New feedback', value: fmt.num(k.feedbackNew), tone: num(k.feedbackNew) ? 'warn' : null,
            info: 'Messages from Settings → Feedback in the app that nobody has read yet.', onClick: go('feedback', 'new') },
          { label: 'Phones ready for notifications', value: fmt.num(k.pushPeople != null ? k.pushPeople : k.pushDevices), sub: fmt.plural(k.pushDevices, 'phone or browser', 'phones and browsers'),
            info: 'Signed-in people with at least one phone or browser that can receive a notification from Send Notification.', onClick: go('notifications', 'setup') },
          { label: 'Listen Together rooms live', value: fmt.num(k.roomsActive),
            info: 'Rooms where friends are listening to the same song together, active in the last 15 minutes.', onClick: go('live', 'rooms') }
        ]),
        h('div.grid.cols-3.dash-charts',
          chartCard('Plays and active users per day', span, 'span-2', go('song-stats', 'top-songs', rangeParams(range)),
            ui.chart({ labels: days, type: 'line', height: 240, title: 'Plays and active users per day',
              series: [{ name: 'Plays', values: series('plays') }, { name: 'Active users', values: series('listeners'), color: 'var(--c3)' }],
              empty: 'No plays in this period', emptyHint: 'Plays by signed-in users show up here.' })),
          chartCard('Users by platform', 'Everyone signed in', null, go('users'),
            ui.share(platforms.map(function (p) { return { label: VX.platformName(p.platform), value: num(p.users != null ? p.users : p.listeners) }; }), { title: 'Users by platform', empty: 'No users yet' })),
          chartCard('New users per day', span, null, go('users', null, { sort: 'joined' }),
            ui.chart({ labels: days, type: 'bar', height: 200, title: 'New users per day',
              series: [{ name: 'New users', values: series('newListeners'), color: 'var(--c3)' }], empty: 'Nobody new in this period' })),
          chartCard('Searches and errors per day', span, 'span-2', go('health', 'errors', rangeParams(range)),
            ui.chart({ labels: days, type: 'line', height: 200, title: 'Searches and errors per day',
              series: [{ name: 'Searches', values: series('searches'), color: 'var(--c2)' }, { name: 'Errors', values: series('errors'), color: 'var(--c5)' }],
              empty: 'No searches or errors in this period' }))
        )
      ];
    }, { skeleton: 8 });
  }

  function rangeParams(range) {
    return range.key === 'custom' ? { range: 'custom', from: range.from, to: range.to } : { range: range.key };
  }

  function chartCard(title, sub, span, onOpen, body) {
    var card = ui.card({ title: title, sub: sub, span: span ? span.replace('span-', '') : null,
      actions: [ui.button('See details', { kind: 'ghost', small: true, icon: 'chevron', onClick: onOpen })], body: body });
    card.classList.add('chart-card');
    return card;
  }
})();
