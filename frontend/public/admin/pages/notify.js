/* VinaX console — Notifications page.
 * Send: compose a push (title, message, in-app link) to everyone or to a
 * segment (country / region / city / language / last check-in), preview who
 * it would reach (dry run) and send it — POST /api/admin/push. History: the
 * sent log with delivery receipts and removal — GET/POST /api/admin/notifylog.
 * Audience: browser subscribers and Android devices with their places
 * (GET /api/admin/push), the push secrets (GET /api/admin/envcheck) and the
 * Android push self-test (GET /api/admin/fcmcheck). */
(function () {
  'use strict';
  var VX = window.VX, h = VX.h, ui = VX.ui, fmt = VX.fmt;

  var SITE = 'https://www.sirimillavinay.online';
  var WEB_SECRETS = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'];
  var ANDROID_SECRET = 'FCM_SERVICE_ACCOUNT';
  var ACTIVITY = [
    { value: '', label: 'Any time' },
    { value: 'active7', label: 'Checked in within 7 days' },
    { value: 'quiet', label: 'Last check-in 7–14 days ago' },
    { value: 'dormant14', label: 'No check-in for 14+ days' }
  ];
  var SEND_ERRORS = {
    push_not_configured: 'Push is not set up on the Worker — add the browser (VAPID_*) or Android (FCM_SERVICE_ACCOUNT) secrets first.',
    body_required: 'Write a message first.',
    bad_link: 'The link must stay inside VinaX (a path such as /trending).',
    duplicate: 'This notification was already sent in the last 10 minutes.'
  };

  VX.page({
    id: 'notify', title: 'Notifications', group: 'Content', icon: 'bell',
    desc: 'Send push notifications, see what went out and who can receive them.',
    noAuto: true,
    tabs: [
      { id: 'send', label: 'Send', desc: 'Write a push notification and send it to everyone or to a segment.', render: renderSend },
      { id: 'history', label: 'History', desc: 'Everything sent from the console and by the daily song pushes, newest first.', render: renderHistory },
      { id: 'audience', label: 'Audience', desc: 'Who can receive a push, where they are, and whether the push setup works.', render: renderAudience }
    ]
  });

  /* ----------------------------------------------------------- helpers */

  function sendError(res) {
    var code = res && res.data && res.data.error;
    return SEND_ERRORS[code] || (res && res.message) || 'The notification could not be sent.';
  }

  function isInternalLink(link) {
    if (!link) return true;
    if (link.charAt(0) === '/') return link.charAt(1) !== '/' && link.charAt(1) !== '\\';
    return link === SITE || link.indexOf(SITE + '/') === 0;
  }

  /** Push readiness from envcheck: { web, android, known } */
  function readiness(envRes) {
    var items = (envRes && envRes.ok && envRes.data && envRes.data.items) || [];
    var set = {};
    items.forEach(function (it) { if (it && it.name) set[it.name] = !!it.set; });
    return {
      known: items.length > 0,
      web: WEB_SECRETS.every(function (n) { return set[n]; }),
      webMissing: WEB_SECRETS.filter(function (n) { return !set[n]; }),
      android: !!set[ANDROID_SECRET],
      items: items.filter(function (it) { return it && it.group === 'Push'; })
    };
  }

  function safeJson(s) {
    if (typeof s !== 'string' || s.charAt(0) !== '{') return null;
    try { var o = JSON.parse(s); return o && typeof o === 'object' ? o : null; } catch (e) { return null; }
  }

  function failedText(map) {
    if (!map || typeof map !== 'object') return '';
    var keys = Object.keys(map);
    if (!keys.length) return '';
    return keys.map(function (k) {
      var why = k === '403' ? 'key mismatch' : k === '0' ? 'timeout' : k === 'error' ? 'error' : 'HTTP ' + k;
      return fmt.num(map[k]) + ' × ' + why;
    }).join(', ');
  }

  function receiptSummary(r) {
    if (!r) return null;
    var web = r.web || {};
    var parts = [];
    parts.push(fmt.num(web.sent) + ' of ' + fmt.num(web.total) + ' browsers');
    if (r.fcmError) parts.push('Android: ' + (r.fcmError === 'not_configured' ? 'not set up' : r.fcmError));
    else parts.push(fmt.num(r.fcm) + ' Android');
    return parts.join(' · ');
  }

  /* -------------------------------------------------------------- Send */

  function renderSend(host, ctx) {
    var envP = VX.api.get('/api/admin/envcheck');
    var body = h('div.page-body');
    host.appendChild(body);
    return ui.load(body, function () {
      return Promise.all([VX.api.get('/api/admin/push'), envP]).then(function (r) {
        if (!r[0].ok) return r[0];
        return { ok: true, data: { push: r[0].data || {}, ready: readiness(r[1]) } };
      });
    }, function (d) { return composer(d.push, d.ready, ctx); }, { skeleton: 6 });
  }

  function composer(push, ready, ctx) {
    var webOn = push.configured === true || ready.web;
    var androidOn = ready.android;
    var canSend = webOn || androidOn || !ready.known;
    var geo = push.geo || {};
    var dedupe = newKey();
    function newKey() { return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

    var title = ui.input({ maxlength: 120, placeholder: 'VinaX', value: '' });
    var msg = ui.textarea({ maxlength: 300, rows: 3, placeholder: 'What should listeners see?' });
    var link = ui.input({ maxlength: 300, placeholder: '/', value: '/' });
    var msgHint = h('p.field-hint', '0 / 300');
    var linkHint = h('p.field-hint', 'Where a tap opens. A VinaX path such as /trending or /song/…; external sites are refused.');

    var mode = 'all';
    var country = ui.select([{ value: '', label: 'Any country' }].concat((geo.countries || []).filter(function (c) { return c && c.key && c.key !== 'Unknown'; }).map(function (c) {
      return { value: c.key, label: fmt.country(c.key) + ' · ' + fmt.num(c.count) };
    })), '');
    var region = ui.select([{ value: '', label: 'Any region' }], '');
    var city = ui.select([{ value: '', label: 'Any city' }], '');
    var lang = ui.input({ maxlength: 16, placeholder: 'e.g. te, hi, ta' });
    var activity = ui.select(ACTIVITY, '');
    function fillRegions() {
      var c = country.value;
      VX.mount(region, h('option', { value: '' }, 'Any region'), (geo.regions || []).filter(function (r) { return r && r.key && r.key !== 'Unknown' && (!c || r.country === c); }).map(function (r) {
        return h('option', { value: r.key }, r.key + ' · ' + fmt.num(r.count));
      }));
      fillCities();
    }
    function fillCities() {
      var c = country.value, rg = region.value;
      VX.mount(city, h('option', { value: '' }, 'Any city'), (geo.cities || []).filter(function (x) { return x && x.key && x.key !== 'Unknown' && (!c || x.country === c) && (!rg || x.region === rg); }).map(function (x) {
        return h('option', { value: x.key }, x.key + ' · ' + fmt.num(x.count));
      }));
    }
    fillRegions();
    country.addEventListener('change', function () { fillRegions(); audienceChanged(); });
    region.addEventListener('change', function () { fillCities(); audienceChanged(); });
    city.addEventListener('change', audienceChanged);
    lang.addEventListener('input', audienceChanged);
    activity.addEventListener('change', audienceChanged);

    var segBox = h('div.form', { hidden: true },
      h('div.form-row', { style: { 'align-items': 'start' } }, ui.field('Country', country), ui.field('Region', region), ui.field('City', city)),
      h('div.form-row', { style: { 'align-items': 'start' } },
        ui.field('Language', lang, 'Device language code; "te" also matches te-IN.'),
        ui.field('Last check-in', activity, 'A device checks in each time the app opens.')),
      h('p.field-hint', 'Tip: to test, pick a segment that only matches your own device, such as your city. Segment sends are not added to the Android in-app inbox.'));

    var audienceSeg = ui.segmented([{ value: 'all', label: 'Everyone' }, { value: 'segment', label: 'A segment' }], 'all', function (v) {
      mode = v; segBox.hidden = v !== 'segment'; audienceChanged();
    }, 'Audience');

    var countOut = h('div');
    function audienceChanged() { VX.mount(countOut, h('p.muted.small', 'Press “Count recipients” to see who this reaches.')); }
    audienceChanged();

    var pvTitle = h('strong'), pvBody = h('div'), pvLink = h('div.muted.small');
    function paintPreview() {
      pvTitle.textContent = title.value.trim() || 'VinaX';
      pvBody.textContent = msg.value.trim() || 'Your message appears here.';
      pvBody.className = msg.value.trim() ? '' : 'muted';
      pvLink.textContent = 'Opens ' + (link.value.trim() || '/');
      msgHint.textContent = msg.value.length + ' / 300';
      var okLink = isInternalLink(link.value.trim());
      link.classList.toggle('invalid', !okLink);
      linkHint.textContent = okLink ? 'Where a tap opens. A VinaX path such as /trending or /song/…; external sites are refused.' : 'This link leaves VinaX and will be refused. Use a path such as /trending.';
    }
    [title, msg, link].forEach(function (el) { el.addEventListener('input', paintPreview); });
    paintPreview();

    function payload(dry) {
      var b = { title: title.value.trim() || 'VinaX', body: msg.value.trim(), link: link.value.trim() || '/' };
      if (mode === 'segment') {
        var f = {};
        if (country.value) f.country = country.value;
        if (region.value) f.region = region.value;
        if (city.value) f.city = city.value;
        var l = lang.value.trim().toLowerCase();
        if (l) f.langPrefix = l;
        if (Object.keys(f).length) b.filter = f;
        if (activity.value) b.activity = activity.value;
      }
      if (dry) b.dryRun = true; else b.dedupe_key = dedupe;
      return b;
    }
    function isEveryone(b) { return !b.filter && !b.activity; }
    function check() {
      if (!msg.value.trim()) { msg.classList.add('invalid'); msg.focus(); VX.toast(SEND_ERRORS.body_required, 'bad'); return false; }
      msg.classList.remove('invalid');
      if (!isInternalLink(link.value.trim())) { link.focus(); VX.toast(SEND_ERRORS.bad_link, 'bad'); return false; }
      if (mode === 'segment' && !payload(true).filter && !payload(true).activity) { VX.toast('Pick at least one segment filter, or choose Everyone.', 'bad'); return false; }
      return true;
    }
    function dryRun() {
      if (!check()) return Promise.resolve(null);
      return VX.api.post('/api/admin/push', payload(true)).then(function (res) {
        if (!res.ok) { VX.toast(sendError(res), 'bad'); return null; }
        var d = res.data || {};
        VX.mount(countOut, ui.notice(h('span', 'Would reach ', h('strong', fmt.plural(d.web, 'browser')), ' and ', h('strong', fmt.plural(d.fcm, 'Android device')), ' · audience: ', String(d.audience || 'everyone'), androidOn ? '' : ' (Android push is not set up, so Android is not counted)'), 'info'));
        return d;
      });
    }

    var result = h('div');
    function send() {
      if (!check()) return Promise.resolve();
      var b = payload(false);
      return dryRun().then(function (d) {
        if (!d) return null;
        var who = fmt.plural(d.web, 'browser') + ' and ' + fmt.plural(d.fcm, 'Android device');
        return VX.confirm(isEveryone(b) ? {
          title: 'Send to everyone?',
          body: 'This pushes “' + fmt.trunc(b.body, 80) + '” to ' + who + ' and shows it in the Android in-app inbox. It cannot be unsent.',
          danger: true, confirmLabel: 'Send to everyone'
        } : {
          title: 'Send to this segment?',
          body: 'This pushes “' + fmt.trunc(b.body, 80) + '” to ' + who + ' (' + (d.audience || 'segment') + '). It cannot be unsent.',
          confirmLabel: 'Send'
        }).then(function (yes) {
          if (!yes) return null;
          return VX.api.post('/api/admin/push', b, { timeout: 60000 }).then(function (res) {
            if (!res.ok) { VX.toast(sendError(res), 'bad'); return; }
            VX.toast('Sent', 'ok');
            dedupe = newKey();
            VX.mount(result, sentCard(res.data || {}, ctx));
          });
        });
      });
    }

    var notices = [];
    if (ready.known && !webOn && !androidOn) {
      notices.push(ui.notice('Push is not set up, so nothing can be sent. Set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT (browsers) and/or FCM_SERVICE_ACCOUNT (Android app) on the Worker.', 'bad'));
    } else if (ready.known && !webOn) {
      notices.push(ui.notice('Browser push is not set up (' + ready.webMissing.join(', ') + ' missing) — only the Android app will receive notifications.', 'warn'));
    } else if (ready.known && !androidOn) {
      notices.push(ui.notice('Android push is not set up (FCM_SERVICE_ACCOUNT missing) — only browsers will receive notifications. The Android app still shows sends to everyone in its in-app inbox.', 'warn'));
    }

    var reach = ui.kpis([
      { label: 'Browser subscribers', value: webOn ? fmt.num(push.subscribers) : 'Not set up', sub: webOn ? 'active web push subscriptions' : 'VAPID secrets missing', tone: webOn ? null : 'warn' },
      { label: 'Android devices', value: androidOn || !ready.known ? fmt.num(push.fcm) : 'Not set up', sub: androidOn || !ready.known ? 'registered for app notifications' : 'FCM_SERVICE_ACCOUNT missing', tone: androidOn || !ready.known ? null : 'warn' }
    ]);
    var nobody = canSend && !Number(push.subscribers) && !Number(push.fcm)
      ? ui.notice('Nobody can receive a push yet. Devices appear here once listeners allow notifications in the app.', 'info') : null;

    var sendBtn = ui.button('Send', { kind: 'primary', icon: 'send', disabled: !canSend, onClick: send });
    var form = h('div.form',
      ui.field('Title', title, 'Up to 120 characters. Blank sends “VinaX”.'),
      h('div.field', h('label.field-label', { for: (msg.id = ui.id('f')) }, 'Message'), msg, msgHint),
      h('div.field', h('label.field-label', { for: (link.id = ui.id('f')) }, 'Link'), link, linkHint),
      h('div.field', h('span.field-label', 'Audience'), h('div', audienceSeg)),
      segBox,
      countOut,
      h('div.actions',
        ui.button('Count recipients', { kind: 'ghost', icon: 'users', disabled: !canSend, onClick: dryRun }),
        sendBtn));

    var preview = h('div.preview-box', { 'aria-label': 'Notification preview' },
      h('div.media', h('span.thumb', { 'aria-hidden': 'true' }), h('div', h('div.cell-sub', 'VinaX · now'), pvTitle, pvBody, pvLink)));

    return [
      notices,
      reach,
      nobody,
      ui.grid([
        ui.card({ title: 'Compose', sub: 'A push notification on phones and browsers', span: 2, body: form }),
        ui.card({ title: 'Preview', sub: 'Roughly how it looks on a phone', body: [preview, h('p.field-hint', 'The exact look depends on the device and browser.')] })
      ]),
      result
    ];
  }

  function sentCard(d, ctx) {
    var failed = failedText(d.failed);
    var fcmFailed = failedText(d.fcmFailed);
    return ui.card({
      title: 'Sent', tone: d.sent || d.fcm ? null : 'warn', sub: 'Audience: ' + (d.target || 'everyone'),
      actions: [ui.button('History', { kind: 'ghost', small: true, onClick: function () { ctx.go('notify', 'history'); } })],
      body: [
        ui.kpis([
          { label: 'Browsers reached', value: fmt.num(d.sent), sub: 'of ' + fmt.num(d.total) + ' matched' },
          { label: 'Expired subscriptions', value: fmt.num(d.gone), sub: 'removed automatically' },
          { label: 'Android delivered', value: d.fcm == null ? '—' : fmt.num(d.fcm), sub: d.fcmError ? (d.fcmError === 'not_configured' ? 'Android push not set up' : 'error: ' + d.fcmError) : 'accepted by the push service', tone: d.fcmError && d.fcmError !== 'not_configured' ? 'bad' : null }
        ]),
        failed ? ui.notice('Browsers that refused it: ' + failed + '.', 'warn') : null,
        fcmFailed ? ui.notice('Android devices that refused it: ' + fcmFailed + '.', 'warn') : null
      ]
    });
  }

  /* ----------------------------------------------------------- History */

  function buildLog(rows) {
    var receipts = {};
    var out = [];
    rows.forEach(function (r) {
      if (r && r.type === 'push-receipt') { var m = safeJson(r.message); if (m && m.ts != null) receipts[String(m.ts)] = { row: r, data: m }; }
    });
    var used = {};
    rows.forEach(function (r) {
      if (!r || !r.type) return;
      var m = safeJson(r.message);
      if (r.type === 'announcement') {
        var rc = m && m.ts != null ? receipts[String(m.ts)] : null;
        if (rc) used[String(m.ts)] = true;
        out.push({ kind: 'announcement', kindLabel: 'Sent to everyone', at: r.created_at, title: (m && m.title) || 'VinaX', text: (m && m.body) || '', link: m && m.link, audience: rc ? rc.data.audience || 'everyone' : 'everyone', receipt: rc ? rc.data : null, raw: r, parsed: m, removable: true });
      } else if (r.type === 'song-push') {
        var parts = String(r.message || '').split('|').slice(1).filter(Boolean);
        out.push({ kind: 'song-push', kindLabel: 'Daily song push', at: r.created_at, title: 'Daily song pick', text: parts.map(function (p) { var i = p.indexOf(':'); return i > 0 ? p.slice(i + 1) + ' (' + p.slice(0, i) + ')' : p; }).join(', '), audience: parts.length ? fmt.plural(parts.length, 'language group') : '—', receipt: null, raw: r, parsed: null, removable: true });
      } else if (r.type === 'ai-push') {
        var place = [r.city, r.region, r.country ? fmt.country(r.country) : null].filter(Boolean).join(', ');
        out.push({ kind: 'ai-push', kindLabel: 'AI daily push', at: r.created_at, title: (m && m.title) || r.song_title || 'AI pick', text: (m && m.body) || r.song_title || '', link: m && m.link, audience: [place, r.language].filter(Boolean).join(' · ') || '—', receipt: null, raw: r, parsed: m, removable: true });
      }
    });
    Object.keys(receipts).forEach(function (ts) {
      if (used[ts]) return;
      var rc = receipts[ts];
      out.push({ kind: 'segment', kindLabel: 'Sent to a segment', at: rc.row.created_at, title: rc.data.title || 'VinaX', text: '', audience: rc.data.audience || '—', receipt: rc.data, raw: rc.row, parsed: rc.data, removable: false });
    });
    out.sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });
    return out;
  }

  function renderHistory(host, ctx) {
    var body = h('div.page-body');
    host.appendChild(body);
    return ui.load(body, function () { return VX.api.get('/api/admin/notifylog'); }, function (d) {
      if (d.configured === false) return ui.empty('Database not connected', 'The sent log lives in the database. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the Worker.');
      var log = buildLog(d.rows || []);
      var last = log[0];
      var manual = log.filter(function (x) { return x.kind === 'announcement' || x.kind === 'segment'; });
      var reached = 0;
      log.forEach(function (x) { if (x.receipt) reached += (Number(x.receipt.web && x.receipt.web.sent) || 0) + (Number(x.receipt.fcm) || 0); });
      return [
        ui.kpis([
          { label: 'In the log', value: fmt.num(log.length), sub: 'newest 60 entries' },
          { label: 'Sent from the console', value: fmt.num(manual.length) },
          { label: 'Devices reached', value: fmt.num(reached), sub: 'browsers + Android, console sends' },
          { label: 'Last send', value: last ? fmt.ago(last.at) : '—', sub: last ? fmt.dateTime(last.at) : 'nothing sent yet' }
        ]),
        ui.card({
          title: 'Sent notifications', sub: 'Click a row for the delivery details', pad: false,
          body: ui.table({
            rows: log, exportName: 'vinax-notifications', sortKey: 'at', sortDir: 'desc',
            empty: 'Nothing sent yet', emptyHint: 'Notifications you send, and the daily song pushes, are listed here.',
            onRow: function (r) { openEntry(r, ctx); },
            columns: [
              { key: 'at', label: 'When', nowrap: true, render: function (r) { return h('span', { title: fmt.dateTime(r.at) }, fmt.ago(r.at)); } },
              { key: 'kindLabel', label: 'Kind', render: function (r) { return ui.pill(r.kindLabel, r.kind === 'announcement' ? 'accent' : r.kind === 'segment' ? 'info' : null); } },
              { key: 'title', label: 'Notification', render: function (r) { return h('div', h('div.cell-main', fmt.trunc(r.title, 60)), r.text ? h('div.cell-sub', fmt.trunc(r.text, 90)) : null); }, sortVal: function (r) { return r.title + ' ' + r.text; } },
              { key: 'audience', label: 'Audience' },
              { key: 'delivery', label: 'Delivered', sortVal: function (r) { return r.receipt ? receiptSummary(r.receipt) : ''; }, render: function (r) { return r.receipt ? receiptSummary(r.receipt) : h('span.muted', r.kind === 'announcement' ? 'no receipt' : '—'); } },
              { key: 'actions', label: '', sort: false, render: function (r) {
                return r.removable ? ui.button('Remove', { kind: 'ghost', small: true, icon: 'trash', ariaLabel: 'Remove “' + fmt.trunc(r.title, 40) + '” from the log', onClick: function () { return removeEntry(r, ctx); } }) : null;
              } }
            ]
          })
        })
      ];
    }, { skeleton: 6 });
  }

  function removeEntry(r, ctx) {
    var what = r.kind === 'song-push'
      ? 'This deletes the daily song push entry. The daily push uses this entry to know it already ran today, so removing it may let it run again.'
      : r.kind === 'announcement'
        ? 'This deletes the entry from the log and from the Android in-app inbox, so devices that have not opened the app yet will not see it. Notifications already delivered stay on devices.'
        : 'This deletes the entry from the log. Notifications already delivered stay on devices.';
    return VX.confirm({ title: 'Remove this notification?', body: what, danger: true, confirmLabel: 'Remove' }).then(function (yes) {
      if (!yes) return;
      return VX.api.post('/api/admin/notifylog', { action: 'retract', created_at: r.raw.created_at }).then(function (res) {
        if (!res.ok) { VX.toast(res.error === 'not_found' ? 'Already removed.' : 'Could not remove: ' + res.message, 'bad'); return; }
        VX.toast('Removed', 'ok');
        ctx.refresh();
      });
    });
  }

  function openEntry(r, ctx) {
    var dr = VX.drawer({ title: r.title || 'Notification' });
    var rc = r.receipt;
    var pairs = [
      ['Kind', r.kindLabel],
      ['Sent', fmt.dateTime(r.at)],
      ['Audience', r.audience],
      r.text ? ['Message', r.text] : null,
      r.link ? ['Link', ui.mono(r.link)] : null
    ];
    if (r.kind === 'ai-push' && r.parsed) {
      var p = r.parsed;
      if (p.reason) pairs.push(['Why this song', String(p.reason)]);
      if (p.pickedBy) pairs.push(['Picked by', String(p.pickedBy)]);
      if (p.cohort && p.cohort.count != null) pairs.push(['Cohort', fmt.plural(p.cohort.count, 'device') + (p.cohort.langName ? ' · ' + p.cohort.langName : '')]);
      if (p.ai_error) pairs.push(['AI error', String(p.ai_error)]);
    }
    var parts = [ui.dl(pairs)];
    if (rc) {
      var web = rc.web || {};
      parts.push(h('h3', 'Delivery'));
      parts.push(ui.kpis([
        { label: 'Browsers', value: fmt.num(web.sent), sub: 'of ' + fmt.num(web.total) },
        { label: 'Expired', value: fmt.num(web.gone) },
        { label: 'Android', value: rc.fcm == null ? '—' : fmt.num(rc.fcm), sub: rc.fcmError ? (rc.fcmError === 'not_configured' ? 'not set up' : rc.fcmError) : null }
      ]));
      var f = failedText(web.failed), ff = failedText(rc.fcmFailed);
      if (f) parts.push(ui.notice('Browsers that refused it: ' + f + '.', 'warn'));
      if (ff) parts.push(ui.notice('Android devices that refused it: ' + ff + '.', 'warn'));
    } else if (r.kind === 'announcement') {
      parts.push(ui.notice('No delivery receipt — sends from before receipts existed, and the daily song pick, have none.', 'info'));
    }
    if (r.removable) parts.push(h('div.actions', ui.button('Remove from log', { kind: 'danger', icon: 'trash', onClick: function () { return removeEntry(r, ctx).then(function () { dr.close(); }); } })));
    VX.mount(dr.body, parts);
  }

  /* ---------------------------------------------------------- Audience */

  function renderAudience(host, ctx) {
    var top = h('div.page-body');
    var diag = h('div');
    host.appendChild(top);
    host.appendChild(diag);
    var envP = VX.api.get('/api/admin/envcheck');
    runFcmCheck(diag);
    return ui.load(top, function () {
      return Promise.all([VX.api.get('/api/admin/push'), envP]).then(function (r) {
        if (!r[0].ok) return r[0];
        return { ok: true, data: { push: r[0].data || {}, ready: readiness(r[1]), envOk: r[1].ok } };
      });
    }, function (d) {
      var p = d.push, ready = d.ready;
      var webOn = p.configured === true;
      var geo = p.geo || {};
      var total = (Number(p.subscribers) || 0) + (Number(p.fcm) || 0);
      var place = function (list, withCountry) {
        return (list || []).map(function (x) { return { label: x.key === 'Unknown' ? 'Unknown' : withCountry ? fmt.country(x.key) : x.key, sub: !withCountry && x.country ? fmt.country(x.country) : null, value: x.count }; });
      };
      return [
        ui.kpis([
          { label: 'Browser subscribers', value: webOn ? fmt.num(p.subscribers) : 'Not set up', sub: webOn ? 'active web push' : 'VAPID secrets missing', tone: webOn ? null : 'warn' },
          { label: 'Android devices', value: ready.known && !ready.android ? 'Not set up' : fmt.num(p.fcm), sub: ready.known && !ready.android ? 'FCM_SERVICE_ACCOUNT missing' : 'registered app installs', tone: ready.known && !ready.android ? 'warn' : null },
          { label: 'Can be reached', value: fmt.num(total), sub: 'browsers + Android' }
        ]),
        ui.grid([
          ui.card({ title: 'Countries', sub: 'Devices that can receive a push', body: ui.hbars(place(geo.countries, true), { empty: 'No subscribers yet', emptyHint: 'Fills in as listeners allow notifications.' }) }),
          ui.card({ title: 'Regions', sub: 'Top regions', body: ui.hbars(place(geo.regions, false), { empty: 'No subscribers yet' }) }),
          ui.card({ title: 'Cities', sub: 'Top cities — use these to target a send', body: ui.hbars(place(geo.cities, false), { empty: 'No subscribers yet' }) })
        ]),
        ui.card({
          title: 'Push secrets', sub: 'Set on the Worker; values are never shown',
          body: d.envOk && ready.items.length ? h('ul.list', ready.items.map(function (it) {
            var optional = it.name === 'NOTIFY_MIN_GAP_HOURS';
            return h('li', h('code.mono', it.name), h('span.grow.muted.small', it.note || ''), ui.pill(it.set ? 'Set' : optional ? 'Not set · optional' : 'Missing', it.set ? 'ok' : optional ? null : 'warn'));
          })) : ui.notice('Could not read the secret checklist.', 'warn')
        })
      ];
    }, { skeleton: 5 });
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
        if (!d.configured) verdict = ui.notice('Android push is not set up: FCM_SERVICE_ACCOUNT is not set on the Worker, so the Android app gets no notifications (it still shows sends to everyone in its in-app inbox).', 'warn');
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
          ['Detail', d.detail ? ui.mono(d.detail) : '—'],
          ['Registered Android devices', d.devices == null ? '—' : fmt.num(d.devices) + ' (including ones that later went inactive)']
        ]));
      });
    }
    load();
  }
})();
