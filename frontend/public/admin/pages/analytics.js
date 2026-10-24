/* VinaX console — Analytics page.
 * GET /api/admin/analytics?view=…&days=… — one view per tab: music, places,
 * engagement, retention, funnel, skips. Every tab has a days picker. */
(function () {
  'use strict';
  var VX = window.VX, h = VX.h, ui = VX.ui, fmt = VX.fmt, arr = VX.arr, obj = VX.obj, num = VX.num;

  VX.page({
    id: 'analytics', title: 'Analytics', group: 'Audience', icon: 'growth',
    desc: 'What people listen to, where they are, when they listen, and whether they come back.',
    tabs: [
      { id: 'music', label: 'Music', desc: 'Top songs, artists and languages, and what is rising against the previous period.', render: tab('music', renderMusic) },
      { id: 'places', label: 'Places', desc: 'Countries and cities, from the edge’s coarse geo — never addresses.', render: tab('geo', renderPlaces) },
      { id: 'engagement', label: 'Engagement', desc: 'Activity by day and by hour of the week (IST), the event mix, segments and app versions.', render: tab('engagement', renderEngagement) },
      { id: 'retention', label: 'Retention', desc: 'Weekly cohorts: of the listeners first seen that week, who came back after 1, 7 and 30 days.', render: tab('retention', renderRetention) },
      { id: 'funnel', label: 'Funnel', desc: 'How many listeners reached each step, from opening the app to sharing.', render: tab('funnel', renderFunnel) },
      { id: 'skips', label: 'Skips', desc: 'Songs listeners bail on most, among songs with at least five plays.', render: tab('skips', renderSkips) }
    ]
  });

  function tab(view, draw) {
    return function (host, ctx) {
      var days = num(ctx.params.days) || 7;
      host.appendChild(h('div.toolbar', ui.daysPicker(days, function (v) { ctx.setParam('days', v); ctx.refresh(); })));
      var body = h('div.page-body');
      host.appendChild(body);
      return ui.load(body, function () { return VX.api.get('/api/admin/analytics', { view: view, days: days }); }, function (d) {
        var gate = ui.gate(d, ctx);
        if (gate) return gate;
        return draw(d.data === undefined ? {} : d.data, days, d, ctx);
      }, { skeleton: 8 });
    };
  }

  /* --------------------------------------------------------------- Music */
  function renderMusic(data) {
    var m = obj(data);
    var songs = arr(m.songs), artists = arr(m.artists), languages = arr(m.languages), rising = arr(m.rising);
    var plays = songs.reduce(function (a, s) { return a + num(s.plays); }, 0);
    return [
      ui.kpis([
        { label: 'Songs played', value: fmt.num(songs.length), sub: 'distinct, top ' + fmt.num(songs.length) },
        { label: 'Plays (top songs)', value: fmt.compact(plays) },
        { label: 'Artists', value: fmt.num(artists.length) },
        { label: 'Languages', value: fmt.num(languages.length) }
      ]),
      ui.grid([
        ui.card({ title: 'Top songs', span: 2, pad: false, body: ui.table({
          columns: [
            { key: 'title', label: 'Song', render: function (r) { return ui.media(r.image, r.title || 'Untitled', r.artist); } },
            { key: 'artist', label: 'Artist', hide: true },
            { key: 'plays', label: 'Plays', align: 'right', render: function (r) { return fmt.num(r.plays); } },
            { key: 'listeners', label: 'Listeners', align: 'right', render: function (r) { return fmt.num(r.listeners); } },
            { key: 'id', label: 'Id', render: function (r) { return r.id ? ui.mono(r.id) : null; } }
          ],
          rows: songs, exportName: 'vinax-top-songs', sortKey: 'plays', sortDir: 'desc', empty: 'No plays in this period'
        }) }),
        ui.card({ title: 'Rising', sub: 'Biggest gain over the previous period', body: ui.hbars(rising.map(function (r) { return { label: r.title, sub: (r.artist || '') + ' · was ' + fmt.num(r.prev_plays != null ? r.prev_plays : r.prevPlays), value: num(r.plays) }; }), { empty: 'Nothing rising yet', limit: 15 }) })
      ], 3),
      ui.grid([
        ui.card({ title: 'Top artists', body: ui.hbars(artists.map(function (a) { return { label: a.artist, sub: fmt.plural(a.listeners, 'listener'), value: num(a.plays) }; }), { empty: 'No plays in this period', limit: 15 }) }),
        ui.card({ title: 'Languages', body: ui.share(languages.map(function (l) { return { label: l.language, value: num(l.plays) }; }), { title: 'Plays by language', empty: 'No plays in this period' }) })
      ], 2)
    ];
  }

  /* -------------------------------------------------------------- Places */
  function renderPlaces(data) {
    var g = obj(data);
    var countries = arr(g.countries), cities = arr(g.cities);
    return [
      ui.kpis([
        { label: 'Countries', value: fmt.num(countries.length) },
        { label: 'Cities', value: fmt.num(cities.length) },
        { label: 'Top country', value: countries[0] ? fmt.country(countries[0].country) : '—', sub: countries[0] ? fmt.plural(countries[0].listeners, 'listener') : null }
      ]),
      ui.grid([
        ui.card({ title: 'Countries', pad: false, body: ui.table({
          columns: [
            { key: 'country', label: 'Country', sortVal: function (r) { return fmt.country(r.country); }, render: function (r) { return h('span', fmt.country(r.country), ' ', ui.mono(r.country || 'XX')); } },
            { key: 'listeners', label: 'Listeners', align: 'right', render: function (r) { return fmt.num(r.listeners); } },
            { key: 'plays', label: 'Plays', align: 'right', render: function (r) { return fmt.num(r.plays); } }
          ],
          rows: countries, exportName: 'vinax-countries', sortKey: 'listeners', sortDir: 'desc', empty: 'No activity in this period'
        }) }),
        ui.card({ title: 'Cities', pad: false, body: ui.table({
          columns: [
            { key: 'city', label: 'City', render: function (r) { return h('div', h('div.cell-main', r.city || 'Unknown'), h('div.cell-sub', [r.region, fmt.country(r.country)].filter(function (x) { return x && x !== '—'; }).join(', '))); } },
            { key: 'listeners', label: 'Listeners', align: 'right', render: function (r) { return fmt.num(r.listeners); } },
            { key: 'plays', label: 'Plays', align: 'right', render: function (r) { return fmt.num(r.plays); } }
          ],
          rows: cities, exportName: 'vinax-cities', sortKey: 'listeners', sortDir: 'desc', empty: 'No activity in this period'
        }) })
      ], 2)
    ];
  }

  /* ---------------------------------------------------------- Engagement */
  function renderEngagement(data) {
    var e = obj(data);
    var timeline = arr(e.timeline), hourly = obj(e.hourly), seg = obj(e.segments), peak = obj(hourly.peak);
    var platforms = obj(e.platforms);
    var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return [
      ui.kpis([
        { label: 'Events', value: fmt.compact(e.total) },
        { label: 'New (7d)', value: fmt.num(seg.new7d) },
        { label: 'Returning (7d)', value: fmt.num(seg.returning7d) },
        { label: 'Quiet (7–30d)', value: fmt.num(seg.inactive30d) },
        { label: 'Dormant (30d+)', value: fmt.num(seg.dormant) },
        { label: 'Power listeners', value: fmt.num(seg.power), hint: '20 or more plays in 30 days' },
        { label: 'Peak hour', value: peak.n != null ? DAYS[num(peak.day)] + ' ' + fmt.num(peak.hour) + ':00' : '—', sub: peak.n != null ? fmt.plural(peak.n, 'event') + ' (IST)' : null }
      ]),
      ui.grid([
        ui.card({ title: 'Plays and listeners by day', span: 'full', body: ui.chart({ labels: timeline.map(function (r) { return r.day; }), series: [
          { name: 'Plays', values: timeline.map(function (r) { return num(r.plays); }) },
          { name: 'Listeners', values: timeline.map(function (r) { return num(r.listeners); }) }
        ], type: 'area', height: 220 }) })
      ]),
      ui.grid([
        ui.card({ title: 'Hour of the week', sub: 'Plays and heartbeats, Indian Standard Time', span: 2, body: ui.heatmap(hourly.cells, { label: 'Activity by hour and weekday' }) }),
        ui.card({ title: 'Event mix', pad: false, body: ui.table({
          columns: [
            { key: 'kind', label: 'Kind', render: function (r) { return ui.mono(r.kind); } },
            { key: 'n', label: 'Events', align: 'right', render: function (r) { return fmt.num(r.n); } },
            { key: 'listeners', label: 'Listeners', align: 'right', render: function (r) { return fmt.num(r.listeners); } }
          ],
          rows: arr(e.byKind), exportName: false, search: false, dense: true, pageSize: 30, empty: 'No events in this period'
        }) })
      ], 3),
      ui.grid([
        ui.card({ title: 'Platforms', body: ui.share(arr(e.byPlatform).map(function (p) { return { label: p.platform, value: num(p.n) }; }), { title: 'Events by platform', empty: 'No events in this period' }) }),
        ui.card({ title: 'App versions', sub: 'Everyone in the directory', pad: false, body: ui.table({
          columns: [
            { key: 'platform', label: 'Platform' },
            { key: 'appVersion', label: 'Version', render: function (r) { return ui.mono(r.appVersion || 'unknown'); } },
            { key: 'listeners', label: 'Listeners', align: 'right', render: function (r) { return fmt.num(r.listeners); } }
          ],
          rows: arr(platforms.versions), exportName: 'vinax-versions', search: false, dense: true, pageSize: 20, empty: 'No versions reported'
        }) })
      ], 2)
    ];
  }

  /* ----------------------------------------------------------- Retention */
  function renderRetention(data) {
    var rows = arr(data);
    var pct = function (n, size) { return num(size) ? fmt.pct(num(n) / num(size) * 100) : '—'; };
    return ui.card({ title: 'Weekly cohorts', sub: 'Listeners first seen in the week, and the share back on day 1, in days 2–7, in days 8–30', pad: false, body: ui.table({
      columns: [
        { key: 'week', label: 'Week of', render: function (r) { return fmt.day(r.week); } },
        { key: 'size', label: 'Cohort', align: 'right', render: function (r) { return fmt.num(r.size); } },
        { key: 'd1', label: 'Day 1', align: 'right', render: function (r) { return h('span', pct(r.d1, r.size), h('span.muted.small', ' (' + fmt.num(r.d1) + ')')); } },
        { key: 'd7', label: 'Week 1', align: 'right', render: function (r) { return h('span', pct(r.d7, r.size), h('span.muted.small', ' (' + fmt.num(r.d7) + ')')); } },
        { key: 'd30', label: 'Month 1', align: 'right', render: function (r) { return h('span', pct(r.d30, r.size), h('span.muted.small', ' (' + fmt.num(r.d30) + ')')); } }
      ],
      rows: rows, exportName: 'vinax-retention', search: false, sortKey: 'week', sortDir: 'desc', empty: 'No cohorts yet', emptyHint: 'Cohorts appear once listeners have been around for more than a day.'
    }) });
  }

  /* -------------------------------------------------------------- Funnel */
  function renderFunnel(data) {
    var steps = arr(data);
    var first = steps.length ? num(steps[0].listeners) : 0;
    if (!steps.length) return ui.empty('No funnel data', 'Steps appear once listeners with usage sharing on use the app.');
    return ui.card({ title: 'Steps', sub: 'Distinct listeners who reached each step, as a share of those who opened the app', body: h('div.stack', steps.map(function (s) {
      var ratio = first ? num(s.listeners) / first : 0;
      return h('div', h('div.hb-top', h('span.hb-label', s.label || s.id || 'Step'), h('span.hb-val', fmt.num(s.listeners) + ' · ' + fmt.ratio(ratio))), ui.meter(ratio, null, s.label));
    })) });
  }

  /* --------------------------------------------------------------- Skips */
  function renderSkips(data) {
    var rows = arr(data);
    return ui.card({ title: 'Most skipped', sub: 'Skip rate = skips ÷ plays, songs with at least five plays', pad: false, body: ui.table({
      columns: [
        { key: 'title', label: 'Song', render: function (r) { return ui.media(r.image, r.title || 'Untitled', r.artist); } },
        { key: 'plays', label: 'Plays', align: 'right', render: function (r) { return fmt.num(r.plays); } },
        { key: 'skips', label: 'Skips', align: 'right', render: function (r) { return fmt.num(r.skips); } },
        { key: 'rate', label: 'Skip rate', align: 'right', render: function (r) { return h('span', ui.meter(num(r.rate) / 100, num(r.rate) >= 50 ? 'bad' : null, 'Skip rate'), ' ', fmt.pct(r.rate)); } },
        { key: 'id', label: 'Id', render: function (r) { return r.id ? ui.mono(r.id) : null; } }
      ],
      rows: rows, exportName: 'vinax-skips', sortKey: 'rate', sortDir: 'desc', empty: 'No skipped songs', emptyHint: 'Needs songs with at least five plays and one skip in the period.'
    }) });
  }
})();
