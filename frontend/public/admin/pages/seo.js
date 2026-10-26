/* VinaX console — SEO page (V2 1.0.1).
 * How the public site looks to a search engine, read live from the server
 * (/api/admin/seo): robots.txt, the sitemap index and every map it lists,
 * and an audit of the key pages (title, description, canonical, H1,
 * structured data, crawlable text). Since V2 1.0 every page a crawler reads
 * is a static file, so crawling costs no Worker requests; this page spends
 * about twenty, only when it is opened, and keeps the answer five minutes. */
(function () {
  'use strict';
  var VX = window.VX, h = VX.h, ui = VX.ui, fmt = VX.fmt, arr = VX.arr, num = VX.num;
  var SITE = 'https://www.vinaxmusic.online';

  VX.page({
    id: 'seo', title: 'SEO', group: 'Content', icon: 'globe', noAuto: true,
    desc: 'How the public site looks to search engines: sitemaps, robots.txt and a live audit of the key pages.',
    tabs: [
      { id: 'overview', label: 'Overview', desc: 'Indexable pages, the sitemaps that list them and what robots.txt allows.', render: renderOverview },
      { id: 'audit', label: 'Page audit', desc: 'Title, description, canonical, H1, structured data and crawlable text of the key pages — or any page you name.', render: renderAudit },
      { id: 'tools', label: 'Search consoles', desc: 'Where to submit the sitemap and check indexing, and what to do each week.', render: renderTools }
    ]
  });

  /* ------------------------------------------------------------ data */

  var cache = null;
  var TTL = 5 * 60 * 1000;

  function fetchSeo(force) {
    if (!force && cache && Date.now() - cache.at < TTL) return Promise.resolve(cache.res);
    return VX.api.get('/api/admin/seo', null, { fresh: true, timeout: 45000 }).then(function (res) {
      if (res && res.ok) cache = { at: Date.now(), res: res };
      return res;
    });
  }

  function extLink(url, text) {
    return /^https:\/\//i.test(String(url || '')) ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, text || url) : (text || url);
  }
  function siteLink(path) { return extLink(SITE + path, path); }

  function toolbar(host, body, load) {
    host.appendChild(h('div.toolbar',
      ui.button('Check again', { kind: 'primary', icon: 'refresh', onClick: function () { return load(true); } }),
      ui.muted(cache ? 'Checked ' + fmt.ago(new Date(cache.at).toISOString()) + ' · reads the live site like a crawler' : 'Reads the live site like a crawler (about 20 requests)')));
    host.appendChild(body);
  }

  /* -------------------------------------------------------- Overview */

  function renderOverview(host) {
    var body = h('div.page-body');
    function load(force) {
      return ui.load(body, function () { return fetchSeo(force); }, function (d) {
        var maps = arr(d.maps), pages = arr(d.pages), robots = d.robots || {};
        var clean = pages.filter(function (p) { return !arr(p.issues).length; }).length;
        var robotsOk = robots.status === 200 && !robots.disallowAll && arr(robots.sitemaps).length > 0;
        return [
          num(d.issues) === 0
            ? ui.notice('All good — robots.txt, the sitemaps and every audited page read the way search engines need.', 'ok')
            : ui.notice(fmt.plural(num(d.issues), 'thing') + ' to look at. The Page audit tab lists them page by page.', 'warn'),
          ui.kpis([
            { label: 'Indexable pages', value: fmt.num(d.indexable), sub: 'URLs in the sitemaps' },
            { label: 'Sitemaps', value: fmt.num(maps.length), sub: d.sitemap && d.sitemap.lastmod ? 'updated ' + d.sitemap.lastmod : 'in the index' },
            { label: 'Pages audited', value: clean + ' / ' + pages.length, sub: 'with no issues', tone: clean === pages.length ? 'ok' : 'warn' },
            { label: 'robots.txt', value: robotsOk ? 'OK' : 'Check', sub: robots.status === 200 ? 'names ' + fmt.plural(arr(robots.sitemaps).length, 'sitemap') : 'answers ' + (robots.status || 'nothing'), tone: robotsOk ? 'ok' : 'bad' },
            { label: 'Worker cost', value: '0', sub: 'requests per crawl (static files)', tone: 'ok', hint: 'Hubs, song pages and sitemaps are static files since V2 1.0' }
          ]),
          ui.card({ title: 'Sitemaps', sub: 'What /sitemap.xml lists, read live', pad: false, body: ui.table({
            columns: [
              { key: 'path', label: 'Map', render: function (m) { return siteLink(m.path); } },
              { key: 'status', label: 'Answer', render: function (m) { return m.status === 200 ? ui.status('ok', '200') : ui.status('bad', String(m.status || 'none')); } },
              { key: 'urls', label: 'URLs', render: function (m) { return fmt.num(m.urls); } },
              { key: 'lastmod', label: 'Last updated', render: function (m) { return m.lastmod || ui.muted('—'); } },
              { key: 'sample', label: 'For example', sort: false, render: function (m) { var s = arr(m.sample)[0]; return s ? siteLink(s) : ui.muted('—'); } }
            ],
            rows: maps, exportName: 'vinax-sitemaps', search: false,
            empty: 'The sitemap index lists no maps'
          }) }),
          ui.card({ title: 'robots.txt', sub: 'What crawlers are told', body: ui.dl([
            ['Answer', robots.status === 200 ? '200' : String(robots.status || 'none')],
            ['Sitemap line', arr(robots.sitemaps).length ? arr(robots.sitemaps).join(' · ') : 'missing'],
            ['Whole site blocked', robots.disallowAll ? 'YES — search engines cannot crawl anything' : 'no'],
            ['Crawlers kept out', arr(robots.blockedAgents).length ? arr(robots.blockedAgents).join(', ') : 'none']
          ]) })
        ];
      }, { skeleton: 8 });
    }
    toolbar(host, body, load);
    return load(false);
  }

  /* ------------------------------------------------------ Page audit */

  function issueCell(p) {
    var list = arr(p.issues);
    return list.length ? h('span', list.map(function (i) { return ui.pill(i, 'warn'); })) : ui.pill('OK', 'ok');
  }

  function auditTable(pages) {
    return ui.table({
      columns: [
        { key: 'path', label: 'Page', render: function (p) { return siteLink(p.path); } },
        { key: 'status', label: 'Answer', render: function (p) { return p.status === 200 ? ui.status('ok', '200 · ' + fmt.num(p.ms) + ' ms') : ui.status('bad', String(p.status || 'none')); } },
        { key: 'title', label: 'Title', render: function (p) { return p.title ? h('span', { title: p.title }, fmt.trunc(p.title, 48)) : ui.muted('—'); } },
        { key: 'h1', label: 'H1', render: function (p) { return p.h1 ? fmt.trunc(p.h1, 32) : ui.muted('—'); } },
        { key: 'jsonLd', label: 'Structured data', sortVal: function (p) { return arr(p.jsonLd).join(', '); }, render: function (p) { return arr(p.jsonLd).length ? arr(p.jsonLd).join(', ') : ui.muted('none'); } },
        { key: 'words', label: 'Words', render: function (p) { return fmt.num(p.words); } },
        { key: 'issues', label: 'Issues', sortVal: function (p) { return arr(p.issues).length; }, render: issueCell }
      ],
      rows: pages, exportName: 'vinax-seo-audit', search: false, sortKey: 'issues', sortDir: 'desc',
      empty: 'Nothing audited'
    });
  }

  function renderAudit(host) {
    var body = h('div.page-body');
    var one = h('div');
    var input = ui.input({ placeholder: '/song/name-id or /telugu-songs', 'aria-label': 'Path to audit', style: { 'min-width': '260px' } });
    function check() {
      var path = String(input.value || '').trim().replace(/^https?:\/\/[^/]+/i, '');
      if (!/^\//.test(path)) path = '/' + path;
      return ui.load(one, function () { return VX.api.get('/api/admin/seo', { path: path }, { fresh: true, timeout: 20000 }); }, function (d) {
        var p = d.page || {};
        return ui.card({ title: 'Audit · ' + p.path, body: [
          ui.dl([
            ['Answer', String(p.status || 'none') + (p.ms ? ' · ' + fmt.num(p.ms) + ' ms' : '')],
            ['Title', p.title || '—'],
            ['Description', p.description || '—'],
            ['Canonical', p.canonical || '—'],
            ['H1', p.h1 || '—'],
            ['Structured data', arr(p.jsonLd).join(', ') || 'none'],
            ['Crawlable words', fmt.num(p.words)],
            ['Share image', p.ogImage ? 'yes' : 'no']
          ]),
          h('div', { style: { 'margin-top': '8px' } }, issueCell(p))
        ] });
      });
    }
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') check(); });
    host.appendChild(h('div.toolbar', input, ui.button('Audit this page', { kind: 'ghost', icon: 'search', onClick: check })));
    host.appendChild(one);
    function load(force) {
      return ui.load(body, function () { return fetchSeo(force); }, function (d) {
        return ui.card({ title: 'Key pages', sub: 'Home, top routes, mood × language hubs and the first song, album and artist pages in the sitemap', pad: false, body: auditTable(arr(d.pages)) });
      }, { skeleton: 8 });
    }
    toolbar(host, body, load);
    return load(false);
  }

  /* ---------------------------------------------------------- Tools */

  function renderTools(host) {
    var sitemap = SITE + '/sitemap.xml';
    host.appendChild(h('div.page-body',
      ui.card({ title: 'Submit and check indexing', body: ui.dl([
        ['Google Search Console', extLink('https://search.google.com/search-console', 'search.google.com/search-console')],
        ['Bing Webmaster Tools', extLink('https://www.bing.com/webmasters', 'bing.com/webmasters')],
        ['Sitemap to submit', h('span', ui.mono(sitemap), ' ', ui.button('Copy', { kind: 'ghost', small: true, icon: 'copy', onClick: function () { try { navigator.clipboard.writeText(sitemap); VX.toast && VX.toast('Copied'); } catch (e) { /* no clipboard */ } } }))],
        ['Rich results (Home)', extLink('https://search.google.com/test/rich-results?url=' + encodeURIComponent(SITE + '/'), 'Rich Results Test')],
        ['Page speed (Home)', extLink('https://pagespeed.web.dev/analysis?url=' + encodeURIComponent(SITE + '/'), 'PageSpeed Insights')],
        ['Structured data', extLink('https://validator.schema.org/', 'Schema.org validator')]
      ]) }),
      ui.card({ title: 'Every week', body: h('ol',
        h('li', 'Search Console → Pages: read why pages are “Discovered/Crawled – currently not indexed” and fix what the Page audit flags.'),
        h('li', 'Search Console → Sitemaps: each map should be “Success”, with the URL counts the Overview shows.'),
        h('li', 'Paste a song link and the Home link into WhatsApp: each should show a title and artwork card.'),
        h('li', 'After a release, run Check again here: every audited page should read OK.')) }),
      ui.card({ title: 'What the site serves to crawlers', body: ui.dl([
        ['Home and app routes', 'prerendered at build (title, description, canonical, real text)'],
        ['Mood × language hubs', '72 static pages with song lists and CollectionPage data'],
        ['Song, album, artist pages', 'static pages for the most-played songs of every language and the songs the hubs link to'],
        ['Cost to the Worker', 'none — all static files; only /api/* uses the daily request quota']
      ]) })));
    return Promise.resolve();
  }
})();
