/* VinaX console — Feedback page.
 * GET /api/admin/feedback?status=…: the inbox with counts; POST actions
 * status (read / resolved with a note), delete, delete_resolved. */
(function () {
  'use strict';
  var VX = window.VX, h = VX.h, ui = VX.ui, fmt = VX.fmt, arr = VX.arr, obj = VX.obj, num = VX.num;
  var LIMIT = 50;

  VX.page({
    id: 'feedback', title: 'Feedback', group: 'Audience', icon: 'message',
    desc: 'Bug reports, ideas and other messages listeners sent from the app.',
    render: render
  });

  var KIND_TONE = { bug: 'bad', idea: 'info', content: 'warn' };

  function render(host, ctx) {
    var state = { status: ctx.params.status || 'new', offset: num(ctx.params.offset) || 0 };
    var segHost = h('div');
    var body = h('div');
    host.appendChild(h('div.toolbar', segHost));
    host.appendChild(body);

    function seg(counts) {
      var c = obj(counts);
      var lbl = function (s, t) { return c[s] != null ? t + ' (' + fmt.num(c[s]) + ')' : t; };
      VX.mount(segHost, ui.segmented([
        { value: 'new', label: lbl('new', 'New') }, { value: 'read', label: lbl('read', 'Read') }, { value: 'resolved', label: lbl('resolved', 'Resolved') }, { value: 'all', label: 'All' }
      ], state.status, function (v) { state.status = v; state.offset = 0; ctx.setParam('status', v); ctx.setParam('offset', ''); load(); }, 'Status'));
    }
    seg(null);

    function act(bodyReq, done) {
      return VX.api.post('/api/admin/feedback', bodyReq).then(function (res) {
        VX.toast(res.ok ? (done || 'Done') : res.message, res.ok ? 'ok' : 'bad');
        if (res.ok) return load();
      });
    }
    function resolve(r) {
      var note = ui.textarea({ rows: 3, maxlength: 500, placeholder: 'What was done (optional, kept with the message)' });
      VX.modal({
        title: 'Resolve this message',
        body: [h('p.muted', fmt.trunc(r.message || '', 200)), ui.field('Note', note)],
        actions: [
          { label: 'Cancel', kind: 'ghost', onClick: function (close) { close(); } },
          { label: 'Mark resolved', kind: 'primary', onClick: function (close) { close(); return act({ action: 'status', id: r.id, status: 'resolved', note: note.value.trim() || undefined }, 'Resolved'); } }
        ]
      });
    }
    function remove(r) {
      return VX.confirm({ title: 'Delete this message?', body: 'It is removed from the database for good.', danger: true, confirmLabel: 'Delete' }).then(function (yes) { if (yes) return act({ action: 'delete', id: r.id }, 'Deleted'); });
    }
    function deleteResolved(n) {
      return VX.confirm({ title: 'Delete every resolved message?', body: fmt.plural(n, 'resolved message') + ' will be removed for good.', danger: true, typed: 'DELETE', confirmLabel: 'Delete all resolved' }).then(function (yes) { if (yes) return act({ action: 'delete_resolved' }, 'Resolved messages deleted'); });
    }

    function load() {
      return ui.load(body, function () { return VX.api.get('/api/admin/feedback', { status: state.status, limit: LIMIT, offset: state.offset }, { fresh: true }); }, function (d) {
        var gate = ui.gate(d, ctx);
        if (gate) return gate;
        var counts = obj(d.counts);
        seg(counts);
        var rows = arr(d.rows);
        var total = num(d.total);
        return [
          ui.kpis([
            { label: 'New', value: fmt.num(counts.new), tone: num(counts.new) ? 'warn' : null },
            { label: 'Read', value: fmt.num(counts.read) },
            { label: 'Resolved', value: fmt.num(counts.resolved) }
          ]),
          ui.card({
            title: state.status === 'all' ? 'Every message' : state.status.charAt(0).toUpperCase() + state.status.slice(1) + ' messages', sub: fmt.plural(total, 'message'), pad: false,
            actions: num(counts.resolved) ? [ui.button('Delete resolved', { kind: 'ghost', small: true, icon: 'trash', onClick: function () { return deleteResolved(counts.resolved); } })] : null,
            body: [
              ui.table({
                columns: [
                  { key: 'at', label: 'When', nowrap: true, render: function (r) { return ui.ago(r.at); } },
                  { key: 'kind', label: 'Kind', render: function (r) { return ui.pill(r.kind || 'other', KIND_TONE[r.kind] || null); } },
                  { key: 'message', label: 'Message', sort: false, render: function (r) {
                    return h('div', h('div', { style: { 'white-space': 'pre-wrap', 'max-width': '52ch' } }, r.message || ''), r.note ? h('div.cell-sub', 'Note: ' + r.note) : null);
                  } },
                  { key: 'name', label: 'From', render: function (r) { return h('div', h('div.cell-main', r.name || 'Anonymous'), h('div.cell-sub', [r.platform, r.appVersion, [r.city, fmt.country(r.country)].filter(function (x) { return x && x !== '—'; }).join(', ')].filter(Boolean).join(' · '))); } },
                  { key: 'status', label: 'Status', render: function (r) { return ui.pill(r.status || 'new', r.status === 'resolved' ? 'ok' : r.status === 'read' ? 'info' : 'warn'); } },
                  { key: 'act', label: '', sort: false, render: function (r) {
                    return h('div.actions',
                      r.status === 'new' ? ui.button('Mark read', { kind: 'ghost', small: true, onClick: function () { return act({ action: 'status', id: r.id, status: 'read' }, 'Marked read'); } }) : null,
                      r.status !== 'resolved' ? ui.button('Resolve', { kind: 'ghost', small: true, icon: 'check', onClick: function () { resolve(r); } }) : null,
                      ui.button('', { kind: 'ghost', small: true, icon: 'trash', ariaLabel: 'Delete message', onClick: function () { return remove(r); } }));
                  } }
                ],
                rows: rows, exportName: 'vinax-feedback-' + state.status, search: rows.length > 8, pageSize: LIMIT, sortKey: 'at', sortDir: 'desc',
                empty: state.status === 'new' ? 'No new feedback' : 'Nothing here', emptyHint: 'Messages listeners send from Settings → Feedback land here.'
              }),
              total > LIMIT ? ui.pager(state.offset, LIMIT, total, function (o) { state.offset = o; ctx.setParam('offset', o || ''); load(); }) : null
            ]
          })
        ];
      }, { skeleton: 6 });
    }
    return load();
  }
})();
