/* VinaX console — Dashboard (the landing page).
 * GET /api/admin/overview?days=: the headline numbers (signed-in users only)
 * with a sparkline each, the big Plays chart beside what needs attention,
 * three smaller charts, the world map (GET /api/admin/live), things to keep
 * an eye on, the app versions people run, and quick actions. Charts follow
 * the date range in the top bar. Every card and chart opens the page behind
 * it with the matching filter already applied. "Customise" (in the page
 * header) lets each admin move, resize and hide cards (kept per browser). */
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

  /* ---------------------------------------------------- your layout
     Each admin arranges the dashboard their own way: cards can be moved,
     made wider or narrower, and hidden. The layout is kept in this browser,
     per admin email. Unknown or new cards fall back to the default order. */
  var WIDGETS = [
    { id: 'today', title: 'Right now and today', size: 'full', sizes: ['full'] },
    { id: 'plays', title: 'Plays and active users per day', size: 'wide', sizes: ['normal', 'wide', 'full'] },
    { id: 'attention', title: 'Needs your attention', size: 'normal', sizes: ['normal', 'wide', 'full'] },
    { id: 'usage', title: 'How many people use the app', size: 'full', sizes: ['full'] },
    { id: 'newUsers', title: 'New users per day', size: 'normal', sizes: ['normal', 'wide', 'full'] },
    { id: 'platforms', title: 'Users by platform', size: 'normal', sizes: ['normal', 'wide'] },
    { id: 'searches', title: 'Searches and errors per day', size: 'normal', sizes: ['normal', 'wide', 'full'] },
    { id: 'map', title: 'Where people are listening', size: 'full', sizes: ['full', 'wide'] },
    { id: 'watch', title: 'Things to keep an eye on', size: 'full', sizes: ['full'] },
    { id: 'versions', title: 'App versions in use', size: 'wide', sizes: ['normal', 'wide', 'full'] },
    { id: 'quick', title: 'Quick actions', size: 'normal', sizes: ['normal', 'wide', 'full'] }
  ];
  var SIZE_TEXT = { normal: 'Small', wide: 'Wide', full: 'Full width' };
  var byWidget = {};
  WIDGETS.forEach(function (w) { byWidget[w.id] = w; });

  function layoutKey() { return 'vinax_admin_dash.' + String((VX.me && VX.me.email) || 'admin').toLowerCase(); }
  function defaults() { return { order: WIDGETS.map(function (w) { return w.id; }), hidden: [], size: {} }; }
  function loadLayout() {
    var l = null;
    try { l = JSON.parse(localStorage.getItem(layoutKey()) || 'null'); } catch (e) { l = null; }
    var d = defaults();
    if (!l || typeof l !== 'object') return d;
    var order = arr(l.order).filter(function (id) { return byWidget[id]; });
    d.order.forEach(function (id) { if (order.indexOf(id) < 0) order.push(id); });
    var size = {};
    Object.keys(obj(l.size)).forEach(function (id) { if (byWidget[id] && byWidget[id].sizes.indexOf(l.size[id]) >= 0) size[id] = l.size[id]; });
    return { order: order, hidden: arr(l.hidden).filter(function (id) { return byWidget[id]; }), size: size };
  }
  function saveLayout(l) { try { localStorage.setItem(layoutKey(), JSON.stringify(l)); } catch (e) {} }
  function sizeOf(l, id) { return l.size[id] || byWidget[id].size; }

  function render(host, ctx) {
    var range = ctx.range;
    return ui.load(host, function () { return VX.api.get('/api/admin/overview', { days: daysFor(range) }); }, function (d) {
      var gate = ui.gate(d, ctx);
      if (gate) return gate;
      var cards = buildCards(d, ctx);
      var layout = loadLayout();
      var editing = ctx.params && ctx.params.customise === '1';
      var root = h('div.dash');
      var dragId = null;

      function move(id, by) {
        var i = layout.order.indexOf(id), j = i + by;
        if (i < 0 || j < 0 || j >= layout.order.length) return;
        layout.order.splice(i, 1); layout.order.splice(j, 0, id);
        saveLayout(layout); paint(id);
      }
      function setHidden(id, hide) {
        layout.hidden = layout.hidden.filter(function (x) { return x !== id; });
        if (hide) layout.hidden.push(id);
        saveLayout(layout); paint();
      }
      function setSize(id, size) { layout.size[id] = size; saveLayout(layout); paint(id); }

      function controls(w, pos, count) {
        var sizes = w.sizes.length > 1 ? h('div.seg', { role: 'radiogroup', 'aria-label': 'Size of ' + w.title }, w.sizes.map(function (sz) {
          return h('button', { type: 'button', role: 'radio', 'aria-checked': String(sizeOf(layout, w.id) === sz), onclick: function () { setSize(w.id, sz); } }, SIZE_TEXT[sz]);
        })) : null;
        return h('div.dash-ctl',
          h('span.dash-grip', { 'aria-hidden': 'true', title: 'Drag to move' }, '⋮⋮'),
          h('strong.dash-ctl-title', w.title),
          h('span.grow'),
          sizes,
          h('span.order-moves',
            h('button.icon-btn.sm', { type: 'button', 'aria-label': 'Move ' + w.title + ' up', disabled: pos === 0, onclick: function () { move(w.id, -1); } }, VX.icon('up')),
            h('button.icon-btn.sm', { type: 'button', 'aria-label': 'Move ' + w.title + ' down', disabled: pos === count - 1, onclick: function () { move(w.id, 1); } }, VX.icon('down'))),
          ui.button('Hide', { kind: 'ghost', small: true, icon: 'close', onClick: function () { setHidden(w.id, true); } }));
      }

      function paint(focusId) {
        var shown = layout.order.filter(function (id) { return layout.hidden.indexOf(id) < 0; });
        // Customise (and Reset while customising) sit in the page header.
        ctx.actions(
          editing ? ui.button('Reset to default', { kind: 'ghost', icon: 'refresh', onClick: function () { layout = defaults(); saveLayout(layout); paint(); VX.toast('Dashboard reset ✓', 'ok'); } }) : null,
          ui.button(editing ? 'Done' : 'Customise', { kind: editing ? 'primary' : null, icon: editing ? 'check' : 'layout', onClick: function () { editing = !editing; if (!editing && ctx.params.customise) ctx.setParam('customise', null); paint(); } }));
        var bar = editing ? ui.notice('Drag a card, or use the arrows, to move it. Your layout is saved in this browser.', 'info') : null;
        var grid = h('div.dash-grid' + (editing ? '.editing' : ''));
        shown.forEach(function (id, pos) {
          var w = byWidget[id];
          var cell = h('div.dash-w.size-' + sizeOf(layout, id), { dataset: { widget: id } });
          if (editing) {
            cell.setAttribute('draggable', 'true');
            cell.appendChild(controls(w, pos, shown.length));
            cell.addEventListener('dragstart', function (e) { dragId = id; cell.classList.add('dragging'); try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id); } catch (x) {} });
            cell.addEventListener('dragend', function () { dragId = null; cell.classList.remove('dragging'); VX.$$('.dash-w.drop-before', grid).forEach(function (x) { x.classList.remove('drop-before'); }); });
            cell.addEventListener('dragover', function (e) { if (!dragId || dragId === id) return; e.preventDefault(); cell.classList.add('drop-before'); });
            cell.addEventListener('dragleave', function () { cell.classList.remove('drop-before'); });
            cell.addEventListener('drop', function (e) {
              e.preventDefault();
              if (!dragId || dragId === id) return;
              var from = layout.order.indexOf(dragId);
              layout.order.splice(from, 1);
              layout.order.splice(layout.order.indexOf(id), 0, dragId);
              var moved = dragId; dragId = null;
              saveLayout(layout); paint(moved);
            });
          }
          var body = cards[id]();
          cell.appendChild(body);
          if (editing) cell.appendChild(h('div.dash-shield', { 'aria-hidden': 'true' }));
          grid.appendChild(cell);
        });
        var tray = null;
        if (editing && layout.hidden.length) {
          tray = ui.card({ title: 'Hidden cards', sub: 'Add a card back to your dashboard.', body: h('div.chips', layout.hidden.map(function (id) {
            return ui.button(byWidget[id].title, { kind: 'ghost', small: true, icon: 'plus', onClick: function () { setHidden(id, false); } });
          })) });
        }
        if (!shown.length && !editing) grid.appendChild(ui.empty ? ui.empty('Every card is hidden', 'Choose Customise to add cards back.') : h('p.muted', 'Every card is hidden. Choose Customise to add cards back.'));
        VX.mount(root, bar, tray, grid);
        if (focusId) { var again = VX.$('.dash-w[data-widget="' + focusId + '"] .dash-ctl button', root); if (again) again.focus(); }
      }
      paint();
      return root;
    }, { skeleton: 8 });
  }

  /** The cards, keyed by widget id; each call builds a fresh element. */
  function buildCards(d, ctx) {
    var range = ctx.range;
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
    var group = function (title, stats) { return h('div.dash-group', h('h2.subhead.dash-head', title), ui.stats(stats)); };
    // The last two weeks of a timeline column, for a stat card's sparkline.
    var spark = function (key) { return series(key).slice(-14); };
    return {
      attention: function () {
        var card = ui.card({ title: 'Needs your attention', sub: attention.length ? fmt.plural(attention.length, 'thing to look at', 'things to look at') : 'All clear', body: ui.attention(attention) });
        card.classList.add('dash-attention');
        return card;
      },
      // Which app builds people run, newest first, from the same answer.
      versions: function () {
        var by = {};
        arr(d.versions).forEach(function (v) {
          var key = String(v.appVersion || 'unknown');
          var row = by[key] || (by[key] = { label: key === 'unknown' ? 'Unknown version' : 'Version ' + key, value: 0, plats: [] });
          row.value += num(v.users != null ? v.users : v.listeners);
          var p = VX.platformName(v.platform);
          if (row.plats.indexOf(p) < 0) row.plats.push(p);
        });
        var items = Object.keys(by).map(function (key) { var r = by[key]; return { label: r.label, value: r.value, sub: r.plats.join(', '), key: key }; })
          .sort(function (a, b) { return b.value - a.value; });
        return chartCard('App versions in use', 'Everyone signed in, by the app version they last used', go('app-versions'),
          ui.hbars(items, { limit: 6, empty: 'No versions reported yet' }));
      },
      // 2.0 — the jobs an admin comes here for, one tap each. Changes are for
      // editors and owners: a viewer sees only the read-only ones.
      quick: function () {
        var actions = [
          { label: 'Send a notification', icon: 'send', page: 'send-notification', edit: true },
          { label: 'Edit the home screen', icon: 'layout', page: 'app-settings/home-screen', edit: true },
          { label: 'Block a song or album', icon: 'lock', page: 'blocked-music', edit: true },
          { label: 'Turn on maintenance', icon: 'wrench', page: 'app-settings/maintenance', edit: true },
          { label: 'See app errors', icon: 'alert', page: 'app-errors' },
          { label: 'Read feedback', icon: 'inbox', page: 'feedback' },
          { label: 'Invite an admin', icon: 'shield', page: 'admins', owner: true }
        ].filter(function (a) { return a.owner ? VX.can('owner') : !a.edit || VX.can('edit'); });
        return ui.card({ title: 'Quick actions', body: h('div.dash-quick', actions.map(function (a, i) {
          return ui.button(a.label, { kind: i === 0 && a.edit ? 'primary' : 'ghost', icon: a.icon, onClick: go(a.page) });
        })) });
      },
      today: function () {
        return group('Right now and today', [
          { label: 'Listening right now', value: fmt.num(k.activeNow), sub: fmt.num(k.playingNow) + ' playing a song', tone: num(k.activeNow) ? 'ok' : null,
            info: 'Signed-in people who had the app open in the last 90 seconds.', onClick: go('listening-now') },
          { label: 'Plays today', value: fmt.num(k.playsToday), delta: VX.change(k.playsToday, k.playsYesterday), deltaLabel: 'vs yesterday', spark: spark('plays'),
            info: 'Songs played today (India time) by signed-in users.', onClick: go('top-songs', null, { range: '1' }) },
          { label: 'Total users', value: fmt.num(k.users != null ? k.users : k.accounts),
            info: 'Everyone who has ever signed in to VinaX with Google.', onClick: go('users') },
          { label: 'New users this week', value: fmt.num(k.newAccounts7d), delta: VX.change(k.newAccounts7d, k.newAccountsPrev7d), deltaLabel: 'vs last week',
            spark: spark('newListeners'), info: 'People who signed in with Google for the first time in the last 7 days.', onClick: go('users', null, { joined: '7', sort: 'joined' }) }
        ]);
      },
      map: function () {
        var card = ui.card({ title: 'Where people are listening', sub: 'Signed-in people with the app open in the last 5 minutes',
          actions: [ui.button('Listening Now', { kind: 'ghost', small: true, icon: 'chevron', onClick: go('listening-now') })], body: h('div') });
        ui.load(card.body, function () { return VX.api.get('/api/admin/live'); }, function (live) {
          var points = arr(obj(live).listening).map(function (r) { return { country: r.country, city: r.city, count: 1, playing: r.isPlaying && r.song ? 1 : 0 }; });
          return VX.worldMap(points);
        }, { skeleton: 3 });
        return card;
      },
      usage: function () {
        return group('How many people use the app', [
          { label: 'Active today', value: fmt.num(k.dau), delta: VX.change(k.dau, k.dauPrev), deltaLabel: 'vs the day before', spark: spark('listeners'),
            info: 'Signed-in people who used the app in the last 24 hours.', onClick: go('users', null, { active: '1' }) },
          { label: 'Active this week', value: fmt.num(k.wau), delta: VX.change(k.wau, k.wauPrev), deltaLabel: 'vs last week',
            info: 'Signed-in people who used the app in the last 7 days.', onClick: go('users', null, { active: '7' }) },
          { label: 'Active this month', value: fmt.num(k.mau), delta: VX.change(k.mau, k.mauPrev), deltaLabel: 'vs last month',
            info: 'Signed-in people who used the app in the last 30 days.', onClick: go('users', null, { active: '30' }) },
          { label: 'Daily ÷ monthly', value: num(k.mau) ? fmt.pct(num(k.dau) / num(k.mau) * 100) : '—', sub: 'How sticky the app is',
            info: 'Active today divided by active this month. The higher it is, the more of this month\'s people come back every day.' }
        ]);
      },
      watch: function () {
        return group('Things to keep an eye on', [
          { label: 'App errors (24 h)', value: fmt.num(k.errors24h), delta: VX.change(k.errors24h, k.errorsPrev24h), deltaLabel: 'vs the day before', inverse: true, spark: spark('errors'),
            tone: num(k.errors24h) > 20 ? 'bad' : num(k.errors24h) > 0 ? 'warn' : null,
            info: 'Problems the app reported in the last 24 hours, such as a song that would not download. Counts every report.', onClick: go('app-errors', null, { range: '1' }) },
          { label: 'New feedback', value: fmt.num(k.feedbackNew), tone: num(k.feedbackNew) ? 'warn' : null,
            info: 'Messages from Settings → Feedback in the app that nobody has read yet.', onClick: go('feedback') },
          { label: 'Phones ready for notifications', value: fmt.num(k.pushPeople != null ? k.pushPeople : k.pushDevices), sub: fmt.plural(k.pushDevices, 'phone or browser', 'phones and browsers'),
            info: 'Signed-in people with at least one phone or browser that can receive a notification from Send Notification.', onClick: go('notification-setup') },
          { label: 'Listen Together rooms live', value: fmt.num(k.roomsActive),
            info: 'Rooms where friends are listening to the same song together, active in the last 15 minutes.', onClick: go('listen-together') }
        ]);
      },
      plays: function () {
        return chartCard('Plays and active users per day', span, go('top-songs', null, rangeParams(range)),
          ui.chart({ labels: days, type: 'area', height: 260, title: 'Plays and active users per day',
            series: [{ name: 'Plays', values: series('plays') }, { name: 'Active users', values: series('listeners'), color: 'var(--c3)' }],
            empty: 'No plays in this period', emptyHint: 'Plays by signed-in users show up here.' }));
      },
      platforms: function () {
        return chartCard('Users by platform', 'Everyone signed in', go('users'),
          ui.share(platforms.map(function (p) { return { label: VX.platformName(p.platform), value: num(p.users != null ? p.users : p.listeners) }; }), { title: 'Users by platform', empty: 'No users yet', totalLabel: 'users' }));
      },
      newUsers: function () {
        return chartCard('New users per day', span, go('users', null, { sort: 'joined' }),
          ui.chart({ labels: days, type: 'bar', height: 200, title: 'New users per day',
            series: [{ name: 'New users', values: series('newListeners') }], empty: 'Nobody new in this period' }));
      },
      searches: function () {
        return chartCard('Searches and errors per day', span, go('app-errors', null, rangeParams(range)),
          ui.chart({ labels: days, type: 'line', height: 200, title: 'Searches and errors per day',
            series: [{ name: 'Searches', values: series('searches'), color: 'var(--c2)' }, { name: 'Errors', values: series('errors'), color: 'var(--c5)' }],
            empty: 'No searches or errors in this period' }));
      }
    };
  }

  function rangeParams(range) {
    return range.key === 'custom' ? { range: 'custom', from: range.from, to: range.to } : { range: range.key };
  }

  function chartCard(title, sub, onOpen, body) {
    var card = ui.card({ title: title, sub: sub,
      actions: [h('button.icon-btn.sm', { type: 'button', 'aria-label': 'See details: ' + title, title: 'See details', onclick: onOpen }, VX.icon('chevron'))], body: body });
    card.classList.add('chart-card');
    return card;
  }
})();
