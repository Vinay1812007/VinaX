/* VinaX console — Top Listeners and At Risk (schema 14).
 * Top Listeners: signed-in people ranked by listening time, today / 7 days /
 * 30 days. At Risk: people who used to listen a lot and have gone quiet.
 * Routes: GET /api/admin/listeners?view=top&days=  and  ?view=at-risk&quiet=
 * Clicking a person opens their profile (#/user?id=). */
(function () {
  'use strict';
  var VX = window.VX, h = VX.h, ui = VX.ui, fmt = VX.fmt, arr = VX.arr, num = VX.num;
  var API = '/api/admin/listeners';
  var LISTEN_INFO = 'Worked out from the app’s “still playing” signal (every 25 seconds while music plays) and each song played; a gap over 6 minutes counts as stopped. An estimate: a phone in the background can send fewer signals.';

  function who(u) { return u.name || u.email || 'User'; }
  function place(r) { return [r.city, r.region, fmt.country(r.country)].filter(function (x) { return x && x !== '—'; }).join(', ') || null; }
  function open(r, ctx) { if (r && /^\d{1,40}$/.test(String(r.id || ''))) ctx.go('user', null, { id: r.id }); }
  function userCell(r) { return ui.media(r.picture, who(r), r.name ? r.email : null, true); }
  function placeCell(r) { var p = place(r); return p ? h('span.nowrap', { title: p }, r.city || r.region || fmt.country(r.country)) : h('span.muted', '—'); }
  function menu(r, ctx) {
    return [
      { label: 'View profile', icon: 'user', onClick: function () { open(r, ctx); } },
      { label: 'Send notification', icon: 'send', hidden: !VX.can('edit'), onClick: function () { ctx.go('send-notification', null, { users: r.id }); } },
      { label: 'Copy email', icon: 'copy', hidden: !r.email, onClick: function () { VX.copy(r.email, 'Email copied'); } }
    ];
  }
  function notifyMany(ctx) {
    return { label: 'Send notification', icon: 'send', onClick: function (sel) {
      if (!VX.can('edit')) { VX.toast(VX.errorText('forbidden'), 'bad'); return; }
      ctx.go('send-notification', null, { users: sel.map(function (u) { return u.id; }).join(',') });
    } };
  }
  /** A segmented switch kept in the address (?key=). */
  function switcher(ctx, key, options, fallback, label, onChange) {
    var value = Number(ctx.params[key]) || fallback;
    if (!options.some(function (o) { return o.value === value; })) value = fallback;
    return { value: value, el: ui.segmented(options, value, function (v) { ctx.setParam(key, v === fallback ? '' : v); onChange(Number(v)); }, label) };
  }

  /* ---------------------------------------------------- Top Listeners */
  var WINDOWS = [{ value: 1, label: 'Today' }, { value: 7, label: '7 days' }, { value: 30, label: '30 days' }];
  function windowText(days) { return days === 1 ? 'today' : 'in the last ' + days + ' days'; }

  function topListeners(host, ctx) {
    var body = h('div');
    var sw = switcher(ctx, 'days', WINDOWS, 7, 'Time range', function (v) { days = v; load(); });
    var days = sw.value;
    VX.mount(host, h('div.toolbar.rank-bar', sw.el), body);
    function load() {
      return ui.load(body, function () { return VX.api.get(API, { view: 'top', days: days }); }, function (d) {
        var gate = ui.gate(d, ctx);
        if (gate) return gate;
        var rows = arr(d.rows), people = num(d.people), total = num(d.total), first = rows[0];
        return [
          ui.stats([
            { label: 'Listening, everyone', value: VX.listenText(total), info: 'Time all signed-in people spent listening ' + windowText(days) + ' (India time), all devices together. ' + LISTEN_INFO },
            { label: 'People listening', value: fmt.num(people), info: 'Signed-in people who listened to anything ' + windowText(days) + '.' },
            { label: 'Average per person', value: people ? VX.listenText(total / people) : '—', info: 'Listening time divided by the people who listened ' + windowText(days) + '.' },
            { label: 'Top listener', value: first ? fmt.trunc(who(first), 20) : '—', sub: first ? VX.listenText(first.seconds) : null, info: 'The person who listened the longest ' + windowText(days) + '.', onClick: first ? function () { open(first, ctx); } : null }
          ]),
          ui.card({ title: 'Top listeners ' + windowText(days), sub: 'The 100 people who listened longest. Click a person to open their profile.', pad: false, body: ui.dataTable({
            columns: [
              { key: 'rank', label: '#', align: 'right', width: '44px', sortVal: function (r) { return rows.indexOf(r) + 1; }, render: function (r) { return String(rows.indexOf(r) + 1); } },
              { key: 'user', label: 'User', always: true, primary: true, sortVal: who, render: userCell, csv: who },
              { key: 'email', label: 'Email', hidden: true },
              { key: 'seconds', label: 'Listening', align: 'right', render: function (r) { return h('strong.nowrap', VX.listenText(r.seconds)); }, csv: function (r) { return Math.round(num(r.seconds) / 60); } },
              { key: 'days', label: 'Days listened', align: 'right', render: function (r) { return fmt.num(r.days); } },
              { key: 'plays', label: 'Plays', align: 'right', render: function (r) { return fmt.num(r.plays); } },
              { key: 'topArtist', label: 'Top artist', render: function (r) { return r.topArtist ? fmt.trunc(r.topArtist, 26) : h('span.muted', '—'); } },
              { key: 'device', label: 'Device', sortVal: function (r) { return VX.deviceText(r); }, render: function (r) { return h('span.nowrap', VX.deviceText(r)); }, csv: function (r) { return VX.deviceText(r); } },
              { key: 'place', label: 'Location', sortVal: function (r) { return place(r) || ''; }, render: placeCell, csv: place },
              { key: 'lastSeen', label: 'Last active', hidden: true, render: function (r) { return ui.ago(r.lastSeen); }, csv: function (r) { return fmt.full(r.lastSeen); } }
            ],
            rows: rows, rowId: function (r) { return r.id; }, search: 'Search by name or email…', exportName: 'vinax-top-listeners', sortKey: 'seconds',
            onRow: function (r) { open(r, ctx); }, rowMenu: function (r) { return menu(r, ctx); }, bulk: [notifyMany(ctx)],
            empty: { title: 'Nobody has listened ' + windowText(days), hint: days === 1 ? 'Try 7 days: people show up here once they play music today.' : 'People show up here once signed-in users play music.' }
          }) })
        ];
      }, { skeleton: 6 });
    }
    return load();
  }

  /* ---------------------------------------------------------- At Risk */
  var QUIET = [{ value: 7, label: '7+ days away' }, { value: 14, label: '14+ days' }, { value: 30, label: '30+ days' }];

  function atRisk(host, ctx) {
    var body = h('div');
    var sw = switcher(ctx, 'quiet', QUIET, 7, 'How long away', function (v) { quiet = v; load(); });
    var quiet = sw.value;
    VX.mount(host, h('div.toolbar.rank-bar', sw.el), body);
    function load() {
      return ui.load(body, function () { return VX.api.get(API, { view: 'at-risk', quiet: quiet }); }, function (d) {
        var gate = ui.gate(d, ctx);
        if (gate) return gate;
        var rows = arr(d.rows), total = num(d.total);
        var rule = 'Someone is at risk when nothing has come from any of their devices for ' + quiet + ' days or more (but something in the last 90 days), and in the 30 days before their last visit they listened for at least 2 hours or used the app on at least 5 different days.';
        var had = rows.reduce(function (t, r) { return t + num(r.seconds); }, 0);
        var longest = rows.reduce(function (m, r) { var t = Date.parse(r.lastActive); return isNaN(t) ? m : Math.min(m, t); }, Infinity);
        return [
          ui.stats([
            { label: 'People at risk', value: fmt.num(total), tone: total ? 'warn' : null, info: rule },
            { label: 'Listening they used to do', value: VX.listenText(had), info: 'What these people listened to in the 30 days before they went quiet, all together. ' + LISTEN_INFO },
            { label: 'Away the longest', value: isFinite(longest) ? fmt.plural(Math.floor((Date.now() - longest) / 86400000), 'day') : '—', info: 'How long ago the person on this list who has been gone longest last used VinaX.' }
          ]),
          h('p.muted.small.rank-rule', rule),
          ui.card({ title: 'Regular listeners who went quiet', sub: 'Most listening first. Select people to send them a notification, or open a profile.', pad: false, body: ui.dataTable({
            columns: [
              { key: 'user', label: 'User', always: true, primary: true, sortVal: who, render: userCell, csv: who },
              { key: 'email', label: 'Email', hidden: true },
              { key: 'lastActive', label: 'Last active', render: function (r) { return ui.ago(r.lastActive); }, csv: function (r) { return fmt.full(r.lastActive); } },
              { key: 'seconds', label: 'Listened before', align: 'right', render: function (r) { return h('strong.nowrap', VX.listenText(r.seconds)); }, csv: function (r) { return Math.round(num(r.seconds) / 60); } },
              { key: 'days', label: 'Days active before', align: 'right', render: function (r) { return fmt.num(r.days); } },
              { key: 'plays', label: 'Plays', align: 'right', hidden: true, render: function (r) { return fmt.num(r.plays); } },
              { key: 'topArtist', label: 'Their top artist', render: function (r) { return r.topArtist ? fmt.trunc(r.topArtist, 26) : h('span.muted', '—'); } },
              { key: 'device', label: 'Device', sortVal: function (r) { return VX.deviceText(r); }, render: function (r) { return h('span.nowrap', VX.deviceText(r)); }, csv: function (r) { return VX.deviceText(r); } },
              { key: 'place', label: 'Location', sortVal: function (r) { return place(r) || ''; }, render: placeCell, csv: place }
            ],
            rows: rows, rowId: function (r) { return r.id; }, search: 'Search by name or email…', exportName: 'vinax-at-risk', sortKey: 'seconds',
            onRow: function (r) { open(r, ctx); }, rowMenu: function (r) { return menu(r, ctx); }, bulk: [notifyMany(ctx)],
            empty: { title: 'Nobody is at risk', hint: 'No regular listener has been away for ' + quiet + ' days or more.' }
          }) })
        ];
      }, { skeleton: 6 });
    }
    return load();
  }

  VX.page({
    id: 'top-listeners', title: 'Top Listeners', group: 'Users', icon: 'play', order: 2, render: topListeners,
    desc: 'The people who listened the longest today, this week or this month.',
    keywords: 'leaderboard most listening time spent heavy users fans ranking'
  });
  VX.page({
    id: 'at-risk', title: 'At Risk', group: 'Users', icon: 'alert', order: 3, render: atRisk,
    desc: 'Regular listeners who have not opened VinaX for a week or more.',
    keywords: 'churn quiet inactive lapsed away win back dormant'
  });
})();
