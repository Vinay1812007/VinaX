/* Feedback — messages people send from Settings → Feedback in the app.
 * Tabs with counts (New · Read · Resolved · All), filters (type, platform,
 * date), a card per message with a status dropdown and a "⋯" menu (reply by
 * notification, copy, delete). Route: GET/POST /api/admin/feedback. */
(function () {
  'use strict';
  var VX = window.VX, h = VX.h, ui = VX.ui, fmt = VX.fmt, arr = VX.arr, obj = VX.obj, num = VX.num;

  var STATUS = [{ value: 'new', label: 'New' }, { value: 'read', label: 'Read' }, { value: 'resolved', label: 'Resolved' }];
  var TABS = STATUS.concat([{ value: 'all', label: 'All' }]);
  var KINDS = [{ value: '', label: 'All types' }, { value: 'bug', label: 'Bug' }, { value: 'idea', label: 'Idea' }, { value: 'content', label: 'Song problem' }, { value: 'other', label: 'Other' }];
  var KIND_TONE = { bug: 'bad', idea: 'info', content: 'warn', other: null };
  var PLATFORMS = [{ value: '', label: 'All platforms' }, { value: 'android', label: 'Android' }, { value: 'web', label: 'Web' }, { value: 'ios', label: 'iOS' }];
  var WHEN = [{ value: '', label: 'Any time' }, { value: '1', label: 'Today' }, { value: '7', label: 'Last 7 days' }, { value: '30', label: 'Last 30 days' }, { value: '90', label: 'Last 90 days' }];
  var LIMIT = 25;

  var EMPTY = {
    new: ['No new feedback.', 'Messages users send from Settings → Feedback appear here.'],
    read: ['Nothing read and waiting.', 'Messages you mark as Read appear here until you resolve them.'],
    resolved: ['Nothing resolved yet.', 'Mark a message Resolved when it is dealt with.'],
    all: ['No feedback yet.', 'Messages users send from Settings → Feedback appear here.']
  };

  function kindName(k) { var f = KINDS.filter(function (x) { return x.value === k; })[0]; return f && f.value ? f.label : 'Other'; }

  function reply(r, done) {
    var title = 'Thanks for your feedback', text = '';
    var count = h('span.muted.small', '0 / 300');
    var ta = ui.textarea({ rows: 4, maxlength: 300, placeholder: 'e.g. Thanks! The fix is in the next update.' });
    ta.addEventListener('input', function () { text = ta.value.trim(); count.textContent = ta.value.length + ' / 300'; });
    var ti = ui.input({ maxlength: 120, value: title });
    ti.addEventListener('input', function () { title = ti.value.trim(); });
    var who = r.user ? (r.user.name || r.user.email) : 'this person';
    VX.modal({
      title: 'Reply by notification',
      body: [
        h('p.muted', 'A notification goes to ' + who + '’s phones and browsers. It opens the app when tapped.'),
        ui.field('Title', ti),
        ui.field('Message', ta, count)
      ],
      actions: [
        { label: 'Cancel', kind: 'ghost' },
        { label: 'Send reply', kind: 'primary', onClick: function (close) {
          if (!text) { ta.classList.add('invalid'); ta.focus(); return; }
          return VX.api.post('/api/admin/feedback', { action: 'reply', id: r.id, title: title || 'Thanks for your feedback', message: text }).then(function (res) {
            if (!res.ok) {
              var why = res.data && res.data.message ? res.data.message : res.error === 'push_not_configured' ? 'Notifications are not set up yet — see Send Notification → Setup check.' : res.message;
              VX.toast('Not sent — ' + why, 'bad'); return;
            }
            close();
            var d = res.data || {};
            VX.toast(num(d.sent) ? 'Reply sent ✓' : 'Reply could not reach their devices', num(d.sent) ? 'ok' : 'bad');
            done();
          });
        } }
      ]
    });
  }

  function card(r, ctx, reload) {
    var canEdit = VX.can('edit');
    var status = ui.dropdown('Status', STATUS, r.status || 'new', function (v) {
      VX.api.post('/api/admin/feedback', { action: 'status', id: r.id, status: v }).then(function (res) {
        if (!res.ok) { VX.toast('Something went wrong — ' + res.message, 'bad'); return; }
        VX.toast(v === 'resolved' ? 'Marked resolved ✓' : v === 'read' ? 'Marked read ✓' : 'Marked new ✓', 'ok');
        reload();
      });
    }, { inline: true, disabled: !canEdit });
    var person = r.user
      ? ui.media(r.user.picture, r.user.name || r.user.email || 'User', r.user.name ? r.user.email : null, true)
      : ui.media(null, r.name || 'Not signed in', r.name ? 'Not signed in' : null, true);
    var device = [r.platform ? VX.platformName(r.platform) : null, r.appVersion ? 'version ' + r.appVersion : null, r.city || (r.country ? fmt.country(r.country) : null)].filter(Boolean).join(' · ');
    var menu = ui.menu([
      { label: 'Reply by notification', icon: 'send', disabled: !canEdit || !r.canReply,
        title: !r.user ? 'They were not signed in, so there is nobody to reply to.' : !r.canReply ? 'They have not turned on notifications.' : null,
        onClick: function () { reply(r, reload); } },
      { label: 'Copy message', icon: 'copy', onClick: function () { VX.copy(r.message || '', 'Message copied'); } },
      r.user && r.user.email ? { label: 'Copy email', icon: 'copy', onClick: function () { VX.copy(r.user.email, 'Email copied'); } } : null,
      r.user ? { label: 'View profile', icon: 'user', onClick: function () { ctx.go('user', null, { id: r.user.id }); } } : null,
      '-',
      { label: 'Delete', icon: 'trash', danger: true, disabled: !canEdit, onClick: function () {
        VX.confirm({ title: 'Delete this message?', body: 'It is removed for good. This cannot be undone.', confirmLabel: 'Delete', danger: true }).then(function (ok) {
          if (!ok) return;
          VX.api.post('/api/admin/feedback', { action: 'delete', id: r.id }).then(function (res) {
            if (!res.ok) { VX.toast('Something went wrong — ' + res.message, 'bad'); return; }
            VX.toast('Deleted ✓', 'ok'); reload();
          });
        });
      } }
    ].filter(Boolean), { label: 'Actions for this message' });
    return h('li.fb-card.status-' + (r.status || 'new'),
      h('div.fb-head', person, h('span.grow'), ui.pill(kindName(r.kind), KIND_TONE[r.kind] || null), ui.ago(r.at), menu),
      h('p.fb-message', r.message || ''),
      r.screenshot && /^https:\/\//.test(r.screenshot) ? h('a.fb-shot', { href: r.screenshot, target: '_blank', rel: 'noopener' }, h('img', { src: r.screenshot, alt: 'Screenshot they attached', loading: 'lazy', referrerpolicy: 'no-referrer' })) : null,
      r.note ? h('p.fb-note.muted.small', r.note) : null,
      h('div.fb-foot', device ? h('span.muted.small', VX.icon('phone'), ' ', device) : h('span'), h('span.grow'), status));
  }

  function render(host, ctx) {
    var p = ctx.params;
    var state = { status: TABS.some(function (t) { return t.value === p.status; }) ? p.status : 'new', kind: p.kind || '', platform: p.platform || '', days: p.days || '', offset: 0 };
    var tabsHost = h('div.fb-tabs');
    var listHost = h('div');
    var bar = h('div.toolbar.filters',
      ui.dropdown('Type', KINDS, state.kind, function (v) { state.kind = v; state.offset = 0; ctx.setParam('kind', v); load(); }, { inline: true }),
      ui.dropdown('Platform', PLATFORMS, state.platform, function (v) { state.platform = v; state.offset = 0; ctx.setParam('platform', v); load(); }, { inline: true }),
      ui.dropdown('When', WHEN, state.days, function (v) { state.days = v; state.offset = 0; ctx.setParam('days', v); load(); }, { inline: true }));

    function drawTabs(counts) {
      VX.mount(tabsHost, ui.tabs(TABS.map(function (t) { return { id: t.value, label: t.label, badge: counts ? fmt.num(num(counts[t.value])) : null }; }), state.status, function (id) {
        state.status = id; state.offset = 0; ctx.setParam('status', id === 'new' ? '' : id); load();
      }).el);
    }
    function load() {
      return ui.load(listHost, function () {
        return VX.api.get('/api/admin/feedback', { status: state.status, kind: state.kind, platform: state.platform, days: state.days, limit: LIMIT, offset: state.offset });
      }, function (d) {
        var gate = ui.gate(d, ctx);
        if (gate) return gate;
        drawTabs(obj(d.counts));
        var rows = arr(d.rows);
        if (!rows.length) {
          var e = EMPTY[state.status] || EMPTY.all;
          var filtered = state.kind || state.platform || state.days;
          return ui.emptyState(filtered ? 'No messages match these filters.' : e[0], filtered ? 'Try “All types”, “All platforms” or “Any time”.' : e[1]);
        }
        return [
          state.status === 'resolved' && VX.can('edit') ? h('div.toolbar', h('span.grow'), ui.button('Delete all resolved', { kind: 'ghost', small: true, icon: 'trash', onClick: function () {
            return VX.confirm({ title: 'Delete every resolved message?', body: fmt.plural(num(obj(d.counts).resolved), 'message') + ' will be removed for good.', typed: true, danger: true, confirmLabel: 'Delete all' }).then(function (ok) {
              if (!ok) return;
              return VX.api.post('/api/admin/feedback', { action: 'delete_resolved' }).then(function (res) {
                if (!res.ok) { VX.toast('Something went wrong — ' + res.message, 'bad'); return; }
                VX.toast('Deleted ' + fmt.plural(num(res.data && res.data.deleted), 'message') + ' ✓', 'ok'); load();
              });
            });
          } })) : null,
          h('ul.fb-list', rows.map(function (r) { return card(r, ctx, load); })),
          num(d.total) > LIMIT ? ui.pager(state.offset, LIMIT, num(d.total), function (o) { state.offset = o; load(); }) : null
        ];
      }, { skeleton: 4 });
    }
    drawTabs(null);
    VX.mount(host, ui.readOnlyNote(), tabsHost, bar, listHost);
    return load();
  }

  VX.page({
    id: 'feedback', title: 'Feedback', group: 'Users', icon: 'message', order: 4,
    desc: 'Messages people send from Settings → Feedback in the app.',
    keywords: 'bug idea report inbox messages',
    render: render
  });
})();
