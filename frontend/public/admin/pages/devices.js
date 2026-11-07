/* Phones & Browsers (schema 16) — the devices signed-in people use: how they
 * run VinaX (the app, a web app on the home screen, a browser tab), phone
 * makers and models, Android and iOS versions, browsers. Follows the date
 * range in the top bar. Route: GET /api/admin/analytics?view=devices&days=.
 * Also defines VX.APP_TIME_INFO, the "time in the app" note Users shares. */
(function () {
  'use strict';
  var VX = window.VX, h = VX.h, ui = VX.ui, fmt = VX.fmt, arr = VX.arr, obj = VX.obj, num = VX.num;

  /** How "time in the app" is measured, for every info tip that shows it. */
  VX.APP_TIME_INFO = 'Time VinaX was on screen or playing music: listening, plus a “still open” signal the app sends about once a minute while it is on screen with nothing playing; a quiet gap over 3 minutes counts as closed. A device still on a copy of the app from before this update does not send that signal, so its idle time is mostly missing until it reloads. An estimate.';

  var DISPLAY = [
    { key: 'app', label: 'Android / iOS app' },
    { key: 'installed', label: 'Web app on the home screen' },
    { key: 'tab', label: 'Browser tab' },
    { key: 'unknown', label: 'Not known yet' }
  ];
  var DISPLAY_TEXT = { app: 'the app', installed: 'web app on the home screen', tab: 'browser tab' };
  /** "Samsung SM-S918B · Android 14 · web app on the home screen" for a profile's device. */
  VX.deviceDetailText = function (d) {
    d = d || {};
    var phone = d.model ? [d.brand && d.brand.indexOf(' / ') < 0 ? d.brand : null, d.model].filter(Boolean).join(' ') : d.brand && d.brand !== 'Apple' ? d.brand : null;
    var sys = d.osVersion ? ((d.os === 'ios' || d.os === 'ipados' || d.brand === 'Apple') ? 'iOS ' : 'Android ') + d.osVersion : null;
    return [phone, sys, d.display && d.display !== 'app' ? DISPLAY_TEXT[d.display] : null].filter(Boolean).join(' · ');
  };

  function rangeText(ctx) { return ctx.range.days === 1 ? 'today' : ctx.range.key === 'custom' ? 'in ' + ctx.range.label : 'in the ' + ctx.range.label.toLowerCase(); }
  function devicesText(v) { return fmt.plural(v, 'device'); }

  function render(host, ctx) {
    return ui.load(host, function () { return VX.api.get('/api/admin/analytics', { view: 'devices', days: ctx.range.days }); }, function (res) {
      var gate = ui.gate(res, ctx);
      if (gate) return gate;
      var d = obj(res.data), disp = obj(d.display), total = num(d.devices);
      if (!total) return ui.emptyState('No devices ' + rangeText(ctx), 'Devices of signed-in people appear here once they use the app. Try a longer date range.');
      var web = num(disp.installed) + num(disp.tab);
      var brands = arr(d.brands), androidAll = num(d.androidAll);
      return [
        ui.stats([
          { label: 'Devices', value: fmt.num(total), sub: 'used ' + rangeText(ctx), info: 'Phones, tablets and computers signed-in people used VinaX on ' + rangeText(ctx) + '. One person can have several.' },
          { label: 'On the home screen', value: web ? fmt.pct(num(disp.installed) / web * 100) : '—', sub: web ? fmt.num(disp.installed) + ' of ' + devicesText(web) + ' on the web' : 'No web devices yet',
            info: 'Of the devices using VinaX in a browser, the share that added it to the home screen (it opens like an app). Counted from this update on.' },
          { label: 'Top phone maker', value: brands[0] ? brands[0].brand : '—', sub: brands[0] ? devicesText(brands[0].devices) : null, info: 'The maker named most often by the phones themselves. iPhones count as Apple.' },
          { label: 'Phone model known', value: androidAll ? fmt.pct(num(d.modelKnown) / androidAll * 100) : '—', sub: androidAll ? 'of ' + devicesText(androidAll) + ' on Android' : null,
            info: 'The Android app names the phone model. Chrome and most browsers hide it (they say only “Android 10; K”), so web devices usually stay unknown.' }
        ]),
        h('div.grid.cols-2',
          ui.card({ title: 'How they run VinaX', sub: 'Devices ' + rangeText(ctx) + '.', body: ui.share(DISPLAY.map(function (x) { return { label: x.label, value: num(disp[x.key]) }; }), { title: 'How they run VinaX' }) }),
          ui.card({ title: 'Phone makers', sub: 'From the phone’s own model name.', body: ui.hbars(brands.map(function (x) { return { label: x.brand, value: num(x.devices) }; }), { format: devicesText, empty: 'No phone makers known yet', limit: 10 }) })),
        h('div.grid.cols-2',
          ui.card({ title: 'Phone models', sub: 'Mostly from the Android app.', body: ui.hbars(arr(d.models).map(function (x) { return { label: x.model, sub: x.brand || null, value: num(x.devices) }; }), { format: devicesText, empty: 'No phone models known yet', limit: 12 }) }),
          ui.card({ title: 'Android versions', sub: num(d.androidKnown) + ' of ' + devicesText(androidAll) + ' on Android say their version.', body: ui.hbars(arr(d.android).map(function (x) { return { label: 'Android ' + x.version, value: num(x.devices) }; }), { format: devicesText, empty: 'No Android versions known yet' }) })),
        h('div.grid.cols-2',
          ui.card({ title: 'iPhone and iPad versions', sub: 'iPads in Safari usually say they are a Mac, so few show here.', body: ui.hbars(arr(d.ios).map(function (x) { return { label: 'iOS ' + x.version, value: num(x.devices) }; }), { format: devicesText, empty: 'No iPhones or iPads yet' }) }),
          ui.card({ title: 'Browsers', sub: 'Devices using VinaX on the web.', body: ui.hbars(arr(d.browsers).map(function (x) { return { label: x.browser, value: num(x.devices) }; }), { format: devicesText, empty: 'No browsers yet' }) })),
        h('p.muted.small', 'Read from each device’s next usage report after the database update to version 16; devices that have not come back since show as “Not known yet”.')
      ];
    });
  }

  VX.page({ id: 'phones-browsers', title: 'Phones & Browsers', group: 'Audience', icon: 'phone', order: 5, range: true, render: render,
    desc: 'How people run VinaX — app, home screen or browser tab — and which phones, systems and browsers they use.',
    keywords: 'devices phones models brands samsung android version ios browsers installed pwa home screen' });
})();
