/* Search Insights — what signed-in users search for, which searches find
 * nothing, and the fixes: a synonym (the app also searches for other words)
 * or a pinned song (shown first for those exact words). Follows the date
 * range in the top bar.
 * Routes: GET /api/admin/trends?view=search|pins&days= (stats_searches,
 * schema 11), POST /api/admin/trends { action: pin | unpin | synonym }.
 * Stored keys: search-pins { words: { id, title, artist, image } },
 * search-synonyms { typed: meant } (also edited in App Settings › Search). */
(function () {
  'use strict';
  var VX = window.VX, h = VX.h, ui = VX.ui, fmt = VX.fmt, arr = VX.arr, obj = VX.obj, num = VX.num;
  var ROUTE = '/api/admin/trends';

  function rangeText(ctx) { return ctx.range.days === 1 ? 'today' : ctx.range.key === 'custom' ? 'in ' + ctx.range.label : 'in the ' + String(ctx.range.label || '').toLowerCase(); }
  function beforeText(ctx) { return ctx.range.days === 1 ? 'yesterday' : 'the ' + fmt.plural(Math.min(90, num(ctx.range.days) || 7), 'day') + ' before'; }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  function updateNeeded(ctx) {
    return ui.card({ title: 'One-time database update needed', tone: 'warn', body: [
      h('p', 'This page needs numbers the database can give only after its one-time update. Every other page keeps working.'),
      VX.can('owner')
        ? h('div.toolbar', ui.button('How to update', { kind: 'primary', small: true, icon: 'database', onClick: function () { ctx.go('db-maintenance'); } }))
        : h('p.muted.small', 'Ask an Owner to run it from Database › Maintenance.')
    ] });
  }

  function load(host, params, ctx, render) {
    return ui.load(host, function () {
      return VX.api.get(ROUTE, params).then(function (res) {
        return !res.ok && res.error === 'db_update_needed' ? { ok: true, status: res.status, data: { updateNeeded: true } } : res;
      });
    }, function (d) {
      if (d && d.updateNeeded) return updateNeeded(ctx);
      return ui.gate(d, ctx) || render(obj(d.data), obj(d.pins), obj(d.synonyms), d);
    });
  }
  function searchView(host, ctx, render) { return load(host, { view: 'search', days: ctx.range.days }, ctx, render); }

  /** An edit button: shown to editors and owners only. */
  function editButton(label, icon, onClick, o) {
    if (!VX.can('edit')) return null;
    var b = ui.button(label, Object.assign({ kind: 'ghost', small: true, icon: icon, onClick: onClick }, o || {}));
    b.classList.add('needs-edit');
    return b;
  }
  function save(body, okText, ctx) {
    return VX.api.post(ROUTE, body).then(function (res) {
      if (!res.ok) {
        var why = res.error === 'too_many' ? 'There are already as many as can be kept. Remove one first.' : res.error === 'bad_song' ? 'Choose a song from the list.' : res.error === 'bad_query' ? 'Type at least two letters.' : res.error === 'bad_synonym' ? 'Fill in two different words.' : res.message;
        VX.toast('Something went wrong — ' + why, 'bad');
        return false;
      }
      VX.toast(okText, 'ok');
      ctx.refresh();
      return true;
    });
  }

  /* ------------------------------------------------------------ the fixes */

  /** "Add a synonym…": typed → meant. */
  function synonymModal(typed, ctx) {
    var from = ui.input({ value: typed || '', maxlength: 60, placeholder: 'bday', 'aria-label': 'When people type' });
    var to = ui.input({ maxlength: 80, placeholder: 'birthday', 'aria-label': 'Also search for' });
    var err = h('p.form-error', { role: 'alert' });
    VX.modal({
      title: 'Add a synonym',
      body: [
        h('p', 'When people search for these words, the app also searches for the words you choose. People see it within a few minutes.'),
        ui.field('When people type', from),
        ui.field('Also search for', to, 'For example the right spelling, or the full name of an artist.'),
        err
      ],
      actions: [
        { label: 'Cancel', kind: 'ghost' },
        { label: 'Save synonym', kind: 'primary', onClick: function (close) {
          var f = from.value.trim().toLowerCase(), t = to.value.trim();
          if (!f || !t) { err.textContent = 'Fill in both.'; return; }
          if (f === t.toLowerCase()) { err.textContent = 'The two are the same.'; return; }
          return save({ action: 'synonym', typed: f, meant: t }, 'Synonym saved ✓', ctx).then(function (ok) { if (ok) close(); });
        } }
      ]
    });
  }

  /** "Pin a song…": the words, then a song from the catalogue. */
  function pinModal(query, ctx, current) {
    var words = ui.input({ value: query || '', maxlength: 80, placeholder: 'e.g. kesariya remix', 'aria-label': 'Search words' });
    var chosen = null;
    var chosenHost = h('div.si-chosen', current ? [h('span.muted.small', 'Pinned now: '), ui.media(current.image, current.title, current.artist || null)] : h('p.muted.small', 'No song chosen yet.'));
    var err = h('p.form-error', { role: 'alert' });
    var picker = ui.musicPicker({ type: 'songs', label: 'Song to show first', onPick: function (m) {
      chosen = m;
      err.textContent = '';
      VX.mount(chosenHost, h('span.muted.small', 'Chosen: '), ui.media(m.image, m.title, m.sub));
    } });
    VX.modal({
      title: 'Pin a song',
      body: [
        h('p', 'When people search for exactly these words, this song is shown first, above everything else. People see it within a few minutes.'),
        ui.field('Search words', words),
        picker,
        chosenHost,
        err
      ],
      actions: [
        { label: 'Cancel', kind: 'ghost' },
        { label: 'Pin this song', kind: 'primary', onClick: function (close) {
          var q = words.value.trim().toLowerCase().replace(/\s+/g, ' ');
          if (q.length < 2) { err.textContent = 'Type at least two letters.'; return; }
          if (!chosen) { err.textContent = 'Search for a song and choose it from the list.'; return; }
          return save({ action: 'pin', query: q, song: { id: chosen.id, title: chosen.title, artist: chosen.sub || '', image: chosen.image || '' } }, 'Song pinned ✓', ctx).then(function (ok) { if (ok) close(); });
        } }
      ]
    });
  }

  function unpin(query, pin, ctx) {
    return VX.confirm({ title: 'Remove this pin?', body: 'Searches for “' + query + '” will show the normal results again' + (pin && pin.title ? ' instead of “' + pin.title + '” first' : '') + '.', confirmLabel: 'Remove pin', danger: true }).then(function (ok) {
      if (ok) return save({ action: 'unpin', query: query }, 'Pin removed ✓', ctx);
    });
  }

  /** What is already done for a search: a pin, a synonym, or nothing. */
  function fixOf(q, pins, synonyms) {
    if (has(pins, q)) return ui.pill('Pinned: ' + fmt.trunc(obj(pins[q]).title || 'a song', 28), 'ok');
    if (has(synonyms, q)) return ui.pill('Also searches “' + fmt.trunc(synonyms[q], 24) + '”', 'info');
    return null;
  }
  function fixMenu(q, pins, ctx) {
    var edit = VX.can('edit');
    return [
      { label: 'Search the catalogue', icon: 'search', onClick: function () { ctx.go('find-music', null, { q: q }); } },
      { label: 'Copy the words', icon: 'copy', onClick: function () { VX.copy(q, 'Words copied'); } },
      '-',
      { label: 'Add a synonym…', icon: 'plus', hidden: !edit, onClick: function () { synonymModal(q, ctx); } },
      { label: has(pins, q) ? 'Change the pinned song…' : 'Pin a song…', icon: 'pin', hidden: !edit, onClick: function () { pinModal(q, ctx, has(pins, q) ? obj(pins[q]) : null); } }
    ];
  }

  /* ----------------------------------------------------------------- tabs */

  function overview(host, ctx) {
    return searchView(host, ctx, function (d, pins, synonyms) {
      var t = obj(d.totals), daily = arr(d.daily), top = arr(d.top), rising = arr(d.rising);
      var searches = num(t.searches), zeroPct = searches ? num(t.zero) / searches * 100 : null;
      var prevPct = num(t.prev_searches) ? num(t.prev_zero) / num(t.prev_searches) * 100 : null;
      return [
        ui.stats([
          { label: 'Searches', value: fmt.num(t.searches), delta: VX.change(t.searches, t.prev_searches), deltaLabel: 'vs before', info: 'How many times signed-in users searched ' + rangeText(ctx) + ', compared with ' + beforeText(ctx) + '.' },
          { label: 'People searching', value: fmt.num(t.people), delta: VX.change(t.people, t.prev_people), deltaLabel: 'vs before', info: 'Signed-in users who searched at least once ' + rangeText(ctx) + '.' },
          { label: 'Found nothing', value: zeroPct == null ? '—' : fmt.pct(zeroPct), tone: zeroPct != null && zeroPct >= 20 ? 'warn' : null, sub: fmt.plural(t.zero, 'search', 'searches') + (prevPct != null ? ' · before: ' + fmt.pct(prevPct) : ''), info: 'The share of searches that showed no songs at all ' + rangeText(ctx) + '. Fix them on the “Found nothing” tab.' },
          { label: 'Different searches', value: fmt.num(t.queries), info: 'How many different words or phrases people searched for ' + rangeText(ctx) + '.' }
        ]),
        ui.card({ title: 'Searches each day', sub: 'All searches, and the ones that found no songs (India time).', body: ui.chart({
          labels: daily.map(function (x) { return x.day; }), type: 'area', height: 200, title: 'Searches each day',
          series: [{ name: 'Searches', values: daily.map(function (x) { return num(x.searches); }) }, { name: 'Found nothing', values: daily.map(function (x) { return num(x.zero); }), color: 'var(--bad)' }],
          empty: 'No searches ' + rangeText(ctx)
        }) }),
        h('div.grid.cols-2.si-grid',
          ui.card({ title: 'Top searches', sub: 'What signed-in users searched for most ' + rangeText(ctx) + '.', pad: false, body: ui.dataTable({
            columns: [
              { key: 'query', label: 'Search', always: true, render: function (r) { return h('div.si-query', h('strong', r.query || '—'), fixOf(r.query, pins, synonyms)); } },
              { key: 'searches', label: 'Searches', align: 'right', render: function (r) { return fmt.num(r.searches); } },
              { key: 'people', label: 'People', align: 'right', hidden: true, render: function (r) { return fmt.num(r.people); } },
              { key: 'zero', label: 'Found nothing', align: 'right', render: function (r) { return num(r.zero) ? ui.pill(fmt.num(r.zero), 'warn') : h('span.muted', '0'); } },
              { key: 'prev_searches', label: 'Before', align: 'right', hidden: true, render: function (r) { return fmt.num(r.prev_searches); } }
            ],
            rows: top, rowId: function (r) { return r.query; }, search: 'Find a search…', exportName: 'vinax-top-searches', pageSize: 10,
            rowMenu: function (r) { return fixMenu(r.query, pins, ctx); },
            empty: { title: 'No searches ' + rangeText(ctx), hint: 'Searches show here once signed-in users search in the app.' }
          }) }),
          ui.card({ title: 'Searched more than before', sub: 'Compared with ' + beforeText(ctx) + '.', body: ui.hbars(rising.map(function (r) {
            return { label: r.query, value: num(r.searches), sub: num(r.prev_searches) ? 'was ' + fmt.num(r.prev_searches) : 'new' };
          }), { empty: 'Nothing is searched more than before', format: function (v) { return fmt.plural(v, 'search', 'searches'); } }) }))
      ];
    });
  }

  function nothingFound(host, ctx) {
    return searchView(host, ctx, function (d, pins, synonyms) {
      var rows = arr(d.zero);
      var fixed = rows.filter(function (r) { return has(pins, r.query) || has(synonyms, r.query); }).length;
      var table = ui.dataTable({
        columns: [
          { key: 'query', label: 'Search', always: true, render: function (r) {
            return h('div.si-query', h('strong', r.query || '—'), fixOf(r.query, pins, synonyms), num(r.found) ? h('span.muted.small', 'found songs ' + fmt.plural(r.found, 'other time')) : null);
          } },
          { key: 'searches', label: 'Searches', align: 'right', render: function (r) { return fmt.num(r.searches); } },
          { key: 'people', label: 'People', align: 'right', hidden: true, render: function (r) { return fmt.num(r.people); } },
          { key: 'last_at', label: 'Last time', render: function (r) { return ui.ago(r.last_at); } },
          { key: 'fix', label: 'Fix', sort: false, hide: !VX.can('edit'), render: function (r) {
            return h('div.si-fix',
              editButton('Add a synonym…', 'plus', function () { synonymModal(r.query, ctx); }),
              editButton(has(pins, r.query) ? 'Change pin…' : 'Pin a song…', 'pin', function () { pinModal(r.query, ctx, has(pins, r.query) ? obj(pins[r.query]) : null); }));
          } }
        ].filter(function (c) { return !c.hide; }),
        rows: rows, rowId: function (r) { return r.query; }, search: 'Find a search…', exportName: 'vinax-searches-found-nothing',
        rowMenu: function (r) { return fixMenu(r.query, pins, ctx); },
        empty: { title: 'Every search found something ' + rangeText(ctx), hint: 'Searches that show no songs appear here, so you can fix them.' }
      });
      return [
        ui.stats([
          { label: 'Searches that found nothing', value: fmt.num(obj(d.totals).zero), info: 'Times signed-in users searched ' + rangeText(ctx) + ' and saw no songs at all.' },
          { label: 'Different words', value: fmt.num(rows.length), info: 'How many different searches found nothing (up to the 50 most common).' },
          { label: 'Fixed already', value: fmt.num(fixed), tone: fixed ? 'ok' : null, info: 'Of those, how many now have a pinned song or a synonym. A fix works for new searches; older ones still count here.' }
        ]),
        ui.readOnlyNote(),
        ui.card({ title: 'Searches that found nothing', sub: 'Fix one with a synonym (the app also searches for other words) or by pinning the song people meant.', pad: false, body: table })
      ];
    });
  }

  function pinsTab(host, ctx) {
    return load(host, { view: 'pins' }, ctx, function (d, pins, synonyms) {
      var keys = Object.keys(pins).sort();
      var synKeys = Object.keys(synonyms).sort();
      var add = editButton('Pin a song…', 'plus', function () { pinModal('', ctx, null); }, { kind: 'primary' });
      return [
        ui.stats([
          { label: 'Pinned searches', value: fmt.num(keys.length), sub: 'up to 100', info: 'Searches that show a chosen song first. People see a change within a few minutes.' },
          { label: 'Synonyms', value: fmt.num(synKeys.length), sub: 'up to 200', info: 'Words that make the app also search for other words (bday → birthday).' }
        ]),
        ui.readOnlyNote(),
        ui.card({ title: 'Pinned songs', sub: 'For exactly these words, the app shows this song first.', actions: add ? [add] : null, body: keys.length
          ? h('ul.si-pins', keys.map(function (q) {
            var p = obj(pins[q]);
            return h('li.si-pin',
              h('span.chip.si-words', h('span.chip-text', h('span', q))),
              h('span.si-arrow', { 'aria-hidden': 'true' }, '→'),
              h('div.si-song', ui.media(p.image, p.title || 'Untitled', p.artist || null)),
              h('div.si-pin-actions',
                editButton('Change…', 'edit', function () { pinModal(q, ctx, p); }),
                editButton('Remove', 'trash', function () { return unpin(q, p, ctx); }, { ariaLabel: 'Remove the pin for ' + q })));
          }))
          : ui.emptyState('No pinned songs yet', 'Pin a song from the “Found nothing” tab, or with the button above.') }),
        ui.card({ title: 'Search synonyms', sub: 'When people type the word on the left, the app also searches for the one on the right. Change or remove them in App Settings › Search & Music Sources.',
          actions: [ui.button('Open App Settings', { kind: 'ghost', small: true, icon: 'settings', onClick: function () { ctx.go('app-settings/search'); } })],
          body: synKeys.length
            ? h('ul.si-pins', synKeys.map(function (k) {
              return h('li.si-pin', h('span.chip.si-words', h('span.chip-text', h('span', k))), h('span.si-arrow', { 'aria-hidden': 'true' }, '→'), h('span.chip.si-words', h('span.chip-text', h('span', synonyms[k]))));
            }))
            : ui.emptyState('No synonyms yet', 'Add one from the “Found nothing” tab or in App Settings.') })
      ];
    });
  }

  VX.page({
    id: 'search-overview', title: 'Search Overview', group: 'Search & Library', icon: 'search', order: 1, range: true,
    desc: 'What people search for in the app, and how often they find what they want.',
    keywords: 'search insights searches queries top popular',
    render: overview
  });
  VX.page({
    id: 'search-no-results', title: 'Searches That Found Nothing', group: 'Search & Library', icon: 'alert', order: 2, range: true,
    desc: 'Searches that showed no songs. Fix one by pinning a song or adding a synonym.',
    keywords: 'search found nothing no results zero empty',
    render: nothingFound
  });
  VX.page({
    id: 'search-pins', title: 'Pins & Synonyms', group: 'Search & Library', icon: 'pin', order: 3,
    desc: 'Songs you pinned to the top of a search, and words that also search for other words.',
    keywords: 'search pin pinned results synonyms words',
    render: pinsTab
  });
})();
