/* Music Library (was Catalog) — find any song, album, artist or playlist in
 * the catalogue, preview it, and block what should not appear in the app.
 * Routes: GET /api/admin/catalog-search?q=&type=, GET/POST /api/admin/content.
 * Uses VX.music from song-stats.js for the shared actions. */
(function () {
  'use strict';
  var VX = window.VX, h = VX.h, ui = VX.ui, fmt = VX.fmt, arr = VX.arr;

  var TYPES = [
    { value: 'songs', label: 'Songs', kind: 'song' },
    { value: 'albums', label: 'Albums', kind: 'album' },
    { value: 'artists', label: 'Artists', kind: 'artist' },
    { value: 'playlists', label: 'Playlists', kind: 'playlist' }
  ];
  var KIND_TEXT = { song: 'Song', album: 'Album', artist: 'Artist', keyword: 'Word in titles' };
  function typeOf(v) { return TYPES.filter(function (t) { return t.value === v; })[0] || TYPES[0]; }

  function resultMenu(it, t, ctx) {
    var music = VX.music;
    var label = [it.title, it.sub].filter(Boolean).join(' — ');
    var items = [
      { label: 'Copy ID', icon: 'copy', onClick: function () { VX.copy(it.id, 'ID copied'); } },
      { label: 'Open in app', icon: 'external', onClick: function () { music.open(t.kind, it.id); } }
    ];
    if (t.kind === 'song' || t.kind === 'album' || t.kind === 'playlist') {
      items.push({ label: 'Add to banner', icon: 'layout', disabled: !VX.can('edit'), onClick: function () {
        var p = { section: 'banners', title: it.title }; p['add' + t.kind.charAt(0).toUpperCase() + t.kind.slice(1)] = it.id;
        ctx.go('app-settings/home-screen', null, p);
      } });
      items.push({ label: 'Use in notification', icon: 'bell', disabled: !VX.can('edit'), onClick: function () {
        var p = { title: it.title }; p[t.kind] = it.id;
        ctx.go('send-notification', null, p);
      } });
    }
    if (t.kind !== 'playlist') {
      items.push('-');
      items.push({ label: 'Block ' + t.kind, icon: 'trash', danger: true, disabled: !VX.can('edit'), onClick: function () {
        music.block(t.kind, t.kind === 'artist' ? it.title : it.id, t.kind === 'artist' ? it.title : label);
      } });
    }
    return items;
  }

  function resultCard(it, t, ctx) {
    var meta = [it.sub, it.raw && it.raw.year, it.raw && it.raw.language ? VX.langName(it.raw.language) : null, it.raw && it.raw.duration ? fmt.dur(it.raw.duration) : null].filter(Boolean).join(' · ');
    var art = it.image && /^https:\/\//.test(it.image)
      ? h('img.lib-art' + (t.kind === 'artist' ? '.round' : ''), { src: it.image, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' })
      : null;
    var blank = function () { return h('div.lib-art.blank' + (t.kind === 'artist' ? '.round' : ''), { 'aria-hidden': 'true' }, VX.icon(t.kind === 'artist' ? 'user' : 'music')); };
    if (!art) art = blank();
    // A dead picture falls back to a plain tile instead of a broken image.
    else art.addEventListener('error', function () { if (art.parentNode) art.parentNode.replaceChild(blank(), art); });
    return h('li.lib-card',
      h('div.lib-art-wrap', art, t.kind === 'song' ? VX.music.previewButton(it.preview, it.title) : null),
      h('div.lib-text', h('div.cell-main', it.title), meta ? h('div.cell-sub', meta) : null),
      ui.menu(resultMenu(it, t, ctx), { label: 'Actions for ' + it.title }));
  }

  function searchTab(host, ctx) {
    var t = typeOf(ctx.params.type);
    var q = ctx.params.q || '';
    var results = h('div.lib-results');
    var seq = 0;
    function run() {
      var my = ++seq;
      ctx.setParam('q', q); ctx.setParam('type', t.value === 'songs' ? '' : t.value);
      if (q.length < 2) { VX.mount(results, ui.emptyState('Search the music catalogue', 'Type at least two letters of a song, album, artist or playlist name.')); return; }
      VX.mount(results, ui.skeleton(4));
      VX.findMusic(q, t.value).then(function (items) {
        if (my !== seq) return;
        if (!items.length) { VX.mount(results, ui.emptyState('No ' + t.label.toLowerCase() + ' found for “' + q + '”', 'Check the spelling or try another word.')); return; }
        VX.mount(results, h('ul.lib-grid', items.map(function (it) { return resultCard(it, t, ctx); })));
      }, function () {
        if (my === seq) VX.mount(results, ui.error('The music catalogue did not answer.', run));
      });
    }
    var typeSel = ui.dropdown('Look for', TYPES, t.value, function (v) { t = typeOf(v); run(); });
    var box = ui.search('Search by name…', function (v) { q = v; run(); }, q);
    run();
    ctx.onDispose(VX.music.stop);
    VX.mount(host, h('div.toolbar.lib-bar', typeSel, h('div.grow', box)), results);
  }

  function blockedTab(host, ctx) {
    return ui.load(host, function () { return VX.api.get('/api/admin/content'); }, function (d) {
      var gate = ui.gate(d, ctx);
      if (gate) return gate;
      var rows = arr(d.blocked);
      var reasons = arr(d.reasons).length ? arr(d.reasons) : VX.music.REASONS;
      var kind = ctx.params.kind || '';
      function shown() { return rows.filter(function (r) { return !kind || r.kind === kind; }); }
      function unblock(r) {
        return VX.confirm({ title: 'Unblock “' + (r.label || r.value) + '”?', body: 'It can appear in the app again within a few minutes.', confirmLabel: 'Unblock' }).then(function (ok) {
          if (!ok) return;
          return VX.api.post('/api/admin/content', { action: 'unblock', id: r.id }).then(function (res) {
            if (!res.ok) { VX.toast('Something went wrong — ' + res.message, 'bad'); return; }
            VX.toast('Unblocked ✓', 'ok'); ctx.refresh();
          });
        });
      }
      var table = ui.dataTable({
        columns: [
          { key: 'label', label: 'Item', always: true, sortVal: function (r) { return r.label || r.value; }, render: function (r) {
            return h('div', h('div.cell-main', r.label || r.value), h('div.cell-sub', KIND_TEXT[r.kind] || fmt.label(r.kind)));
          } },
          { key: 'reason', label: 'Reason', render: function (r) {
            var cur = reasons.indexOf(r.reason) >= 0 ? r.reason : 'Other';
            return ui.dropdown('Reason for ' + (r.label || r.value), reasons, cur, function (v) {
              VX.api.post('/api/admin/content', { action: 'reason', id: r.id, reason: v }).then(function (res) {
                if (res.ok) { r.reason = v; VX.toast('Saved ✓', 'ok'); } else VX.toast('Something went wrong — ' + res.message, 'bad');
              });
            }, { bare: true, disabled: !VX.can('edit') });
          } },
          { key: 'blockedBy', label: 'Blocked by', render: function (r) { return !r.blockedBy || r.blockedBy === 'owner' ? 'Owner' : r.blockedBy; } },
          { key: 'createdAt', label: 'Date', render: function (r) { return ui.ago(r.createdAt); } },
          { key: 'act', label: '', sort: false, always: true, render: function (r) { return ui.button('Unblock', { kind: 'ghost', small: true, disabled: !VX.can('edit'), onClick: function () { return unblock(r); } }); } }
        ],
        rows: shown(), rowId: function (r) { return String(r.id); }, search: 'Search blocked items…', exportName: 'vinax-blocked',
        filters: [ui.dropdown('Show', [{ value: '', label: 'Everything' }, { value: 'song', label: 'Songs' }, { value: 'album', label: 'Albums' }, { value: 'artist', label: 'Artists' }, { value: 'keyword', label: 'Words in titles' }], kind, function (v) { kind = v; ctx.setParam('kind', v); table.update(shown()); }, { inline: true })],
        rowMenu: function (r) { return [
          { label: 'Copy ID', icon: 'copy', onClick: function () { VX.copy(r.value, 'Copied'); } },
          r.kind === 'song' || r.kind === 'album' ? { label: 'Open in app', icon: 'external', onClick: function () { VX.music.open(r.kind, r.value); } } : null,
          { label: 'Unblock', icon: 'refresh', disabled: !VX.can('edit'), onClick: function () { unblock(r); } }
        ].filter(Boolean); },
        empty: { title: 'Nothing is blocked', hint: 'Use “⋯ → Block” on a search result to hide a song, album or artist from the app.' }
      });
      // Block an artist or a word in titles without searching first.
      var word = '';
      var wordInput = ui.input({ placeholder: 'e.g. nightcore', maxlength: 60, 'aria-label': 'Word to block' });
      wordInput.addEventListener('input', function () { word = wordInput.value.trim(); });
      var addCard = VX.can('edit') ? ui.card({ title: 'Block more', sub: 'Hide every song by an artist, or every song with a word in its title.', body: h('div.grid.cols-2',
        ui.musicPicker({ type: 'artists', label: 'Block an artist', onPick: function (a) { VX.music.block('artist', a.title, a.title).then(function (row) { if (row) ctx.refresh(); }); } }),
        h('div.field', h('label.field-label', 'Block a word in titles'), h('div.toolbar', wordInput, ui.button('Block word', { kind: 'ghost', onClick: function () {
          if (word.length < 3) { VX.toast('Type at least 3 letters.', 'bad'); return; }
          return VX.music.block('keyword', word.toLowerCase(), word).then(function (row) { if (row) ctx.refresh(); });
        } })))) }) : null;
      return [
        ui.stats([
          { label: 'Songs blocked', value: fmt.num(rows.filter(function (r) { return r.kind === 'song'; }).length), info: 'Single songs hidden from the app.' },
          { label: 'Albums blocked', value: fmt.num(rows.filter(function (r) { return r.kind === 'album'; }).length), info: 'Whole albums hidden from the app, with every song on them.' },
          { label: 'Artists blocked', value: fmt.num(rows.filter(function (r) { return r.kind === 'artist'; }).length), info: 'Artists whose songs are hidden from the app.' },
          { label: 'Words blocked', value: fmt.num(rows.filter(function (r) { return r.kind === 'keyword'; }).length), info: 'Songs with these words in their title are hidden.' }
        ]),
        ui.readOnlyNote(),
        ui.card({ title: 'Blocked songs & albums', pad: false, body: table }),
        addCard
      ];
    });
  }

  VX.page({
    id: 'find-music', title: 'Find Music', group: 'Search & Library', icon: 'library', order: 4,
    desc: 'Find any song, album or artist, listen to a preview, and block what should not appear in the app.',
    keywords: 'music library catalog catalogue search songs albums artists playlists preview',
    render: searchTab
  });
  VX.page({
    id: 'blocked-music', title: 'Blocked Songs & Albums', group: 'Search & Library', icon: 'lock', order: 5,
    desc: 'Songs and albums hidden from the app. Unblock one to show it again.',
    keywords: 'blocked hidden unblock songs albums',
    render: blockedTab
  });
})();
