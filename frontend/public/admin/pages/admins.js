/* VinaX console — Admins & Roles (console rebuild).
 * Who can open this console and what each person may change. Admins sign in
 * with Google; only emails on this list get in. Owners invite, change roles
 * and remove (/api/admin/admins); the server refuses everyone else and never
 * lets the last Owner go.
 */
(function () {
  'use strict';
  var VX = window.VX, h = VX.h, ui = VX.ui, fmt = VX.fmt, arr = VX.arr;

  var ROLES = [
    { value: 'owner', label: 'Owner', hint: 'Can do everything, including Database maintenance and managing admins.' },
    { value: 'editor', label: 'Editor', hint: 'Can change App Settings, send notifications, handle feedback and block music.' },
    { value: 'viewer', label: 'Viewer', hint: 'Can see everything but change nothing.' }
  ];
  var ROLE_LABEL = { owner: 'Owner', editor: 'Editor', viewer: 'Viewer' };
  var ERRORS = {
    last_owner: 'The console needs at least one Owner. Make someone else an Owner first.',
    already_admin: 'That email is already on the list.',
    bad_email: 'That does not look like an email address.',
    not_found: 'That admin is no longer on the list.'
  };
  function errText(res) { return ERRORS[res.error] || res.message || 'Something went wrong'; }

  VX.page({
    id: 'admins', title: 'Admins & Roles', group: 'System', icon: 'shield', order: 4, noAuto: true,
    desc: 'Who can open this console and what each person may change.',
    keywords: 'admins roles owner editor viewer invite team access permissions',
    render: function (host, ctx) {
      var owner = VX.can('owner');
      return ui.load(host, function () { return VX.api.get('/api/admin/admins', null, { fresh: true }); }, function (d) {
        var gate = ui.gate(d, ctx);
        if (gate) return gate;
        var rows = arr(d.rows), bootstrap = arr(d.bootstrap), me = d.me || VX.me || {};
        var owners = rows.filter(function (r) { return r.role === 'owner'; }).length;

        function post(body, done) {
          return VX.api.post('/api/admin/admins', body).then(function (res) {
            if (!res.ok) { VX.toast(errText(res), 'bad'); ctx.refresh(); return false; }
            VX.toast(done, 'ok');
            ctx.refresh();
            return true;
          });
        }
        function changeRole(r, role, sel) {
          if (role === r.role) return;
          return VX.confirm({ title: 'Make ' + (r.name || r.email) + ' ' + ROLE_LABEL[role] + '?', body: (ROLES.filter(function (x) { return x.value === role; })[0] || {}).hint + ' It applies within a minute.', confirmLabel: 'Change role' }).then(function (ok) {
            if (!ok) { sel.value = r.role; return; }
            return post({ action: 'role', email: r.email, role: role }, (r.name || r.email) + ' is now ' + ROLE_LABEL[role] + ' ✓');
          });
        }
        function remove(r) {
          var self = r.email === me.email;
          return VX.confirm({ title: 'Remove ' + (r.name || r.email) + '?', body: self ? 'You are removing yourself. You will lose access within a minute.' : 'They can no longer open this console. You can invite them again later.', danger: true, confirmLabel: 'Remove' }).then(function (ok) {
            if (ok) return post({ action: 'remove', email: r.email }, (r.name || r.email) + ' removed ✓');
          });
        }
        function invite() {
          var email = ui.input({ type: 'email', placeholder: 'name@gmail.com', autocomplete: 'off', maxlength: 254 });
          var role = 'viewer';
          var err = h('p.form-error', { role: 'alert' });
          VX.modal({
            title: 'Invite an admin',
            body: [
              h('p.muted', 'They sign in with this Google account. When account emails are on (App Settings › Notification Rules), VinaX emails them the console address; otherwise tell them yourself.'),
              ui.field('Google email', email),
              ui.radios('Role', ROLES.map(function (r) { return { value: r.value, label: r.label, hint: r.hint }; }), role, function (v) { role = v; }),
              err
            ],
            actions: [
              { label: 'Cancel', kind: 'ghost' },
              { label: 'Invite', kind: 'primary', onClick: function (close) {
                var v = String(email.value || '').trim().toLowerCase();
                if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) { err.textContent = ERRORS.bad_email; email.focus(); return; }
                if (rows.some(function (r) { return r.email === v; })) { err.textContent = ERRORS.already_admin; return; }
                return VX.api.post('/api/admin/admins', { action: 'invite', email: v, role: role }).then(function (res) {
                  if (!res.ok) { err.textContent = errText(res); return; }
                  close();
                  VX.toast(v + ' invited as ' + ROLE_LABEL[role] + (res.data && res.data.emailed ? ' and emailed' : '') + ' ✓', 'ok');
                  ctx.refresh();
                });
              } }
            ]
          });
        }

        return [
          ui.readOnlyNote('owner'),
          ui.stats([
            { label: 'Admins', value: fmt.num(rows.length), info: 'Everyone who can sign in to this console.' },
            { label: 'Owners', value: fmt.num(owners), info: 'People who can do everything, including managing admins. There is always at least one.' },
            { label: 'Signed in this week', value: fmt.num(rows.filter(function (r) { return r.lastSignIn && Date.now() - Date.parse(r.lastSignIn) < 7 * 86400000; }).length), info: 'Admins who opened the console in the last 7 days.' }
          ]),
          ui.card({ title: 'Admins', sub: 'Only these Google accounts can open the console', pad: false,
            actions: owner ? [ui.button('Invite admin', { kind: 'primary', small: true, icon: 'plus', onClick: invite })] : null,
            body: ui.dataTable({
              rows: rows, rowId: function (r) { return r.email; }, exportName: 'vinax-admins', search: rows.length > 8 ? 'Search admins…' : false,
              empty: { title: 'No admins yet', hint: owner ? 'Invite someone to share the work.' : 'An Owner can invite admins here.', action: owner ? { label: 'Invite admin', icon: 'plus', onClick: invite } : null },
              rowMenu: owner ? function (r) {
                var lastOwner = r.role === 'owner' && owners <= 1;
                return [{ label: 'Remove', icon: 'trash', danger: true, disabled: lastOwner, title: lastOwner ? ERRORS.last_owner : null, onClick: function () { remove(r); } }];
              } : null,
              columns: [
                { key: 'name', label: 'Admin', always: true, sortVal: function (r) { return r.name || r.email; }, render: function (r) {
                  return h('div.admin-cell', ui.media(r.picture, r.name || r.email.split('@')[0], r.email === me.email ? 'You' : null, true),
                    bootstrap.indexOf(r.email) >= 0 ? h('span.pill.info', { title: 'Set on the server as a first owner, so this person is always an Owner.' }, 'Always Owner') : null);
                } },
                { key: 'email', label: 'Email' },
                { key: 'role', label: 'Role', sortVal: function (r) { return ({ owner: 0, editor: 1, viewer: 2 })[r.role]; }, render: function (r) {
                  var locked = !owner || bootstrap.indexOf(r.email) >= 0 || (r.role === 'owner' && owners <= 1);
                  var sel = ui.select(ROLES.map(function (x) { return { value: x.value, label: x.label }; }), r.role, { 'aria-label': 'Role for ' + r.email, disabled: locked, title: locked && owner ? (bootstrap.indexOf(r.email) >= 0 ? 'Always an Owner (set on the server)' : ERRORS.last_owner) : null });
                  sel.classList.add('role-sel');
                  sel.addEventListener('change', function () { changeRole(r, sel.value, sel); });
                  return sel;
                } },
                { key: 'lastSignIn', label: 'Last sign-in', nowrap: true, render: function (r) { return r.lastSignIn ? ui.ago(r.lastSignIn) : h('span.muted', 'Not yet'); } },
                { key: 'invitedBy', label: 'Added by', hidden: true, render: function (r) { return r.invitedBy || null; } }
              ]
            }) }),
          ui.card({ title: 'What each role can do', body: h('ul.role-list', ROLES.map(function (r) {
            return h('li', ui.pill(r.label, r.value === 'owner' ? 'accent' : r.value === 'editor' ? 'ok' : null), h('span', r.hint));
          })) })
        ];
      });
    }
  });
})();
