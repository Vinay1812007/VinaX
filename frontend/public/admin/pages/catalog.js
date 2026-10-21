/* VinaX console — Catalog page.
 * What the catalogue shows listeners. Blocked content and the most-played
 * block candidates (/api/admin/content: POST {action:'block'|'unblock',
 * kind:'song'|'artist'|'keyword', songId, songTitle?, reason?}), a live
 * catalogue lookup with block-from-results (/api/admin/catalog-search),
 * three remote config editors — 'search-synonyms' (Record<from,to>, ≤200),
 * 'catalog-sources' (Record<slug,boolean>) and 'language-order' (slug[],
 * ≤20) — a JSON import/export of the blocklist through the same content
 * endpoint, and the SEO corpus behind the sitemaps (/api/admin/seo).
 * The old console's Songs / Playlists / Categories screens were browser-only
 * mock-ups with no server behind them, so they are not carried over. */
(function () {
  'use strict';
  var VX = window.VX, h = VX.h, ui = VX.ui, fmt = VX.fmt;

  VX.page({
    id: 'catalog', title: 'Catalog', group: 'Content', icon: 'library', noAuto: true,
    desc: 'Block songs, artists and words, look up the catalogue, and tune how search and the catalogue behave.',
    tabs: [
      { id: 'blocked', label: 'Blocked content', desc: 'Songs, artists and words hidden from every listener.', render: renderBlocked },
      { id: 'lookup', label: 'Catalog lookup', desc: 'Search the live catalogue the way the app does, and block from the results.', render: renderLookup },
      { id: 'synonyms', label: 'Search synonyms', desc: 'Rewrite what listeners type before it reaches the catalogue.', render: renderSynonyms },
      { id: 'sources', label: 'Catalog sources', desc: 'Switch a catalogue source off for every listener while it is down.', render: renderSources },
      { id: 'languages', label: 'Language order', desc: 'The default order of the language chips on Home.', render: renderLanguages },
      { id: 'io', label: 'Import / export', desc: 'Back up the blocklist to a JSON file, or add blocks from one.', render: renderIo },
      { id: 'seo', label: 'SEO pages', desc: 'The public song, album, artist and playlist pages search engines can find.', render: renderSeo }
    ]
  });

  var CONTENT = '/api/admin/content';
  var SITE = 'https://www.sirimillavinay.online';
  var NOT_CONNECTED = 'The database is not connected. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the Worker.';
  var CONTENT_ERRORS = {
    keyword_too_short: 'A blocked word must be at least 3 characters — shorter words would hide most of the catalogue.',
    bad_request: 'Enter what to block.',
    not_configured: NOT_CONNECTED,
    unknown_action: 'The server did not understand that request.'
  };

  /* -------------------------------------------------------- helpers */

  function kindOf(id) {
    id = String(id || '');
    if (id.indexOf('artist:') === 0) return { kind: 'artist', label: 'Artist', value: id.slice(7) };
    if (id.indexOf('kw:') === 0) return { kind: 'keyword', label: 'Word', value: id.slice(3) };
    return { kind: 'song', label: 'Song', value: id };
  }

  function contentPost(body) {
    return VX.api.post(CONTENT, body).then(function (res) {
      if (!res.ok) res.friendly = CONTENT_ERRORS[res.error] || (res.status === 500 ? 'The database did not save the change.' : res.message);
      return res;
    });
  }

  /** Block with a confirm dialog. kind: 'song' | 'artist' | 'keyword'. */
  function block(kind, value, title, reason) {
    var what = kind === 'artist' ? 'every song by ' + value : kind === 'keyword' ? 'every song whose title contains “' + value + '”' : '“' + (title || value) + '”';
    return VX.confirm({
      title: kind === 'artist' ? 'Block this artist?' : kind === 'keyword' ? 'Block this word?' : 'Block this song?',
      body: 'This hides ' + what + ' from search, charts and recommendations for every listener. You can unblock it later.',
      danger: true, confirmLabel: 'Block'
    }).then(function (yes) {
      if (!yes) return null;
      var body = { action: 'block', kind: kind, songId: String(value) };
      if (title) body.songTitle = String(title).slice(0, 200);
      if (reason) body.reason = String(reason).slice(0, 200);
      return contentPost(body).then(function (res) {
        if (res.ok) VX.toast('Blocked', 'ok'); else VX.toast('Could not block: ' + res.friendly, 'bad');
        return res;
      });
    });
  }

  function unblock(row) {
    return contentPost({ action: 'unblock', songId: row.song_id }).then(function (res) {
      if (res.ok) VX.toast('Unblocked — visible again within a few minutes', 'ok'); else VX.toast('Could not unblock: ' + res.friendly, 'bad');
      return res;
    });
  }

  /** VX.config.get as a ui.load fetcher: { ok, data: { value, updatedAt } } or an error result. */
  function cfgLoad(key) {
    return VX.config.get(key).then(function (r) {
      if (r.ok) return { ok: true, status: 200, data: r };
      var failed = r.res && !r.res.ok;
      return { ok: false, status: failed ? r.res.status : 503, error: failed ? r.res.error : 'db_unconfigured', message: r.message || 'Could not read the setting.' };
    });
  }
  function publishedLine(cfg) {
    return cfg.value == null ? 'Not set — the app uses its built-in default.' : 'Published' + (cfg.updatedAt ? ' ' + fmt.ago(cfg.updatedAt) : '') + '.';
  }
  function clearButton(key, label, body, ctx, disabled, icon) {
    return ui.button(label || 'Clear', { kind: 'ghost', icon: icon || 'trash', disabled: disabled, onClick: function () {
      return VX.confirm({ title: label + '?', body: body, danger: true, confirmLabel: label }).then(function (yes) {
        if (!yes) return null;
        return VX.config.set(key, null).then(function (res) { if (res.ok) ctx.refresh(); });
      });
    } });
  }
  function copy(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(String(text)).then(function () { VX.toast('Copied', 'ok'); }, function () { VX.toast('Copy failed', 'bad'); });
    } catch (e) {}
    VX.toast('Copy is not available in this browser', 'bad');
    return null;
  }
  function cap(s) { s = String(s == null ? '' : s); return s ? s.charAt(0).toUpperCase() + s.slice(1) : '—'; }

  /* -------------------------------------------------------- blocked */

  function renderBlocked(host, ctx) {
    var form = h('div');
    var body = h('div.page-body');
    host.appendChild(h('div.page-body', form, body));
    buildBlockForm(form, ctx);
    return ui.load(body, function () { return VX.api.get(CONTENT, null, { fresh: true }); }, function (d) {
      if (d.configured === false) return ui.notice(NOT_CONNECTED, 'warn');
      var rows = (d.blocked || []).map(function (r) { var k = kindOf(r.song_id); return Object.assign({}, r, { kind: k.kind, kindLabel: k.label, what: k.kind === 'song' ? (r.song_title || k.value) : k.value }); });
      var count = function (k) { return rows.filter(function (r) { return r.kind === k; }).length; };
      var blockedIds = {};
      rows.forEach(function (r) { blockedIds[r.song_id] = true; });
      return [
        ui.kpis([
          { label: 'Songs blocked', value: fmt.num(count('song')) },
          { label: 'Artists blocked', value: fmt.num(count('artist')) },
          { label: 'Words blocked', value: fmt.num(count('keyword')) }
        ]),
        ui.card({ title: 'Blocked', sub: 'Newest first · up to 500 shown', pad: false,
          body: ui.table({
            columns: [
              { key: 'kindLabel', label: 'Type', render: function (r) { return ui.pill(r.kindLabel, r.kind === 'song' ? null : r.kind === 'artist' ? 'info' : 'warn'); } },
              { key: 'what', label: 'What', render: function (r) { return h('div', h('div.cell-main', r.what || '—'), r.kind === 'song' ? h('div.cell-sub', r.song_id) : null); } },
              { key: 'reason', label: 'Reason' },
              { key: 'created_at', label: 'Blocked', render: function (r) { return h('span', { title: fmt.dateTime(r.created_at) }, fmt.ago(r.created_at)); } },
              { key: 'act', label: '', sort: false, render: function (r) {
                return ui.button('Unblock', { kind: 'ghost', small: true, onClick: function () { return unblock(r).then(function (res) { if (res.ok) ctx.refresh(); }); } });
              } }
            ],
            rows: rows, exportName: 'vinax-blocklist',
            empty: 'Nothing is blocked', emptyHint: 'Use the form above, Catalog lookup, or the Skips report to hide a song, an artist or a word.'
          }) }),
        ui.card({ title: 'Most played songs', sub: 'Last 30 days — check here for anything that should not be on the app', pad: false,
          body: ui.table({
            columns: [
              { key: 'song_title', label: 'Song', render: function (r) { return h('div', h('div.cell-main', r.song_title || r.song_id), h('div.cell-sub', r.song_artist || '')); } },
              { key: 'plays', label: 'Plays', align: 'right', render: function (r) { return fmt.num(r.plays); } },
              { key: 'act', label: '', sort: false, render: function (r) {
                if (blockedIds[r.song_id]) return ui.pill('Blocked', 'bad');
                return ui.button('Block', { kind: 'ghost', small: true, onClick: function () { return block('song', r.song_id, r.song_title, 'Blocked from most played').then(function (res) { if (res && res.ok) ctx.refresh(); }); } });
              } }
            ],
            rows: d.topSongs || [], exportName: 'vinax-most-played-30d', pageSize: 10,
            empty: 'No plays in the last 30 days', emptyHint: 'Songs appear here once listeners play them.'
          }) })
      ];
    }, { skeleton: 6 });
  }

  function buildBlockForm(host, ctx) {
    var kind = 'song';
    var value = ui.input({ maxlength: '120', placeholder: 'Song id, e.g. 3IoDK8qI' });
    var title = ui.input({ maxlength: '200', placeholder: 'So you recognise it later' });
    var reason = ui.input({ maxlength: '200', placeholder: 'Optional' });
    var titleField = ui.field('Song title', title);
    var hint = h('p.field-hint', 'Find a song id with Catalog lookup.');
    var labels = { song: ['Song id', 'Song id, e.g. 3IoDK8qI', 'Find a song id with Catalog lookup.'], artist: ['Artist name', 'e.g. Some Artist', 'Hides every song credited to this artist (matched without case).'], keyword: ['Word or phrase', 'At least 3 characters', 'Hides every song whose title or subtitle contains it.'] };
    var valueField = ui.field(labels.song[0], value);
    function setKind(k) {
      kind = k;
      valueField.querySelector('label').textContent = labels[k][0];
      value.placeholder = labels[k][1];
      hint.textContent = labels[k][2];
      titleField.hidden = k !== 'song';
    }
    VX.mount(host, ui.card({
      title: 'Block something',
      body: h('div.form', { style: { 'max-width': 'none' } },
        h('div', ui.segmented([{ value: 'song', label: 'Song' }, { value: 'artist', label: 'Artist' }, { value: 'keyword', label: 'Word' }], kind, setKind, 'What to block')),
        h('div.form-row', { style: { 'align-items': 'start' } }, valueField, titleField, ui.field('Reason', reason)),
        hint,
        h('div.actions', ui.button('Block', { kind: 'primary', icon: 'close', onClick: function () {
          var v = value.value.trim();
          if (!v) { value.classList.add('invalid'); value.focus(); return null; }
          if (kind === 'keyword' && v.length < 3) { value.classList.add('invalid'); VX.toast(CONTENT_ERRORS.keyword_too_short, 'bad'); return null; }
          value.classList.remove('invalid');
          return block(kind, v, kind === 'song' ? title.value.trim() : '', reason.value.trim()).then(function (res) { if (res && res.ok) ctx.refresh(); });
        } })))
    }));
  }

  /* --------------------------------------------------------- lookup */

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
      VX.mount(body, ui.empty('Search the catalogue', 'Type a song or album name and press Enter. Results come from the same catalogue listeners use, so you can find ids and block from here.'));
      setTimeout(function () { try { input.focus(); } catch (e) {} }, 30);
      return null;
    }
    var blockedP = VX.api.get(CONTENT);
    return ui.load(body, function () {
      return VX.api.get('/api/admin/catalog-search', { q: q, kind: kind, limit: 20 }).then(function (res) {
        if (!res.ok && res.error === 'no_mirrors_responded') res.message = 'No catalogue source answered. They may be down or rate-limiting — try again in a minute.';
        if (!res.ok && res.error === 'rate_limited') res.message = 'Too many lookups in a minute — wait a moment and try again.';
        return res;
      });
    }, function (d) {
      var items = d.items || [];
      var wrap = h('div.page-body');
      var tableHost = h('div');
      function draw(blocked) {
        VX.mount(tableHost, ui.card({ title: fmt.plural(items.length, 'result') + ' for “' + q + '”', sub: d.source ? 'Answered by ' + d.source : null, pad: false,
          body: ui.table({
            columns: [
              { key: 'name', label: kind === 'album' ? 'Album' : 'Song', render: function (r) { return ui.media(r.image, r.name || 'Untitled', r.subtitle); } },
              { key: 'subtitle', label: 'Artist', hide: true },
              { key: 'id', label: 'Id', render: function (r) { return h('div.actions', ui.mono(r.id), ui.button('', { kind: 'ghost', small: true, icon: 'copy', ariaLabel: 'Copy id ' + r.id, onClick: function () { return copy(r.id); } })); } },
              { key: 'status', label: 'Status', sort: false, render: function (r) {
                var art = firstArtist(r.subtitle);
                if (kind === 'song' && blocked['' + r.id]) return ui.pill('Song blocked', 'bad');
                if (art && blocked['artist:' + art.toLowerCase()]) return ui.pill('Artist blocked', 'bad');
                return ui.pill('Visible', 'ok');
              } },
              { key: 'act', label: '', sort: false, render: function (r) {
                return h('div.actions',
                  kind === 'song' ? ui.button('Stats', { kind: 'ghost', small: true, title: 'Open this song in Music → Song drilldown', onClick: function () { ctx.go('music', 'song', { q: r.id }); } }) : null,
                  kind === 'song' && !blocked['' + r.id] ? ui.button('Block song', { kind: 'ghost', small: true, onClick: function () { return block('song', r.id, r.name, 'Blocked from catalogue lookup').then(function (res) { if (res && res.ok) { blocked['' + r.id] = true; draw(blocked); } }); } }) : null,
                  r.subtitle ? ui.button('Block artist…', { kind: 'ghost', small: true, onClick: function () { return artistDialog(r.subtitle).then(function (name) { if (name) { blocked['artist:' + name.toLowerCase()] = true; draw(blocked); } }); } }) : null);
              } }
            ],
            rows: items, exportName: 'vinax-catalog-' + kind, search: false,
            empty: 'Nothing found for “' + q + '”', emptyHint: 'Try fewer words or check the spelling.'
          }) }));
      }
      draw({});
      blockedP.then(function (res) {
        if (!res.ok) return;
        var map = {};
        ((res.data && res.data.blocked) || []).forEach(function (b) { map[b.song_id] = true; });
        draw(map);
      });
      wrap.appendChild(tableHost);
      return wrap;
    }, { skeleton: 6 });
  }

  function firstArtist(sub) { return String(sub || '').split(/,|·|&/)[0].trim(); }

  /** Ask which artist name to block (prefilled from the result's credits). Resolves the name or null. */
  function artistDialog(subtitle) {
    return new Promise(function (resolve) {
      var done = false;
      var input = ui.input({ value: firstArtist(subtitle), maxlength: '120' });
      var msg = h('p.field-hint', { role: 'status' });
      VX.modal({
        title: 'Block an artist',
        body: [h('p', 'Credits: ', h('strong', subtitle)), ui.field('Artist name', input, 'Every song credited to this name is hidden (case does not matter).'), msg],
        onClose: function () { if (!done) resolve(null); },
        actions: [
          { label: 'Cancel', kind: 'ghost' },
          { label: 'Block artist', kind: 'danger', onClick: function (close) {
            var name = input.value.trim();
            if (!name) { input.classList.add('invalid'); return null; }
            return contentPost({ action: 'block', kind: 'artist', songId: name, reason: 'Blocked from catalogue lookup' }).then(function (res) {
              if (res.ok) { VX.toast('Blocked ' + name, 'ok'); done = true; resolve(name); close(); }
              else msg.textContent = 'Could not block: ' + res.friendly;
            });
          } }
        ]
      });
    });
  }

  /* ------------------------------------------------------- synonyms */

  function renderSynonyms(host, ctx) {
    var body = h('div.page-body');
    host.appendChild(body);
    var prefill = String(ctx.params.from || '').trim().toLowerCase().slice(0, 60);
    return ui.load(body, function () { return cfgLoad('search-synonyms'); }, function (cfg) {
      var saved = cfg.value && typeof cfg.value === 'object' && !Array.isArray(cfg.value) ? cfg.value : {};
      var rows = Object.keys(saved).map(function (k) { return { from: k, to: String(saved[k] == null ? '' : saved[k]) }; });
      if (prefill && !rows.some(function (r) { return r.from === prefill; })) rows.unshift({ from: prefill, to: '', focus: true });
      if (!rows.length) rows.push({ from: '', to: '' });
      var list = h('div.editor-list');
      var count = h('span.muted.small');
      var problems = h('div');
      var tester = ui.input({ placeholder: 'Try a search, e.g. arr hits', 'aria-label': 'Test a search' });
      var testOut = h('p.field-hint', { 'aria-live': 'polite' });

      function draw() {
        VX.clear(list);
        rows.forEach(function (r, i) {
          var from = ui.input({ value: r.from, maxlength: '60', placeholder: 'Listener types', 'aria-label': 'Listener types (row ' + (i + 1) + ')' });
          var to = ui.input({ value: r.to, maxlength: '80', placeholder: 'Search for instead', 'aria-label': 'Search for instead (row ' + (i + 1) + ')' });
          from.addEventListener('input', function () { r.from = from.value; check(); });
          to.addEventListener('input', function () { r.to = to.value; check(); });
          list.appendChild(h('div.editor-row', h('div.form-row', from, to),
            h('button.icon-btn', { type: 'button', 'aria-label': 'Remove row ' + (i + 1), onclick: function () { rows.splice(i, 1); if (!rows.length) rows.push({ from: '', to: '' }); draw(); } }, VX.icon('trash'))));
          if (r.focus) { delete r.focus; setTimeout(function () { to.focus(); }, 30); }
        });
        check();
      }
      function collect() {
        var out = {}, errs = [];
        rows.forEach(function (r, i) {
          var f = String(r.from || '').trim().toLowerCase(), t = String(r.to || '').trim();
          if (!f && !t) return;
          if (!f || !t) { errs.push('Row ' + (i + 1) + ': fill in both sides.'); return; }
          if (f.length > 60) errs.push('Row ' + (i + 1) + ': “listener types” is longer than 60 characters.');
          if (t.length > 80) errs.push('Row ' + (i + 1) + ': the rewrite is longer than 80 characters.');
          if (f === t.toLowerCase()) { errs.push('Row ' + (i + 1) + ': both sides are the same.'); return; }
          if (out[f] != null) { errs.push('Row ' + (i + 1) + ': “' + f + '” is already listed.'); return; }
          out[f] = t;
        });
        if (Object.keys(out).length > 200) errs.push('At most 200 synonyms.');
        return { value: out, errors: errs };
      }
      function check() {
        var c = collect();
        count.textContent = fmt.num(Object.keys(c.value).length) + ' of 200';
        VX.mount(problems, c.errors.length ? ui.notice(c.errors.slice(0, 4).join(' '), 'bad') : null);
        test();
        return c;
      }
      function test() {
        var qv = tester.value.trim().toLowerCase();
        if (!qv) { testOut.textContent = 'Type a search to see what the catalogue receives.'; return; }
        var map = collect().value, out = qv;
        if (map[qv]) out = map[qv];
        else Object.keys(map).forEach(function (k) { out = out.replace(new RegExp('(^|\\s)' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=\\s|$)', 'g'), function (_, pre) { return pre + map[k]; }); });
        testOut.textContent = out === qv ? 'Unchanged: “' + qv + '”' : 'Becomes: “' + out + '”';
      }
      tester.addEventListener('input', test);
      draw();
      return ui.card({ title: 'Search synonyms', sub: 'When a search equals the left side (or contains it as a whole word), the right side is searched instead. ' + publishedLine(cfg),
        actions: [count],
        body: h('div.form', { style: { 'max-width': 'none' } },
          h('div.form-row', h('span.field-label', 'Listener types'), h('span.field-label', 'Search for instead')),
          list,
          h('div.actions', ui.button('Add a synonym', { kind: 'ghost', small: true, icon: 'plus', onClick: function () { rows.push({ from: '', to: '', focus: false }); draw(); var last = VX.$$('input', list).slice(-2)[0]; if (last) last.focus(); } })),
          problems,
          h('div.preview-box', ui.field('Test', tester), testOut),
          h('div.actions',
            ui.button('Publish synonyms', { kind: 'primary', icon: 'check', onClick: function () {
              var c = check();
              if (c.errors.length) { VX.toast('Fix the highlighted problems first', 'bad'); return null; }
              return VX.config.set('search-synonyms', c.value).then(function (res) { if (res.ok) { ctx.setParam('from', ''); ctx.refresh(); } });
            } }),
            clearButton('search-synonyms', 'Clear synonyms', 'Searches go to the catalogue exactly as typed again.', ctx, cfg.value == null)))
      });
    }, { skeleton: 4 });
  }

  /* -------------------------------------------------------- sources */

  var SOURCES = [
    { id: 'vinax-render', label: 'VinaX Music API', note: 'The main catalogue service (Android and web).' },
    { id: 'local-catalog', label: 'VinaX Catalog (built in)', note: 'The Worker’s own catalogue route, /api/cat. Web only.' },
    { id: 'sirimilla', label: 'Backup catalogue mirror', note: 'Used when the others fail.' }
  ];

  function renderSources(host, ctx) {
    var body = h('div.page-body');
    host.appendChild(body);
    return ui.load(body, function () { return cfgLoad('catalog-sources'); }, function (cfg) {
      var saved = cfg.value && typeof cfg.value === 'object' && !Array.isArray(cfg.value) ? cfg.value : {};
      var state = {};
      SOURCES.forEach(function (s) { state[s.id] = saved[s.id] !== false; });
      var msg = h('div');
      function warn() {
        var on = SOURCES.filter(function (s) { return state[s.id]; }).length;
        VX.mount(msg, on ? null : ui.notice('At least one source must stay on. With every source off, the app ignores the switches and keeps all of them on.', 'bad'));
        return on;
      }
      var probeOut = h('span.muted.small', { 'aria-live': 'polite' });
      var list = h('ul.list', SOURCES.map(function (s) {
        var tg = ui.toggle(state[s.id] ? 'On' : 'Off', state[s.id], function (on, cb) { state[s.id] = on; cb.parentNode.querySelector('.switch-label').textContent = on ? 'On' : 'Off'; warn(); }, { 'aria-label': s.label });
        return h('li', h('div.grow', h('div.cell-main', s.label), h('div.cell-sub', s.note, ' · ', ui.mono(s.id))),
          s.id === 'local-catalog' ? h('div.actions', probeOut, ui.button('Test', { kind: 'ghost', small: true, onClick: function () { return probe(probeOut); } })) : null,
          tg);
      }));
      warn();
      return ui.card({ title: 'Catalog sources', sub: 'Turn a source off while it is down or rate-limited; listeners skip it within about a minute. ' + publishedLine(cfg),
        body: h('div.form', { style: { 'max-width': 'none' } }, list, msg,
          h('div.actions',
            ui.button('Publish switches', { kind: 'primary', icon: 'check', onClick: function () {
              if (!warn()) return null;
              var value = {};
              SOURCES.forEach(function (s) { value[s.id] = !!state[s.id]; });
              return VX.config.set('catalog-sources', value).then(function (res) { if (res.ok) ctx.refresh(); });
            } }),
            clearButton('catalog-sources', 'Turn all back on', 'Every catalogue source is used again.', ctx, cfg.value == null, 'refresh')))
      });
    }, { skeleton: 3 });
  }

  function probe(out) {
    out.textContent = 'Testing…';
    var t0 = Date.now();
    return VX.api.get('/api/cat/search/songs', { query: 'love', limit: 3 }, { fresh: true, noAuthRedirect: true, timeout: 12000 }).then(function (res) {
      var ms = Date.now() - t0;
      var n = res.ok && res.data && res.data.data && Array.isArray(res.data.data.results) ? res.data.data.results.length : null;
      out.textContent = res.ok && n ? 'Working · ' + fmt.ms(ms) + ' · ' + fmt.plural(n, 'result') : res.ok ? 'Answered but found nothing (' + fmt.ms(ms) + ')' : 'Not working · ' + (res.status ? 'HTTP ' + res.status : res.message);
    });
  }

  /* ------------------------------------------------------ languages */

  var LANGS = ['hindi', 'telugu', 'tamil', 'english', 'punjabi', 'kannada', 'malayalam', 'bengali', 'marathi', 'bhojpuri', 'gujarati', 'urdu'];
  var SLUG = /^[a-z][a-z0-9_-]{0,39}$/;

  function renderLanguages(host, ctx) {
    var body = h('div.page-body');
    host.appendChild(body);
    return ui.load(body, function () { return cfgLoad('language-order'); }, function (cfg) {
      var saved = Array.isArray(cfg.value) ? cfg.value.filter(function (x) { return typeof x === 'string' && SLUG.test(x); }) : [];
      var order = saved.slice();
      LANGS.forEach(function (l) { if (order.indexOf(l) < 0) order.push(l); });
      order = order.slice(0, 20);
      var list = h('ol.list');
      var preview = h('div.actions');
      function move(i, step) { var j = i + step; if (j < 0 || j >= order.length) return; var t = order[i]; order[i] = order[j]; order[j] = t; draw(j, step); }
      function draw(focusIdx, step) {
        VX.clear(list);
        order.forEach(function (l, i) {
          var up = h('button.icon-btn', { type: 'button', 'aria-label': 'Move ' + l + ' up', disabled: i === 0, onclick: function () { move(i, -1); } }, h('span', { 'aria-hidden': 'true' }, '↑'));
          var down = h('button.icon-btn', { type: 'button', 'aria-label': 'Move ' + l + ' down', disabled: i === order.length - 1, onclick: function () { move(i, 1); } }, h('span', { 'aria-hidden': 'true' }, '↓'));
          list.appendChild(h('li', h('span.muted', { style: { width: '22px', 'text-align': 'right' } }, String(i + 1)), h('span.grow', cap(l)), LANGS.indexOf(l) < 0 ? ui.pill('custom') : null, up, down));
          if (focusIdx === i) { var want = step < 0 ? up : down; var target = want.disabled ? (step < 0 ? down : up) : want; setTimeout(function () { target.focus(); }, 0); }
        });
        VX.mount(preview, order.slice(0, 10).map(function (l) { return ui.pill(cap(l), 'accent'); }));
      }
      draw();
      return ui.grid([
        ui.card({ title: 'Language order', sub: 'For listeners who have not pinned their own languages. Top first. ' + publishedLine(cfg),
          body: h('div.form', list,
            h('div.actions',
              ui.button('Publish order', { kind: 'primary', icon: 'check', onClick: function () { return VX.config.set('language-order', order.slice(0, 20)).then(function (res) { if (res.ok) ctx.refresh(); }); } }),
              clearButton('language-order', 'Back to default', 'Home uses its built-in language order again.', ctx, cfg.value == null, 'refresh'))) }),
        ui.card({ title: 'Preview', sub: 'The first 10 chips on Home', body: h('div.preview-box', preview) })
      ], 2);
    }, { skeleton: 4 });
  }

  /* ------------------------------------------------------------- io */

  function renderIo(host, ctx) {
    var body = h('div.page-body');
    host.appendChild(body);
    return ui.load(body, function () { return VX.api.get(CONTENT, null, { fresh: true }); }, function (d) {
      if (d.configured === false) return ui.notice(NOT_CONNECTED, 'warn');
      var current = d.blocked || [];
      var have = {};
      current.forEach(function (b) { have[b.song_id] = true; });
      var file = h('input', { type: 'file', accept: '.json,application/json', 'aria-label': 'Choose a blocklist JSON file' });
      var plan = h('div');
      file.addEventListener('change', function () {
        var f = file.files && file.files[0];
        if (!f) return;
        if (f.size > 2 * 1024 * 1024) { VX.mount(plan, ui.notice('That file is larger than 2 MB — it is not a blocklist export.', 'bad')); return; }
        var r = new FileReader();
        r.onload = function () { VX.mount(plan, importPlan(String(r.result || ''), have, ctx)); };
        r.readAsText(f);
      });
      return ui.grid([
        ui.card({ title: 'Export', sub: fmt.plural(current.length, 'blocked entry', 'blocked entries') + ' (songs, artists and words)',
          body: h('div.form',
            h('p.muted', 'Downloads every block as JSON. Keep it as a backup, or import it into another environment.'),
            h('div.actions', ui.button('Download blocklist', { kind: 'primary', icon: 'download', disabled: !current.length, onClick: function () {
              VX.download.json('vinax-blocklist-' + VX.stamp(), current.map(function (b) { return { songId: b.song_id, title: b.song_title || null, reason: b.reason || null, createdAt: b.created_at || null }; }));
            } }), !current.length ? h('span.muted.small', 'Nothing is blocked yet.') : null)) }),
        ui.card({ title: 'Import', sub: 'Adds blocks from a JSON file. It never removes anything.',
          body: h('div.form',
            h('p.muted', 'Use a file from Export, or a list like ', ui.mono('[{"songId":"abc123","title":"Song name","reason":"…"}]'), '. Artist and word blocks keep their ', ui.mono('artist:'), ' / ', ui.mono('kw:'), ' prefix.'),
            file, plan) })
      ], 2);
    }, { skeleton: 3 });
  }

  function importPlan(text, have, ctx) {
    var data;
    try { data = JSON.parse(text); } catch (e) { return ui.notice('This is not valid JSON.', 'bad'); }
    if (data && !Array.isArray(data) && Array.isArray(data.blocked)) data = data.blocked;
    if (!Array.isArray(data)) return ui.notice('Expected a list of blocks ([ … ]).', 'bad');
    var seen = {}, rows = [], bad = 0;
    data.forEach(function (x) {
      var id = x && typeof x === 'object' ? (x.songId || x.song_id || x.id) : (typeof x === 'string' ? x : null);
      id = id == null ? '' : String(id).trim().slice(0, 120);
      if (!id) { bad++; return; }
      if (seen[id]) return;
      seen[id] = true;
      var k = kindOf(id);
      rows.push({ songId: id, kind: k.label, title: x && typeof x === 'object' ? String(x.title || x.songTitle || x.song_title || '').slice(0, 200) : '', reason: x && typeof x === 'object' ? String(x.reason || '').slice(0, 200) : '', exists: !!have[id] });
    });
    var fresh = rows.filter(function (r) { return !r.exists; });
    var status = h('p.muted.small', { 'aria-live': 'polite' });
    if (rows.length > 500) return ui.notice('The file has ' + fmt.num(rows.length) + ' entries; import at most 500 at a time.', 'bad');
    return h('div.page-body',
      ui.notice(fmt.plural(rows.length, 'entry', 'entries') + ' in the file · ' + fmt.num(fresh.length) + ' new · ' + fmt.num(rows.length - fresh.length) + ' already blocked' + (bad ? ' · ' + fmt.num(bad) + ' skipped (no id)' : ''), fresh.length ? 'info' : 'ok'),
      ui.table({
        columns: [
          { key: 'kind', label: 'Type' },
          { key: 'songId', label: 'Id', render: function (r) { return ui.mono(r.songId); } },
          { key: 'title', label: 'Title' },
          { key: 'exists', label: '', render: function (r) { return r.exists ? ui.pill('Already blocked') : ui.pill('New', 'accent'); } }
        ], rows: rows, exportName: false, pageSize: 10
      }),
      h('div.actions',
        ui.button('Import ' + fmt.plural(fresh.length, 'new block'), { kind: 'primary', icon: 'upload', disabled: !fresh.length, onClick: function () {
          return VX.confirm({ title: 'Import ' + fmt.plural(fresh.length, 'block') + '?', body: 'These are hidden from every listener right away.', danger: true, confirmLabel: 'Import' }).then(function (yes) {
            if (!yes) return null;
            var ok = 0, failed = 0;
            return fresh.reduce(function (p, r, i) {
              return p.then(function () {
                status.textContent = 'Importing ' + (i + 1) + ' of ' + fresh.length + '…';
                var body = { action: 'block', songId: r.songId, reason: r.reason || 'Imported from file' };
                if (r.title) body.songTitle = r.title;
                return contentPost(body).then(function (res) { if (res.ok) ok++; else failed++; });
              });
            }, Promise.resolve()).then(function () {
              status.textContent = '';
              VX.toast('Imported ' + fmt.num(ok) + (failed ? ' · ' + fmt.num(failed) + ' failed' : ''), failed ? 'bad' : 'ok');
              ctx.refresh();
            });
          });
        } }),
        status));
  }

  /* ------------------------------------------------------------ seo */

  function renderSeo(host) {
    var body = h('div.page-body');
    host.appendChild(body);
    return ui.load(body, function () { return VX.api.get('/api/admin/seo'); }, function (d) {
      if (d.configured === false) return ui.notice(NOT_CONNECTED, 'warn');
      var counts = d.counts || [];
      var sm = d.sitemap || {};
      var c = function (t) { var r = counts.filter(function (x) { return x.type === t; })[0]; return r ? r.count : 0; };
      var pages = counts.reduce(function (a, r) { return a + (Number(r.pages) || 0); }, 0);
      var days = VX.fillDays(d.addedByDay, 14, 'day', ['n']);
      var smOk = Number(sm.status) === 200 && !sm.error;
      return [
        !Number(d.total) ? ui.notice('No public pages are known yet. The list grows by itself as the catalogue is browsed and the sitemap job runs.', 'info') : null,
        ui.kpis([
          { label: 'Public pages', value: fmt.num(d.total), sub: fmt.plural(pages, 'sitemap file') },
          { label: 'Songs', value: fmt.num(c('song')) },
          { label: 'Albums', value: fmt.num(c('album')) },
          { label: 'Artists', value: fmt.num(c('artist')) },
          { label: 'Playlists', value: fmt.num(c('playlist')) },
          { label: 'Sitemap', value: sm.status ? (smOk ? 'Reachable' : 'Problem') : '—', tone: sm.status ? (smOk ? 'ok' : 'bad') : null,
            sub: sm.error ? String(sm.error) : sm.status ? 'HTTP ' + sm.status + ' · ' + fmt.plural(sm.entries, 'map') + ' · ' + fmt.bytes(sm.bytes) + ' · ' + fmt.ms(sm.ms) : 'not checked' }
        ]),
        ui.grid([
          ui.card({ title: 'Pages added per day', sub: 'Last 14 days, from the newest ' + fmt.num(d.sampled) + ' pages', span: 2,
            body: ui.chart({ labels: days.labels, series: [{ name: 'Pages added', values: days.values.n }], type: 'bar', height: 200, empty: 'No pages added recently' }) }),
          ui.card({ title: 'Languages', sub: 'Of the newest pages',
            body: ui.share((d.languages || []).map(function (r) { return { label: r.lang && r.lang !== 'unknown' ? cap(r.lang) : 'Unknown', value: r.n }; }), { empty: 'No pages yet' }) })
        ]),
        ui.card({ title: 'Newest pages', sub: 'The 25 most recently discovered', pad: false,
          body: ui.table({
            columns: [
              { key: 'type', label: 'Type', render: function (r) { return ui.pill(cap(r.type)); } },
              { key: 'name', label: 'Title', render: function (r) {
                var id = String(r.key || '').split(':')[1] || '';
                var slug = r.slug || '';
                var href = /^(song|album|artist|playlist)$/.test(r.type) && /^[\w-]+$/.test(id) && /^[a-z0-9-]*$/.test(slug) ? SITE + '/' + r.type + '/' + (slug ? slug + '-' : '') + id : null;
                return href ? h('a', { href: href, target: '_blank', rel: 'noopener noreferrer' }, r.name || r.title || id, ' ', VX.icon('external')) : (r.name || r.title || r.key || '—');
              } },
              { key: 'lang', label: 'Language', render: function (r) { return r.lang ? cap(r.lang) : '—'; } },
              { key: 'added_at', label: 'Added', render: function (r) { return h('span', { title: fmt.dateTime(r.added_at) }, fmt.ago(r.added_at)); } }
            ],
            rows: d.newest || [], exportName: 'vinax-seo-newest',
            empty: 'No pages yet', emptyHint: 'Song, album, artist and playlist pages appear here as they are discovered.'
          }) })
      ];
    }, { skeleton: 5 });
  }
})();
