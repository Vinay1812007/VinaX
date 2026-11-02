// Mock answers for Send Notification and A/B Tests (console rebuild).
// Used by the preview server and the console e2e specs. Handlers receive
// (url: URL, body: object | null) and return the JSON answer.
const now = Date.now();
const iso = (ms) => new Date(ms).toISOString();

const PUSH = {
  configured: true,
  web: { configured: true, active: 12, allDevices: 40 },
  fcm: { configured: true, active: 21, allDevices: 55 },
  people: 15,
  geo: {
    countries: [{ key: 'IN', count: 30 }, { key: 'AE', count: 3 }],
    regions: [{ key: 'Telangana', country: 'IN', count: 18 }, { key: 'Karnataka', country: 'IN', count: 9 }, { key: 'Dubai', country: 'AE', count: 3 }],
    cities: [{ key: 'Hyderabad', region: 'Telangana', country: 'IN', count: 15 }, { key: 'Warangal', region: 'Telangana', country: 'IN', count: 3 }, { key: 'Bengaluru', region: 'Karnataka', country: 'IN', count: 9 }],
  },
  langs: [{ lang: 'te', count: 20 }, { lang: 'hi', count: 8 }, { lang: 'en', count: 5 }],
  rules: { minGapHours: 12, quiet: { enabled: true, start: '22:00', end: '08:00' }, types: { announcements: true, releases: true, recommendations: true, reminders: true } },
  quiet: { quiet: false, until: null },
};

const ROWS = [
  { id: 41, at: iso(now - 2 * 3600e3), kind: 'announcement', title: 'New Telugu hits are here', body: 'Fresh songs from this week — tap to listen.', link: '/charts', image: null, status: 'sent', scheduledFor: null, audience: 'Telugu', filter: { lang: 'te', label: 'Telugu' }, web: { total: 5, sent: 5, gone: 0 }, fcm: { total: 9, sent: 8 }, delivered: 13, opened: 4, openRate: 30.8, failures: null, sentBy: 'owner@example.com', createdBy: 'owner@example.com', retractedAt: null },
  { id: 42, at: iso(now - 3600e3), kind: 'announcement', title: 'Weekend picks', body: 'Your weekend playlist is ready.', link: '/made-for-you', image: null, status: 'scheduled', scheduledFor: iso(now + 26 * 3600e3), audience: 'Everyone', filter: { label: 'Everyone' }, web: { total: 12, sent: 0, gone: 0 }, fcm: { total: 21, sent: 0 }, delivered: 0, opened: 0, openRate: null, failures: null, sentBy: 'owner@example.com', createdBy: 'owner@example.com', retractedAt: null },
  { id: 43, at: iso(now - 30 * 60e3), kind: 'announcement', title: 'Diwali greetings', body: 'Happy Diwali from VinaX!', link: '/', image: null, status: 'draft', scheduledFor: null, audience: 'Hyderabad', filter: { city: 'Hyderabad', label: 'Hyderabad' }, web: { total: 0, sent: 0, gone: 0 }, fcm: { total: 0, sent: 0 }, delivered: 0, opened: 0, openRate: null, failures: null, sentBy: 'owner@example.com', createdBy: 'owner@example.com', retractedAt: null },
];

const EXPERIMENTS = [
  { key: 'home-shelf-order', name: 'Discovery first on Home', description: 'Do people play more when discovery shelves come first?', variants: [{ name: 'control', pct: 50 }, { name: 'discovery-first', pct: 50 }], audience: { platform: 'all', minVersion: null, percent: 40 }, status: 'running', active: true, startedAt: iso(now - 4 * 86400e3), endedAt: null, winner: null, createdAt: iso(now - 5 * 86400e3), updatedAt: iso(now - 4 * 86400e3) },
  { key: 'rec-next-songs', name: 'Taste weight', description: 'How closely next songs follow taste.', variants: [{ name: 'control', pct: 34 }, { name: 'taste-0.15', pct: 33 }, { name: 'taste-0.18', pct: 33 }], audience: { platform: 'android', minVersion: '1.8.0', percent: 100 }, status: 'finished', active: false, startedAt: iso(now - 30 * 86400e3), endedAt: iso(now - 9 * 86400e3), winner: 'taste-0.18', createdAt: iso(now - 31 * 86400e3), updatedAt: iso(now - 9 * 86400e3) },
];

function dry(body) {
  const users = Array.isArray(body?.users) ? body.users.length : 0;
  const f = body?.filter || {};
  let people = users || 15;
  if (f.lang) people = Math.max(1, Math.round(people * 0.6));
  if (f.city) people = Math.max(1, Math.round(people * 0.5));
  if (body?.activity) people = Math.max(1, Math.round(people * 0.7));
  return { dryRun: true, people, devices: people * 2, web: people, fcm: people, skippedRecent: 1, audience: 'Everyone', quiet: { quiet: false, until: null } };
}

export default {
  'GET /api/admin/push': () => PUSH,
  'POST /api/admin/push': (url, body) => {
    if (body?.dryRun) return dry(body);
    if (body?.test) return { ok: true, test: true, devices: 2 };
    if (body?.draft) return { ok: true, id: 44, status: 'draft' };
    if (body?.when === 'schedule') return { ok: true, id: 45, status: 'scheduled', scheduledFor: body.scheduledFor };
    return { ok: true, id: 46, status: 'sent', people: 15, skippedRecent: 1, web: { total: 12, sent: 12, gone: 0, failed: {} }, fcm: { total: 21, sent: 20, failed: {} }, audience: 'Everyone' };
  },
  'GET /api/admin/notifications': (url) => {
    const s = url.searchParams.get('status');
    return { configured: true, rows: s && s !== 'all' ? ROWS.filter((r) => r.status === s) : ROWS, counts: { sent: 1, scheduled: 1, draft: 1 } };
  },
  'POST /api/admin/notifications': (url, body) => (body?.action === 'cancel' ? { ok: true, id: body.id, status: 'cancelled' } : { ok: true, id: body?.id, deleted: 1, announcementCleared: false }),
  'GET /api/admin/experiments': () => ({ configured: true, activeUsers: 120, rows: EXPERIMENTS }),
  'POST /api/admin/experiments': (url, body) => ({ ok: true, row: { ...body } }),
  'GET /api/admin/fcmcheck': () => ({ configured: true, project: 'vinax', token: true, fcm: 'ok', detail: null }),
};
