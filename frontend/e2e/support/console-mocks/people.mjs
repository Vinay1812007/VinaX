// Mocks for Dashboard, Live Now and Users (console rebuild): signed-in people only.
const now = Date.now();
const ago = (min) => new Date(now - min * 60_000).toISOString();
const day = (d) => { const x = new Date(now - d * 86_400_000); return x.toISOString().slice(0, 10); };

const NAMES = [
  ['Asha Rao', 'asha.rao@gmail.com', 'android', '1.8.3', 'IN', 'Telangana', 'Hyderabad', 'telugu'],
  ['Vikram Singh', 'vikram.s@gmail.com', 'web', '1.8.3', 'IN', 'Delhi', 'New Delhi', 'hindi'],
  ['Meena Iyer', 'meena.iyer@gmail.com', 'android', '1.8.1', 'IN', 'Tamil Nadu', 'Chennai', 'tamil'],
  ['Rahul Verma', 'rahulv@gmail.com', 'android', '1.7.9', 'IN', 'Maharashtra', 'Mumbai', 'hindi'],
  ['Kavya Reddy', 'kavya.r@gmail.com', 'web', '1.8.3', 'IN', 'Telangana', 'Warangal', 'telugu'],
  ['Arjun Nair', 'arjun.nair@gmail.com', 'android', '1.8.3', 'IN', 'Kerala', 'Kochi', 'malayalam'],
  ['Priya Sharma', 'priya.sharma@gmail.com', 'ios', '1.8.2', 'IN', 'Karnataka', 'Bengaluru', 'kannada'],
  ['Sai Kiran', 'saikiran@gmail.com', 'android', '1.8.3', 'IN', 'Andhra Pradesh', 'Vijayawada', 'telugu'],
  ['Divya Menon', 'divya.menon@gmail.com', 'web', '1.8.3', 'AE', 'Dubai', 'Dubai', 'malayalam'],
  ['Rohit Gupta', 'rohit.g@gmail.com', 'android', '1.8.0', 'IN', 'Uttar Pradesh', 'Lucknow', 'hindi'],
  ['Lakshmi Prasad', 'lakshmi.p@gmail.com', 'android', '1.8.3', 'IN', 'Telangana', 'Hyderabad', 'telugu'],
  ['Neha Joshi', 'neha.joshi@gmail.com', 'web', '1.8.3', 'US', 'California', 'San Jose', 'english'],
  ['Kiran Kumar', 'kiran.k@gmail.com', 'android', '1.8.3', 'IN', 'Karnataka', 'Mysuru', 'kannada'],
  ['Anjali Das', 'anjali.das@gmail.com', 'android', '1.8.2', 'IN', 'West Bengal', 'Kolkata', 'bengali'],
  ['Farhan Ali', 'farhan.ali@gmail.com', 'web', '1.8.3', 'IN', 'Telangana', 'Hyderabad', 'urdu'],
];
const SONGS = [['Naatu Naatu', 'Rahul Sipligunj'], ['Kesariya', 'Arijit Singh'], ['Vaathi Coming', 'Anirudh'], ['Srivalli', 'Sid Sriram'], ['Apna Bana Le', 'Arijit Singh']];
const users = NAMES.map((n, i) => ({
  id: '1100000000000000000' + String(i + 10),
  name: n[0], email: n[1], picture: null, platform: n[2], appVersion: n[3], country: n[4], region: n[5], city: n[6], language: n[7],
  nowPlaying: i < 5 ? { title: SONGS[i][0], artist: SONGS[i][1] } : null, isPlaying: i < 3,
  joined: ago(60 * 24 * (i * 3 + 1)), lastSeen: ago(i < 5 ? i : i * 90), devices: i % 4 === 0 ? 2 : 1, plays: 400 - i * 23, blocked: i === 13,
}));

function profile(u) {
  return {
    account: { id: u.id, email: u.email, name: u.name, picture: null, platform: u.platform, appVersion: u.appVersion, country: u.country, region: u.region, city: u.city, createdAt: u.joined, lastSeen: u.lastSeen, blockedAt: u.blocked ? ago(600) : null },
    devices: [
      { id: 'd_' + 'ab'.repeat(16), platform: u.platform, appVersion: u.appVersion, country: u.country, region: u.region, city: u.city, firstSeen: u.joined, lastSeen: u.lastSeen, signedOutAt: null, nowPlaying: u.nowPlaying, isPlaying: u.isPlaying },
      ...(u.devices > 1 ? [{ id: 'd_' + 'cd'.repeat(16), platform: 'web', appVersion: '1.8.3', country: u.country, region: u.region, city: u.city, firstSeen: u.joined, lastSeen: ago(3000), signedOutAt: null, nowPlaying: null, isPlaying: false }] : []),
    ],
    backup: { version: 12, bytes: 48213, updatedAt: ago(200) },
    stats: { plays: u.plays, plays30d: Math.round(u.plays / 3), activeDays30d: 18, favorites: 34, searches: 61, errors: 2, firstEvent: u.joined, lastEvent: u.lastSeen },
    topSongs: SONGS.map((s, i) => ({ title: s[0], artist: s[1], image: null, plays: 40 - i * 6 })),
    topArtists: SONGS.map((s, i) => ({ artist: s[1], plays: 60 - i * 9 })),
    languages: [{ language: u.language, plays: 120 }, { language: 'hindi', plays: 40 }, { language: 'english', plays: 12 }],
    history: Array.from({ length: 30 }, (_, i) => ({ at: ago(i * 37 + 3), songId: 's' + i, title: SONGS[i % 5][0], artist: SONGS[i % 5][1], image: null, language: u.language, platform: u.platform })),
    feedback: [{ id: 7, at: ago(3000), kind: 'bug', message: 'Lyrics did not load for one song.', status: 'resolved', platform: u.platform, appVersion: u.appVersion }],
    activity: ['play', 'favorite', 'search', 'skip', 'open', 'error', 'complete', 'share'].map((k, i) => ({ at: ago(i * 50 + 2), kind: k, title: k === 'search' || k === 'open' ? null : SONGS[i % 5][0], artist: SONGS[i % 5][1], errorKind: k === 'error' ? 'download' : null, message: k === 'error' ? 'Song download timed out' : null, platform: u.platform, appVersion: u.appVersion, city: u.city })),
  };
}

const timeline = (days) => Array.from({ length: days }, (_, i) => ({
  day: day(days - 1 - i), plays: 80 + Math.round(40 * Math.sin(i / 2)) + i * 3, listeners: 6 + (i % 5), newListeners: i % 3, errors: (i * 7) % 9, searches: 30 + (i % 6) * 4, heartbeats: 200,
}));

export default {
  'GET /api/admin/overview': (url) => {
    const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days')) || 14));
    return {
      configured: true, schema: { version: 11, appliedAt: ago(4000) }, days,
      kpis: { activeNow: 4, playingNow: 3, users: 15, listeners: 15, accounts: 15, newListeners24h: 1, newAccounts7d: 3, newAccountsPrev7d: 2, playsToday: 148, playsYesterday: 131, plays24h: 160, plays7d: 980, playsPrev7d: 870, errors24h: 35, errorsPrev24h: 22, dau: 9, dauPrev: 8, wau: 13, wauPrev: 12, mau: 15, mauPrev: 11, feedbackNew: 2, pushDevices: 0, pushPeople: 0, roomsActive: 1 },
      timeline: timeline(days),
      platforms: [{ platform: 'android', users: 9, listeners: 9, accounts: 9 }, { platform: 'web', users: 5, listeners: 5, accounts: 5 }, { platform: 'ios', users: 1, listeners: 1, accounts: 1 }],
      versions: [],
      attention: [
        { id: 'errors', level: 'bad', text: '35 app errors in the last 24 hours.', action: 'View errors', page: 'health', tab: 'errors' },
        { id: 'feedback', level: 'warn', text: '2 new feedback messages waiting to be read.', action: 'Read feedback', page: 'feedback', tab: 'new' },
        { id: 'push', level: 'warn', text: 'No phones are set up for notifications yet.', action: 'Set up', page: 'notifications', tab: 'setup' },
        { id: 'rooms', level: 'info', text: '1 Listen Together room open right now.', action: 'See rooms', page: 'live', tab: 'rooms' },
      ],
      checkedAt: new Date().toISOString(),
    };
  },
  'GET /api/admin/live': () => {
    const listening = users.slice(0, 5).map((u, i) => ({ key: u.id, user: { id: u.id, name: u.name, email: u.email, picture: null }, platform: u.platform, appVersion: u.appVersion, country: u.country, city: u.city, song: u.nowPlaying ? { ...u.nowPlaying, image: null } : null, isPlaying: u.isPlaying, lastSeen: ago(i * 0.5) }));
    return {
      configured: true, now: new Date().toISOString(), counts: { activeNow: 5, playingNow: 3, roomsOpen: 1 }, listening,
      feed: Array.from({ length: 14 }, (_, i) => { const u = users[i % 6]; const kinds = ['play', 'favorite', 'search', 'skip', 'complete', 'error', 'open']; const k = kinds[i % kinds.length];
        return { id: 100 - i, at: ago(i * 2 + 0.2), kind: k, user: { id: u.id, name: u.name, email: u.email, picture: null }, song: ['search', 'open', 'error'].includes(k) ? null : { title: SONGS[i % 5][0], artist: SONGS[i % 5][1], image: null }, message: k === 'error' ? 'Song download timed out' : null, errorKind: k === 'error' ? 'download' : null, platform: u.platform, city: u.city }; }),
      rooms: [{ code: 'K7M2QX', hostName: 'Asha', members: 3, song: { title: 'Naatu Naatu', artist: 'Rahul Sipligunj', image: null }, playing: true, updatedAt: ago(1), createdAt: ago(42) }],
    };
  },
  'POST /api/admin/live': (url, b) => ({ ok: true, ended: b.action === 'end_all_rooms' ? 1 : 1 }),
  'GET /api/admin/listeners': (url) => {
    const p = url.searchParams;
    if (p.get('filters') === '1') {
      const places = {};
      users.forEach((u) => { const k = [u.country, u.region, u.city].join('|'); places[k] = (places[k] || 0) + 1; });
      return { configured: true,
        places: Object.entries(places).map(([k, n]) => { const [country, region, city] = k.split('|'); return { country, region, city, users: n }; }),
        versions: [['android', '1.8.3', 6], ['android', '1.8.2', 1], ['android', '1.8.1', 1], ['android', '1.8.0', 1], ['android', '1.7.9', 1], ['web', '1.8.3', 5], ['ios', '1.8.2', 1]].map(([platform, version, n]) => ({ platform, version, users: n })),
        languages: [['telugu', 4], ['hindi', 3], ['kannada', 2], ['malayalam', 2], ['tamil', 1], ['bengali', 1], ['urdu', 1], ['english', 1]].map(([language, n]) => ({ language, users: n })) };
    }
    const acct = p.get('account');
    if (acct) { const u = users.find((x) => x.id === acct); return u ? { configured: true, profile: profile(u) } : { __status: 404, configured: true, error: 'not_found' }; }
    let rows = users.slice();
    const q = (p.get('q') || '').toLowerCase();
    if (q) rows = rows.filter((u) => (u.name + ' ' + u.email).toLowerCase().includes(q));
    for (const [k, f] of [['platform', 'platform'], ['country', 'country'], ['region', 'region'], ['city', 'city'], ['version', 'appVersion'], ['language', 'language']]) if (p.get(k)) rows = rows.filter((u) => String(u[f]).toLowerCase() === p.get(k).toLowerCase());
    if (p.get('active')) rows = rows.filter((u) => Date.parse(u.lastSeen) > now - Number(p.get('active')) * 86_400_000);
    if (p.get('joined')) rows = rows.filter((u) => Date.parse(u.joined) > now - Number(p.get('joined')) * 86_400_000);
    const ids = (p.get('ids') || '').split(',').filter(Boolean);
    if (ids.length) rows = rows.filter((u) => ids.includes(u.id));
    const sort = p.get('sort') || 'last_active';
    rows.sort((a, b) => sort === 'joined' ? Date.parse(b.joined) - Date.parse(a.joined) : sort === 'plays' ? b.plays - a.plays : sort === 'name' ? a.name.localeCompare(b.name) : Date.parse(b.lastSeen) - Date.parse(a.lastSeen));
    const limit = Number(p.get('limit')) || 50, offset = Number(p.get('offset')) || 0;
    return { configured: true, total: rows.length, limit, offset, rows: rows.slice(offset, offset + limit),
      counts: { users: 15, new7d: 3, activeToday: 9, byPlatform: { android: 9, web: 5, ios: 1 } } };
  },
  'POST /api/admin/listeners': (url, b) => (b.action === 'block' || b.action === 'unblock' ? { ok: true, blocked: b.action === 'block' } : b.action === 'signout_device' ? { ok: true, signedOutAt: new Date().toISOString() } : { ok: true, deleted: { listener: 1, account: 1, events: 230 } }),
};
