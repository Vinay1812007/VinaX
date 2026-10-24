/* VinaX console — Listeners page.
 * The directory (GET /api/admin/listeners: search, platform, days, paged on
 * the server) and one listener's profile in a drawer (?id= or ?account=),
 * with a JSON download and the delete action. */
(function () {
  'use strict';
  var VX = window.VX, h = VX.h, ui = VX.ui, fmt = VX.fmt, arr = VX.arr, obj = VX.obj, num = VX.num;
  var LIMIT = 50;

  VX.page({
    id: 'listeners', title: 'Listeners', group: 'Audience', icon: 'users',
    desc: 'Everyone with usage sharing on (the default) or signed in: search, filter, open a profile, delete a person’s data.',
    render: render
  });

  function who(r) { return r.name || r.handle || r.email || (r.listenerId ? fmt.trunc(r.listenerId, 14) : 'Listener'); }

  function render(host, ctx) {
    var p = ctx.params;
    var state = { q: p.q || '', platform: p.platform || '', days: num(p.days) || 0, offset: num(p.offset) || 0 };
    var body = h('div');
    var bar = h('div.toolbar',
      ui.search('Name, handle or email', function (v) { state.q = v; state.offset = 0; sync(); load(); }, state.q),
      ui.segmented([{ value: '', label: 'Any platform' }, { value: 'web', label: 'Web' }, { value: 'android', label: 'Android' }, { value: 'ios', label: 'iOS' }], state.platform, function (v) { state.platform = v; state.offset = 0; sync(); load(); }, 'Platform'),
      ui.segmented([{ value: 0, label: 'All time' }, { value: 1, label: '24h' }, { value: 7, label: '7d' }, { value: 30, label: '30d' }], state.days, function (v) { state.days = num(v); state.offset = 0; sync(); load(); }, 'Last seen'));
    host.appendChild(bar);
    host.appendChild(body);
    function sync() { ctx.setParam('q', state.q); ctx.setParam('platform', state.platform); ctx.setParam('days', state.days || ''); ctx.setParam('offset', state.offset || ''); }
    function params() {
      var o = { limit: LIMIT, offset: state.offset };
      if (state.q) o.q = state.q;
      if (state.platform) o.platform = state.platform;
      if (state.days) o.days = state.days;
      return o;
    }
    function load() {
      return ui.load(body, function () { return VX.api.get('/api/admin/listeners', params()); }, function (d) {
        var gate = ui.gate(d, ctx);
        if (gate) return gate;
        var rows = arr(d.rows);
        var counts = obj(d.counts), byP = obj(counts.byPlatform);
        var total = num(d.total);
        return [
          ui.kpis([
            { label: 'Listeners', value: fmt.compact(counts.listeners), sub: 'devices sharing usage' },
            { label: 'Signed in', value: fmt.compact(counts.accounts), sub: 'Google accounts' },
            { label: 'Android', value: fmt.compact(byP.android) },
            { label: 'Web', value: fmt.compact(byP.web) },
            { label: 'iOS', value: fmt.compact(byP.ios) }
          ]),
          ui.card({ title: 'Directory', sub: state.q ? fmt.plural(total, 'match', 'matches') + ' for “' + state.q + '”' : fmt.plural(total, 'person', 'people'), pad: false, body: [
            ui.table({
              columns: [
                { key: 'name', label: 'Listener', sortVal: who, render: function (r) { return ui.media(r.picture, who(r), [r.handle ? '@' + r.handle : null, r.email].filter(Boolean).join(' · '), true); } },
                { key: 'account', label: 'Account', sortVal: function (r) { return r.accountId ? 1 : 0; }, render: function (r) { return r.accountId ? ui.pill('Signed in', 'ok') : ui.pill('Device only'); } },
                { key: 'platform', label: 'Platform', render: function (r) { return h('span', r.platform || 'web', r.appVersion ? h('span.muted.small', ' · ' + r.appVersion) : null); } },
                { key: 'city', label: 'Place', render: function (r) { return [r.city, r.region, fmt.country(r.country)].filter(function (x) { return x && x !== '—'; }).join(', ') || null; } },
                { key: 'nowPlaying', label: 'Playing', sort: false, render: function (r) { var s = obj(r.nowPlaying); return s.title ? h('span', r.isPlaying ? ui.dot('ok') : null, ' ', fmt.trunc(s.title, 40)) : null; } },
                { key: 'firstSeen', label: 'First seen', render: function (r) { return ui.ago(r.firstSeen); } },
                { key: 'lastSeen', label: 'Last seen', render: function (r) { return ui.ago(r.lastSeen); } }
              ],
              rows: rows, exportName: 'vinax-listeners', search: false, pageSize: LIMIT, sortKey: 'lastSeen', sortDir: 'desc',
              empty: state.q || state.platform || state.days ? 'Nobody matches these filters' : 'No listeners yet',
              emptyHint: 'People appear here once they use the app with usage sharing on (the default) or sign in.',
              onRow: function (r) { openProfile(r, ctx, load); }
            }),
            total > LIMIT ? ui.pager(state.offset, LIMIT, total, function (o) { state.offset = o; sync(); load(); }) : null
          ] })
        ];
      }, { skeleton: 8 });
    }
    if (p.id || p.account) setTimeout(function () { openProfile({ listenerId: p.id || null, accountId: p.account || null }, ctx, load); }, 50);
    return load();
  }

  function openProfile(row, ctx, reload) {
    var dr = VX.drawer({ title: who(row) });
    var params = row.listenerId ? { id: row.listenerId } : { account: row.accountId };
    ui.load(dr.body, function () { return VX.api.get('/api/admin/listeners', params, { fresh: true }); }, function (d) {
      var pr = obj(d.profile);
      var l = obj(pr.listener), a = obj(pr.account), st = obj(pr.stats), bk = obj(pr.backup);
      var np = obj(l.now_playing);
      var events = arr(pr.events);
      var name = a.name || l.display_name || who(row);
      dr.setTitle(name);
      function del() {
        var reason = ui.input({ placeholder: 'Reason (kept in the audit trail)', maxlength: 200 });
        var m = VX.modal({
          title: 'Delete ' + name + '?',
          body: [h('p', 'Removes the device row, every usage event, room memberships' + (a.id ? ', the Google account and its synced backup' : '') + '. This cannot be undone.'), ui.field('Reason', reason)],
          actions: [
            { label: 'Cancel', kind: 'ghost', onClick: function (close) { close(); } },
            { label: 'Continue', kind: 'danger', onClick: function (close) {
              if (!reason.value.trim()) { reason.classList.add('invalid'); reason.focus(); return; }
              close();
              return VX.confirm({ title: 'Type DELETE to confirm', body: 'Everything about ' + name + ' is removed from the database.', typed: 'DELETE', danger: true, confirmLabel: 'Delete' }).then(function (yes) {
                if (!yes) return;
                var bodyReq = { action: 'delete', reason: reason.value.trim() };
                if (l.id) bodyReq.id = l.id;
                if (a.id) bodyReq.account = a.id;
                return VX.api.post('/api/admin/listeners', bodyReq).then(function (res) {
                  VX.toast(res.ok ? 'Deleted' : res.message, res.ok ? 'ok' : 'bad');
                  if (res.ok) { dr.close(); if (reload) reload(); }
                });
              });
            } }
          ]
        });
        return m;
      }
      return [
        h('div.toolbar', { style: { 'margin-bottom': '12px' } },
          ui.button('Download JSON', { kind: 'ghost', small: true, icon: 'download', onClick: function () { VX.download.json('vinax-listener-' + (l.handle || a.id || l.id || 'profile') + '-' + VX.stamp(), pr); } }),
          ui.button('Delete this person', { kind: 'danger', small: true, icon: 'trash', onClick: del })),
        ui.dl([
          ['Name', name],
          ['Handle', l.handle ? '@' + l.handle : '—'],
          ['Email', a.email ? h('span', a.email, a.email_verified ? [' ', ui.pill('verified', 'ok')] : null) : 'Not signed in'],
          ['Device id', l.id ? ui.mono(l.id) : '—'],
          ['Account id', a.id ? ui.mono(a.id) : '—'],
          ['Platform', [l.platform || a.platform, l.app_version || a.app_version].filter(Boolean).join(' · ') || '—'],
          ['Place', [l.city || a.city, l.region || a.region, fmt.country(l.country || a.country)].filter(function (x) { return x && x !== '—'; }).join(', ') || '—'],
          ['First seen', l.first_seen || a.created_at ? fmt.dateTime(l.first_seen || a.created_at) : '—'],
          ['Last seen', l.last_seen || a.last_seen ? fmt.ago(l.last_seen || a.last_seen) : '—'],
          ['Playing now', np.title ? np.title + (np.artist ? ' · ' + np.artist : '') : '—'],
          ['Synced backup', bk.version ? 'version ' + fmt.num(bk.version) + ' · ' + fmt.bytes(bk.bytes) + ' · ' + fmt.ago(bk.updatedAt) : 'None']
        ]),
        ui.kpis([
          { label: 'Plays', value: fmt.compact(st.plays), sub: fmt.compact(st.plays30d) + ' in 30 days' },
          { label: 'Active days (30d)', value: fmt.num(st.activeDays30d) },
          { label: 'Events', value: fmt.compact(st.events) },
          { label: 'Errors', value: fmt.num(st.errors), tone: num(st.errors) ? 'warn' : null }
        ]),
        h('h3.subhead', { style: { 'margin-top': '14px' } }, 'Top songs'),
        ui.hbars(arr(pr.topSongs).map(function (s) { return { label: s.title, sub: s.artist, value: num(s.plays) }; }), { empty: 'No plays yet', limit: 8 }),
        h('h3.subhead', { style: { 'margin-top': '14px' } }, 'Languages'),
        ui.share(arr(pr.languages).map(function (x) { return { label: x.language, value: num(x.plays) }; }), { empty: 'No plays yet' }),
        h('h3.subhead', { style: { 'margin-top': '14px' } }, 'Recent events'),
        ui.table({
          columns: [
            { key: 'at', label: 'When', nowrap: true, render: function (e) { return ui.ago(e.at); } },
            { key: 'kind', label: 'Kind', render: function (e) { return ui.pill(e.kind || 'event', e.kind === 'error' ? 'bad' : null); } },
            { key: 'song_title', label: 'Song', render: function (e) { return e.song_title ? h('span', e.song_title, e.song_artist ? h('span.muted.small', ' · ' + e.song_artist) : null) : e.message ? fmt.trunc(e.message, 80) : null; } },
            { key: 'platform', label: 'Platform' }
          ],
          rows: events, exportName: 'vinax-activity-' + (l.handle || l.id || 'listener'), search: false, dense: true, pageSize: 20,
          empty: 'No events', emptyHint: 'Usage events appear once this listener opts in.'
        })
      ];
    }, { skeleton: 8 });
  }
})();
