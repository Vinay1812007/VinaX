// Mocks for the System pages: App Health, Database, Google Search, Admins & Roles.
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
const days = (n) => Array.from({ length: n }, (_, i) => {
  const d = new Date(Date.now() - (n - 1 - i) * 86400000);
  return d.toISOString().slice(0, 10);
});

const errorsTop = [
  { fingerprint: 'a1'.repeat(16), errorKind: 'download', message: 'Download of "Naatu Naatu" timed out after 30s', shape: 'Download of … timed out after #', samples: ['Download of "Naatu Naatu" timed out after 30s', 'Download of "Butta Bomma" timed out after 30s'], variants: 14, hits: 41, users: 9, lastSeen: ago(12), firstSeen: ago(60 * 70), platforms: ['android'], versions: ['1.8.3', '1.8.2'], status: 'investigating', note: null },
  { fingerprint: 'b2'.repeat(16), errorKind: 'push', message: 'PushManager not supported on this device', shape: 'PushManager not supported on this device', samples: ['PushManager not supported on this device'], variants: 1, hits: 22, users: 6, lastSeen: ago(40), firstSeen: ago(60 * 90), platforms: ['android'], versions: ['1.8.3'], status: 'new', note: null },
  { fingerprint: 'c3'.repeat(16), errorKind: 'react', message: "TypeError: Cannot read properties of undefined (reading 'id')", shape: "TypeError: Cannot read properties of undefined (reading …)", samples: ["TypeError: Cannot read properties of undefined (reading 'id')"], variants: 1, hits: 9, users: 4, lastSeen: ago(200), firstSeen: ago(60 * 30), platforms: ['web'], versions: ['1.8.3'], status: 'new', note: null },
  { fingerprint: 'd4'.repeat(16), errorKind: 'promise', message: 'NotAllowedError: play() failed because the user didn\'t interact with the document first.', shape: 'NotAllowedError: play() failed because the user didn…t interact with the document first.', samples: [], variants: 1, hits: 5, users: 2, lastSeen: ago(600), firstSeen: ago(60 * 100), platforms: ['web'], versions: ['1.8.1'], status: 'fixed', note: null },
];

let admins = [
  { email: 'owner@example.com', name: 'Asha Rao', picture: null, role: 'owner', invitedBy: null, createdAt: ago(60 * 24 * 30), lastSignIn: ago(3) },
  { email: 'ravi@example.com', name: 'Ravi Kumar', picture: null, role: 'editor', invitedBy: 'owner@example.com', createdAt: ago(60 * 24 * 10), lastSignIn: ago(60 * 26) },
  { email: 'meena@example.com', name: null, picture: null, role: 'viewer', invitedBy: 'owner@example.com', createdAt: ago(60 * 24 * 2), lastSignIn: null },
];

export default {
  'GET /api/admin/errors': (url) => {
    const n = Number(url.searchParams.get('days')) || 7;
    return { configured: true, days: n, total: 77, groups: errorsTop.length, users: 14, byDay: days(n).map((day, i) => ({ day, hits: (i * 7) % 13 })), top: errorsTop };
  },
  'POST /api/admin/errors': (url, b) => (b.action === 'clear' ? { ok: true, deleted: 77 } : { ok: true, fingerprint: b.fingerprint, status: b.status }),
  'GET /api/admin/edge': () => ({
    healthy: false, problems: 1, origin: 'https://www.vinaxmusic.online', checkedAt: new Date().toISOString(),
    shell: { ok: true, status: 200, ms: 182, build: '1.8.3' },
    assets: [{ path: '/assets/index-abc.js', ok: true, ms: 80, kind: 'script' }, { path: '/assets/index-def.css', ok: true, ms: 60, kind: 'style' }],
    endpoints: [
      { name: 'App settings', path: '/api/appconfig', ok: true, status: 200, ms: 120 },
      { name: 'Banners', path: '/api/appconfig?key=banners', ok: true, status: 200, ms: 98 },
      { name: 'Song search', path: '/api/cat/search', ok: false, status: 502, ms: 3000, note: 'The music source did not answer in time' },
    ],
  }),
  'GET /api/admin/musicapi': () => ({ checkedAt: new Date().toISOString(), mirrors: [{ id: 'vinax-cat', ok: true, songs: 10, ms: 340 }, { id: 'direct', ok: true, songs: 0, ms: 900 }, { id: 'x', label: 'saavn.sumit.co', ok: false, ms: 10000, note: 'No answer' }] }),
  'GET /api/admin/ai': () => ({
    settings: { enabled: false, testers: ['1', '2'] },
    providers: [{ name: 'Groq', configured: true, restingUntil: null, lastError: null }, { name: 'Google Gemini', configured: true, restingUntil: null, lastError: { kind: 'rate', at: ago(30) } }, { name: 'NVIDIA', configured: false }],
    models: [
      { id: 'groq:gpt-oss-20b', name: 'GPT OSS 20B', provider: 'Groq', group: 'Fast', configured: true, ownerEnabled: true },
      { id: 'gemini:gemini-3.5-flash', name: 'Gemini 3.5 Flash', provider: 'Google Gemini', group: 'Smart', configured: true, ownerEnabled: true, restingUntil: new Date(Date.now() + 20 * 60000).toISOString(), restKind: 'quota' },
      { id: 'nvidia:llama', name: 'Llama 4', provider: 'NVIDIA', group: null, configured: false, ownerEnabled: false },
    ],
    search: { grounding: { usedToday: 12, dailyLimit: 450, configured: true }, api: { usedToday: 3, dailyLimit: 100, configured: true, provider: 'tavily' } },
    voice: { dictation: true, readAloud: true, live: false },
  }),
  'POST /api/admin/ai': () => ({ ok: true, firstTokenMs: 420 }),
  'GET /api/admin/personal': () => ({ configured: true, stats: { accounts: 12, eventsDay: 340, eventsWeek: 2100, songs: 5400, songsEmbedded: 5100, backlog: 300, pagesDay: 18, playlistsDay: 4, colistenPairs: 23000, colistenUpdatedAt: ago(600) }, config: { enabled: true }, embed: { configured: true, model: 'x' } }),
  'POST /api/admin/personal': (url, b) => (b.action === 'embed' ? { embedded: 120, backlog: 180 } : { pairs: 23400 }),
  'GET /api/admin/releases': () => ({
    configured: true, release: { tag: 'v1.8.3', name: 'VinaX 1.8.3', notes: 'VinaX AI settings, Claude-style replies and live previews.', assets: [{ name: 'vinax-1.8.3.apk', url: 'https://github.com/x/y/releases/download/v1.8.3/vinax.apk' }] },
    live: { version: '1.8.3', build: 183, minBuild: 170 },
    runs: [{ name: 'Build Android APK', title: 'release: 1.8.3', status: 'completed', conclusion: 'success', started: ago(300), finished: ago(290), url: 'https://github.com/x/y/actions/runs/1' }, { name: 'CI', title: 'Fix a bug', status: 'completed', conclusion: 'failure', started: ago(400), finished: ago(395), url: 'https://github.com/x/y/actions/runs/2' }],
    commits: [{ message: 'VinaX AI settings, Claude-style replies and live previews (#205)', author: 'Sirimilla Vinay', at: ago(320), url: 'https://github.com/x/y/commit/1' }],
  }),
  'GET /api/admin/envcheck': () => ({
    checkedAt: new Date().toISOString(), missingRequired: [],
    items: [
      { name: 'ADMIN_OWNER_EMAILS', label: 'First owners of this console', group: 'Admin', required: false, set: true, note: 'Google emails that are always Owners of this console (the first admins)' },
      { name: 'ADMIN_LOGIN_PASSWORD', label: 'Owner recovery password', group: 'Admin', required: false, set: true, note: 'owner recovery password for the console' },
      { name: 'PAGES_DEPLOY_HOOK', label: 'Website rebuild link', group: 'Admin', required: false, set: false, note: 'lets Google Search → Bots publish robots.txt right away' },
      { name: 'SUPABASE_URL', label: 'Database address', group: 'Database', required: true, set: true, note: 'database project URL' },
      { name: 'SUPABASE_SERVICE_ROLE_KEY', label: 'Database key', group: 'Database', required: true, set: true, note: 'server only' },
      { name: 'FCM_SERVICE_ACCOUNT', label: 'Android notifications', group: 'Push', required: false, set: false, note: 'Android push' },
      { name: 'GEMINI_API_KEY', label: 'AI provider: Google Gemini', group: 'VinaX AI', required: false, set: true, note: 'Gemini chat models' },
    ],
  }),
  'GET /api/admin/database': () => ({
    configured: true, reachable: true, schema: { version: 10, appliedAt: ago(60 * 5) }, schemaWanted: 10, expected: 33, missing: [], totalBytes: 48_000_000,
    retention: { eventsDays: 180, errorsDays: 30, feedbackDays: null, notificationsDays: null },
    tables: [
      { name: 'events', label: 'Play history and activity', about: 'Plays, skips, searches, likes and app error reports.', rows: 182340, bytes: 31_000_000, approximate: true, keptFor: '180 days (error reports 30 days)' },
      { name: 'accounts', label: 'Users (Google accounts)', about: 'Everyone who signed in with Google.', rows: 15, bytes: 64000, approximate: false, keptFor: 'Forever' },
      { name: 'listeners', label: 'Devices', about: 'Each phone or browser that uses VinaX.', rows: 63, bytes: 128000, approximate: false, keptFor: 'Forever' },
      { name: 'feedback', label: 'Feedback', about: 'Messages users send from Settings → Feedback.', rows: 21, bytes: 32000, approximate: false, keptFor: 'Forever' },
      { name: 'audit_log', label: 'Change log', about: 'Every change an admin made in this console.', rows: 410, bytes: 512000, approximate: false, keptFor: 'Forever' },
    ],
    jobs: [
      { job: 'status-tick', label: 'Status check', about: 'Checks that the website, the app and the music sources answer.', enabled: true, every: 30, defaultEvery: 30, choices: [30, 60, 180, 360], lastAt: ago(8), ok: true, overdue: false, neverRan: false },
      { job: 'housekeeping', label: 'Clean-up', about: 'Removes old data and closes empty rooms.', enabled: true, every: 60, defaultEvery: 60, choices: [60, 180, 360, 720, 1440], lastAt: ago(250), ok: false, summary: { error: 'housekeeping: a step failed' }, overdue: true, neverRan: false },
      { job: 'personal-embed', label: 'Recommendation learning', about: 'Teaches the engine about new songs.', enabled: false, every: 30, defaultEvery: 30, choices: [30, 60, 180, 360, 1440], lastAt: null, ok: null, overdue: false, neverRan: true },
      { job: 'scheduled-notifications', label: 'Scheduled notifications', about: 'Sends notifications whose time has come.', enabled: true, every: 5, defaultEvery: 5, choices: [5, 15, 30, 60], lastAt: ago(3), ok: true, overdue: false, neverRan: false },
    ],
    jobsReadable: true, checkedAt: new Date().toISOString(),
  }),
  'POST /api/admin/database': (url, b) => (b.action === 'run_job' ? { ok: true, result: { ok: true, summary: {} } } : b.action === 'job_setting' ? { ok: true, job: b.job, enabled: b.enabled ?? true, every: b.every ?? 30 } : { ok: true, deleted: 12, retired: 3, rooms: 1, members: 2 }),
  'GET /api/admin/audit': () => ({
    configured: true, total: 3, limit: 50, offset: 0, actors: ['owner@example.com', 'ravi@example.com'], actions: ['push-send', 'settings', 'admin-invite'],
    rows: [
      { id: 3, at: ago(5), actor: 'ravi@example.com', action: 'settings', target: 'banners', summary: 'published banners', before: null, after: [{ title: 'Diwali offer' }], requestId: 'r3' },
      { id: 2, at: ago(90), actor: 'owner@example.com', action: 'push-send', target: 'everyone', summary: '"New songs" to everyone', requestId: 'r2' },
      { id: 1, at: ago(60 * 30), actor: 'owner@example.com', action: 'admin-invite', target: 'ravi@example.com', summary: 'invited ravi@example.com as editor', requestId: 'r1' },
    ],
  }),
  'GET /api/admin/seo': (url) => {
    if (url.searchParams.get('view') === 'bots') {
      const B = [['Googlebot', 'Google', 'search', true], ['Bingbot', 'Bing', 'search', true], ['GPTBot', 'GPTBot', 'ai', false], ['ClaudeBot', 'ClaudeBot', 'ai', false], ['PerplexityBot', 'PerplexityBot', 'ai', false], ['AhrefsBot', 'Ahrefs', 'seo', false]];
      return { groups: { search: 'Search engines', ai: 'AI bots', seo: 'SEO tools' }, saved: false, publishReady: false, liveStatus: 200, bots: B.map(([id, name, group, allowed]) => ({ id, name, group, about: name + ' crawler', allowByDefault: allowed, allowed, live: allowed })) };
    }
    if (url.searchParams.get('path')) return { page: { path: url.searchParams.get('path'), status: 200, ms: 120, title: 'Page', issues: ['no meta description'] } };
    return {
      origin: 'https://www.vinaxmusic.online', checkedAt: new Date().toISOString(), indexable: 21840, issues: 3,
      robots: { status: 200, sitemaps: ['https://www.vinaxmusic.online/sitemap.xml'], blockedAgents: ['GPTBot', 'ClaudeBot'], disallowAll: false },
      sitemap: { status: 200, maps: 3, lastmod: '2026-11-01' },
      maps: [{ path: '/sitemap-static.xml', status: 200, urls: 40, lastmod: '2026-11-01' }, { path: '/sitemap-hubs.xml', status: 200, urls: 800, lastmod: '2026-11-01' }, { path: '/entity-pages.xml', status: 200, urls: 21000, lastmod: '2026-11-01' }],
      pages: [
        { path: '/', status: 200, ms: 140, title: 'VinaX — Free Telugu, Hindi & Tamil songs', issues: [] },
        { path: '/top-songs/', status: 200, ms: 160, title: 'Top songs', issues: ['description is 32 characters (50–160)'] },
        { path: '/telugu-songs', status: 200, ms: 150, title: 'Telugu songs', issues: ['no H1', 'only 40 words of crawlable text'] },
        { path: '/about/', status: 200, ms: 90, title: 'About VinaX', issues: [] },
      ],
    };
  },
  'POST /api/admin/seo': () => ({ ok: false, error: 'publish_not_configured' }),
  'GET /api/admin/admins': () => ({ configured: true, rows: admins, bootstrap: ['owner@example.com'], me: { email: 'owner@example.com', role: 'owner', via: 'google' } }),
  'POST /api/admin/admins': (url, b) => {
    if (b.action === 'invite') { if (admins.some((a) => a.email === b.email)) return { __status: 409, error: 'already_admin' }; admins = admins.concat([{ email: b.email, name: null, picture: null, role: b.role, invitedBy: 'owner@example.com', createdAt: new Date().toISOString(), lastSignIn: null }]); return { ok: true }; }
    if (b.action === 'role') { if (b.email === 'owner@example.com' && b.role !== 'owner') return { __status: 409, error: 'last_owner' }; admins = admins.map((a) => (a.email === b.email ? { ...a, role: b.role } : a)); return { ok: true }; }
    if (b.action === 'remove') { if (b.email === 'owner@example.com') return { __status: 409, error: 'last_owner' }; admins = admins.filter((a) => a.email !== b.email); return { ok: true }; }
    return { __status: 400, error: 'unknown_action' };
  },
};
