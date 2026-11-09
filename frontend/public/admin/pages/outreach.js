/* VinaX console — Automatic Notifications (schema 18).
 * The pushes VinaX sends on its own, one message per person: the Sunday
 * weekly recap, win-back nudges to regular listeners who went quiet, and new
 * releases from each person's favourite artists. This page shows what went
 * out in the last days, how many people got and opened each run, who got the
 * newest run, the switches (set in Notification Rules) and the job.
 *   GET  /api/admin/outreach?days=14                 → settings, rules, kinds, job, summary
 *   POST /api/admin/outreach { action: 'preview', kind } → the real message to your own phone (editor)
 *   POST /api/admin/outreach { action: 'run' }           → run the job now (owner)
 */
(function () {
  'use strict';
  var VX = window.VX, h = VX.h, ui = VX.ui, fmt = VX.fmt, arr = VX.arr, obj = VX.obj, num = VX.num;
  var API = '/api/admin/outreach';
  var KINDS = ['recap', 'winback', 'release'];
  var WINDOWS = [{ value: 7, label: '7 days' }, { value: 14, label: '14 days' }, { value: 30, label: '30 days' }];

  function who(u) { return u.name || u.email || 'User'; }
  function kindName(k, kinds) { return (obj(kinds[k]).label) || fmt.label(k); }
  function openUser(r, ctx) { if (r && /^\d{1,40}$/.test(String(r.id || ''))) ctx.go('user', null, { id: r.id }); }
  function rate(opened, sent) { return sent ? Math.round((num(opened) / num(sent)) * 100) + '%' : '—'; }

  /** Why nothing went out, from the job's per-kind summary, in plain words. */
  function kindStatus(d, k) {
    var s = obj(obj(d.settings));
    if (s[k] === false) return { text: 'Off', tone: 'muted' };
    var rules = obj(d.rules);
    if (k === 'winback' && rules.reminders === false) return { text: 'Off: Reminders are switched off in Notification Rules', tone: 'warn' };
    if (k === 'release' && rules.releases === false) return { text: 'Off: New releases are switched off in Notification Rules', tone: 'warn' };
    return { text: 'On', tone: 'ok' };
  }

  /** Send me a preview of one kind. */
  function previewButton(k, kinds) {
    return ui.button('Send me a preview', { small: true, icon: 'send', onClick: function () {
      if (!VX.can('edit')) { VX.toast(VX.errorText('forbidden'), 'bad'); return; }
      return VX.api.post(API, { action: 'preview', kind: k }).then(function (r) {
        if (r.ok) VX.toast(kindName(k, kinds) + ' preview sent to ' + fmt.plural(num(obj(r.data).devices), 'device') + ' ✓' + (obj(r.data).real ? '' : ' (sample numbers: you have no listening this week)'), 'ok');
        else if (r.error === 'no_devices') VX.toast('None of your devices has notifications on. Open VinaX with your Google account on your phone and allow notifications first.', 'bad');
        else if (r.error === 'no_google') VX.toast('Previews need a Google sign-in to this console (the recovery password has no phone to send to).', 'bad');
        else VX.toast('Not sent: ' + r.message, 'bad');
      });
    } });
  }

  function render(host, ctx) {
    var body = h('div');
    var days = Number(ctx.params.days) || 14;
    if (!WINDOWS.some(function (o) { return o.value === days; })) days = 14;
    var sw = ui.segmented(WINDOWS, days, function (v) { days = Number(v); ctx.setParam('days', days === 14 ? '' : days); load(); }, 'Time range');
    VX.mount(host, h('div.toolbar.rank-bar', sw), body);
    function load() {
      return ui.load(body, function () { return VX.api.get(API, { days: days }); }, function (d) {
        var gate = ui.gate(d, ctx);
        if (gate) return gate;
        var kinds = obj(d.kinds), sum = obj(d.summary), per = obj(sum.kinds), runs = arr(sum.runs), latest = arr(sum.latest), job = d.job ? obj(d.job) : null;
        var people = KINDS.reduce(function (t, k) { return t + num(obj(per[k]).people); }, 0);
        var sent = KINDS.reduce(function (t, k) { return t + num(obj(per[k]).sent); }, 0);
        var opened = KINDS.reduce(function (t, k) { return t + num(obj(per[k]).opened); }, 0);
        var devices = runs.reduce(function (t, r) { return t + num(r.devices); }, 0);
        var window_ = 'in the last ' + days + ' days';
        var stats = ui.stats([
          { label: 'Messages sent', value: fmt.num(people), info: 'Automatic messages sent ' + window_ + ', one per person per send. A person who got a recap and a new-release message counts twice.' },
          { label: 'Delivered', value: fmt.num(sent), sub: devices ? 'of ' + fmt.plural(devices, 'device') + (devices > sent ? ' · ' + fmt.num(devices - sent) + ' missed' : '') : null, info: 'Phones and browsers that accepted a message ' + window_ + '. A person with two devices counts twice here. A device misses it when it has gone (the app was removed or notifications were switched off) or the push service refused it.' },
          { label: 'Opened', value: rate(opened, sent), sub: fmt.num(opened) + ' taps', info: 'Taps on these messages, as a share of the ones delivered. The app counts a tap when the notification opens it; a message read and swiped away is not counted.' },
          { label: 'Last run', value: job ? fmt.ago(job.at) : 'Not yet', tone: job && job.ok === false ? 'bad' : null, sub: job && job.ok === false ? 'Failed' : null, info: 'When the Automatic notifications job last looked for messages to send. It runs hourly (System › Scheduled Jobs) and sends only what is due in each person’s own time.' }
        ]);
        var cards = h('div.grid.cols-3.outreach-kinds', KINDS.map(function (k) {
          var info = obj(kinds[k]), st = kindStatus(d, k), mine = obj(per[k]);
          var last = job && job.summary && typeof obj(job.summary)[k] === 'object' ? obj(obj(job.summary)[k]) : null;
          var skipped = last ? obj(last.skipped) : {};
          var why = Object.keys(skipped).map(function (key) { return fmt.label(key).toLowerCase() + ' ' + fmt.num(skipped[key]); }).join(', ');
          return ui.card({
            title: info.label || fmt.label(k), tone: st.tone === 'warn' ? 'warn' : null,
            actions: [ui.pill(st.text, st.tone === 'muted' ? null : st.tone)],
            body: [
              h('p.muted', 'When: ' + (info.when || '—') + '.'),
              h('p.muted', 'Limit: ' + (info.cap || '—') + '.'),
              // dt/dd straight under the list: .kv is a two-column grid of its children.
              h('dl.kv',
                h('dt', 'Sent ' + window_), h('dd', fmt.num(mine.people) + (mine.people ? ' · opened ' + rate(mine.opened, mine.sent) : '')),
                h('dt', 'Last sent'), h('dd', mine.lastAt ? fmt.ago(mine.lastAt) : 'Not yet'),
                last ? h('dt', 'Last run') : null,
                last ? h('dd', typeof last.error === 'string' ? 'Failed: ' + last.error : fmt.plural(num(last.due), 'person', 'people') + ' due, ' + fmt.plural(num(last.people), 'message') + ' sent' + (k === 'release' && last.found != null ? ', ' + fmt.plural(num(last.found), 'new song') + ' in the catalogue' : '') + (last.note ? ' · ' + last.note : '')) : null,
                last && why ? h('dt', 'Not sent because') : null,
                last && why ? h('dd.muted', why) : null),
              h('div.toolbar', VX.can('edit') ? previewButton(k, kinds) : null,
                h('a.btn.ghost.sm', { href: '#/notification-rules?section=outreach' }, 'Switch in Notification Rules'))
            ]
          });
        }));
        var byDay = arr(sum.byDay);
        var chart = ui.card({ title: 'Sent each day', sub: 'Automatic messages per day ' + window_ + ' (India time), one per person.', body: ui.chart({
          labels: byDay.map(function (r) { return r.day; }), type: 'bar', stacked: true, height: 180, title: 'Automatic notifications sent per day',
          series: KINDS.map(function (k, i) { return { name: kindName(k, kinds), values: byDay.map(function (r) { return num(r[k]); }), color: ['var(--c1)', 'var(--c3)', 'var(--c2)'][i] }; }),
          empty: 'Nothing sent ' + window_, emptyHint: 'Messages go out on their own once people are due.'
        }) });
        var runsTable = ui.card({ title: 'Each send', sub: 'One row per run and kind. Taps are counted on the run, not per person.', pad: false, body: ui.dataTable({
          columns: [
            { key: 'at', label: 'When', always: true, primary: true, sortVal: function (r) { return r.at || ''; }, render: function (r) { return ui.ago(r.at); }, csv: function (r) { return fmt.full(r.at); } },
            { key: 'kind', label: 'Kind', render: function (r) { return kindName(r.kind, kinds); }, csv: function (r) { return kindName(r.kind, kinds); } },
            { key: 'people', label: 'People', align: 'right', render: function (r) { return fmt.num(r.people); } },
            { key: 'sent', label: 'Delivered', align: 'right', render: function (r) { return h('span.nowrap', fmt.num(r.sent), r.devices ? h('span.muted', ' of ' + fmt.num(r.devices)) : null); }, csv: function (r) { return r.sent; } },
            { key: 'opened', label: 'Opened', align: 'right', render: function (r) { return rate(r.opened, r.sent); }, csv: function (r) { return r.opened; } }
          ],
          rows: runs, rowId: function (r, i) { return String(r.kind) + ':' + String(r.notificationId || i); }, sortKey: 'at', exportName: 'vinax-automatic-notifications', pageSize: 15,
          empty: { title: 'Nothing sent ' + window_, hint: 'Messages go out on their own once people are due: Sunday evening for the recap, after a week away for win-back, within a day of a release.' }
        }) });
        var latestTable = ui.card({ title: 'Who got the newest run', sub: 'The people in the latest run of each kind and the exact message each one got. Click a person to open their profile.', pad: false, body: ui.dataTable({
          columns: [
            { key: 'user', label: 'User', always: true, primary: true, sortVal: who, render: function (r) { return ui.media(r.picture, who(r), r.name ? r.email : null, true); }, csv: who },
            { key: 'kind', label: 'Kind', render: function (r) { return kindName(r.kind, kinds); }, csv: function (r) { return kindName(r.kind, kinds); } },
            { key: 'message', label: 'Message', render: function (r) { return h('div', h('div.cell-main', r.title || '—'), h('div.cell-sub', r.body || '')); }, csv: function (r) { return (r.title || '') + ' — ' + (r.body || ''); } },
            { key: 'sent', label: 'Delivered', align: 'right', render: function (r) { return num(r.sent) ? fmt.num(r.sent) + ' of ' + fmt.num(r.devices) : h('span.muted', 'No'); }, csv: function (r) { return r.sent; } },
            { key: 'at', label: 'When', render: function (r) { return ui.ago(r.at); }, csv: function (r) { return fmt.full(r.at); } }
          ],
          rows: latest, rowId: function (r, i) { return String(r.kind) + ':' + String(r.id) + ':' + i; }, search: 'Search by name or email…', sortKey: 'at', exportName: 'vinax-automatic-latest', pageSize: 25,
          onRow: function (r) { openUser(r, ctx); },
          rowMenu: function (r) { return [{ label: 'View profile', icon: 'user', onClick: function () { openUser(r, ctx); } }]; },
          empty: { title: 'Nobody yet', hint: 'Once a run goes out, the people in it are listed here with their message.' }
        }) });
        var runNow = VX.can('owner') ? h('div.toolbar', ui.button('Check now', { kind: 'ghost', small: true, icon: 'refresh', onClick: function () {
          return VX.api.post(API, { action: 'run' }).then(function (r) {
            if (r.ok) { VX.toast('Checked: ' + summarize(obj(r.data).summary, kinds), 'ok'); load(); }
            else VX.toast('Could not run: ' + r.message, 'bad');
          });
        } })) : null;
        return [stats, cards, runNow, chart, runsTable, latestTable];
      }, { skeleton: 6 });
    }
    return load();
  }

  /** "Weekly recap 3 sent · Win-back nothing due · New releases off" from a run summary. */
  function summarize(summary, kinds) {
    var s = obj(summary);
    if (s.waiting === 'quiet_hours') return 'quiet hours, nothing sent';
    return KINDS.map(function (k) {
      var v = s[k];
      if (typeof v === 'string') return kindName(k, kinds) + ' ' + v;
      var o = obj(v);
      if (typeof o.error === 'string') return kindName(k, kinds) + ' failed';
      return kindName(k, kinds) + ' ' + (num(o.people) ? fmt.plural(num(o.people), 'message') + ' sent' : 'nothing due');
    }).join(' · ');
  }

  VX.page({
    id: 'automatic-notifications', title: 'Automatic Notifications', group: 'Notifications', icon: 'bell', order: 5,
    desc: 'Messages VinaX sends on its own: the weekly recap, win-back nudges and new releases from each person’s favourite artists, with who got them and who opened them.',
    keywords: 'recap win-back winback new releases automatic outreach',
    render: render
  });
})();
