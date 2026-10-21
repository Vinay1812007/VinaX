/* VinaX console — Feedback page.
 * The inbox of feedback and bug reports listeners send from the app
 * (/api/admin/feedback, newest 200). Filter by status and type, open a
 * message in a drawer with its device and app details, and mark it read,
 * resolved or new again (POST /api/admin/feedback { id, status }). Resolved
 * messages can be deleted in bulk (POST /api/admin/maintenance
 * { action: 'clear_feedback' }) — the server has no single-message delete. */
(function () {
  'use strict';
  var VX = window.VX, h = VX.h, ui = VX.ui, fmt = VX.fmt;

  VX.page({
    id: 'feedback', title: 'Feedback', group: 'System', icon: 'message',
    desc: 'Feedback and bug reports from listeners. Open one to read it in full and mark it read or resolved.',
    render: render
  });

  var STATUS = {
    new: { label: 'New', tone: 'warn' },
    read: { label: 'Read', tone: 'info' },
    resolved: { label: 'Resolved', tone: 'ok' }
  };
  var TYPE = {
    bug: { label: 'Bug', tone: 'bad' },
    idea: { label: 'Idea', tone: 'accent' },
    other: { label: 'Other', tone: null }
  };

  function statusOf(r) { return r.status ? String(r.status) : 'new'; }
  function typeOf(r) { return r.type ? String(r.type) : 'other'; }
  function statusPill(r) { var s = STATUS[statusOf(r)]; return s ? ui.pill(s.label, s.tone) : ui.pill(statusOf(r)); }
  function typePill(r) { var t = TYPE[typeOf(r)]; return t ? ui.pill(t.label, t.tone) : ui.pill(typeOf(r)); }
  function place(r) { return [r.city, r.country ? fmt.country(r.country) : null].filter(Boolean).join(', ') || null; }
  function device(r) { return [r.platform, r.app_version ? 'v' + r.app_version : null].filter(Boolean).join(' · ') || null; }

  function setStatus(r, status) {
    return VX.api.post('/api/admin/feedback', { id: Number(r.id), status: status }).then(function (res) {
      if (res.ok) VX.toast('Marked ' + (STATUS[status] ? STATUS[status].label.toLowerCase() : status), 'ok');
      else VX.toast('Could not update: ' + res.message, 'bad');
      return res;
    });
  }

  function render(host, ctx) {
    var fStatus = ctx.params.status || 'open';
    var fType = ctx.params.type || 'all';
    var bar = h('div.toolbar');
    var summary = h('div');
    var list = h('div');
    host.appendChild(summary);
    host.appendChild(bar);
    host.appendChild(list);

    return ui.load(list, function () { return VX.api.get('/api/admin/feedback'); }, function (d) {
      if (d.configured === false) {
        VX.clear(bar);
        return ui.empty('Database not connected', 'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the Worker to receive feedback.');
      }
      var rows = (d.feedback || []).filter(function (r) { return r && r.id != null; });
      var counts = { new: 0, read: 0, resolved: 0, bug: 0, idea: 0 };
      rows.forEach(function (r) { counts[statusOf(r)] = (counts[statusOf(r)] || 0) + 1; if (typeOf(r) === 'bug' && statusOf(r) !== 'resolved') counts.bug++; if (typeOf(r) === 'idea') counts.idea++; });
      var week = rows.filter(function (r) { return r.created_at && Date.now() - Date.parse(r.created_at) < 7 * 86400000; }).length;

      VX.mount(summary, ui.kpis([
        { label: 'New', value: fmt.num(counts.new), sub: 'not opened yet', tone: counts.new ? 'warn' : null },
        { label: 'Open bugs', value: fmt.num(counts.bug), sub: 'bug reports not resolved', tone: counts.bug ? 'bad' : null },
        { label: 'Ideas', value: fmt.num(counts.idea) },
        { label: 'Last 7 days', value: fmt.num(week), sub: 'messages received' },
        { label: 'Resolved', value: fmt.num(counts.resolved), sub: 'can be deleted' }
      ]));

      var types = ['bug', 'idea', 'other'];
      rows.forEach(function (r) { if (types.indexOf(typeOf(r)) < 0) types.push(typeOf(r)); });
      var typeSel = ui.select([{ value: 'all', label: 'All types' }].concat(types.map(function (t) { return { value: t, label: TYPE[t] ? TYPE[t].label : t }; })), fType, { 'aria-label': 'Type', style: { width: 'auto', 'min-width': '150px' } });
      typeSel.addEventListener('change', function () { fType = typeSel.value; ctx.setParam('type', fType === 'all' ? '' : fType); table.update(filtered()); });

      VX.mount(bar,
        ui.segmented([
          { value: 'open', label: 'Open (' + fmt.num(counts.new + counts.read) + ')' },
          { value: 'new', label: 'New (' + fmt.num(counts.new) + ')' },
          { value: 'resolved', label: 'Resolved (' + fmt.num(counts.resolved) + ')' },
          { value: 'all', label: 'All (' + fmt.num(rows.length) + ')' }
        ], fStatus, function (v) { fStatus = v; ctx.setParam('status', v === 'open' ? '' : v); table.update(filtered()); }, 'Status'),
        typeSel,
        h('span.grow'),
        ui.button('Delete resolved', { kind: 'ghost', icon: 'trash', disabled: !counts.resolved, onClick: function () {
          return VX.confirm({ title: 'Delete resolved feedback?', body: 'Permanently deletes ' + fmt.plural(counts.resolved, 'resolved message') + '. New and read messages stay. This cannot be undone.', danger: true, confirmLabel: 'Delete resolved' }).then(function (ok) {
            if (!ok) return null;
            return VX.api.post('/api/admin/maintenance', { action: 'clear_feedback' }).then(function (res) {
              if (res.ok) { VX.toast('Resolved feedback deleted', 'ok'); ctx.refresh(); }
              else VX.toast('Could not delete: ' + res.message, 'bad');
            });
          });
        } }));

      function filtered() {
        return rows.filter(function (r) {
          var s = statusOf(r);
          if (fStatus === 'open' && s === 'resolved') return false;
          if (fStatus !== 'open' && fStatus !== 'all' && s !== fStatus) return false;
          if (fType !== 'all' && typeOf(r) !== fType) return false;
          return true;
        });
      }

      var table = ui.table({
        columns: [
          { key: 'status', label: 'Status', sortVal: statusOf, render: statusPill },
          { key: 'type', label: 'Type', sortVal: typeOf, render: typePill },
          { key: 'message', label: 'Message', width: '42%', render: function (r) {
            return h('div', h('div.cell-main', { style: statusOf(r) === 'new' ? { 'font-weight': '650' } : null }, fmt.trunc(r.message || '(empty)', 120)), r.name ? h('div.cell-sub', r.name) : null);
          } },
          { key: 'device', label: 'Device', sortVal: device, render: device },
          { key: 'place', label: 'Place', sortVal: place, render: place },
          { key: 'created_at', label: 'Received', nowrap: true, render: function (r) { return r.created_at ? h('span', { title: fmt.dateTime(r.created_at) }, fmt.ago(r.created_at)) : null; } }
        ],
        rows: filtered(), sortKey: 'created_at', sortDir: 'desc', exportName: 'vinax-feedback', search: 'Search messages…', pageSize: 25,
        empty: rows.length ? 'Nothing matches this filter' : 'No feedback yet',
        emptyHint: rows.length ? 'Try another status or type.' : 'Messages listeners send from Settings → Feedback in the app appear here.',
        onRow: function (r) { open(r, ctx); }
      });
      return h('div.card', h('div.card-body.flush', table));
    }, { skeleton: 8 });
  }

  function open(r, ctx) {
    var dr = VX.drawer({ title: (TYPE[typeOf(r)] ? TYPE[typeOf(r)].label : 'Message') + ' #' + r.id });
    function act(label, status, kind) {
      return ui.button(label, { kind: kind || 'ghost', small: true, onClick: function () {
        return setStatus(r, status).then(function (res) { if (res.ok) { dr.close(); ctx.refresh(); } });
      } });
    }
    var s = statusOf(r);
    VX.mount(dr.body,
      h('div.toolbar', { style: { 'margin-bottom': '12px' } }, statusPill(r), typePill(r), h('span.grow'), r.created_at ? ui.muted(fmt.dateTime(r.created_at)) : null),
      h('pre.json', { style: { 'font-family': 'inherit', 'font-size': '14px', 'max-height': '50vh' } }, r.message || '(empty message)'),
      h('div.toolbar', { style: { margin: '12px 0 16px' } },
        s !== 'resolved' ? act('Mark resolved', 'resolved', 'primary') : null,
        s === 'new' ? act('Mark read', 'read') : null,
        s !== 'new' ? act(s === 'resolved' ? 'Reopen' : 'Mark unread', 'new') : null,
        ui.button('Copy text', { kind: 'ghost', small: true, icon: 'copy', onClick: function () {
          try { return navigator.clipboard.writeText(String(r.message || '')).then(function () { VX.toast('Copied', 'ok'); }, function () { VX.toast('Could not copy', 'bad'); }); }
          catch (e) { VX.toast('Could not copy', 'bad'); return null; }
        } })),
      ui.dl([
        ['From', r.name || 'Anonymous'],
        ['Type', TYPE[typeOf(r)] ? TYPE[typeOf(r)].label : typeOf(r)],
        ['Status', STATUS[s] ? STATUS[s].label : s],
        ['Platform', r.platform || '—'],
        ['App version', r.app_version || '—'],
        ['Place', place(r) || '—'],
        ['Received', r.created_at ? fmt.dateTime(r.created_at) + ' (' + fmt.ago(r.created_at) + ')' : '—'],
        ['Message id', String(r.id)]
      ]),
      h('p.muted.small', { style: { 'margin-top': '14px' } }, 'Replies are not possible from here: the app does not collect contact details with feedback.')
    );
  }
})();
