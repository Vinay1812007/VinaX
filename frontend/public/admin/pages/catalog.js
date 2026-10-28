/* VinaX console — Catalog page.
 * Blocked songs, artists and keywords. The live catalogue lookup left with
 * the music catalogue (no provider remains). (13.9.1 — the blocklist, the
 * search synonyms, catalogue-source switches, language order and the SEO
 * corpus went with the database.) */
(function () {
  'use strict';
  var VX = window.VX, h = VX.h, ui = VX.ui, fmt = VX.fmt;

  VX.page({
    id: 'catalog', title: 'Catalog', group: 'Content', icon: 'library', noAuto: true,
    desc: 'Keep blocked songs, artists and keywords out of the app.',
    tabs: [
      { id: 'blocked', label: 'Blocked content', desc: 'Songs, artists and keywords hidden from search and playback for everyone. Changes reach the app within a minute.', render: renderBlocked }
    ]
  });

  function renderBlocked(host, ctx) {
    var body = h('div');
    host.appendChild(body);
    var arr = VX.arr, num = VX.num;
    function post(bodyReq, done) {
      return VX.api.post('/api/admin/content', bodyReq).then(function (res) {
        VX.toast(res.ok ? done : res.message, res.ok ? 'ok' : 'bad');
        if (res.ok) return load();
      });
    }
    function block(kind, value, label, reason) {
      return post({ action: 'block', kind: kind, value: value, label: label || undefined, reason: reason || undefined }, 'Blocked');
    }
    function load() {
      return ui.load(body, function () { return VX.api.get('/api/admin/content', null, { fresh: true }); }, function (d) {
        var gate = ui.gate(d, ctx);
        if (gate) return gate;
        var blocked = arr(d.blocked), suggestions = arr(d.suggestions);
        var blockedIds = {};
        blocked.forEach(function (b) { if (b.kind === 'song') blockedIds[String(b.value)] = true; });
        var kind = ui.select([{ value: 'song', label: 'Song (by id)' }, { value: 'artist', label: 'Artist (by name)' }, { value: 'keyword', label: 'Keyword (in titles)' }], 'song');
        var value = ui.input({ placeholder: 'Song id, artist name or keyword', maxlength: 200 });
        var label = ui.input({ placeholder: 'Song title (optional, for you)', maxlength: 200 });
        var reason = ui.input({ placeholder: 'Why (optional)', maxlength: 200 });
        var err = h('p.login-err', { role: 'alert' });
        var counts = { song: 0, artist: 0, keyword: 0 };
        blocked.forEach(function (b) { if (counts[b.kind] != null) counts[b.kind] += 1; });
        return [
          ui.kpis([
            { label: 'Blocked songs', value: fmt.num(counts.song) },
            { label: 'Blocked artists', value: fmt.num(counts.artist) },
            { label: 'Blocked keywords', value: fmt.num(counts.keyword) }
          ]),
          ui.grid([
            ui.card({ title: 'Block something', sub: 'Keywords match titles case-insensitively (at least 3 characters)', body: h('div.form',
              h('div.form-row', ui.field('What', kind), ui.field('Value', value)),
              h('div.form-row', ui.field('Label', label), ui.field('Reason', reason)),
              err,
              h('div.actions', ui.button('Block', { kind: 'primary', icon: 'plus', onClick: function () {
                var v = value.value.trim();
                if (!v) { err.textContent = 'Type the id, name or keyword to block.'; value.focus(); return Promise.resolve(); }
                if (kind.value === 'keyword' && v.length < 3) { err.textContent = 'Keywords need at least 3 characters.'; return Promise.resolve(); }
                err.textContent = '';
                return block(kind.value, v, label.value.trim(), reason.value.trim());
              } }))) }),
            ui.card({ title: 'Most played, last 30 days', sub: 'One click blocks a song listeners should not hear', pad: false, body: ui.table({
              columns: [
                { key: 'title', label: 'Song', render: function (r) { return ui.media(r.image, r.title || 'Untitled', r.artist); } },
                { key: 'plays', label: 'Plays', align: 'right', render: function (r) { return fmt.num(r.plays); } },
                { key: 'act', label: '', sort: false, render: function (r) { return blockedIds[String(r.id)] ? ui.pill('Blocked', 'bad') : ui.button('Block', { kind: 'ghost', small: true, ariaLabel: 'Block ' + (r.title || r.id), onClick: function () {
                  return VX.confirm({ title: 'Block “' + (r.title || r.id) + '”?', body: 'It disappears from search and playback for every listener.', danger: true, confirmLabel: 'Block' }).then(function (yes) { if (yes) return block('song', String(r.id), r.title || '', ''); });
                } }); } }
              ],
              rows: suggestions, exportName: false, search: false, dense: true, pageSize: 10, empty: 'No plays yet'
            }) })
          ], 2),
          ui.card({ title: 'Blocked now', sub: fmt.plural(blocked.length, 'entry', 'entries'), pad: false, body: ui.table({
            columns: [
              { key: 'kind', label: 'Kind', render: function (r) { return ui.pill(r.kind || '—', r.kind === 'song' ? 'bad' : r.kind === 'artist' ? 'warn' : 'info'); } },
              { key: 'value', label: 'Value', render: function (r) { return h('div', h('div.cell-main', r.label || r.value || '—'), r.label ? h('div.cell-sub', ui.mono(r.value)) : null); } },
              { key: 'reason', label: 'Reason' },
              { key: 'createdAt', label: 'Since', render: function (r) { return ui.ago(r.createdAt); } },
              { key: 'act', label: '', sort: false, render: function (r) { return ui.button('Unblock', { kind: 'ghost', small: true, onClick: function () { return post({ action: 'unblock', id: r.id }, 'Unblocked'); } }); } }
            ],
            rows: blocked, exportName: 'vinax-blocked', search: blocked.length > 8, empty: 'Nothing is blocked', emptyHint: 'Blocked songs, artists and keywords are hidden from every listener.'
          }) })
        ];
      }, { skeleton: 6 });
    }
    return load();
  }
})();
