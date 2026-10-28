/* VinaX console — Catalog page.
 * A live catalogue lookup (/api/admin/catalog-search): search songs or albums
 * the way the app does and copy their ids. (13.9.1 — the blocklist, the
 * search synonyms, catalogue-source switches, language order and the SEO
 * corpus went with the database.) */
(function () {
  'use strict';
  var VX = window.VX, h = VX.h, ui = VX.ui, fmt = VX.fmt;

  VX.page({
    id: 'catalog', title: 'Catalog', group: 'Content', icon: 'library', noAuto: true,
    desc: 'Look up the live catalogue the way the app does, and keep blocked songs, artists and keywords out of it.',
    tabs: [
      { id: 'lookup', label: 'Catalog lookup', desc: 'Search the live catalogue the way the app does and copy song or album ids.', render: renderLookup },
      { id: 'blocked', label: 'Blocked content', desc: 'Songs, artists and keywords hidden from search and playback for everyone. Changes reach the app within a minute.', render: renderBlocked }
    ]
  });

  function copy(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(String(text)).then(function () { VX.toast('Copied', 'ok'); }, function () { VX.toast('Copy failed', 'bad'); });
    } catch (e) {}
    VX.toast('Copy is not available in this browser', 'bad');
    return null;
  }

  function renderLookup(host, ctx) {
    var q = String(ctx.params.q || '').trim();
    var kind = ctx.params.kind === 'album' ? 'album' : 'song';
    var input = ui.input({ type: 'search', value: q, maxlength: '120', placeholder: 'Song or album name', 'aria-label': 'Search the catalogue' });
    var body = h('div.page-body');
    function run() { ctx.setParam('q', input.value.trim()); ctx.refresh(); }
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); run(); } });
    host.appendChild(h('div.toolbar',
      ui.segmented([{ value: 'song', label: 'Songs' }, { value: 'album', label: 'Albums' }], kind, function (k) { ctx.setParam('kind', k); if (input.value.trim()) run(); }, 'Search for'),
      h('div.search-box', VX.icon('search'), input),
      ui.button('Search', { kind: 'primary', icon: 'search', onClick: run })));
    host.appendChild(body);
    if (!q) {
      VX.mount(body, ui.empty('Search the catalogue', 'Type a song or album name and press Enter. Results come from the same catalogue listeners use, so you can find ids here.'));
      setTimeout(function () { try { input.focus(); } catch (e) {} }, 30);
      return null;
    }
    return ui.load(body, function () {
      return VX.api.get('/api/admin/catalog-search', { q: q, kind: kind, limit: 20 }).then(function (res) {
        if (!res.ok && res.error === 'no_mirrors_responded') res.message = 'No catalogue source answered. They may be down or rate-limiting — try again in a minute.';
        if (!res.ok && res.error === 'rate_limited') res.message = 'Too many lookups in a minute — wait a moment and try again.';
        return res;
      });
    }, function (d) {
      var items = d.items || [];
      return ui.card({ title: fmt.plural(items.length, 'result') + ' for “' + q + '”', sub: d.source ? 'Answered by ' + d.source : null, pad: false,
        body: ui.table({
          columns: [
            { key: 'name', label: kind === 'album' ? 'Album' : 'Song', render: function (r) { return ui.media(r.image, r.name || 'Untitled', r.subtitle); } },
            { key: 'subtitle', label: 'Artist', hide: true },
            { key: 'id', label: 'Id', render: function (r) { return h('div.actions', ui.mono(r.id), ui.button('', { kind: 'ghost', small: true, icon: 'copy', ariaLabel: 'Copy id ' + r.id, onClick: function () { return copy(r.id); } })); } }
          ],
          rows: items, exportName: 'vinax-catalog-' + kind, search: false,
          empty: 'Nothing found for “' + q + '”', emptyHint: 'Try fewer words or check the spelling.'
        }) });
    }, { skeleton: 6 });
  }

  /* ------------------------------------------------------ Blocked content */

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
