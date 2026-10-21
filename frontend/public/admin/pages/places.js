/* VinaX console — Places page.
 * Where listeners are, from edge geolocation:
 *   Countries & cities  /api/admin/location?days= (countries, top 50 cities, all-time platforms)
 *   World map           the same cities as circles plus /api/admin/live listeners as
 *                       pulsing dots (refreshed every 20 s), drawn with the vendored
 *                       Leaflet (window.L). Common cities have built-in coordinates;
 *                       others are looked up once through the public geocoder allowed
 *                       by the console CSP, throttled to one request per 1.2 s, and
 *                       cached in localStorage (vinax_admin_geo2, shared with the old
 *                       console). Map tiles are public map images (img-src https:). */
(function () {
  'use strict';
  var VX = window.VX, h = VX.h, ui = VX.ui, fmt = VX.fmt;

  VX.page({
    id: 'places', title: 'Places', group: 'Audience', icon: 'globe',
    desc: 'Countries and cities listeners connect from, and a live world map.',
    noAuto: true, // the map refreshes its live layer itself; a full re-render would reset zoom
    tabs: [
      { id: 'geo', label: 'Countries & cities', desc: 'Distinct listener devices per place, from where they connect.', render: renderGeo },
      { id: 'map', label: 'World map', desc: 'Cities from the chosen window, and who is listening right now.', render: renderMap }
    ]
  });

  /* ------------------------------------------------------------ helpers */

  function notConnected() {
    return ui.empty('Database not connected', 'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the Worker to see where listeners are.');
  }
  function countryName(cc) { return !cc || cc === '??' || cc === 'XX' ? 'Unknown' : fmt.country(cc); }
  function platformLabel(p) {
    var v = String(p || '').toLowerCase();
    if (!v || v === 'web') return 'Web';
    if (v === 'android') return 'Android';
    if (v === 'ios') return 'iOS';
    if (v === 'pwa') return 'Installed web app';
    return v.charAt(0).toUpperCase() + v.slice(1);
  }
  function windowText(days) { return days === 1 ? 'last 24 hours' : 'last ' + days + ' days'; }
  function daysParam(ctx) { var d = Number(ctx.params.days) || 7; return [1, 7, 30, 90].indexOf(d) >= 0 ? d : 7; }

  /* ------------------------------------------------- Countries & cities */

  function renderGeo(host, ctx) {
    var days = daysParam(ctx);
    var body = h('div');
    host.appendChild(h('div.toolbar', ui.daysPicker(days, function (d) { ctx.setParam('days', d); ctx.refresh(); })));
    host.appendChild(body);
    return ui.load(body, function () { return VX.api.get('/api/admin/location', { days: days }); }, function (d) {
      if (d.configured === false) return notConnected();
      var w = windowText(d.days || days);
      var countries = (d.countries || []).map(function (c) { return { cc: c.country, label: countryName(c.country), value: Number(c.listeners) || 0 }; });
      var cities = (d.cities || []).map(function (c) {
        var l = Number(c.listeners) || 0, p = Number(c.plays) || 0;
        return { city: c.city && c.city !== 'Unknown' ? c.city : null, country: countryName(c.country), cc: c.country, listeners: l, plays: p, per: l ? p / l : 0 };
      });
      var totalListeners = countries.reduce(function (a, c) { return a + c.value; }, 0);
      var known = countries.filter(function (c) { return c.label !== 'Unknown'; });
      var platforms = (d.platforms || []).map(function (p) { return { label: platformLabel(p.platform), value: Number(p.listeners) || 0 }; });

      if (!countries.length && !cities.length) {
        return h('div.page-body',
          ui.empty('No locations in the ' + w, 'Countries and cities appear as listeners use the app — they come from where each connection is made, no permission needed.'),
          platforms.length ? ui.card({ title: 'Platforms', sub: 'All listener devices, all time', body: ui.share(platforms) }) : null);
      }
      return h('div.page-body',
        ui.kpis([
          { label: 'Countries', value: fmt.num(known.length), sub: w },
          { label: 'Cities', value: fmt.num(cities.filter(function (c) { return c.city; }).length) + ((d.cities || []).length >= 50 ? '+' : ''), sub: (d.cities || []).length >= 50 ? 'top 50 shown' : w },
          { label: 'Top country', value: known[0] ? known[0].label : '—', sub: known[0] ? fmt.plural(known[0].value, 'listener') : null },
          { label: 'Top city', value: cities[0] && cities[0].city ? cities[0].city : '—', sub: cities[0] ? fmt.plural(cities[0].listeners, 'listener') : null }
        ]),
        ui.grid([
          ui.card({
            title: 'Countries', sub: 'Listener devices · ' + w,
            actions: [ui.button('CSV', { kind: 'ghost', small: true, icon: 'download', onClick: function () {
              VX.download.csv('vinax-countries-' + (d.days || days) + 'd-' + VX.stamp(), countries.map(function (c) { return { country_code: c.cc, country: c.label, listeners: c.value }; }));
              return null;
            } })],
            body: ui.hbars(countries.map(function (c) { return { label: c.label, value: c.value, sub: totalListeners ? fmt.ratio(c.value / totalListeners) + ' of listeners' : null }; }), { limit: 12, empty: 'No countries yet' })
          }),
          ui.card({ title: 'Platforms', sub: 'All listener devices, all time', body: ui.share(platforms, { empty: 'No listener devices yet' }) })
        ]),
        ui.card({
          title: 'Cities', sub: 'Top 50 by listeners · ' + w, pad: false,
          body: ui.table({
            columns: [
              { key: 'city', label: 'City', render: function (r) { return r.city || h('span.muted', 'Unknown city'); }, sortVal: function (r) { return r.city || ''; } },
              { key: 'country', label: 'Country' },
              { key: 'listeners', label: 'Listeners', align: 'right', render: function (r) { return fmt.num(r.listeners); } },
              { key: 'plays', label: 'Plays', align: 'right', render: function (r) { return fmt.num(r.plays); } },
              { key: 'per', label: 'Plays per listener', align: 'right', render: function (r) { return r.listeners ? fmt.num(Math.round(r.per * 10) / 10) : '—'; } }
            ],
            rows: cities, sortKey: 'listeners', sortDir: 'desc', exportName: 'vinax-cities-' + (d.days || days) + 'd',
            empty: 'No cities yet', emptyHint: 'Cities appear as listeners use the app.'
          })
        }),
        h('p.muted.small', 'Places come from where each connection is made. A listener who connects from two cities counts in both, so country totals can be slightly higher than the number of people.')
      );
    }, { skeleton: 6 });
  }

  /* --------------------------------------------------------- geocoding */

  var CITY_COORD = {
    'mumbai': [19.08, 72.88], 'bombay': [19.08, 72.88], 'delhi': [28.61, 77.21], 'new delhi': [28.61, 77.21],
    'bengaluru': [12.97, 77.59], 'bangalore': [12.97, 77.59], 'hyderabad': [17.38, 78.49], 'chennai': [13.08, 80.27],
    'madras': [13.08, 80.27], 'kolkata': [22.57, 88.36], 'calcutta': [22.57, 88.36], 'pune': [18.52, 73.86],
    'ahmedabad': [23.03, 72.58], 'jaipur': [26.91, 75.79], 'surat': [21.17, 72.83], 'lucknow': [26.85, 80.95],
    'kanpur': [26.45, 80.33], 'nagpur': [21.15, 79.09], 'indore': [22.72, 75.86], 'bhopal': [23.26, 77.41],
    'visakhapatnam': [17.69, 83.22], 'vizag': [17.69, 83.22], 'vijayawada': [16.51, 80.65], 'patna': [25.59, 85.14],
    'vadodara': [22.31, 73.18], 'coimbatore': [11.02, 76.96], 'kochi': [9.93, 76.27], 'cochin': [9.93, 76.27],
    'thiruvananthapuram': [8.52, 76.94], 'trivandrum': [8.52, 76.94], 'mysuru': [12.30, 76.64], 'mysore': [12.30, 76.64],
    'madurai': [9.93, 78.12], 'chandigarh': [30.73, 76.78], 'guwahati': [26.14, 91.74], 'mangaluru': [12.91, 74.86],
    'rajkot': [22.30, 70.80], 'ranchi': [23.34, 85.31], 'raipur': [21.25, 81.63], 'amritsar': [31.63, 74.87],
    'varanasi': [25.32, 82.97], 'aurangabad': [19.88, 75.34], 'jodhpur': [26.24, 73.02], 'gwalior': [26.22, 78.18],
    'ludhiana': [30.90, 75.86], 'agra': [27.18, 78.01], 'noida': [28.54, 77.39], 'gurugram': [28.46, 77.03],
    'gurgaon': [28.46, 77.03], 'faridabad': [28.41, 77.31], 'ghaziabad': [28.67, 77.45], 'dehradun': [30.32, 78.03],
    'jamshedpur': [22.80, 86.20], 'warangal': [17.97, 79.59], 'tirupati': [13.63, 79.42], 'guntur': [16.31, 80.44],
    'nellore': [14.44, 79.99], 'kakinada': [16.99, 82.25], 'rajahmundry': [17.00, 81.78], 'bhubaneswar': [20.30, 85.82],
    'srikakulam': [18.30, 83.90], 'anantapur': [14.68, 77.60], 'kurnool': [15.83, 78.04], 'kadapa': [14.47, 78.82],
    'new york': [40.71, -74.01], 'brooklyn': [40.68, -73.94], 'london': [51.51, -0.13], 'dubai': [25.20, 55.27],
    'singapore': [1.35, 103.82], 'toronto': [43.65, -79.38], 'sydney': [-33.87, 151.21], 'melbourne': [-37.81, 144.96],
    'los angeles': [34.05, -118.24], 'chicago': [41.88, -87.63], 'san francisco': [37.77, -122.42], 'houston': [29.76, -95.37],
    'dallas': [32.78, -96.80], 'seattle': [47.61, -122.33], 'atlanta': [33.75, -84.39], 'boston': [42.36, -71.06],
    'washington': [38.91, -77.04], 'jersey city': [40.72, -74.05], 'edison': [40.52, -74.41], 'ashburn': [39.04, -77.49],
    'vancouver': [49.28, -123.12], 'auckland': [-36.85, 174.76], 'tokyo': [35.68, 139.69], 'hong kong': [22.32, 114.17],
    'kuala lumpur': [3.14, 101.69], 'riyadh': [24.71, 46.68], 'dammam': [26.43, 50.10], 'jeddah': [21.49, 39.19],
    'doha': [25.29, 51.53], 'abu dhabi': [24.45, 54.38], 'sharjah': [25.35, 55.41], 'muscat': [23.59, 58.41],
    'kuwait city': [29.38, 47.99], 'manama': [26.23, 50.59], 'frankfurt': [50.11, 8.68], 'berlin': [52.52, 13.40],
    'paris': [48.86, 2.35], 'amsterdam': [52.37, 4.90], 'zurich': [47.37, 8.54], 'dublin': [53.35, -6.26],
    'johannesburg': [-26.20, 28.05], 'nairobi': [-1.29, 36.82], 'lagos': [6.52, 3.38], 'cairo': [30.04, 31.24],
    'colombo': [6.93, 79.85], 'kathmandu': [27.72, 85.32], 'dhaka': [23.81, 90.41], 'karachi': [24.86, 67.01],
    'lahore': [31.55, 74.34], 'islamabad': [33.68, 73.05]
  };
  var CENTROID = {
    IN: [22, 79], US: [39, -98], GB: [54, -2], CA: [56, -106], AU: [-25, 133], AE: [24, 54], SA: [24, 45],
    PK: [30, 70], BD: [24, 90], NP: [28, 84], LK: [7, 81], SG: [1, 104], MY: [4, 102], ID: [-2, 118],
    PH: [13, 122], TH: [15, 101], JP: [36, 138], KR: [36, 128], CN: [35, 105], HK: [22, 114], DE: [51, 10],
    FR: [46, 2], IT: [42, 13], ES: [40, -4], NL: [52, 5], SE: [62, 15], NO: [62, 10], CH: [47, 8], IE: [53, -8],
    PT: [39, -8], RU: [61, 105], UA: [49, 32], TR: [39, 35], EG: [27, 30], ZA: [-30, 25], NG: [10, 8],
    KE: [0, 38], BR: [-10, -55], AR: [-34, -64], MX: [23, -102], CL: [-30, -71], CO: [4, -73], NZ: [-42, 174],
    QA: [25, 51], KW: [29, 48], OM: [21, 57], BH: [26, 50], IL: [31, 35], FI: [64, 26], DK: [56, 10],
    BE: [50, 4], AT: [47, 14], PL: [52, 20], GR: [39, 22], MM: [21, 96], KH: [13, 105], VN: [16, 108],
    TW: [24, 121], MA: [32, -6], DZ: [28, 3], AF: [33, 66], IR: [32, 53], IQ: [33, 44]
  };

  var GEO_KEY = 'vinax_admin_geo2';
  var geoCache = null;
  function cache() {
    if (!geoCache) { try { geoCache = JSON.parse(localStorage.getItem(GEO_KEY) || '{}') || {}; } catch (e) { geoCache = {}; } }
    return geoCache;
  }
  function saveCache() { try { localStorage.setItem(GEO_KEY, JSON.stringify(geoCache)); } catch (e) {} }
  function geoKey(city, cc) { return String(city || '').toLowerCase().trim() + '|' + String(cc || '').toUpperCase().slice(0, 2); }

  /** [lat, lon, exact] for a city, or null when even the country is unknown. */
  function locate(city, cc) {
    var name = String(city || '').toLowerCase().trim();
    if (name && name !== 'unknown') {
      if (CITY_COORD[name]) return [CITY_COORD[name][0], CITY_COORD[name][1], true];
      var hit = cache()[geoKey(city, cc)];
      if (hit && hit !== 'x' && hit.length === 2) return [hit[0], hit[1], true];
    }
    var g = CENTROID[String(cc || '').toUpperCase().slice(0, 2)];
    if (!g) return null;
    // Deterministic spread around the country centre so unknown cities don't stack.
    var hsh = 0;
    for (var i = 0; i < name.length; i++) hsh = (hsh * 31 + name.charCodeAt(i)) | 0;
    return [g[0] + (((hsh >> 4) % 97) / 97 - 0.5) * 6, g[1] + ((hsh % 97) / 97 - 0.5) * 7, false];
  }
  function needsLookup(city, cc) {
    var name = String(city || '').toLowerCase().trim();
    return !!name && name !== 'unknown' && !CITY_COORD[name] && cache()[geoKey(city, cc)] === undefined;
  }

  /**
   * One-at-a-time geocoder. This is the console's only request that does not
   * go through VX.api — on purpose: VX.api attaches the owner token, which
   * must never be sent to a third-party host. No credentials, no referrer.
   */
  function makeGeocoder(onFound) {
    var queue = [], queued = {}, busy = false, stopped = false, timer = null;
    function pump() {
      if (busy || stopped) return;
      var next = queue.shift();
      if (!next) return;
      busy = true;
      var url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&city=' + encodeURIComponent(next.city) +
        (next.cc && next.cc.length === 2 ? '&countrycodes=' + encodeURIComponent(next.cc.toLowerCase()) : '');
      VX.api.external(url)
        .then(function (j) {
          if (j == null) return; // rate-limited or down: try again another time
          var hit = j[0];
          var lat = hit && parseFloat(hit.lat), lon = hit && parseFloat(hit.lon);
          cache()[next.key] = hit && isFinite(lat) && isFinite(lon) ? [Math.round(lat * 100) / 100, Math.round(lon * 100) / 100] : 'x';
          saveCache();
          if (!stopped && cache()[next.key] !== 'x') onFound(next.key);
        })
        .catch(function () { /* offline or blocked: keep the country guess */ })
        .then(function () { timer = setTimeout(function () { busy = false; pump(); }, 1200); });
    }
    return {
      add: function (city, cc) {
        if (!needsLookup(city, cc)) return;
        var key = geoKey(city, cc);
        if (queued[key]) return;
        queued[key] = true;
        queue.push({ key: key, city: String(city), cc: String(cc || '').toUpperCase() });
        pump();
      },
      pending: function () { return queue.length + (busy ? 1 : 0); },
      stop: function () { stopped = true; queue = []; clearTimeout(timer); }
    };
  }

  /* ----------------------------------------------------------- World map */

  function renderMap(host, ctx) {
    var days = daysParam(ctx);
    var body = h('div');
    host.appendChild(h('div.toolbar', ui.daysPicker(days, function (d) { ctx.setParam('days', d); ctx.refresh(); })));
    host.appendChild(body);

    if (!window.L) {
      VX.mount(body, ui.notice('The map library did not load (/admin/leaflet/leaflet.js). Reload the page; the Countries & cities tab still works.', 'bad'));
      return Promise.resolve();
    }
    var L = window.L;
    var map = null, cityLayer = null, liveLayer = null;
    var markersByKey = {};
    var mapEl = h('div.map', { role: 'region', 'aria-label': 'World map of listeners' });
    var legend = h('p.muted.small');
    var liveHost = h('div');
    var citiesHost = h('div');
    var live = [];
    var state = { cities: [], approx: 0, unplaced: 0, liveUnplaced: 0 };
    var geocoder = makeGeocoder(function (key) {
      var c = cache()[key];
      (markersByKey[key] || []).forEach(function (m) { m.setLatLng([c[0], c[1]]); });
      drawLegend();
    });
    ctx.onDispose(function () { geocoder.stop(); if (map) { map.remove(); map = null; } });

    function css(name, fallback) {
      var v = getComputedStyle(document.documentElement).getPropertyValue(name);
      return (v && v.trim()) || fallback;
    }
    function track(key, marker) { (markersByKey[key] = markersByKey[key] || []).push(marker); }

    function drawLegend() {
      var parts = ['Circle size = listener devices in the ' + windowText(days) + '.', 'Pulsing dots = listening right now (last 2 minutes).'];
      if (state.approx) parts.push(fmt.plural(state.approx, 'city is', 'cities are') + ' placed near the country centre' + (geocoder.pending() ? ' while their exact spot is looked up' : '') + '.');
      if (state.unplaced) parts.push(fmt.plural(state.unplaced, 'place') + ' with an unknown country cannot be drawn.');
      legend.textContent = parts.join(' ');
    }

    function popup(lines) { return h('div', lines.filter(Boolean).map(function (l, i) { return i ? h('div', l) : h('strong', l); })); }

    function drawCities() {
      cityLayer.clearLayers();
      state.approx = 0; state.unplaced = 0;
      var max = state.cities.reduce(function (a, c) { return Math.max(a, c.listeners); }, 1);
      var accent = css('--accent', '#e8a33d');
      state.cities.forEach(function (c) {
        var ll = locate(c.city, c.cc);
        if (!ll) { state.unplaced += 1; return; }
        if (!ll[2]) { state.approx += 1; geocoder.add(c.city, c.cc); }
        var m = L.circleMarker([ll[0], ll[1]], {
          radius: 5 + 18 * Math.sqrt(c.listeners / max), color: accent, weight: 1.5, fillColor: accent, fillOpacity: 0.35
        });
        m.bindPopup(popup([c.city || 'Unknown city', c.country, fmt.plural(c.listeners, 'listener') + ' · ' + fmt.plural(c.plays, 'play'), ll[2] ? null : 'Approximate position']));
        m.bindTooltip(h('span', (c.city || 'Unknown city') + ' · ' + fmt.num(c.listeners)));
        track(geoKey(c.city, c.cc), m);
        cityLayer.addLayer(m);
      });
    }

    function drawLive() {
      liveLayer.clearLayers();
      state.liveUnplaced = 0;
      live.forEach(function (l) {
        var ll = locate(l.city, l.country);
        if (!ll) { state.liveUnplaced += 1; return; }
        if (!ll[2]) geocoder.add(l.city, l.country);
        var icon = L.divIcon({ className: 'vx-live-marker', html: h('span.dot.live', { style: { width: '12px', height: '12px', border: '2px solid var(--surface)' } }), iconSize: [12, 12], iconAnchor: [6, 6] });
        var m = L.marker([ll[0], ll[1]], { icon: icon, keyboard: false, zIndexOffset: 1000 });
        m.bindPopup(popup([l.name || 'Anonymous', [l.city, countryName(l.country)].filter(Boolean).join(', '), l.song ? (l.playing ? 'Playing ' : 'Paused on ') + l.song + (l.artist ? ' — ' + l.artist : '') : 'Browsing']));
        track(geoKey(l.city, l.country), m);
        liveLayer.addLayer(m);
      });
      VX.mount(liveHost, ui.card({
        title: h('span.status.' + (live.length ? 'ok' : 'muted'), ui.dot(live.length ? 'live' : null), 'Listening now'), sub: 'Last 2 minutes · refreshes every 20 seconds',
        body: live.length ? h('ul.list', live.slice(0, 12).map(function (l) {
          return h('li', ui.media(l.image, l.name || 'Anonymous', [l.city, countryName(l.country)].filter(Boolean).join(', ')), h('span.grow'),
            l.song ? h('span.small.muted', fmt.trunc(l.song, 32)) : null, l.playing ? ui.pill('Playing', 'ok') : ui.pill('Paused'));
        })) : ui.empty('Nobody is listening right now', 'Listeners appear on the map within seconds of opening the app.')
      }));
    }

    function fit() {
      var pts = [];
      cityLayer.eachLayer(function (m) { pts.push(m.getLatLng()); });
      liveLayer.eachLayer(function (m) { pts.push(m.getLatLng()); });
      if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.25), { maxZoom: 5 });
      else map.setView([21.5, 79], 3);
    }

    function initMap() {
      if (!mapEl.isConnected || map) return;
      map = L.map(mapEl, { worldCopyJump: true, zoomControl: true, minZoom: 1 });
      var tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 12,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'
      }).addTo(map);
      // Keep only the map-data credit the tile licence requires.
      if (map.attributionControl) map.attributionControl.setPrefix(false);
      // Dark theme: darken the (light) map images so the map sits in the page.
      if (!document.documentElement.classList.contains('light')) {
        var pane = map.getPane('tilePane');
        if (pane) pane.style.filter = 'invert(1) hue-rotate(180deg) brightness(0.9) contrast(0.85) saturate(0.6)';
      }
      tiles.on('tileerror', function () { /* offline tiles: markers still draw on the plain background */ });
      cityLayer = L.layerGroup().addTo(map);
      liveLayer = L.layerGroup().addTo(map);
      drawCities();
      drawLive();
      fit();
      drawLegend();
    }

    function pollLive() {
      return VX.api.get('/api/admin/live', null, { fresh: true }).then(function (res) {
        if (!res.ok || !map) return;
        live = (res.data && res.data.listeners) || [];
        drawLive();
        drawLegend();
      });
    }

    return ui.load(body, function () {
      return Promise.all([VX.api.get('/api/admin/location', { days: days }), VX.api.get('/api/admin/live', null, { fresh: true })]).then(function (r) {
        if (!r[0].ok) return r[0];
        return { ok: true, data: { loc: r[0].data || {}, live: r[1].ok ? r[1].data || {} : null } };
      });
    }, function (d) {
      if (d.loc.configured === false) return notConnected();
      state.cities = (d.loc.cities || []).map(function (c) {
        return { city: c.city && c.city !== 'Unknown' ? c.city : null, cc: c.country, country: countryName(c.country), listeners: Number(c.listeners) || 0, plays: Number(c.plays) || 0 };
      });
      live = (d.live && d.live.listeners) || [];
      var top = state.cities.slice().sort(function (a, b) { return b.listeners - a.listeners; }).slice(0, 10);
      VX.mount(citiesHost, ui.card({
        title: 'Top cities', sub: windowText(days),
        body: ui.hbars(top.map(function (c) { return { label: c.city || 'Unknown city', sub: c.country, value: c.listeners }; }), { empty: 'No cities yet', emptyHint: 'Cities appear as listeners use the app.' })
      }));
      return h('div.page-body',
        !state.cities.length && !live.length ? ui.notice('No listener locations in the ' + windowText(days) + ' yet. The map fills in as people use the app.', 'info') : null,
        d.live ? null : ui.notice('Live listeners could not be loaded; the map shows cities only.', 'warn'),
        ui.card({ title: 'World map', sub: 'Drag to pan, scroll or pinch to zoom, click a circle for details', pad: true, body: [mapEl, legend] }),
        ui.grid([liveHost, citiesHost])
      );
    }, { skeleton: 6 }).then(function (res) {
      if (res && res.ok && res.data && res.data.loc && res.data.loc.configured !== false) {
        initMap();
        ctx.every(20000, pollLive);
      }
      return res;
    });
  }
})();
