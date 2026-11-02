/* VinaX console — Send Notification (console rebuild).
 *
 * Compose · History · Saved audiences · Setup check.
 * Routes: GET/POST /api/admin/push (counts, dry run, send, test, draft,
 * schedule), GET/POST /api/admin/notifications (history, cancel, delete,
 * retract), the `push-audiences` setting, /api/admin/envcheck and fcmcheck.
 * Only people signed in with Google are ever in the audience.
 */
(function () {
  'use strict';
  var VX = window.VX, h = VX.h, ui = VX.ui, fmt = VX.fmt;
  var arr = VX.arr, obj = VX.obj, num = VX.num;

  /** Pages a tap can open (no typing of addresses). */
  var PAGES = [
    { value: '/library', label: 'Library' }, { value: '/favorites', label: 'Favorites' }, { value: '/made-for-you', label: 'Made For You' },
    { value: '/weekly', label: 'Your Week' }, { value: '/discover', label: 'Discover' }, { value: '/trending', label: 'Trending' },
    { value: '/top-songs', label: 'Top songs' }, { value: '/languages', label: 'Languages' }, { value: '/moods', label: 'Moods' },
    { value: '/podcasts', label: 'Podcasts' }, { value: '/videos', label: 'Videos' }, { value: '/together', label: 'Listen Together' },
    { value: '/recap', label: 'Recap' }, { value: '/stats', label: 'Your VinaX' }, { value: '/vinaxai', label: 'VinaX AI' },
    { value: '/settings', label: 'Settings' }, { value: '/help', label: 'Help Center' }
  ];
  var TAPS = [
    { value: 'home', label: 'Home' }, { value: 'charts', label: 'Charts' }, { value: 'song', label: 'A song' },
    { value: 'album', label: 'An album' }, { value: 'playlist', label: 'A playlist' }, { value: 'page', label: 'Another page in the app' }
  ];
  var ACTIVITY = [
    { value: '', label: 'Anyone', hint: 'Every signed-in person' },
    { value: 'active7', label: 'Active in last 7 days', hint: 'Opened the app this week' },
    { value: 'quiet', label: 'Quiet 7–14 days', hint: 'Last seen one to two weeks ago' },
    { value: 'dormant14', label: 'Inactive 14+ days', hint: 'Not seen for two weeks or more' }
  ];
  var PLATFORM = [{ value: '', label: 'All' }, { value: 'web', label: 'Web' }, { value: 'fcm', label: 'Android' }];
  var TITLE_MAX = 120, BODY_MAX = 300;

  /** What Compose starts from (Duplicate, Edit draft and saved audiences fill it). */
  var seed = null;

  function blank() {
    return { title: '', body: '', image: null, tap: 'home', target: null, page: '/library', country: '', region: '', city: '', lang: '', channel: '', activity: '', users: [], when: 'now', scheduledFor: null, draftId: null };
  }
  function linkOf(st) {
    if (st.tap === 'charts') return '/charts';
    if ((st.tap === 'song' || st.tap === 'album' || st.tap === 'playlist') && st.target && st.target.id) return '/' + st.tap + '/' + encodeURIComponent(st.target.id);
    if (st.tap === 'page') return st.page || '/';
    return '/';
  }
  /** A stored row / link back into the Compose state. */
  function fromRow(r) {
    var st = blank();
    var f = obj(r.filter);
    st.title = r.title || ''; st.body = r.body || ''; st.image = r.image || null;
    st.country = f.country || ''; st.region = f.region || ''; st.city = f.city || ''; st.lang = f.lang || ''; st.channel = f.channel || ''; st.activity = f.activity || '';
    st.users = arr(f.users).map(function (id) { return { id: String(id), name: null, email: null, picture: null }; });
    var link = r.link || '/';
    var m = /^\/(song|album|playlist)\/(.+)$/.exec(link);
    if (link === '/') st.tap = 'home';
    else if (link === '/charts') st.tap = 'charts';
    else if (m) { st.tap = m[1]; st.target = { id: decodeURIComponent(m[2]), title: 'Chosen ' + m[1], sub: null, image: null }; }
    else { st.tap = 'page'; st.page = link; }
    return st;
  }
  function audienceBody(st) {
    var f = {};
    if (st.country) f.country = st.country;
    if (st.region) f.region = st.region;
    if (st.city) f.city = st.city;
    if (st.lang) f.lang = st.lang;
    if (st.channel) f.channel = st.channel;
    return { filter: f, activity: st.activity || null, users: st.users.map(function (u) { return u.id; }) };
  }
  function plural(n, one, many) { return fmt.plural(num(n), one, many); }

  /* ------------------------------------------------------------- Compose */

  function renderCompose(host, ctx) {
    var st = seed ? seed : blank();
    seed = null;
    var p = ctx.params || {};
    if (p.title && !st.title) st.title = String(p.title).slice(0, TITLE_MAX);
    if (p.message && !st.body) st.body = String(p.message).slice(0, BODY_MAX);
    ['song', 'album', 'playlist'].forEach(function (k) { if (p[k]) { st.tap = k; st.target = { id: String(p[k]), title: p.name || 'Chosen ' + k, sub: p.artist || null, image: /^https:\/\//.test(p.image || '') ? p.image : null }; } });
    if (p.users) st.users = String(p.users).split(',').filter(function (x) { return /^\d{1,40}$/.test(x); }).slice(0, 500).map(function (id) { return { id: id, name: null, email: null, picture: null }; });
    var dedupe = VX.rid();
    var dirty = false;
    ctx.onLeave(function () { return dirty && (st.title || st.body) ? 'Your notification is not sent or saved yet. Leave without saving?' : null; });

    return ui.load(host, function () { return VX.api.get('/api/admin/push'); }, function (d) {
      var gate = ui.gate(d, ctx);
      if (gate) return gate;
      var geo = obj(d.geo);
      var canEdit = VX.can('edit');
      var reachEl = h('div.reach', { 'aria-live': 'polite' });
      var previewHost = h('div.np-preview');
      var errEl = h('p.form-error', { role: 'alert' });
      var lastReach = null;

      function touch() { dirty = true; drawPreview(); }
      function drawPreview() {
        VX.mount(previewHost, h('div.preview-label.muted.small', 'Preview'), ui.phone([
          h('div.np-lock-time', VX.time.nowHm()),
          h('div.np-card',
            h('div.np-head', h('span.np-icon', { 'aria-hidden': 'true' }, 'V'), h('span', 'VinaX'), h('span.np-when', 'now')),
            h('strong.np-title', st.title || 'VinaX'),
            h('p.np-body', st.body || 'Your message appears here.'),
            st.image ? h('img.np-img', { src: st.image, alt: '', referrerpolicy: 'no-referrer' }) : null),
          h('p.np-tap.muted.small', 'A tap opens: ' + tapLabel())
        ], { label: 'How the notification will look on a phone' }));
      }
      function tapLabel() {
        if (st.tap === 'home') return 'Home';
        if (st.tap === 'charts') return 'Charts';
        if (st.tap === 'page') { var pg = PAGES.filter(function (x) { return x.value === st.page; })[0]; return pg ? pg.label : 'a page'; }
        return st.target ? st.target.title : 'choose a ' + st.tap + ' below';
      }

      /* -- live reach count -- */
      var reachTimer = null, reachSeq = 0;
      function countReach() {
        clearTimeout(reachTimer);
        VX.mount(reachEl, h('span.muted', 'Counting…'));
        reachTimer = setTimeout(function () {
          var my = ++reachSeq;
          var b = Object.assign({ body: st.body || 'count', link: '/', dryRun: true }, audienceBody(st));
          VX.api.post('/api/admin/push', b).then(function (res) {
            if (my !== reachSeq) return;
            if (!res.ok) { lastReach = null; VX.mount(reachEl, h('span.muted', res.error === 'kind_off' ? 'Announcements are switched off in Notification Rules.' : 'Could not count the audience — ' + res.message)); return; }
            var r = res.data || {};
            lastReach = r;
            VX.mount(reachEl,
              h('strong.reach-num', 'Will reach about ' + plural(r.people, 'user')),
              h('span.muted.small', ' · ' + plural(r.devices, 'phone or browser', 'phones and browsers')),
              num(r.skippedRecent) ? h('span.muted.small', ' · ' + plural(r.skippedRecent, 'device') + ' skipped (had a notification recently)') : null,
              ui.info('Counts people signed in with Google who allowed notifications and match every choice under “Who gets it”. People who got a notification too recently (Notification Rules) are left out.', 'Reach'));
          });
        }, 350);
      }

      /* -- message -- */
      function textField(key, label, max, multiline) {
        var inp = multiline ? ui.textarea({ rows: 3, maxlength: max }) : ui.input({ maxlength: max });
        inp.value = st[key] || '';
        var counter = h('span.counter.muted.small', inp.value.length + ' / ' + max);
        inp.addEventListener('input', function () { st[key] = inp.value; counter.textContent = inp.value.length + ' / ' + max; touch(); });
        return ui.field(label, inp, counter);
      }
      var tapHost = h('div.tap-target');
      function drawTap() {
        var nodes = [];
        if (st.tap === 'song' || st.tap === 'album' || st.tap === 'playlist') {
          var type = st.tap + 's';
          if (st.target) nodes.push(h('div.picked', ui.media(st.target.image, st.target.title, st.target.sub), ui.button('Change', { kind: 'ghost', small: true, onClick: function () { st.target = null; drawTap(); touch(); } })));
          else nodes.push(ui.musicPicker({ type: type, label: 'Find the ' + st.tap, onPick: function (m) { st.target = { id: m.id, title: m.title, sub: m.sub, image: m.image }; drawTap(); touch(); } }));
        } else if (st.tap === 'page') {
          nodes.push(ui.dropdown('Page', PAGES, st.page, function (v) { st.page = v; touch(); }));
        }
        VX.mount(tapHost, nodes);
      }
      drawTap();
      var message = ui.card({ title: 'Message', body: h('div.form-col',
        textField('title', 'Title', TITLE_MAX, false),
        textField('body', 'Message', BODY_MAX, true),
        ui.imageUpload({ label: 'Picture (optional)', value: st.image, aspect: 2, width: 1024, purpose: 'notification', disabled: !canEdit, onChange: function (url) { st.image = url; touch(); } }),
        ui.dropdown('Where a tap goes', TAPS, st.tap, function (v) { st.tap = v; st.target = null; drawTap(); touch(); }),
        tapHost) });

      /* -- who gets it -- */
      var whoHost = h('div.form-col');
      function opts(list, all, labelOf) { return [{ value: '', label: all }].concat(list.map(function (x) { return { value: x.key, label: (labelOf ? labelOf(x.key) : x.key) + ' (' + fmt.num(x.count) + ')' }; })); }
      function drawWho() {
        var regions = arr(geo.regions).filter(function (r) { return !st.country || (r.country || 'Unknown') === st.country || (!r.country && st.country === 'Unknown'); });
        var cities = arr(geo.cities).filter(function (c) { return (!st.country || (c.country || 'Unknown') === st.country) && (!st.region || (c.region || 'Unknown') === st.region); });
        var userChips = st.users.map(function (u) { return { id: u.id, label: u.name || u.email || 'Chosen user', sub: u.name ? u.email : null, img: u.picture || null }; });
        VX.mount(whoHost,
          h('p.muted.small', 'Leave everything on “Everyone” to reach every signed-in person.'),
          h('div.form-row.three',
            ui.dropdown('Country', opts(arr(geo.countries), 'Everyone', function (k) { return k === 'Unknown' ? 'Not known' : fmt.country(k); }), st.country, function (v) { st.country = v; st.region = ''; st.city = ''; drawWho(); changed(); }),
            ui.dropdown('State', opts(regions, 'All states'), st.region, function (v) { st.region = v; st.city = ''; drawWho(); changed(); }, { disabled: !st.country }),
            ui.dropdown('City', opts(cities, 'All cities'), st.city, function (v) { st.city = v; changed(); }, { disabled: !st.country })),
          ui.dropdown('Language', [{ value: '', label: 'Every language' }].concat(arr(d.langs).filter(function (l) { return l.lang && l.lang !== 'unknown'; }).map(function (l) { return { value: l.lang, label: VX.langName(l.lang) + ' (' + fmt.num(l.count) + ')' }; })), st.lang, function (v) { st.lang = v; changed(); }),
          ui.radios('Platform', PLATFORM, st.channel, function (v) { st.channel = v; changed(); }, { row: true }),
          ui.radios('Activity', ACTIVITY, st.activity, function (v) { st.activity = v; changed(); }),
          h('div.field',
            h('span.field-label', 'Only these people (optional)'),
            ui.chips(userChips, function (id) { st.users = st.users.filter(function (u) { return u.id !== id; }); drawWho(); changed(); }, { empty: 'Not limited to chosen people.' }),
            ui.userPicker({ label: 'Add a person', hideLabel: true, onPick: function (u) { if (!st.users.some(function (x) { return x.id === u.id; })) st.users.push(u); drawWho(); changed(); } })),
          h('div.toolbar', reachEl, h('span.grow'), canEdit ? ui.button('Save this audience', { kind: 'ghost', small: true, icon: 'plus', onClick: saveAudience }) : null));
      }
      function changed() { touch(); countReach(); }
      function saveAudience() {
        var name = ui.input({ maxlength: 60, placeholder: 'e.g. Telugu listeners in Hyderabad' });
        VX.modal({
          title: 'Save this audience', body: [ui.field('Name', name, 'Find it later under Saved audiences.')],
          actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Save', kind: 'primary', onClick: function (close) {
            var n = name.value.trim();
            if (!n) { name.classList.add('invalid'); name.focus(); return; }
            return readAudiences().then(function (list) {
              var a = audienceBody(st);
              list.unshift({ id: VX.rid(), name: n, filter: a.filter, activity: a.activity, users: a.users });
              return writeAudiences(list.slice(0, 30));
            }).then(function (ok) { if (ok) { close(); VX.toast('Audience saved ✓', 'ok'); } });
          } }]
        });
      }
      drawWho();

      /* -- when -- */
      var whenHost = h('div.form-col');
      function drawWhen() {
        var q = obj(d.quiet);
        VX.mount(whenHost,
          ui.radios('Send', [{ value: 'now', label: 'Send now' }, { value: 'schedule', label: 'Schedule for later' }], st.when, function (v) { st.when = v; drawWhen(); drawButtons(); touch(); }, { row: true }),
          st.when === 'schedule' ? ui.dateTimePicker('Send on', st.scheduledFor, function (iso) { st.scheduledFor = iso; touch(); }, { min: new Date(Date.now() + 120000).toISOString() }) : null,
          st.when === 'now' && q.quiet ? ui.notice('It is quiet hours now (until ' + fmt.time(q.until) + ' ' + VX.tzShort() + '). You can schedule it, or confirm to send anyway.', 'warn') : null);
      }
      drawWhen();

      /* -- buttons -- */
      var btnHost = h('div.save-bar.compose-actions');
      function drawButtons() {
        VX.mount(btnHost,
          ui.button('Send test to me', { kind: 'ghost', icon: 'phone', disabled: !canEdit, onClick: sendTest }),
          ui.button(st.draftId ? 'Update draft' : 'Save draft', { kind: 'ghost', icon: 'edit', disabled: !canEdit, onClick: saveDraft }),
          h('span.grow'),
          ui.button(st.when === 'schedule' ? 'Schedule' : 'Send', { kind: 'primary', icon: st.when === 'schedule' ? 'calendar' : 'send', disabled: !canEdit, onClick: send }));
      }
      drawButtons();

      function check(needAudience) {
        errEl.textContent = '';
        if (!st.body.trim()) { errEl.textContent = 'Write a message first.'; return false; }
        if ((st.tap === 'song' || st.tap === 'album' || st.tap === 'playlist') && !st.target) { errEl.textContent = 'Choose the ' + st.tap + ' a tap should open, or pick another place.'; return false; }
        if (needAudience && st.when === 'schedule' && !st.scheduledFor) { errEl.textContent = 'Pick the date and time to send it.'; return false; }
        if (needAudience && st.when === 'schedule' && new Date(st.scheduledFor).getTime() < Date.now() + 60000) { errEl.textContent = 'Pick a time at least a minute from now.'; return false; }
        return true;
      }
      function payload(extra) {
        return Object.assign({ title: st.title.trim() || 'VinaX', body: st.body.trim(), link: linkOf(st), image: st.image || null }, audienceBody(st), st.draftId ? { draftId: st.draftId } : {}, extra || {});
      }
      function sendTest() {
        if (!check(false)) return;
        return VX.api.post('/api/admin/push', payload({ test: true })).then(function (res) {
          if (!res.ok) { VX.toast(res.data && res.data.message ? res.data.message : 'Something went wrong — ' + res.message, 'bad'); return; }
          VX.toast('Test sent to ' + plural(res.data.devices, 'of your devices', 'of your devices') + ' ✓', 'ok');
        });
      }
      function saveDraft() {
        if (!check(false)) return;
        return VX.api.post('/api/admin/push', payload({ draft: true })).then(function (res) {
          if (!res.ok) { VX.toast('Something went wrong — ' + res.message, 'bad'); return; }
          st.draftId = res.data.id; dirty = false; drawButtons();
          VX.toast('Draft saved ✓', 'ok');
        });
      }
      function send() {
        if (!check(true)) return;
        var n = lastReach ? num(lastReach.people) : null;
        if (st.when === 'schedule') {
          return VX.confirm({ title: 'Schedule this notification?', body: 'It will go to about ' + plural(n, 'user') + ' on ' + fmt.full(st.scheduledFor) + '. You can cancel it from History until then.', confirmLabel: 'Schedule' }).then(function (ok) {
            if (!ok) return;
            return VX.api.post('/api/admin/push', payload({ when: 'schedule', scheduledFor: st.scheduledFor, dedupeKey: dedupe })).then(function (res) {
              if (!res.ok) { VX.toast((res.data && res.data.message) || 'Something went wrong — ' + res.message, 'bad'); return; }
              done('Scheduled for ' + fmt.full(res.data.scheduledFor) + ' ✓');
            });
          });
        }
        if (n === 0) { VX.toast('Nobody matches this audience yet. Change “Who gets it”.', 'bad'); return; }
        return VX.confirm({ title: 'Send now?', body: 'Send to ' + plural(n, 'user') + ' now? This cannot be unsent, only retracted.', confirmLabel: 'Send now' }).then(function (ok) {
          if (ok) return post(false);
        });
      }
      function post(ignoreQuiet) {
        return VX.api.post('/api/admin/push', payload({ when: 'now', dedupeKey: dedupe, ignoreQuiet: ignoreQuiet || undefined })).then(function (res) {
          if (res.status === 409 && res.error === 'quiet_hours') {
            return VX.confirm({ title: 'It is quiet hours', body: 'Quiet hours last until ' + fmt.time(res.data.until) + ' ' + VX.tzShort() + '. People may be asleep. Send anyway?', confirmLabel: 'Send anyway', danger: true }).then(function (ok) { if (ok) return post(true); });
          }
          if (!res.ok) { VX.toast((res.data && res.data.message) || 'Something went wrong — ' + res.message, 'bad'); return; }
          done('Sent to ' + plural(res.data.people, 'user') + ' ✓');
        });
      }
      function done(msg) {
        VX.toast(msg, 'ok');
        dirty = false;
        ctx.go('notifications', 'history', {});
      }

      drawPreview();
      countReach();
      var form = h('div.compose-main',
        ui.readOnlyNote(),
        message,
        ui.card({ title: 'Who gets it', sub: 'Only people signed in with Google can get notifications.', body: whoHost }),
        ui.card({ title: 'When', body: whenHost }),
        errEl,
        btnHost);
      return h('div.compose', canEdit ? form : h('fieldset.ro', { disabled: true }, form), h('aside.compose-side', previewHost));
    });
  }

  /* ------------------------------------------------------------- History */

  var STATUS = {
    sent: ['Sent', 'ok'], scheduled: ['Scheduled', 'info'], draft: ['Draft', null], cancelled: ['Cancelled', null],
    sending: ['Sending', 'warn'], retracted: ['Retracted', 'bad']
  };
  function statusPill(s) { var x = STATUS[s] || [fmt.label(s || 'sent'), null]; return ui.pill(x[0], x[1]); }

  function renderHistory(host, ctx) {
    var filter = ctx.params.status || 'all';
    return ui.load(host, function () { return VX.api.get('/api/admin/notifications', { status: filter, limit: 200 }); }, function (d) {
      var gate = ui.gate(d, ctx);
      if (gate) return gate;
      var rows = arr(d.rows), counts = obj(d.counts);
      var sentRows = rows.filter(function (r) { return r.status === 'sent' && num(r.delivered) > 0; });
      var delivered = sentRows.reduce(function (a, r) { return a + num(r.delivered); }, 0);
      var opened = sentRows.reduce(function (a, r) { return a + num(r.opened); }, 0);
      var canEdit = VX.can('edit');
      function act(body, msg) {
        return VX.api.post('/api/admin/notifications', body).then(function (res) {
          if (!res.ok) { VX.toast((res.data && res.data.message) || 'Something went wrong — ' + res.message, 'bad'); return; }
          VX.toast(msg, 'ok'); ctx.refresh();
        });
      }
      function details(r) {
        VX.modal({ title: r.title || 'Notification', wide: true, body: [
          ui.dl([
            ['Status', statusPill(r.status)],
            [r.status === 'scheduled' ? 'Sends on' : r.status === 'draft' ? 'Saved' : 'Sent', ui.ago(r.status === 'scheduled' ? r.scheduledFor : r.at)],
            ['Message', r.body],
            ['A tap opens', r.link === '/' ? 'Home' : r.link],
            ['Audience', r.audience],
            ['Delivered', fmt.num(r.delivered) + ' (web ' + fmt.num(obj(r.web).sent) + ' · Android ' + fmt.num(obj(r.fcm).sent) + ')'],
            ['Opened', fmt.num(r.opened) + (r.openRate != null ? ' (' + fmt.pct(r.openRate) + ')' : '')],
            ['Phones no longer reachable', fmt.num(obj(r.web).gone)],
            ['Sent by', r.sentBy || '—']
          ]),
          r.image ? h('img.np-detail-img', { src: r.image, alt: '', referrerpolicy: 'no-referrer' }) : null
        ] });
      }
      var table = ui.dataTable({
        rows: rows, exportName: 'vinax-notifications', search: 'Search by title or message…',
        filters: [ui.dropdown('Show', [{ value: 'all', label: 'Everything' }, { value: 'sent', label: 'Sent' }, { value: 'scheduled', label: 'Scheduled' }, { value: 'draft', label: 'Drafts' }], filter, function (v) { ctx.setParam('status', v === 'all' ? null : v); ctx.refresh(); }, { inline: true })],
        empty: { title: 'Nothing sent yet', hint: 'Notifications you send, schedule or save as drafts appear here.', action: canEdit ? { label: 'Write one', icon: 'send', onClick: function () { ctx.go('notifications', 'compose'); } } : null },
        onRow: details,
        columns: [
          { key: 'at', label: 'Date', sortVal: function (r) { return r.status === 'scheduled' ? r.scheduledFor : r.at; }, render: function (r) { return ui.ago(r.status === 'scheduled' ? r.scheduledFor : r.at); }, csv: function (r) { return r.status === 'scheduled' ? r.scheduledFor : r.at; } },
          { key: 'title', label: 'Title', render: function (r) { return h('div', h('div.cell-main', r.title || 'VinaX'), h('div.cell-sub', fmt.trunc(r.body || '', 90))); } },
          { key: 'audience', label: 'Audience' },
          { key: 'status', label: 'Status', render: function (r) { return statusPill(r.status); } },
          { key: 'delivered', label: 'Delivered', align: 'right', render: function (r) { return r.status === 'sent' || r.status === 'retracted' ? fmt.num(r.delivered) : null; } },
          { key: 'opened', label: 'Opened', align: 'right', render: function (r) { return r.status === 'sent' || r.status === 'retracted' ? fmt.num(r.opened) : null; } },
          { key: 'openRate', label: 'Open rate', align: 'right', render: function (r) { return r.openRate == null ? null : fmt.pct(r.openRate); } }
        ],
        rowMenu: function (r) {
          return [
            { label: 'View details', icon: 'info', onClick: function () { details(r); } },
            { label: 'Duplicate', icon: 'copy', hidden: !canEdit, onClick: function () { seed = fromRow(r); ctx.go('notifications', 'compose'); } },
            { label: 'Edit draft', icon: 'edit', hidden: !canEdit || r.status !== 'draft', onClick: function () { seed = fromRow(r); seed.draftId = r.id; ctx.go('notifications', 'compose'); } },
            { label: 'Cancel sending', icon: 'close', hidden: !canEdit || r.status !== 'scheduled', onClick: function () {
              VX.confirm({ title: 'Cancel this scheduled notification?', body: '“' + (r.title || 'VinaX') + '” will not be sent.', confirmLabel: 'Cancel sending', danger: true }).then(function (ok) { if (ok) act({ action: 'cancel', id: r.id }, 'Cancelled ✓'); });
            } },
            { label: 'Retract', icon: 'refresh', hidden: !canEdit || r.status !== 'sent', onClick: function () {
              VX.confirm({ title: 'Retract this notification?', body: 'Phones that already showed it keep it, but Android phones that have not opened the app yet will not show it, and it is marked retracted here.', confirmLabel: 'Retract', danger: true }).then(function (ok) { if (ok) act({ action: 'retract', id: r.id }, 'Retracted ✓'); });
            } },
            '-',
            { label: 'Delete', icon: 'trash', danger: true, hidden: !canEdit || (r.status !== 'draft' && r.status !== 'cancelled'), onClick: function () {
              VX.confirm({ title: 'Delete this ' + (r.status === 'draft' ? 'draft' : 'notification') + '?', body: 'This cannot be undone.', confirmLabel: 'Delete', danger: true }).then(function (ok) { if (ok) act({ action: 'delete', id: r.id }, 'Deleted ✓'); });
            } }
          ];
        }
      });
      return [
        ui.stats([
          { label: 'Sent', value: fmt.num(counts.sent), info: 'Notifications that went out, all time.', onClick: function () { ctx.setParam('status', 'sent'); ctx.refresh(); } },
          { label: 'Scheduled', value: fmt.num(counts.scheduled), info: 'Waiting to go out at the time you picked. Cancel any of them from the ⋯ menu.', onClick: function () { ctx.setParam('status', 'scheduled'); ctx.refresh(); } },
          { label: 'Drafts', value: fmt.num(counts.draft), info: 'Saved but not sent. Open one from the ⋯ menu to finish it.', onClick: function () { ctx.setParam('status', 'draft'); ctx.refresh(); } },
          { label: 'Open rate', value: delivered ? fmt.pct(opened / delivered * 100) : '—', sub: delivered ? fmt.num(opened) + ' taps of ' + fmt.num(delivered) + ' delivered' : null, info: 'Of the notifications shown below that reached a phone or browser, the share people tapped. Taps are counted from app versions that report them.' }
        ]),
        ui.card({ title: 'History', pad: false, body: table })
      ];
    });
  }

  /* ---------------------------------------------------- Saved audiences */

  function readAudiences() {
    return VX.api.get('/api/admin/settings', { key: 'push-audiences' }, { fresh: true }).then(function (res) {
      return res.ok ? arr(res.data && res.data.value).filter(function (a) { return a && a.id && a.name; }) : [];
    });
  }
  function writeAudiences(list) {
    return VX.api.post('/api/admin/settings', { key: 'push-audiences', value: list.length ? list : null }).then(function (res) {
      if (!res.ok) VX.toast('Something went wrong — ' + res.message, 'bad');
      return res.ok;
    });
  }
  function describeAudience(a) {
    var f = obj(a.filter), parts = [];
    if (arr(a.users).length) parts.push(plural(arr(a.users).length, 'chosen user'));
    if (f.city) parts.push(f.city); else if (f.region) parts.push(f.region); else if (f.country) parts.push(fmt.country(f.country));
    if (f.lang) parts.push(VX.langName(f.lang));
    if (f.channel) parts.push(f.channel === 'web' ? 'Web' : 'Android');
    var act = ACTIVITY.filter(function (x) { return x.value === (a.activity || ''); })[0];
    if (act && act.value) parts.push(act.label);
    return parts.join(' · ') || 'Everyone';
  }

  function renderAudiences(host, ctx) {
    return ui.load(host, function () { return VX.api.get('/api/admin/settings', { key: 'push-audiences' }, { fresh: true }); }, function (d) {
      var gate = ui.gate(d, ctx);
      if (gate) return gate;
      var list = arr(d.value).filter(function (a) { return a && a.id && a.name; });
      var canEdit = VX.can('edit');
      if (!list.length) {
        return ui.card({ body: ui.emptyState('No saved audiences yet', 'On Compose, choose who gets it and press “Save this audience”. It then appears here for next time.', { label: 'Go to Compose', icon: 'send', onClick: function () { ctx.go('notifications', 'compose'); } }) });
      }
      var counts = {};
      var table = ui.dataTable({
        rows: list, rowId: function (a) { return a.id; }, exportName: false, search: list.length > 8 ? 'Search audiences…' : false,
        columns: [
          { key: 'name', label: 'Name', render: function (a) { return h('strong', a.name); } },
          { key: 'who', label: 'Who', sortVal: describeAudience, render: describeAudience },
          { key: 'reach', label: 'Reaches about', align: 'right', sort: false, render: function (a) { var el = h('span.muted', '…'); counts[a.id] = el; return el; } }
        ],
        rowMenu: function (a) {
          return [
            { label: 'Use in a notification', icon: 'send', hidden: !canEdit, onClick: function () { var st = fromRow({ filter: Object.assign({}, a.filter, { activity: a.activity, users: a.users }), link: '/' }); seed = st; ctx.go('notifications', 'compose'); } },
            { label: 'Rename', icon: 'edit', hidden: !canEdit, onClick: function () {
              var name = ui.input({ maxlength: 60, value: a.name });
              VX.modal({ title: 'Rename audience', body: [ui.field('Name', name)], actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Save', kind: 'primary', onClick: function (close) {
                var n = name.value.trim(); if (!n) return;
                return writeAudiences(list.map(function (x) { return x.id === a.id ? Object.assign({}, x, { name: n }) : x; })).then(function (ok) { if (ok) { close(); VX.toast('Saved ✓', 'ok'); ctx.refresh(); } });
              } }] });
            } },
            '-',
            { label: 'Delete', icon: 'trash', danger: true, hidden: !canEdit, onClick: function () {
              VX.confirm({ title: 'Delete “' + a.name + '”?', body: 'Only the saved audience is deleted. Nobody is affected.', confirmLabel: 'Delete', danger: true }).then(function (ok) {
                if (ok) writeAudiences(list.filter(function (x) { return x.id !== a.id; })).then(function (done) { if (done) { VX.toast('Deleted ✓', 'ok'); ctx.refresh(); } });
              });
            } }
          ];
        }
      });
      // Count each audience after the table is drawn.
      setTimeout(function () {
        list.forEach(function (a) {
          VX.api.post('/api/admin/push', { body: 'count', link: '/', dryRun: true, filter: a.filter, activity: a.activity, users: a.users }).then(function (res) {
            if (counts[a.id]) counts[a.id].textContent = res.ok ? plural(res.data.people, 'user') : '—';
          });
        });
      }, 0);
      return ui.card({ title: 'Saved audiences', sub: 'Groups of people you send to often.', pad: false, body: table });
    });
  }

  /* --------------------------------------------------------- Setup check */

  function renderSetup(host, ctx) {
    return ui.load(host, function () {
      return Promise.all([VX.api.get('/api/admin/push'), VX.api.get('/api/admin/envcheck'), VX.api.get('/api/admin/fcmcheck', null, { timeout: 30000 })]).then(function (r) {
        return { ok: true, data: { push: r[0], env: r[1], fcm: r[2] } };
      });
    }, function (all) {
      var push = all.push.ok ? obj(all.push.data) : null;
      var envItems = all.env.ok ? arr(obj(all.env.data).items).filter(function (i) { return i && i.group === 'Push'; }) : [];
      var fcm = all.fcm.ok ? obj(all.fcm.data) : null;
      var web = push ? obj(push.web) : {}, and = push ? obj(push.fcm) : {};
      var webReady = !!web.configured;
      var androidReady = !!(fcm && fcm.fcm === 'ok');
      var devices = num(web.allDevices) + num(and.allDevices);
      var signed = num(web.active) + num(and.active);
      function row(ok, title, sub, fix) {
        return h('li.check-row' + (ok ? '.ok' : ok === null ? '.unknown' : '.bad'),
          h('span.check-mark', { 'aria-hidden': 'true' }, ok ? '✓' : ok === null ? '?' : '✗'),
          h('div.check-text', h('strong', title), h('p.muted.small', sub), !ok && fix ? h('details.how-fix', h('summary', 'How to fix'), h('div.small', fix)) : null),
          h('span.sr-only', ok ? 'Ready' : 'Needs attention'));
      }
      var rules = push ? obj(push.rules) : {};
      var quiet = obj(rules.quiet);
      return [
        ui.card({ title: 'Is everything ready to send?', body: h('ul.checklist',
          row(webReady, 'Browser notifications ready', webReady ? 'People using VinaX in a browser can get notifications.' : 'Browsers cannot get notifications yet.',
            ['The website needs its web push keys on the server. A developer adds them once; nobody else has to do anything.', h('p.muted.small', 'Technical: Worker secrets VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT.')]),
          row(fcm ? androidReady : null, 'Android notifications ready', androidReady ? 'The Android app can get notifications even when it is closed.' : fcm && !fcm.configured ? 'Android phones cannot get notifications yet.' : 'The Android notification service did not accept the server’s key.',
            ['A developer connects the server to Firebase (the Android notification service) with the project’s service account.', h('p.muted.small', 'Technical: Worker secret FCM_SERVICE_ACCOUNT' + (fcm && fcm.detail ? ' · ' + fcm.detail : '') + '.')]),
          row(devices > 0, 'Phones and browsers registered', devices ? plural(devices, 'phone or browser', 'phones and browsers') + ' allowed notifications.' : 'No phone or browser has allowed notifications yet.',
            'People turn notifications on in the app (Settings → Notifications). Android asks on first open.'),
          row(signed > 0, 'Signed-in people you can reach', signed ? plural(push.people, 'person', 'people') + ' signed in with Google on ' + plural(signed, 'device') + '.' : 'None of those phones belong to a signed-in person yet.',
            'Only people signed in with Google get notifications. A phone links to its owner the next time they open the app while signed in.')
        ) }),
        ui.card({ title: 'Notification Rules in force', sub: 'Change them in App Settings → Notification Rules.', actions: [ui.button('Open Notification Rules', { kind: 'ghost', small: true, icon: 'settings', onClick: function () { ctx.go('app-settings/notification-rules'); } })], body: ui.dl([
          ['At most', num(rules.minGapHours) ? 'One notification per person every ' + (num(rules.minGapHours) >= 24 ? plural(num(rules.minGapHours) / 24, 'day') : plural(rules.minGapHours, 'hour')) : 'No limit'],
          ['Quiet hours', quiet.enabled ? quiet.start + ' to ' + quiet.end + ' (India time)' + (obj(push && push.quiet).quiet ? ' — quiet now' : '') : 'Off']
        ]) }),
        envItems.length ? ui.card({ title: 'Technical details', sub: 'For a developer. Values are never shown.', body: h('ul.list', envItems.map(function (it) { return h('li', h('code.mono', it.name), h('span.grow'), ui.pill(it.set ? 'Set ✓' : 'Missing ✗', it.set ? 'ok' : 'warn')); })) }) : null
      ];
    });
  }

  VX.page({
    id: 'notifications', title: 'Send Notification', group: 'Engage', icon: 'bell', order: 1, noAuto: true,
    desc: 'Send a message to people’s phones and browsers. Only people signed in with Google can get them.',
    keywords: 'push notify message announcement broadcast',
    tabs: [
      { id: 'compose', label: 'Compose', render: renderCompose },
      { id: 'history', label: 'History', render: renderHistory },
      { id: 'audiences', label: 'Saved audiences', render: renderAudiences },
      { id: 'setup', label: 'Setup check', render: renderSetup }
    ]
  });
})();
