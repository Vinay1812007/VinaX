/* VinaX console — Growth & engagement page.
 * How the audience grows, comes back and uses the app:
 *   Growth          /api/admin/growth (+ accounts from /api/admin/overview)
 *   Engagement      /api/admin/engagement?days=
 *   Retention       /api/admin/retention — weekly cohorts; the server sends COUNTS,
 *                   percentages are computed here (count ÷ cohort size) and
 *                   windows that have not fully elapsed are marked
 *   Funnel          /api/admin/funnel?days= (server allows 1–30)
 *   Segments        /api/admin/insights (segments use fixed 7/30-day windows)
 *   Feature usage   /api/admin/usage?days= (1–30)
 *   Heatmap         /api/admin/usage?days= — 7×24 grid of plays, India time
 *   Insights        /api/admin/digest + /api/admin/insights?days= (languages, rising songs) */
(function () {
  'use strict';
  var VX = window.VX, h = VX.h, ui = VX.ui, fmt = VX.fmt;

  VX.page({
    id: 'audience', title: 'Growth & engagement', group: 'Audience', icon: 'growth',
    desc: 'New listeners, how often they come back, what they do and when they listen.',
    tabs: [
      { id: 'growth', label: 'Growth', desc: 'New listener devices per day (UTC) and signed-in accounts.', render: renderGrowth },
      { id: 'engagement', label: 'Engagement', desc: 'What listeners do with songs: finish, skip, like, repeat.', render: renderEngagement },
      { id: 'retention', label: 'Retention', desc: 'Weekly cohorts of new devices and the share that came back.', render: renderRetention },
      { id: 'funnel', label: 'Funnel', desc: 'How many devices reached each step in the window.', render: renderFunnel },
      { id: 'segments', label: 'Segments', desc: 'Listeners grouped by how recently and how much they listen.', render: renderSegments },
      { id: 'usage', label: 'Feature usage', desc: 'Events by type and platform.', render: renderUsage },
      { id: 'heatmap', label: 'Heatmap', desc: 'When people listen, by day of week and hour (India time).', render: renderHeatmap },
      { id: 'insights', label: 'Insights', desc: 'The weekly digest, languages and songs on the rise.', render: renderInsights }
    ]
  });

  /* ------------------------------------------------------------ helpers */

  var DAY_MS = 86400000;
  function notConnected() {
    return ui.empty('Database not connected', 'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the Worker to see audience numbers.');
  }
  function rangePicker(ctx, days, options) {
    var opts = (options || [1, 7, 30, 90]).map(function (v) { return { value: v, label: v === 1 ? '24h' : v + 'd' }; });
    return h('div.toolbar', ui.segmented(opts, days, function (v) { ctx.setParam('days', v); ctx.refresh(); }, 'Time range'));
  }
  function daysParam(ctx, max) { var d = Number(ctx.params.days) || 7; return Math.max(1, Math.min(max || 90, d)); }
  function share(n, of) { return Number(of) > 0 ? Number(n) / Number(of) : null; }
  function windowText(days) { return days === 1 ? 'last 24 hours' : 'last ' + days + ' days'; }

  var TYPE_LABEL = {
    play: 'Plays', complete: 'Songs finished', skip: 'Skips', search: 'Searches', favorite: 'Likes', download: 'Downloads',
    share: 'Shares', error: 'Errors', open: 'App opens', register: 'Names chosen', heartbeat: 'Listening check-ins',
    playlist: 'Playlist actions', 'site-mode': 'Site mode changes', 'weekly-digest': 'Weekly digests'
  };
  function typeLabel(t) { return TYPE_LABEL[t] || (t ? String(t).charAt(0).toUpperCase() + String(t).slice(1).replace(/[-_]/g, ' ') : 'Other'); }
  function platformLabel(p) {
    var v = String(p || '').toLowerCase();
    if (!v || v === 'web') return 'Web';
    if (v === 'android') return 'Android';
    if (v === 'ios') return 'iOS';
    if (v === 'pwa') return 'Installed web app';
    return v.charAt(0).toUpperCase() + v.slice(1);
  }

  /* -------------------------------------------------------------- Growth */

  function renderGrowth(host, ctx) {
    var body = h('div');
    host.appendChild(body);
    return ui.load(body, function () {
      return Promise.all([VX.api.get('/api/admin/growth'), VX.api.get('/api/admin/overview')]).then(function (r) {
        if (!r[0].ok) return r[0];
        return { ok: true, data: { growth: r[0].data || {}, overview: r[1].ok ? r[1].data || {} : null } };
      });
    }, function (d) {
      var g = d.growth;
      if (g.configured === false) return notConnected();
      var days = (g.days || []).map(function (n) { return Number(n) || 0; });
      while (days.length < 14) days.unshift(0);
      var labels = VX.fillDays([], 14, 'day', []).labels;
      var last = Number(g.last14) || 0, prev = Number(g.prev14) || 0;
      var best = days.reduce(function (b, v, i) { return v > b.v ? { v: v, i: i } : b; }, { v: 0, i: -1 });
      var acc = (d.overview && d.overview.accounts) || null;
      var sm = (d.overview && d.overview.summary) || {};
      var empty = !last && !prev;
      return h('div.page-body',
        g.sampled ? ui.notice('More than 5,000 devices joined in 28 days, so these numbers are counted from the newest 5,000.', 'warn') : null,
        ui.kpis([
          { label: 'New devices · 14 days', value: fmt.num(last), delta: prev ? (last - prev) / prev * 100 : null, sub: prev ? 'vs ' + fmt.num(prev) + ' in the 14 before' : 'none in the 14 before' },
          { label: 'Per day', value: fmt.num(Math.round(last / 14 * 10) / 10), sub: 'average · 14 days' },
          { label: 'Best day', value: best.i >= 0 ? fmt.num(best.v) : '—', sub: best.i >= 0 ? fmt.day(labels[best.i]) : 'no new devices yet' },
          { label: 'Today', value: fmt.num(days[13]), sub: 'new devices (UTC day)' },
          acc ? { label: 'Signed-in accounts', value: fmt.num(acc.total), sub: fmt.num(acc.newToday) + ' new today · ' + fmt.num(acc.active7d) + ' active this week' } : null,
          sm.total_users != null ? { label: 'Listener devices', value: fmt.num(sm.total_users), sub: 'all time' } : null
        ]),
        ui.card({
          title: 'New listener devices per day', sub: 'First seen · last 14 days (UTC)',
          body: ui.chart({ labels: labels, series: [{ name: 'New devices', values: days }], type: 'bar', height: 240,
            empty: 'No new devices yet', emptyHint: 'Each device that opens the app with usage sharing on counts once, on its first day.' })
        }),
        empty ? ui.notice('Growth counts listener devices that share usage. Google accounts are counted under “Signed-in accounts”.', 'info') : null
      );
    }, { skeleton: 6 });
  }

  /* ---------------------------------------------------------- Engagement */

  function renderEngagement(host, ctx) {
    var days = daysParam(ctx, 90);
    var body = h('div');
    host.appendChild(rangePicker(ctx, days));
    host.appendChild(body);
    return ui.load(body, function () { return VX.api.get('/api/admin/engagement', { days: days }); }, function (d) {
      if (d.configured === false) return notConnected();
      var w = windowText(d.days || days);
      var events = ['plays', 'skips', 'completes', 'favorites', 'downloads', 'shares'].reduce(function (a, k) { return a + (Number(d[k]) || 0); }, 0);
      var ret = d.retention || {};
      var rate = function (label, v, sub, tone) {
        return h('div', { style: { display: 'grid', gap: '6px' } },
          h('div', { style: { display: 'flex', 'justify-content': 'space-between', gap: '8px' } }, h('strong', label), h('span', events ? fmt.pct(v) : '—')),
          ui.meter(events ? Number(v) / 100 : 0, tone), h('p.muted.small', sub));
      };
      var retCell = function (v) { return v == null ? '—' : fmt.pct(v); };
      return h('div.page-body',
        events >= 5000 ? ui.notice('There were more than 5,000 events in this window; counts and rates come from the newest 5,000. Pick a shorter window for exact numbers.', 'warn') : null,
        !events ? ui.notice('No plays in the ' + w + ' yet. These numbers fill in as listeners play, finish, skip and like songs.', 'info') : null,
        ui.kpis([
          { label: 'Plays', value: fmt.num(d.plays), sub: w },
          { label: 'Finished', value: fmt.num(d.completes), sub: 'songs played to the end' },
          { label: 'Skips', value: fmt.num(d.skips) },
          { label: 'Likes', value: fmt.num(d.favorites) },
          { label: 'Downloads', value: fmt.num(d.downloads) },
          { label: 'Shares', value: fmt.num(d.shares) },
          { label: 'Plays per listener', value: Number(d.plays) ? fmt.num(d.avgPlaysPerUser) : '—', sub: 'among devices that played' }
        ]),
        ui.grid([
          ui.card({ title: 'How songs are received', sub: w, body: h('div', { style: { display: 'grid', gap: '16px' } },
            rate('Finished', d.completionRate, 'Songs finished ÷ songs played.', 'ok'),
            rate('Skipped', d.skipRate, 'Skips ÷ (plays + skips). Lower is better.', Number(d.skipRate) > 40 ? 'warn' : null),
            rate('Played again', d.repeatRate, 'Share of listener–song pairs played more than once.', null)) }),
          ui.card({ title: 'Coming back', sub: 'Approximate · from listener devices',
            body: [
              ui.kpis([
                { label: 'After 1 day', value: retCell(ret.d1) },
                { label: 'After 7 days', value: retCell(ret.d7) },
                { label: 'After 30 days', value: retCell(ret.d30) }
              ]),
              h('p.muted.small', 'Of devices that joined between 2N and N days ago, the share seen again in the last N days. “—” means no device joined in that window yet. The Retention tab has exact weekly cohorts.')
            ] }),
          ui.card({ title: 'Event mix', sub: w, body: ui.share([
            { label: 'Plays', value: d.plays }, { label: 'Finished', value: d.completes }, { label: 'Skips', value: d.skips },
            { label: 'Likes', value: d.favorites }, { label: 'Downloads', value: d.downloads }, { label: 'Shares', value: d.shares }
          ], { empty: 'No events in this window' }) })
        ])
      );
    }, { skeleton: 6 });
  }

  /* ----------------------------------------------------------- Retention */

  // Return windows, in days after a device's first event (see vinax_retention in vinax-13.sql).
  var WINDOWS = [
    { key: 'd1', label: 'Day 1', hint: 'came back 1–2 days after their first visit', start: 1, end: 2 },
    { key: 'd7', label: 'Week 1', hint: 'came back on days 2–7', start: 2, end: 8 },
    { key: 'd30', label: 'Month 1', hint: 'came back on days 8–30', start: 8, end: 31 }
  ];

  function cohortStart(ymd) {
    var m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
  }
  /** 'none' = nobody in the cohort can have returned yet; 'partial' = some can; 'done' = the window has passed for everyone. */
  function windowState(weekStart, w, now) {
    if (isNaN(weekStart)) return 'done';
    if (now < weekStart + w.start * DAY_MS) return 'none';
    if (now < weekStart + (7 + w.end) * DAY_MS) return 'partial';
    return 'done';
  }

  function renderRetention(host, ctx) {
    var body = h('div');
    host.appendChild(body);
    return ui.load(body, function () { return VX.api.get('/api/admin/retention'); }, function (d) {
      if (d.configured === false) return ui.empty('Retention is not available', 'Either the database is not connected, or the vinax_retention function is missing — run frontend/supabase/vinax-13.sql in the database SQL editor.');
      var now = Date.now();
      var cohorts = (d.cohorts || []).slice().sort(function (a, b) { return String(b.cohort_week).localeCompare(String(a.cohort_week)); });
      if (!cohorts.length) return ui.empty('No cohorts yet', 'Each week’s new devices form a cohort. The first one appears after listeners use the app; return rates fill in over the following days and weeks.');

      // Weighted averages over cohorts whose window has fully passed.
      var avg = WINDOWS.map(function (w) {
        var n = 0, size = 0;
        cohorts.forEach(function (c) {
          if (windowState(cohortStart(c.cohort_week), w, now) !== 'done') return;
          n += Number(c[w.key]) || 0; size += Number(c.cohort_size) || 0;
        });
        return size ? n / size : null;
      });
      var totalNew = cohorts.reduce(function (a, c) { return a + (Number(c.cohort_size) || 0); }, 0);

      var cell = function (c, w) {
        var size = Number(c.cohort_size) || 0;
        var n = Number(c[w.key]) || 0;
        var st = windowState(cohortStart(c.cohort_week), w, now);
        if (st === 'none') return h('td.right', { style: { 'vertical-align': 'middle' } }, h('span.muted.small', 'not yet'));
        var r = size ? n / size : 0;
        var alpha = Math.round(Math.min(1, r) * 70 + (r > 0 ? 8 : 0));
        return h('td.right', {
          title: fmt.num(n) + ' of ' + fmt.num(size) + ' ' + w.hint + (st === 'partial' ? ' (so far — this window is still open for part of the cohort)' : ''),
          style: { background: 'color-mix(in srgb, var(--accent) ' + alpha + '%, transparent)', 'vertical-align': 'middle' }
        },
          h('strong', fmt.ratio(r)),
          h('div.cell-sub', fmt.num(n) + (st === 'partial' ? ' · so far' : '')));
      };

      var table = h('table.tbl',
        h('thead', h('tr',
          h('th', { scope: 'col' }, 'Cohort (week of)'),
          h('th.right', { scope: 'col' }, 'New devices'),
          WINDOWS.map(function (w) { return h('th.right', { scope: 'col', title: w.hint }, w.label); }))),
        h('tbody', cohorts.map(function (c) {
          var mid = { 'vertical-align': 'middle' };
          return h('tr', h('th', { scope: 'row', style: mid }, fmt.day(c.cohort_week)), h('td.right', { style: mid }, fmt.num(c.cohort_size)), WINDOWS.map(function (w) { return cell(c, w); }));
        })));

      return h('div.page-body',
        ui.kpis([
          { label: 'New devices', value: fmt.num(totalNew), sub: 'in these ' + fmt.plural(cohorts.length, 'cohort') },
          { label: 'Back on day 1', value: avg[0] == null ? '—' : fmt.ratio(avg[0]), sub: avg[0] == null ? 'no finished cohort yet' : 'weighted, finished cohorts' },
          { label: 'Back in week 1', value: avg[1] == null ? '—' : fmt.ratio(avg[1]), sub: avg[1] == null ? 'no finished cohort yet' : 'days 2–7' },
          { label: 'Back in month 1', value: avg[2] == null ? '—' : fmt.ratio(avg[2]), sub: avg[2] == null ? 'no finished cohort yet' : 'days 8–30' }
        ]),
        ui.card({
          title: 'Weekly cohorts', sub: 'Devices grouped by the week (UTC, from Monday) of their first event · last 8 weeks', pad: false,
          actions: [ui.button('CSV', { kind: 'ghost', small: true, icon: 'download', onClick: function () {
            VX.download.csv('vinax-retention-' + VX.stamp(), cohorts.map(function (c) {
              var row = { cohort_week: c.cohort_week, new_devices: c.cohort_size };
              WINDOWS.forEach(function (w) {
                var size = Number(c.cohort_size) || 0;
                row[w.key + '_returned'] = c[w.key];
                row[w.key + '_pct'] = size ? Math.round((Number(c[w.key]) || 0) / size * 1000) / 10 : '';
                row[w.key + '_window'] = windowState(cohortStart(c.cohort_week), w, now);
              });
              return row;
            }));
            return null;
          } })],
          body: [h('div.tbl-scroll', table),
            h('div.card-body', h('p.muted.small',
              'Each cell is the share of that week’s new devices that came back in the window: Day 1 = 1–2 days after their first visit, Week 1 = days 2–7, Month 1 = days 8–30. ',
              '“so far” means the window is still open for devices that joined late in the week, so the number can still grow; “not yet” means nobody in the cohort has reached it.'))]
        })
      );
    }, { skeleton: 8 });
  }

  /* -------------------------------------------------------------- Funnel */

  function renderFunnel(host, ctx) {
    var days = daysParam(ctx, 30);
    if ([1, 7, 30].indexOf(days) < 0) days = 7;
    var body = h('div');
    host.appendChild(rangePicker(ctx, days, [1, 7, 30]));
    host.appendChild(body);
    return ui.load(body, function () { return VX.api.get('/api/admin/funnel', { days: days }); }, function (d) {
      if (d.configured === false) return notConnected();
      var steps = d.steps || [];
      var base = steps.length ? Number(steps[0].devices) || 0 : 0;
      var w = windowText(d.days || days);
      if (!base) return ui.empty('No one opened the app in the ' + w, 'The funnel fills in as listeners open the app, choose a name, play and like songs.');
      var by = {};
      steps.forEach(function (s) { by[s.id] = Number(s.devices) || 0; });
      return h('div.page-body',
        d.source === 'sampled' ? ui.notice('Estimated from a sample of ' + fmt.num(d.sampled) + ' events (the exact database function was unavailable).', 'warn') : null,
        ui.kpis([
          { label: 'Opened the app', value: fmt.num(base), sub: 'devices · ' + w },
          { label: 'Played a song', value: fmt.ratio(share(by.play, base)), sub: fmt.num(by.play) + ' devices' },
          { label: 'Finished a song', value: fmt.ratio(share(by.complete, base)), sub: fmt.num(by.complete) + ' devices' },
          { label: 'Liked a song', value: fmt.ratio(share(by.favorite, base)), sub: fmt.num(by.favorite) + ' devices' }
        ]),
        ui.card({
          title: 'Steps', sub: 'Share of the devices that opened the app · ' + w,
          body: [
            ui.hbars(steps.map(function (s) {
              return { label: s.label || s.id, value: Number(s.devices) || 0, sub: fmt.ratio(share(s.devices, base)) + ' of everyone who opened' };
            }), { limit: 10 }),
            h('p.muted.small', 'Steps are counted independently — a device can search without playing — so later steps can be larger than earlier ones.')
          ]
        })
      );
    }, { skeleton: 6 });
  }

  /* ------------------------------------------------------------ Segments */

  function renderSegments(host, ctx) {
    var body = h('div');
    host.appendChild(body);
    return ui.load(body, function () { return VX.api.get('/api/admin/insights', { days: 7 }); }, function (d) {
      if (d.configured === false) return notConnected();
      var s = d.segments || {};
      var n = function (k) { return Number(s[k]) || 0; };
      var activeWeek = n('new_7d') + n('returning_7d');
      var all = activeWeek + n('inactive_30d');
      if (!all && !n('power_users')) return ui.empty('No listeners to group yet', 'Segments fill in as listener devices open the app over the coming days.');
      return h('div.page-body',
        ui.kpis([
          { label: 'New this week', value: fmt.num(n('new_7d')), sub: 'first seen in the last 7 days', tone: n('new_7d') ? 'ok' : null },
          { label: 'Returning', value: fmt.num(n('returning_7d')), sub: 'seen this week, joined earlier' },
          { label: 'Drifting away', value: fmt.num(n('inactive_30d')), sub: 'last seen 7–30 days ago', tone: n('inactive_30d') > activeWeek ? 'warn' : null },
          { label: 'Power listeners', value: fmt.num(n('power_users')), sub: '20+ plays in 30 days' }
        ]),
        ui.grid([
          ui.card({ title: 'Listeners seen in the last 30 days', sub: 'Each device is in exactly one of these groups',
            body: ui.share([
              { label: 'New this week', value: n('new_7d') },
              { label: 'Returning this week', value: n('returning_7d') },
              { label: 'Drifting away (7–30 days)', value: n('inactive_30d') }
            ], { empty: 'No listeners in the last 30 days' }) }),
          ui.card({ title: 'What the groups mean', body: ui.dl([
            ['New this week', 'Devices whose first visit was in the last 7 days.'],
            ['Returning', 'Devices seen in the last 7 days that first visited earlier — the core audience.'],
            ['Drifting away', 'Devices last seen 7–30 days ago. A push message can bring them back.'],
            ['Power listeners', 'Devices with 20 or more plays in the last 30 days. They overlap the groups above.'],
            ['Weekly active', fmt.num(activeWeek) + ' devices (new + returning)'],
            ['Power share', activeWeek ? fmt.ratio(n('power_users') / activeWeek) + ' of weekly active' : '—']
          ]) })
        ]),
        h('p.muted.small', 'Segments use fixed windows and count listener devices that share usage; signed-in accounts without a device are not included.')
      );
    }, { skeleton: 6 });
  }

  /* ------------------------------------------------------- Feature usage */

  function renderUsage(host, ctx) {
    var days = daysParam(ctx, 30);
    if ([1, 7, 30].indexOf(days) < 0) days = 7;
    var body = h('div');
    host.appendChild(rangePicker(ctx, days, [1, 7, 30]));
    host.appendChild(body);
    return ui.load(body, function () { return VX.api.get('/api/admin/usage', { days: days }); }, function (d) {
      if (d.configured === false || !d.byType) return notConnected();
      var w = windowText(d.days || days);
      var types = (d.byType || []).filter(function (t) { return t && t.type !== 'heartbeat'; });
      var total = types.reduce(function (a, t) { return a + (Number(t.n) || 0); }, 0);
      var hb = (d.byType || []).filter(function (t) { return t && t.type === 'heartbeat'; })[0];
      var rows = types.map(function (t) { return { type: t.type, label: typeLabel(t.type), n: Number(t.n) || 0, devices: Number(t.devices) || 0, share: total ? (Number(t.n) || 0) / total : 0 }; });
      return h('div.page-body',
        d.source === 'sampled' ? ui.notice('Estimated from a sample of ' + fmt.num(d.sampled) + ' events (the exact database function was unavailable).', 'warn') : null,
        ui.kpis([
          { label: 'Events', value: fmt.num(total), sub: w + ' · excluding check-ins' },
          { label: 'Features used', value: fmt.num(rows.length), sub: 'different event types' },
          { label: 'Most used', value: rows[0] ? rows[0].label : '—', sub: rows[0] ? fmt.num(rows[0].n) + ' events' : 'nothing yet' },
          { label: 'Listening check-ins', value: hb ? fmt.num(hb.n) : '0', sub: hb ? fmt.num(hb.devices) + ' devices' : 'sent while a song plays' }
        ]),
        ui.grid([
          ui.card({ title: 'By feature', sub: w, span: 2, pad: false, body: ui.table({
            columns: [
              { key: 'label', label: 'Feature' },
              { key: 'n', label: 'Events', align: 'right', render: function (r) { return fmt.num(r.n); } },
              { key: 'devices', label: 'Listeners', align: 'right', render: function (r) { return fmt.num(r.devices); } },
              { key: 'share', label: 'Share of events', render: function (r) {
                return h('div', { style: { display: 'grid', 'grid-template-columns': '48px 1fr', gap: '8px', 'align-items': 'center', 'min-width': '140px' } }, h('span.small', fmt.ratio(r.share)), ui.meter(r.share));
              } },
              { key: 'type', label: 'Event name', render: function (r) { return ui.mono(r.type); } }
            ],
            rows: rows, sortKey: 'n', sortDir: 'desc', exportName: 'vinax-feature-usage-' + days + 'd', pageSize: 25,
            empty: 'No events in this window', emptyHint: 'Searches, plays, likes, downloads and shares are counted here as listeners use them.'
          }) }),
          ui.card({ title: 'By platform', sub: 'Events · ' + w, body: ui.share((d.byPlatform || []).map(function (p) { return { label: platformLabel(p.platform), value: p.n }; }), { empty: 'No events in this window' }) })
        ])
      );
    }, { skeleton: 6 });
  }

  /* ------------------------------------------------------------- Heatmap */

  var DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first
  function hourLabel(hr) { return (hr % 12 === 0 ? 12 : hr % 12) + (hr < 12 ? ' am' : ' pm'); }

  function renderHeatmap(host, ctx) {
    var days = daysParam(ctx, 30);
    if ([7, 30].indexOf(days) < 0) days = 7;
    var body = h('div');
    host.appendChild(rangePicker(ctx, days, [7, 30]));
    host.appendChild(body);
    return ui.load(body, function () { return VX.api.get('/api/admin/usage', { days: days }); }, function (d) {
      if (d.configured === false || !d.byType) return notConnected();
      var grid = [];
      for (var i = 0; i < 7; i++) {
        var row = (d.heatmap && d.heatmap[i]) || [];
        grid.push([]);
        for (var j = 0; j < 24; j++) grid[i].push(Number(row[j]) || 0);
      }
      var max = 0, total = 0;
      grid.forEach(function (r) { r.forEach(function (v) { max = Math.max(max, v); total += v; }); });
      var w = windowText(d.days || days);
      if (!total) return ui.empty('No listening in the ' + w, 'The heatmap fills in as listeners play songs; each cell is one hour of one weekday.');

      var cells = [h('div.heat-lbl', '')];
      for (var hh = 0; hh < 24; hh++) cells.push(h('div.heat-lbl', hh % 3 === 0 ? String(hh) : ''));
      DAY_ORDER.forEach(function (di) {
        cells.push(h('div.heat-lbl', DAY_NAMES[di]));
        grid[di].forEach(function (v, hr) {
          cells.push(h('div.heat-cell', {
            title: DAY_NAMES[di] + ' ' + hourLabel(hr) + ' · ' + fmt.plural(v, 'listening event'),
            style: { opacity: v ? (0.15 + 0.85 * v / max).toFixed(2) : '0.05', 'aspect-ratio': 'auto', height: '24px' }
          }));
        });
      });
      var byHour = [], byDay = [];
      for (var x = 0; x < 24; x++) byHour.push(grid.reduce(function (a, r) { return a + r[x]; }, 0));
      DAY_ORDER.forEach(function (di) { byDay.push({ label: DAY_NAMES[di], value: grid[di].reduce(function (a, b) { return a + b; }, 0) }); });
      var top = [];
      grid.forEach(function (r, di) { r.forEach(function (v, hr) { if (v) top.push({ label: DAY_NAMES[di] + ' · ' + hourLabel(hr) + '–' + hourLabel((hr + 1) % 24), value: v, cell: { day: di, hour: hr, n: v } }); }); });
      top.sort(function (a, b) { return b.value - a.value; });
      // Peak from the grid itself, so the tile always agrees with the cells.
      var peak = top[0] ? top[0].cell : null;
      var peakText = peak ? DAY_NAMES[peak.day] + ' at ' + hourLabel(peak.hour) : null;
      var busiestDay = byDay.slice().sort(function (a, b) { return b.value - a.value; })[0];

      return h('div.page-body',
        ui.kpis([
          { label: 'Listening events', value: fmt.num(total), sub: 'plays + check-ins · ' + w },
          { label: 'Busiest hour', value: peakText || '—', sub: peak ? fmt.plural(peak.n, 'event') + ' · India time' : null },
          { label: 'Busiest day', value: busiestDay.label, sub: fmt.plural(busiestDay.value, 'event') },
          { label: 'Quietest hours', value: quietRange(byHour), sub: 'least listening · India time' }
        ]),
        ui.card({
          title: 'When people listen', sub: 'Plays plus the check-ins sent every ~25 s while a song plays, so busier cells mean more listening time · India time (IST) · ' + w,
          body: [
            h('div.heat', { role: 'img', 'aria-label': 'Listening heatmap. Busiest: ' + (top.slice(0, 3).map(function (t) { return t.label; }).join(', ') || 'none'), style: { 'grid-template-columns': '34px repeat(24, minmax(0, 1fr))' } }, cells),
            h('p.muted.small', 'Stronger colour = more listening. Hover a cell for its count. Hours run 0–23 across the top.')
          ]
        }),
        ui.grid([
          ui.card({ title: 'By hour of day', sub: 'India time · ' + w, span: 2, body: ui.chart({
            labels: byHour.map(function (_, hr) { return hr; }), series: [{ name: 'Listening events', values: byHour }], type: 'bar', height: 200,
            labelFormat: function (l) { return hourLabel(Number(l)); }
          }) }),
          ui.card({ title: 'Busiest hours', sub: 'Top 6 · ' + w, body: ui.hbars(top, { limit: 6 }) })
        ])
      );
    }, { skeleton: 8 });
  }
  function quietRange(byHour) {
    // The 3-hour window with the fewest plays.
    var best = null;
    for (var s = 0; s < 24; s++) {
      var v = byHour[s] + byHour[(s + 1) % 24] + byHour[(s + 2) % 24];
      if (best == null || v < best.v) best = { s: s, v: v };
    }
    return best ? hourLabel(best.s) + '–' + hourLabel((best.s + 3) % 24) : '—';
  }

  /* ------------------------------------------------------------ Insights */

  function renderInsights(host, ctx) {
    var days = daysParam(ctx, 90);
    var digestSub = h('span');
    var digestCard = ui.card({ title: 'Weekly digest', sub: digestSub, body: null });
    var body = h('div');
    host.appendChild(h('div.page-body', digestCard, rangePicker(ctx, days), body));

    ui.load(digestCard.body, function () { return VX.api.get('/api/admin/digest'); }, function (d) {
      var g = d.digest;
      if (d.configured === false) return ui.empty('Database not connected', 'The weekly digest is stored in the database.');
      if (!g) return ui.empty('No digest yet', 'A summary of the week is saved every Monday morning by the scheduled job; the first one appears after it runs.');
      digestSub.textContent = 'Week of ' + fmt.date(g.week_of) + (d.created_at ? ' · saved ' + fmt.ago(d.created_at) : '');
      return h('div', { style: { display: 'grid', gap: '14px' } },
        ui.kpis([
          { label: 'Active listeners', value: fmt.num(g.active_listeners) },
          { label: 'New listeners', value: fmt.num(g.new_listeners) },
          { label: 'Plays', value: fmt.num(g.plays) },
          { label: 'Searches', value: fmt.num(g.searches) },
          { label: 'Errors', value: fmt.num(g.errors), tone: Number(g.errors) > 0 ? 'warn' : null }
        ]),
        ui.dl([['Top song', g.top_song && g.top_song !== '—' ? g.top_song : null], ['Top search', g.top_search && g.top_search !== '—' ? g.top_search : null]]),
        g.sampled ? h('p.muted.small', 'Counted from a sample of the week’s events.') : null);
    });

    return ui.load(body, function () { return VX.api.get('/api/admin/insights', { days: days }); }, function (d) {
      if (d.configured === false) return notConnected();
      var w = windowText(d.days || days);
      var langs = (d.languages || []).map(function (l) {
        var name = l.language && l.language !== 'unknown' ? String(l.language) : 'Unknown';
        return { label: name.charAt(0).toUpperCase() + name.slice(1), value: Number(l.plays) || 0, listeners: Number(l.listeners) || 0 };
      });
      var trending = (d.trending || []).map(function (t) {
        var now = Number(t.plays) || 0, before = Number(t.prev_plays) || 0;
        return { title: t.song_title, artist: t.song_artist, image: t.song_image, plays: now, prev: before, change: before ? (now - before) / before : null };
      });
      return ui.grid([
        ui.card({ title: 'Languages', sub: 'Plays · ' + w, body: ui.share(langs, { empty: 'No plays in this window' }) }),
        ui.card({ title: 'Languages by listeners', sub: 'Devices that played each · ' + w, body: ui.hbars(langs.map(function (l) { return { label: l.label, value: l.listeners, sub: fmt.plural(l.value, 'play') }; }).sort(function (a, b) { return b.value - a.value; }), { empty: 'No plays in this window' }) }),
        ui.card({ title: 'Songs on the rise', sub: 'Plays in the ' + w + ' vs the window before', span: 'full', pad: false, body: ui.table({
          columns: [
            { key: 'title', label: 'Song', render: function (r) { return ui.media(r.image, r.title, r.artist); }, sortVal: function (r) { return r.title; } },
            { key: 'plays', label: 'Plays', align: 'right', render: function (r) { return fmt.num(r.plays); } },
            { key: 'prev', label: 'Before', align: 'right', render: function (r) { return fmt.num(r.prev); } },
            { key: 'change', label: 'Change', align: 'right', render: function (r) {
              return r.change == null ? ui.pill('New', 'accent') : ui.pill((r.change >= 0 ? '▲ ' : '▼ ') + fmt.ratio(Math.abs(r.change)), r.change >= 0 ? 'ok' : 'warn');
            } }
          ],
          rows: trending, sortKey: 'plays', sortDir: 'desc', exportName: 'vinax-rising-' + days + 'd',
          empty: 'No songs played in this window', emptyHint: 'Songs appear here once listeners play them.'
        }) })
      ]);
    }, { skeleton: 6 });
  }
})();
