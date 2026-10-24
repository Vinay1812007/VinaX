/* VinaX console — Notifications page.
 * Push setup only: the push secrets (GET /api/admin/envcheck) and the
 * Android push self-test (GET /api/admin/fcmcheck). (13.9.1 — sending,
 * history and the subscriber audience went with the database, which held
 * the push registrations.) */
(function () {
  'use strict';
  var VX = window.VX, h = VX.h, ui = VX.ui, fmt = VX.fmt;

  VX.page({
    id: 'notify', title: 'Notifications', group: 'Content', icon: 'bell',
    desc: 'Send a push to listeners, see what was sent and who it reached, and check the push setup.',
    noAuto: true,
    tabs: [
      { id: 'send', label: 'Send', desc: 'Compose a push, preview who gets it, send it. Links stay on the site.', render: renderSend },
      { id: 'history', label: 'History', desc: 'Every push sent, with how many devices took it. Retracting an announcement stops the Android app from showing it.', render: renderHistory },
      { id: 'audience', label: 'Audience', desc: 'Devices that can receive a push, by channel, place and language.', render: renderAudience },
      { id: 'setup', label: 'Push setup', desc: 'Which push secrets the Worker has, and whether Android push is accepted.', render: renderSetup }
    ]
  });

  var arr = VX.arr, obj = VX.obj, num = VX.num;

  /* ---------------------------------------------------------------- Send */

  function renderSend(host, ctx) {
    var body = h('div');
    host.appendChild(body);
    return ui.load(body, function () { return VX.api.get('/api/admin/push', null, { fresh: true }); }, function (d) {
      var gate = ui.gate(d, ctx);
      if (gate) return gate;
      var web = obj(d.web), fcm = obj(d.fcm), geo = obj(d.geo);
      var none = !web.configured && !fcm.configured;
      var dedupeKey = VX.rid();
      var title = ui.input({ maxlength: 120, placeholder: 'VinaX', value: 'VinaX' });
      var text = ui.textarea({ rows: 3, maxlength: 300, placeholder: 'New this week: the Telugu hits playlist is live.' });
      var counter = h('div.counter', '0 / 300');
      text.addEventListener('input', function () { counter.textContent = text.value.length + ' / 300'; });
      var link = ui.input({ maxlength: 300, value: '/', placeholder: '/charts' });
      var opt = function (list, keyName, labelFn) { return [{ value: '', label: 'Any' }].concat(arr(list).map(function (x) { return { value: x[keyName], label: (labelFn ? labelFn(x) : x[keyName]) + ' (' + fmt.num(x.count) + ')' }; })); };
      var country = ui.select(opt(geo.countries, 'key', function (x) { return fmt.country(x.key); }), '');
      var region = ui.select(opt(geo.regions, 'key'), '');
      var city = ui.select(opt(geo.cities, 'key'), '');
      var lang = ui.select(opt(d.langs, 'lang'), '');
      var channel = ui.select([{ value: '', label: 'Both channels' }, { value: 'web', label: 'Browsers only' }, { value: 'fcm', label: 'Android only' }], '');
      var activity = '';
      var out = h('div.receipt');
      var err = h('p.login-err', { role: 'alert' });
      function filter() {
        var f = {};
        if (country.value) f.country = country.value;
        if (region.value) f.region = region.value;
        if (city.value) f.city = city.value;
        if (lang.value) f.lang = lang.value;
        if (channel.value) f.channel = channel.value;
        return f;
      }
      function everyone() { return !Object.keys(filter()).length && !activity; }
      function payload(dry) {
        var b = { title: title.value.trim() || 'VinaX', body: text.value.trim(), link: link.value.trim() || '/', filter: filter(), dedupeKey: dedupeKey };
        if (activity) b.activity = activity;
        if (dry) b.dryRun = true;
        return b;
      }
      function valid() {
        if (!text.value.trim()) { err.textContent = 'Write the message first.'; text.focus(); return false; }
        var l = link.value.trim() || '/';
        if (!(l.charAt(0) === '/' && l.charAt(1) !== '/') && !/^https:\/\/(www\.)?vinaxmusic\.online(\/|$)/.test(l)) { err.textContent = 'The link must stay on the site: a path like /charts.'; link.focus(); return false; }
        err.textContent = '';
        return true;
      }
      function preview() {
        if (!valid()) return Promise.resolve();
        VX.mount(out, ui.loading('Counting the audience…'));
        return VX.api.post('/api/admin/push', payload(true), { timeout: 40000 }).then(function (res) {
          var r = obj(res.data);
          VX.mount(out, res.ok ? ui.notice('This push would reach ' + fmt.plural(r.web, 'browser') + ' and ' + fmt.plural(r.fcm, 'Android device') + ' (' + (r.audience || 'everyone') + '). Nothing was sent.', 'info') : ui.notice(res.message, 'bad'));
        });
      }
      function send() {
        if (!valid()) return Promise.resolve();
        var all = everyone();
        return VX.confirm({
          title: all ? 'Send to everyone?' : 'Send this push?',
          body: all ? 'Every browser and Android device with push on receives it, and the Android app shows it as the announcement on open.' : 'Only devices matching the filters receive it.',
          confirmLabel: 'Send', danger: all, typed: all ? 'SEND' : undefined
        }).then(function (yes) {
          if (!yes) return;
          VX.mount(out, ui.loading('Sending…'));
          return VX.api.post('/api/admin/push', payload(false), { timeout: 90000 }).then(function (res) {
            var r = obj(res.data), w = obj(r.web), f = obj(r.fcm);
            if (!res.ok) { VX.mount(out, ui.notice(res.error === 'duplicate' ? 'This exact push was already sent a moment ago; change the text to send another.' : res.message, 'bad')); return; }
            dedupeKey = VX.rid();
            VX.mount(out, ui.notice('Sent to ' + (r.audience || 'everyone') + '.', 'ok'), ui.kpis([
              { label: 'Browsers', value: fmt.num(w.sent) + ' / ' + fmt.num(w.total), sub: num(w.gone) ? fmt.plural(w.gone, 'gone subscription') : 'delivered', tone: num(w.total) && num(w.sent) < num(w.total) ? 'warn' : null },
              { label: 'Android', value: fmt.num(f.sent) + ' / ' + fmt.num(f.total), sub: 'delivered to the push service' },
              { label: 'Receipt', value: r.id != null ? '#' + fmt.num(r.id) : '—', sub: 'in History' }
            ]), obj(w.failed) && Object.keys(obj(w.failed)).length ? h('p.muted.small', 'Browser failures: ' + Object.keys(obj(w.failed)).map(function (k) { return 'HTTP ' + k + ' × ' + fmt.num(w.failed[k]); }).join(', ')) : null);
            VX.toast('Push sent', 'ok');
          });
        });
      }
      return [
        none ? ui.notice('No push channel is set up: set the VAPID keys for browsers and FCM_SERVICE_ACCOUNT for Android (Push setup tab). Composing works, sending is refused.', 'warn') : null,
        ui.kpis([
          { label: 'Browsers', value: fmt.compact(web.active), sub: web.configured ? 'web push ready' : 'VAPID keys not set', tone: web.configured ? null : 'warn' },
          { label: 'Android devices', value: fmt.compact(fcm.active), sub: fcm.configured ? 'FCM ready' : 'FCM not set', tone: fcm.configured ? null : 'warn' },
          { label: 'Frequency cap', value: obj(d.rules).minGapHours != null ? fmt.plural(obj(d.rules).minGapHours, 'hour') : 'default', sub: 'between pushes to one device' }
        ]),
        ui.grid([
          ui.card({ title: 'Message', body: h('div.form', ui.field('Title', title), ui.field('Body', text), counter, ui.field('Link', link, 'Where a tap goes: a site path such as /charts or /song/<id>.')) }),
          ui.card({ title: 'Audience', sub: 'Leave everything on Any to reach everyone', body: h('div.form',
            h('div.form-row', ui.field('Country', country), ui.field('Region', region), ui.field('City', city)),
            h('div.form-row', ui.field('Language', lang), ui.field('Channel', channel)),
            ui.field('Activity', ui.segmented([{ value: '', label: 'Anyone' }, { value: 'active7', label: 'Active 7d' }, { value: 'quiet', label: 'Quiet 7–14d' }, { value: 'dormant14', label: 'Dormant 14d+' }], '', function (v) { activity = v; }, 'Activity'), 'By the device’s last check-in.')) })
        ], 2),
        err,
        h('div.actions', ui.button('Preview audience', { kind: 'ghost', icon: 'users', onClick: preview }), ui.button('Send push', { kind: 'primary', icon: 'send', disabled: none, onClick: send })),
        out
      ];
    }, { skeleton: 6 });
  }

  /* ------------------------------------------------------------- History */

  function renderHistory(host, ctx) {
    var body = h('div');
    host.appendChild(body);
    function load() {
      return ui.load(body, function () { return VX.api.get('/api/admin/notifications', { limit: 100 }, { fresh: true }); }, function (d) {
        var gate = ui.gate(d, ctx);
        if (gate) return gate;
        var rows = arr(d.rows);
        function retract(r) {
          return VX.confirm({ title: 'Retract this push?', body: 'Devices that already received it keep it; the Android app stops showing it as the current announcement and it is marked retracted here.', danger: true, confirmLabel: 'Retract' }).then(function (yes) {
            if (!yes) return;
            return VX.api.post('/api/admin/notifications', { action: 'retract', id: r.id }).then(function (res) { VX.toast(res.ok ? 'Retracted' : res.message, res.ok ? 'ok' : 'bad'); if (res.ok) return load(); });
          });
        }
        return ui.card({ title: 'Sent', sub: fmt.plural(rows.length, 'push', 'pushes') + ' · newest first', pad: false, body: ui.table({
          columns: [
            { key: 'at', label: 'When', nowrap: true, render: function (r) { return ui.ago(r.at); } },
            { key: 'kind', label: 'Kind', render: function (r) { return ui.pill(r.kind || 'announcement', r.retractedAt ? 'bad' : 'info'); } },
            { key: 'title', label: 'Message', render: function (r) { return h('div', h('div.cell-main', r.title || '—'), h('div.cell-sub', fmt.trunc(r.body || '', 120)), r.link && r.link !== '/' ? h('div.cell-sub', ui.mono(r.link)) : null); } },
            { key: 'audience', label: 'Audience', sort: false, render: function (r) { var a = obj(r.audience); var keys = Object.keys(a); return keys.length ? keys.map(function (k) { return k + ' ' + a[k]; }).join(' · ') : 'everyone'; } },
            { key: 'web', label: 'Browsers', align: 'right', sortVal: function (r) { return num(obj(r.web).sent); }, render: function (r) { var w = obj(r.web); return fmt.num(w.sent) + ' / ' + fmt.num(w.total); } },
            { key: 'fcm', label: 'Android', align: 'right', sortVal: function (r) { return num(obj(r.fcm).sent); }, render: function (r) { var f = obj(r.fcm); return fmt.num(f.sent) + ' / ' + fmt.num(f.total); } },
            { key: 'retractedAt', label: 'State', render: function (r) { return r.retractedAt ? ui.pill('Retracted', 'bad') : ui.pill('Sent', 'ok'); } },
            { key: 'act', label: '', sort: false, render: function (r) { return r.retractedAt ? null : ui.button('Retract', { kind: 'ghost', small: true, onClick: function () { return retract(r); } }); } }
          ],
          rows: rows, exportName: 'vinax-notifications', search: rows.length > 8, pageSize: 25, sortKey: 'at', sortDir: 'desc',
          empty: 'Nothing sent yet', emptyHint: 'Pushes you send from the Send tab are listed here with their delivery counts.'
        }) });
      }, { skeleton: 6 });
    }
    return load();
  }

  /* ------------------------------------------------------------ Audience */

  function renderAudience(host, ctx) {
    return ui.load(host, function () { return VX.api.get('/api/admin/push'); }, function (d) {
      var gate = ui.gate(d, ctx);
      if (gate) return gate;
      var web = obj(d.web), fcm = obj(d.fcm), geo = obj(d.geo);
      var geoTable = function (rows, keyLabel, labelFn) {
        return ui.table({
          columns: [
            { key: 'key', label: keyLabel, render: function (r) { return h('div', h('div.cell-main', labelFn ? labelFn(r) : r.key || 'Unknown'), r.country && keyLabel !== 'Country' ? h('div.cell-sub', [r.region, fmt.country(r.country)].filter(function (x) { return x && x !== '—'; }).join(', ')) : null); } },
            { key: 'count', label: 'Devices', align: 'right', render: function (r) { return fmt.num(r.count); } }
          ],
          rows: arr(rows), exportName: false, search: arr(rows).length > 8, dense: true, pageSize: 15, sortKey: 'count', sortDir: 'desc', empty: 'No devices yet'
        });
      };
      return [
        ui.kpis([
          { label: 'Browsers', value: fmt.compact(web.active), sub: web.configured ? 'web push ready' : 'VAPID keys not set' },
          { label: 'Android devices', value: fmt.compact(fcm.active), sub: fcm.configured ? 'FCM ready' : 'FCM not set' },
          { label: 'Countries', value: fmt.num(arr(geo.countries).length) },
          { label: 'Languages', value: fmt.num(arr(d.langs).length) }
        ]),
        ui.grid([
          ui.card({ title: 'Countries', pad: false, body: geoTable(geo.countries, 'Country', function (r) { return fmt.country(r.key); }) }),
          ui.card({ title: 'Regions', pad: false, body: geoTable(geo.regions, 'Region') }),
          ui.card({ title: 'Cities', pad: false, body: geoTable(geo.cities, 'City') })
        ], 3),
        ui.card({ title: 'Languages', sub: 'The device locale at registration', body: ui.share(arr(d.langs).map(function (l) { return { label: l.lang || 'unknown', value: num(l.count) }; }), { title: 'Devices by language', empty: 'No devices yet' }) })
      ];
    }, { skeleton: 6 });
  }

  /* --------------------------------------------------------------- Setup */

  function renderSetup(host) {
    var top = h('div.page-body');
    var diag = h('div');
    host.appendChild(top);
    host.appendChild(diag);
    runFcmCheck(diag);
    return ui.load(top, function () { return VX.api.get('/api/admin/envcheck'); }, function (d) {
      var items = (d.items || []).filter(function (it) { return it && it.group === 'Push'; });
      return ui.card({
        title: 'Push secrets', sub: 'Set on the Worker; values are never shown',
        body: items.length ? h('ul.list', items.map(function (it) {
          var optional = it.name === 'NOTIFY_MIN_GAP_HOURS';
          return h('li', h('code.mono', it.name), h('span.grow.muted.small', it.note || ''), ui.pill(it.set ? 'Set' : optional ? 'Not set · optional' : 'Missing', it.set ? 'ok' : optional ? null : 'warn'));
        })) : ui.notice('Could not read the secret checklist.', 'warn')
      });
    }, { skeleton: 3 });
  }

  function runFcmCheck(host) {
    var out = h('div');
    var card = ui.card({
      title: 'Android push self-test',
      sub: 'Asks the push service to validate a test message — nothing is delivered',
      actions: [ui.button('Run again', { kind: 'ghost', small: true, icon: 'refresh', onClick: function () { return load(); } })],
      body: out
    });
    VX.mount(host, card);
    function load() {
      return ui.load(out, function () { return VX.api.get('/api/admin/fcmcheck', null, { fresh: true, timeout: 30000 }); }, function (d) {
        var verdict;
        if (!d.configured) verdict = ui.notice('Android push is not set up: FCM_SERVICE_ACCOUNT is not set on the Worker, so the Android app gets no notifications.', 'warn');
        else if (d.fcm === 'ok') verdict = ui.notice('Android push works: the service account is accepted and the push service answered.', 'ok');
        else if (!d.token) verdict = ui.notice('The service account was refused' + (d.detail ? ' (' + d.detail + ')' : '') + '. Re-download the service-account JSON for the app’s project and set it as FCM_SERVICE_ACCOUNT.', 'bad');
        else if (d.fcm === 'denied') verdict = ui.notice('The push service refused this service account (' + (d.detail || 'denied') + '). Give it the messaging permission in the app’s project.', 'bad');
        else verdict = ui.notice('The push service did not answer normally (' + (d.detail || 'error') + '). Try again in a minute.', 'bad');
        var answer = { ok: ['ok', 'OK'], denied: ['bad', 'Denied'], error: ['bad', 'Error'], skipped: [null, 'Not run'] }[d.fcm] || [null, '—'];
        return h('div.form', { style: { 'max-width': 'none' } }, verdict, ui.dl([
          ['Service account', d.configured ? ui.pill('Set', 'ok') : ui.pill('Missing', 'warn')],
          ['Project', d.project ? ui.mono(d.project) : '—'],
          ['Sign-in token', d.configured ? (d.token ? ui.pill('Issued', 'ok') : ui.pill('Refused', 'bad')) : '—'],
          ['Push service answer', ui.pill(answer[1], answer[0])],
          ['Detail', d.detail ? ui.mono(d.detail) : '—']
        ]));
      });
    }
    load();
  }
})();
