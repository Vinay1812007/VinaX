/* VinaX console — Smart Alerts (System).
 * The server checks for trouble every few minutes (the `alerts` job) and
 * sends ONE short alert per problem to the admins' own phones: app errors
 * rising, the site or music search not answering, no songs played, new
 * feedback. This page shows whether it is on, who gets the alerts and
 * whether their phone is linked, the rules (Owners edit them: the
 * `alert-rules` setting, saved through /api/admin/settings), a test alert,
 * Check now, and the recent alerts.
 *   GET  /api/admin/alerts                    → rules, recipients, me, push, recent, job, signals
 *   POST /api/admin/alerts { action: 'test' }  → a test to your own phone (editor)
 *   POST /api/admin/alerts { action: 'check' } → check now (owner)
 */
(function () {
  'use strict';
  var VX = window.VX, h = VX.h, ui = VX.ui, fmt = VX.fmt, arr = VX.arr, obj = VX.obj, num = VX.num;

  var RULES = [
    { id: 'errorsSpike', title: 'App errors rising', desc: 'When the app suddenly reports many more errors than the hour before.' },
    { id: 'siteDown', title: 'Site or music search not answering', desc: 'When the website or music search stops answering. Sent even during quiet hours.' },
    { id: 'noPlays', title: 'No songs played', desc: 'When nobody plays a song for a while — playback may be broken.' },
    { id: 'newFeedback', title: 'New feedback', desc: 'When new feedback messages arrive from the app.' }
  ];
  var RULE_NAME = {}; RULES.forEach(function (r) { RULE_NAME[r.id] = r.title; });
  var WHO = [
    { value: 'owners', label: 'Owners', hint: 'Only admins with the Owner role.' },
    { value: 'editors', label: 'Owners and editors', hint: 'Owners and Editors, not Viewers.' },
    { value: 'all', label: 'Every admin', hint: 'Everyone who can open this console.' }
  ];
  var ROLE_LABEL = { owner: 'Owner', editor: 'Editor', viewer: 'Viewer' };
  var HELD = { cooldown: 'already sent recently', quiet_hours: 'waiting for quiet hours to end', duplicate: 'already sent', failed: 'could not be saved' };
  var COOLDOWNS = [15, 30, 60, 120, 240, 720, 1440];
  var MINUTES = [30, 60, 120, 180, 360];
  var MIN_ERRORS = [5, 10, 20, 50, 100, 250];
  var FACTORS = [1.5, 2, 3, 5];
  var MIN_FEEDBACK = [1, 3, 5, 10, 25];

  function span(m) {
    m = num(m);
    if (m >= 60 && m % 60 === 0) { var hrs = m / 60; return hrs === 24 ? '1 day' : fmt.plural(hrs, 'hour'); }
    return fmt.plural(m, 'minute');
  }
  /** Dropdown options from a list, keeping a stored value that is not in it. */
  function options(list, value, label) {
    var vals = list.slice();
    if (value != null && vals.indexOf(Number(value)) < 0) vals.push(Number(value));
    vals.sort(function (a, b) { return a - b; });
    return vals.map(function (v) { return { value: String(v), label: label(v) }; });
  }
  var HM = /^([01]\d|2[0-3]):([0-5]\d)$/;

  /** The rules as the form edits them, with the server's defaults. */
  function fromRules(raw) {
    var r = obj(raw), q = obj(r.quiet), rules = obj(r.rules);
    var es = obj(rules.errorsSpike), sd = obj(rules.siteDown), np = obj(rules.noPlays), nf = obj(rules.newFeedback);
    return {
      enabled: r.enabled !== false,
      who: r.who === 'editors' || r.who === 'all' ? r.who : 'owners',
      quiet: { enabled: q.enabled === true, start: HM.test(q.start || '') ? q.start : '23:00', end: HM.test(q.end || '') ? q.end : '07:00' },
      cooldownMinutes: COOLDOWNS.indexOf(num(r.cooldownMinutes)) >= 0 ? num(r.cooldownMinutes) : 60,
      rules: {
        errorsSpike: { on: es.on !== false, minErrors: num(es.minErrors) > 0 ? num(es.minErrors) : 10, factor: num(es.factor) >= 1 ? num(es.factor) : 2 },
        siteDown: { on: sd.on !== false },
        noPlays: { on: np.on !== false, minutes: MINUTES.indexOf(num(np.minutes)) >= 0 ? num(np.minutes) : 60, onlyIfUsualPlays: np.onlyIfUsualPlays !== false },
        newFeedback: { on: nf.on !== false, minCount: num(nf.minCount) > 0 ? num(nf.minCount) : 1 }
      }
    };
  }
  var nice = function (t) {
    var p = /^(\d{2}):(\d{2})$/.exec(t || '');
    if (!p) return t || '';
    var hr = Number(p[1]), h12 = hr % 12 || 12;
    return h12 + (p[2] !== '00' ? ':' + p[2] : '') + (hr < 12 ? ' am' : ' pm');
  };

  VX.page({
    id: 'alerts', title: 'Smart Alerts', group: 'Overview', icon: 'bell', order: 5, noAuto: true,
    desc: 'Alerts on your phone when something goes wrong: errors rising, the site not answering, no plays, new feedback.',
    keywords: 'alerts alarm warn notify phone push errors down outage feedback monitoring',
    render: function (host, ctx) {
      return ui.load(host, function () { return VX.api.get('/api/admin/alerts', null, { fresh: true }); }, function (d) {
        var gate = ui.gate(d, ctx);
        if (gate) return gate;
        return view(d, ctx);
      });
    }
  });

  function view(d, ctx) {
    var owner = VX.can('owner');
    var rules = fromRules(d.rules);
    var job = obj(d.job), signals = obj(d.signals), probes = obj(signals.probes), me = obj(d.me);
    var people = arr(d.recipients);
    var getters = people.filter(function (p) { return p.gets; });
    var linked = getters.filter(function (p) { return num(p.phones) > 0; });
    var jobOn = job.enabled !== false;
    var push = d.push && typeof d.push === 'object' ? d.push : null;

    var status = !rules.enabled ? { value: 'Off', tone: null, sub: 'Switched off below' }
      : !jobOn ? { value: 'Paused', tone: 'warn', sub: 'The check is off in Database → Scheduled jobs' }
        : { value: 'On', tone: 'ok', sub: 'Checks every ' + span(job.every || 5) };
    var lastSub = job.lastAt ? (job.ok === false ? 'The last check failed' : 'Worked') : 'Not run yet';
    var next = !rules.enabled || !jobOn ? '—' : job.nextAt ? fmt.ago(job.nextAt) : 'Within ' + span(job.every || 5);
    var down = ['website', 'catalog'].filter(function (c) { return probes[c] === false; });
    var probeKnown = probes.website != null || probes.catalog != null;

    return [
      ui.readOnlyNote('owner'),
      push && push.web === false && push.fcm === false ? ui.notice('The server cannot send notifications yet, so alerts cannot reach any phone. Set up notifications first (Send Notification → Setup check).', 'bad') : null,
      ui.stats([
        { label: 'Smart Alerts', value: status.value, tone: status.tone, sub: status.sub, info: 'Whether the server is watching for problems and sending alerts to admins’ phones.' },
        { label: 'Last check', value: job.lastAt ? fmt.ago(job.lastAt) : 'Never', sub: lastSub, tone: job.ok === false ? 'bad' : null, info: 'When the server last looked for problems.' },
        { label: 'Next check', value: next, info: 'When the server looks for problems again. It checks every few minutes by itself.' },
        { label: 'Phones linked', value: fmt.num(linked.length) + ' of ' + fmt.num(getters.length), tone: getters.length && !linked.length ? 'warn' : null, sub: getters.length === 1 ? 'admin who gets alerts' : 'admins who get alerts', info: 'How many of the admins who get alerts have a phone that can receive them.' }
      ]),
      h('h3.subhead', 'Right now'),
      ui.stats([
        { label: 'Errors this hour', value: fmt.num(signals.errorsLastHour), sub: signals.errorsHourBefore != null ? fmt.num(signals.errorsHourBefore) + ' the hour before' : null, info: 'Problems the app reported in the last hour, compared with the hour before.' },
        { label: 'Songs played this hour', value: fmt.num(signals.playsLastHour), info: 'Songs people started playing in the last hour.' },
        { label: 'Unread feedback', value: fmt.num(signals.newFeedback), onClick: ctx.go ? function () { ctx.go('feedback'); } : null, info: 'Feedback messages nobody has opened yet.' },
        { label: 'Site and music search', value: !probeKnown ? '—' : down.length ? 'Not answering' : 'Answering', tone: down.length ? 'bad' : probeKnown ? 'ok' : null, sub: down.length ? down.map(function (c) { return c === 'website' ? 'Website' : 'Music search'; }).join(', ') : null, info: 'Whether the website and music search answer when the server checks them.' }
      ]),
      h('div.grid.alerts-grid',
        actionsCard(d, ctx, me),
        peopleCard(people, rules)),
      rulesCard(rules, owner, ctx, d.saved === true),
      recentCard(arr(d.recent))
    ];
  }

  /* ------------------------------------------------------------ actions */

  function actionsCard(d, ctx, me) {
    var viaPassword = me.via === 'password' || (VX.me && VX.me.via === 'password');
    var canTest = VX.can('edit') && !viaPassword;
    var test = ui.button('Send me a test alert', { kind: 'primary', icon: 'send', disabled: !canTest, title: viaPassword ? 'You signed in with the recovery password, which has no phone. Sign in with Google to test.' : null, onClick: function () {
      return VX.api.post('/api/admin/alerts', { action: 'test' }).then(function (res) {
        if (!res.ok) { VX.toast(res.message || 'The test alert could not be sent.', 'bad'); return; }
        var data = obj(res.data);
        VX.toast(num(data.sent) ? 'Test alert sent to ' + fmt.plural(data.sent, 'phone') + ' ✓' : 'Sent, but no phone took it. Open the VinaX app and allow notifications.', num(data.sent) ? 'ok' : 'bad');
      });
    } });
    var check = VX.can('owner') ? ui.button('Check now', { kind: 'ghost', icon: 'refresh', onClick: function () {
      return VX.api.post('/api/admin/alerts', { action: 'check' }).then(function (res) {
        if (!res.ok) { VX.toast(res.message || 'The check did not finish. Try again.', 'bad'); return; }
        showResult(obj(obj(res.data).result));
        ctx.refresh();
      });
    } }) : null;
    var phones = me.phones;
    return ui.card({
      title: 'Try it', sub: 'Make sure alerts reach your phone',
      body: [
        h('p.muted', viaPassword
          ? 'You signed in with the recovery password, which has no phone of its own. Sign in with Google to send yourself a test alert.'
          : phones == null ? 'A test alert goes only to your own phone.'
            : num(phones) > 0 ? 'Your account has ' + fmt.plural(phones, 'phone') + ' linked. A test alert goes only to you.'
              : 'No phone is linked to your Google account yet. Sign in to the VinaX app on your phone with the same Google account and allow notifications.'),
        h('div.toolbar.alerts-actions', test, check),
        VX.can('owner') ? h('p.muted.small', 'Check now looks for problems straight away and sends an alert if one is found. Alerts already sent recently are not sent again.') : null
      ]
    });
  }

  function showResult(r) {
    var firing = arr(r.firing), sent = arr(r.sent), held = arr(r.held);
    var lines = [];
    if (r.on === false) lines.push(h('p', 'Smart Alerts are switched off, so nothing was checked.'));
    else if (!firing.length) lines.push(ui.notice('All clear — no problems found.', 'ok'));
    sent.forEach(function (s) {
      lines.push(h('p', h('strong', RULE_NAME[s.rule] || 'Alert'), ' — sent to ' + fmt.plural(s.devices, 'phone') + (num(s.devices) ? ' (' + fmt.num(s.delivered) + ' reached)' : '') + '.'));
    });
    held.forEach(function (x) {
      lines.push(h('p', h('strong', RULE_NAME[x.rule] || 'Alert'), ' — found, not sent: ' + (HELD[x.reason] || 'held') + '.'));
    });
    if (sent.length && !num(r.devices)) lines.push(ui.notice('Nobody who gets alerts has a linked phone, so no phone got it.', 'info'));
    VX.modal({ title: 'Check finished', body: lines, actions: [{ label: 'Done', kind: 'primary' }] });
  }

  /* ------------------------------------------------------------- people */

  function peopleCard(people, rules) {
    var help = 'To get alerts, sign in to the VinaX app on your phone with the same Google account you use here, and allow notifications.';
    return ui.card({
      title: 'Who gets alerts', sub: (WHO.filter(function (w) { return w.value === rules.who; })[0] || WHO[0]).label,
      body: [
        people.length ? h('ul.alert-people', people.map(function (p) {
          var phone = !p.gets ? h('span.muted.small', 'Not chosen') :
            p.phones == null ? ui.pill('Could not check', null) :
              num(p.phones) > 0 ? ui.pill(num(p.phones) === 1 ? 'Phone linked' : fmt.plural(p.phones, 'phone') + ' linked', 'ok') :
                ui.pill('No phone linked', 'warn');
          return h('li' + (p.gets ? '' : '.dim'),
            ui.media(null, p.name || String(p.email || '').split('@')[0], p.email, true),
            h('span.alert-person-tail', ui.pill(ROLE_LABEL[p.role] || 'Admin', p.role === 'owner' ? 'accent' : null), phone));
        })) : ui.empty('No admins yet', 'Admins & Roles lists who can open the console.'),
        h('p.muted.small.alerts-help', VX.icon('info'), h('span', help))
      ]
    });
  }

  /* -------------------------------------------------------------- rules */

  function rulesCard(stored, owner, ctx, saved) {
    var m = VX.st ? VX.st.clone(stored) : JSON.parse(JSON.stringify(stored));
    var start = JSON.stringify(m);
    var err = h('p.form-error', { role: 'alert' });
    var save = ui.button('Save rules', { kind: 'primary', icon: 'check', disabled: true, onClick: doSave });
    var cancel = ui.button('Cancel changes', { kind: 'ghost', disabled: true, onClick: function () { ctx.refresh(); } });
    var form = h('div.alert-rules');
    function changed() {
      var dirty = JSON.stringify(m) !== start;
      save.disabled = !owner || !dirty;
      cancel.disabled = !dirty;
      err.textContent = dirty && m.quiet.enabled && m.quiet.start === m.quiet.end ? 'Quiet hours need different start and end times.' : '';
    }
    function doSave() {
      if (m.quiet.enabled && m.quiet.start === m.quiet.end) { VX.toast('Quiet hours need different start and end times.', 'bad'); return; }
      return VX.confirm({ title: 'Save alert rules?', body: 'The next check uses the new rules, within a few minutes.', confirmLabel: 'Save rules' }).then(function (ok) {
        if (!ok) return;
        return VX.api.post('/api/admin/settings', { key: 'alert-rules', value: m }).then(function (res) {
          if (!res.ok) { VX.toast('Something went wrong — ' + (res.message || 'try again'), 'bad'); return; }
          VX.toast('Alert rules saved ✓', 'ok');
          ctx.refresh();
        });
      });
    }
    function dd(label, list, value, fmtLabel, onPick) {
      return ui.dropdown(label, options(list, value, fmtLabel), String(value), function (v) { onPick(Number(v)); changed(); }, { inline: true, disabled: !owner });
    }

    var quietTimes = h('div.form-row.alert-quiet-times',
      ui.timePicker('Quiet from', m.quiet.start, function (v) { m.quiet.start = v || '23:00'; changed(); }),
      ui.timePicker('Quiet until', m.quiet.end, function (v) { m.quiet.end = v || '07:00'; changed(); }));
    quietTimes.hidden = !m.quiet.enabled;

    var r = m.rules;
    var extra = {
      errorsSpike: h('div.alert-rule-opts',
        dd('At least', MIN_ERRORS, r.errorsSpike.minErrors, function (v) { return fmt.plural(v, 'error') + ' an hour'; }, function (v) { r.errorsSpike.minErrors = v; }),
        dd('And more than', FACTORS, r.errorsSpike.factor, function (v) { return v + ' times the hour before'; }, function (v) { r.errorsSpike.factor = v; })),
      siteDown: null,
      noPlays: h('div.alert-rule-opts',
        dd('Nothing played for', MINUTES, r.noPlays.minutes, span, function (v) { r.noPlays.minutes = v; }),
        ui.checkbox('Only when people were listening at this time yesterday (avoids night-time alerts)', r.noPlays.onlyIfUsualPlays, function (on) { r.noPlays.onlyIfUsualPlays = on; changed(); }, { disabled: !owner })),
      newFeedback: h('div.alert-rule-opts',
        dd('At least', MIN_FEEDBACK, r.newFeedback.minCount, function (v) { return fmt.plural(v, 'new message'); }, function (v) { r.newFeedback.minCount = v; }))
    };

    VX.mount(form,
      ui.switchRow('Send alerts', 'Switch off to stop every alert. The checks still show on this page.', m.enabled, function (on) { m.enabled = on; changed(); }, { disabled: !owner }),
      ui.radios('Who gets alerts', WHO, m.who, function (v) { m.who = v; changed(); }, { row: true, disabled: !owner }),
      h('div.alert-rule-list', RULES.map(function (def) {
        var opts = extra[def.id];
        if (opts) opts.hidden = !r[def.id].on;
        return h('div.alert-rule',
          ui.switchRow(def.title, def.desc, r[def.id].on, function (on) { r[def.id].on = on; if (opts) opts.hidden = !on; changed(); }, { disabled: !owner }),
          opts);
      })),
      dd('Do not repeat the same alert for', COOLDOWNS, m.cooldownMinutes, span, function (v) { m.cooldownMinutes = v; }),
      h('div',
        ui.switchRow('Quiet hours', 'No alerts during these hours (India time), except when the site or music search is not answering.', m.quiet.enabled, function (on) { m.quiet.enabled = on; quietTimes.hidden = !on; changed(); }, { disabled: !owner }),
        quietTimes));

    return ui.card({
      title: 'Alert rules', sub: saved ? 'Your rules' : 'Built-in rules — change any of them and save', span: 'full',
      body: [
        owner ? form : h('fieldset.ro', { disabled: true }, form),
        err,
        owner ? h('div.save-bar', save, cancel) : null,
        h('p.muted.small', m.quiet.enabled ? 'Quiet hours: ' + nice(m.quiet.start) + ' – ' + nice(m.quiet.end) + ' India time.' : 'No quiet hours.')
      ]
    });
  }

  /* ------------------------------------------------------------- recent */

  function recentCard(rows) {
    return ui.card({
      title: 'Recent alerts', sub: 'The last 30 alerts the server sent', span: 'full',
      body: rows.length ? h('ul.alert-list', rows.map(function (r) {
        var devices = num(r.devices), sent = num(r.sent);
        var reach = !devices ? 'No phone was linked' : 'Reached ' + fmt.num(sent) + ' of ' + fmt.plural(devices, 'phone');
        return h('li',
          h('span.alert-dot', ui.dot(r.rule === 'siteDown' ? 'bad' : r.rule === 'newFeedback' ? 'info' : 'warn')),
          h('div.alert-main',
            h('div.alert-title', h('strong', r.title || 'Alert'), r.rule ? ui.pill(RULE_NAME[r.rule] || 'Alert', null) : null),
            r.body ? h('p.muted', r.body) : null,
            h('div.muted.small', ui.ago(r.at), ' · ', h('span' + (devices && sent < devices ? '.alert-miss' : ''), reach))));
      })) : ui.empty('No alerts yet', 'When something goes wrong, the alert shows here too.')
    });
  }
})();
