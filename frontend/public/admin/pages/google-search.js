/* VinaX console — Google Search (console rebuild).
 * Can search engines find and read the website? Tabs:
 *   summary  cards, Check again, and "Bots allowed to read the site" (Allow / Block per crawler)
 *   pages    Page check: what is wrong with each key page and how to fix it, or check one song / album / artist page
 *   console  Search Console: where to submit the site and what to check each week
 * Reads /api/admin/seo (the live site, read the way a crawler reads it) and
 * /api/admin/seo?view=bots; saves bot choices to the `robots` setting.
 */
(function () {
  'use strict';
  var VX = window.VX, h = VX.h, ui = VX.ui, fmt = VX.fmt, arr = VX.arr, obj = VX.obj, num = VX.num;
  var SITE = 'https://www.vinaxmusic.online';

  [
    { id: 'google-search', title: 'Google Search', icon: 'globe', render: renderSummary,
      desc: 'How many pages search engines can find, and which bots may read the site.',
      keywords: 'seo sitemap robots crawlers bots indexing' },
    { id: 'page-check', title: 'Page Check', icon: 'check', render: renderPages,
      desc: 'The main pages read the way Google reads them: what is wrong and how to fix it.',
      keywords: 'seo page check problems titles meta' },
    { id: 'search-console', title: 'Search Console', icon: 'external', render: renderConsole,
      desc: 'Where to tell Google and Bing about the site, and what to check each week.',
      keywords: 'search console bing webmaster submit sitemap' }
  ].forEach(function (p, i) {
    VX.page(Object.assign({ group: 'Growth & SEO', order: i + 1, noAuto: true }, p));
  });

  var cache = null;
  function fetchSeo(force) {
    if (cache && !force && Date.now() - cache.at < 120000) return Promise.resolve(cache.res);
    return VX.api.get('/api/admin/seo', null, { fresh: true, timeout: 60000 }).then(function (res) { if (res.ok) cache = { at: Date.now(), res: res }; return res; });
  }
  function siteLink(path) { return h('a', { href: SITE + path, target: '_blank', rel: 'noopener noreferrer' }, path === '/' ? 'Home page' : path); }

  /** One crawler problem → what is wrong and how to fix it, in plain words. Exposed as VX.seoExplain for tests. */
  function explain(issue) {
    var s = String(issue || ''), m;
    if ((m = /^answers (\S+)/.exec(s))) return { what: m[1] === 'nothing' ? 'The page does not open' : 'The page answers with an error (' + m[1] + ')', fix: 'Open the page yourself. If it is gone, remove links to it; if it moved, add a redirect.' };
    if (s === 'no title') return { what: 'No page title', fix: 'Give the page a title — it is the blue link people click in Google.' };
    if ((m = /^title is (\d+)/.exec(s))) return { what: 'Title is too long (' + m[1] + ' characters)', fix: 'Shorten the title to under 70 characters so Google shows all of it.' };
    if (s === 'no meta description') return { what: 'No short description', fix: 'Add a one-line description (50–160 characters). Google shows it under the title.' };
    if ((m = /^description is (\d+)/.exec(s))) return { what: Number(m[1]) < 50 ? 'Description is too short (' + m[1] + ' characters)' : 'Description is too long (' + m[1] + ' characters)', fix: 'Keep the description between 50 and 160 characters.' };
    if (s === 'no canonical') return { what: 'Google may not know this page’s main address', fix: 'Ask a developer to add a “canonical” link pointing to this page.' };
    if (/canonicals$/.test(s)) return { what: 'The page names more than one main address', fix: 'Ask a developer to keep just one “canonical” link.' };
    if ((m = /^canonical points to (.*)$/.exec(s))) return { what: 'The page says its main address is ' + m[1], fix: 'Point the “canonical” link at this page, or Google may skip it.' };
    if (s === 'no H1') return { what: 'No main heading', fix: 'Add one big heading at the top that says what the page is about.' };
    if (s === 'no structured data') return { what: 'No song or album details for Google', fix: 'Ask a developer to add structured data, so Google can show rich results.' };
    if ((m = /^only (\d+) words/.exec(s))) return { what: 'Very little text Google can read (' + m[1] + ' words)', fix: 'Add a short paragraph about the page — at least 60 words.' };
    if (s === 'marked noindex') return { what: 'Hidden from Google on purpose', fix: 'If this page should appear in Google, remove its “noindex” tag.' };
    return { what: s.charAt(0).toUpperCase() + s.slice(1), fix: 'Ask a developer to look at this page.' };
  }
  VX.seoExplain = explain;

  /* ------------------------------------------------------------- Summary */

  function renderSummary(host, ctx) {
    var top = h('div'), bots = h('div');
    host.appendChild(h('div.toolbar', ui.button('Check again', { kind: 'primary', icon: 'refresh', onClick: function () { return load(true); } }),
      ui.muted('Reads the live site about 20 times, like Google does. Allowed a few times a minute.')));
    host.appendChild(top);
    host.appendChild(bots);
    function load(force) {
      return ui.load(top, function () { return fetchSeo(force); }, function (d) {
        var robots = obj(d.robots), sitemap = obj(d.sitemap), maps = arr(d.maps), pages = arr(d.pages);
        var clean = pages.filter(function (p) { return !arr(p.issues).length && p.status === 200; }).length;
        var mapsOk = maps.filter(function (m) { return m.status === 200 && num(m.urls) > 0; }).length;
        return [
          !num(d.issues) ? ui.notice('All good — search engines can read every page that was checked.', 'ok')
            : ui.notice(fmt.plural(num(d.issues), 'thing') + ' to look at. The Page check tab explains each one.', 'warn'),
          robots.disallowAll ? ui.notice('robots.txt blocks every search engine from the whole site. Nothing will appear in Google until this is fixed.', 'bad') : null,
          ui.stats([
            { label: 'Pages Google can find', value: fmt.num(d.indexable), info: 'Pages listed in the site’s sitemaps — the lists that tell search engines which pages exist.' },
            { label: 'Sitemaps', value: fmt.num(mapsOk) + (mapsOk === maps.length && maps.length ? ' ✓' : ' of ' + fmt.num(maps.length)), tone: sitemap.status === 200 && mapsOk === maps.length ? 'ok' : 'bad', info: 'Each sitemap must open and list pages. Submit the main one in Search Console.' },
            { label: 'Pages with no problems', value: fmt.num(clean) + ' of ' + fmt.num(pages.length), tone: clean === pages.length ? 'ok' : 'warn', info: 'Of the main pages checked, how many Google can read with nothing to fix.', onClick: function () { ctx.go('page-check'); } },
            { label: 'robots.txt', value: robots.status === 200 ? 'Working ✓' : 'Not working ✗', tone: robots.status === 200 ? 'ok' : 'bad', info: 'The file that tells search engines and bots what they may read. If it does not open, Google may stop reading the whole site.' },
            { label: 'Server load per check', value: 'None', sub: 'pages are ready-made files', info: 'How much of the server’s daily allowance search engines use. The public pages are ready-made files, so crawlers cost nothing; only this check uses about 20 quick reads.' }
          ]),
          ui.card({ title: 'Sitemaps', sub: 'The lists of pages search engines read', pad: false, body: ui.dataTable({
            rows: maps, exportName: false, search: false, rowId: function (m) { return m.path; },
            empty: 'No sitemaps found',
            columns: [
              { key: 'path', label: 'Sitemap', always: true, render: function (m) { return siteLink(m.path); } },
              { key: 'status', label: 'Status', render: function (m) { return m.status === 200 ? ui.pill('Working ✓', 'ok') : ui.pill('Not working ✗', 'bad'); } },
              { key: 'urls', label: 'Pages', align: 'right', render: function (m) { return fmt.num(m.urls); } },
              { key: 'lastmod', label: 'Last updated', render: function (m) { return m.lastmod ? fmt.date(m.lastmod) : null; } }
            ]
          }) }),
          d.checkedAt ? h('p.muted.small', 'Checked ' + fmt.full(d.checkedAt) + '.') : null
        ];
      });
    }
    renderBots(bots);
    return load(false);
  }

  /* --------------------------------------------------------------- Bots */

  function renderBots(host) {
    return ui.load(host, function () { return VX.api.get('/api/admin/seo', { view: 'bots' }, { fresh: true, timeout: 20000 }); }, function (d) {
      var bots = arr(d.bots), groups = obj(d.groups);
      var saved = {};
      bots.forEach(function (b) { saved[b.id] = !!b.allowed; });
      var draft = Object.assign({}, saved);
      var canEdit = VX.can('edit');
      var chip = h('span');
      var saveBtn = ui.button('Save & apply', { kind: 'primary', icon: 'check', disabled: true, onClick: save });
      var cancelBtn = ui.button('Cancel changes', { kind: 'ghost', disabled: true, onClick: function () { draft = Object.assign({}, saved); draw(); } });
      var list = h('div.bot-groups');
      function dirty() { return bots.some(function (b) { return draft[b.id] !== saved[b.id]; }); }
      function sync() {
        var dt = dirty();
        VX.mount(chip, ui.statusChip(dt ? 'unsaved' : d.saved ? 'live' : 'builtin'));
        saveBtn.disabled = !canEdit || !dt;
        cancelBtn.disabled = !dt;
      }
      function draw() {
        VX.mount(list, ['search', 'ai', 'seo'].map(function (g) {
          var inGroup = bots.filter(function (b) { return b.group === g; });
          if (!inGroup.length) return null;
          var allowed = inGroup.filter(function (b) { return draft[b.id]; }).length;
          return h('section.bot-group',
            h('div.bot-group-head', h('h4', groups[g] || g), h('span.muted.small', fmt.num(allowed) + ' of ' + fmt.num(inGroup.length) + ' allowed')),
            h('ul.bot-list', inGroup.map(function (b) {
              var seg = ui.segmented([{ value: 'allow', label: 'Allow' }, { value: 'block', label: 'Block' }], draft[b.id] ? 'allow' : 'block', function (v) { draft[b.id] = v === 'allow'; sync(); draw(); }, b.name + ': allow or block');
              if (!canEdit) VX.$$('button', seg).forEach(function (x) { x.disabled = true; });
              var notLive = b.live != null && b.live !== saved[b.id];
              return h('li.bot-row',
                h('div.bot-text', h('strong', b.name), h('span.muted.small', b.about), notLive ? h('span.pill.warn', 'Not live yet') : null),
                seg);
            })));
        }));
        sync();
      }
      function save() {
        return VX.confirm({ title: 'Save & apply?', body: d.publishReady ? 'The website is rebuilt so robots.txt uses your choices. Bots see it within a few minutes.' : 'Your choices are saved. They reach robots.txt the next time the website is updated (with the next release). Add the “Website rebuild link” key to make this instant.', confirmLabel: 'Save & apply' }).then(function (ok) {
          if (!ok) return;
          var value = { bots: {} };
          bots.forEach(function (b) { if (draft[b.id] !== b.allowByDefault) value.bots[b.id] = draft[b.id]; });
          return VX.api.post('/api/admin/settings', { key: 'robots', value: Object.keys(value.bots).length ? value : null }).then(function (res) {
            if (!res.ok) { VX.toast('Something went wrong — ' + res.message, 'bad'); return; }
            saved = Object.assign({}, draft);
            d.saved = Object.keys(value.bots).length > 0;
            draw();
            if (!d.publishReady) { VX.toast('Saved ✓ — live with the next website update', 'ok'); return; }
            return VX.api.post('/api/admin/seo', { action: 'publish_robots' }).then(function (r2) {
              VX.toast(r2.ok ? 'Saved ✓ — the website is updating now' : 'Saved ✓, but the website could not be rebuilt — ' + r2.message, r2.ok ? 'ok' : 'bad');
            });
          });
        });
      }
      draw();
      return ui.card({ title: 'Bots allowed to read the site', sub: 'Search engines bring visitors. AI bots and SEO tools read every page and bring none, so they are blocked unless you allow them.',
        actions: [chip], body: [
          !canEdit ? ui.readOnlyNote() : null,
          list,
          h('div.save-bar', saveBtn, cancelBtn, h('span.grow'), h('span.muted.small', d.publishReady ? 'Changes go live within a few minutes.' : 'Changes go live with the next website update.'))
        ] });
    });
  }

  /* ---------------------------------------------------------- Page check */

  function pageTable(pages) {
    return ui.dataTable({
      rows: pages, rowId: function (p) { return p.path; }, exportName: 'vinax-page-check', search: false, sortKey: 'problems', sortDir: 'desc',
      empty: 'No pages checked',
      columns: [
        { key: 'path', label: 'Page', always: true, render: function (p) { return h('div', h('div.cell-main', siteLink(p.path)), p.title ? h('div.cell-sub', fmt.trunc(p.title, 60)) : null); } },
        { key: 'what', label: 'What’s wrong', sort: false, csv: function (p) { return arr(p.issues).map(function (i) { return explain(i).what; }).join('; '); }, render: function (p) {
          var list = arr(p.issues);
          return list.length ? h('ul.issue-list', list.map(function (i) { return h('li', explain(i).what); })) : h('span.muted', 'Nothing');
        } },
        { key: 'fix', label: 'How to fix', sort: false, csv: function (p) { return arr(p.issues).map(function (i) { return explain(i).fix; }).join('; '); }, render: function (p) {
          var list = arr(p.issues);
          return list.length ? h('ul.issue-list.fix', list.map(function (i) { return h('li', explain(i).fix); })) : null;
        } },
        { key: 'problems', label: 'Status', sortVal: function (p) { return arr(p.issues).length; }, render: function (p) { return arr(p.issues).length ? ui.pill('Needs work', 'warn') : ui.pill('OK ✓', 'ok'); } }
      ]
    });
  }

  function renderPages(host) {
    var body = h('div'), one = h('div');
    var type = 'songs';
    var pickerHost = h('div.page-picker');
    function drawPicker() {
      VX.mount(pickerHost, ui.musicPicker({ type: type, label: 'Find the page', hideLabel: true, onPick: function (m) {
        var path = '/' + ({ songs: 'song', albums: 'album', artists: 'artist' })[type] + '/' + encodeURIComponent(m.id);
        checkOne(path, m.title);
      } }));
    }
    function checkOne(path, name) {
      return ui.load(one, function () { return VX.api.get('/api/admin/seo', { path: path }, { fresh: true, timeout: 20000 }); }, function (d) {
        var p = obj(d.page);
        return ui.card({ title: 'Check: ' + (name || p.path), sub: p.path, body: pageTable([p]) });
      });
    }
    host.appendChild(ui.card({ title: 'Check one song, album or artist page', body: h('div.form-row.one-check',
      ui.dropdown('Kind of page', [{ value: 'songs', label: 'Song' }, { value: 'albums', label: 'Album' }, { value: 'artists', label: 'Artist' }], type, function (v) { type = v; drawPicker(); }),
      pickerHost) }));
    drawPicker();
    host.appendChild(one);
    host.appendChild(h('div.toolbar', ui.button('Check again', { kind: 'ghost', icon: 'refresh', onClick: function () { return load(true); } })));
    host.appendChild(body);
    function load(force) {
      return ui.load(body, function () { return fetchSeo(force); }, function (d) {
        return ui.card({ title: 'Main pages', sub: 'Home, the top lists, popular language pages, and the first song, album and artist pages', pad: false, body: pageTable(arr(d.pages)) });
      });
    }
    return load(false);
  }

  /* ------------------------------------------------------ Search Console */

  function renderConsole(host) {
    var sitemap = SITE + '/sitemap.xml';
    var ext = function (url, text) { return h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, text, ' ', VX.icon('external')); };
    host.appendChild(h('div.page-body',
      ui.card({ title: 'Tell search engines about the site', body: ui.dl([
        ['Google Search Console', ext('https://search.google.com/search-console', 'Open Google Search Console')],
        ['Bing Webmaster Tools', ext('https://www.bing.com/webmasters', 'Open Bing Webmaster Tools')],
        ['Sitemap to submit', h('span', ui.mono(sitemap), ' ', ui.button('Copy', { kind: 'ghost', small: true, icon: 'copy', onClick: function () { return VX.copy(sitemap, 'Sitemap address copied'); } }))],
        ['Rich results test', ext('https://search.google.com/test/rich-results?url=' + encodeURIComponent(SITE + '/'), 'Test the home page')],
        ['Page speed', ext('https://pagespeed.web.dev/analysis?url=' + encodeURIComponent(SITE + '/'), 'Measure the home page')]
      ]) }),
      ui.card({ title: 'Every week', body: h('ol.steps',
        h('li', 'Search Console → Pages: read why pages are “not indexed” and fix what Page check shows.'),
        h('li', 'Search Console → Sitemaps: each sitemap should say “Success”, with about the page counts on the Summary tab.'),
        h('li', 'Paste a song link and the home page link into WhatsApp: each should show a title and a picture.'),
        h('li', 'After a release, press Check again on the Summary tab: every main page should be OK.')) })));
    return Promise.resolve();
  }
})();
