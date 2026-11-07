// Console mocks — Feedback, Song Stats, Music Library, Trending, Search Insights (the preview server and e2e).
const now = Date.now();
const ago = (min) => new Date(now - min * 60000).toISOString();
const IMG = 'https://c.saavncdn.com/806/RRR-Telugu-2021-20220318101503-150x150.jpg';
const day = (i) => new Date(now - i * 86400000).toISOString().slice(0, 10);

const songs = [
  ['s1', 'Naatu Naatu', 'Rahul Sipligunj, Kaala Bhairava', 412, 96, 300],
  ['s2', 'Srivalli', 'Sid Sriram', 388, 88, 410],
  ['s3', 'Kesariya', 'Arijit Singh', 301, 70, 120],
  ['s4', 'Butta Bomma', 'Armaan Malik', 254, 61, 260],
  ['s5', 'Arabic Kuthu', 'Anirudh Ravichander', 199, 44, 20],
  ['s6', 'Samajavaragamana', 'Sid Sriram', 150, 39, 140],
].map(([id, title, artist, plays, listeners, prev]) => ({ id, title, artist, image: IMG, plays, listeners, prev_plays: prev }));

const music = {
  songs,
  artists: [['Sid Sriram', 538, 101], ['Arijit Singh', 301, 70], ['Anirudh Ravichander', 260, 58], ['Armaan Malik', 254, 61], ['Rahul Sipligunj', 212, 49]].map(([artist, plays, listeners]) => ({ artist, plays, listeners })),
  languages: [['telugu', 980, 140], ['hindi', 420, 90], ['tamil', 260, 55], ['english', 80, 20], ['unknown', 12, 5]].map(([language, plays, listeners]) => ({ language, plays, listeners })),
  rising: songs.filter((s) => s.plays > s.prev_plays).map((s) => ({ id: s.id, title: s.title, artist: s.artist, image: s.image, plays: s.plays, prev_plays: s.prev_plays })),
};

// Schema 11 — Trending and Search Insights (GET/POST /api/admin/trends).
const series = (days, base, step) => Array.from({ length: days }, (_, i) => Math.max(0, Math.round(base + step * i + ((i * 7) % 5))));
const trending = (days) => {
  // Ranks agree with the plays: s6 was not played before (NEW), the others moved.
  const list = songs.map((s, i) => ({ ...s, prev_plays: i === 5 ? 0 : s.prev_plays, rank: i + 1, prev_rank: [2, 1, 4, 3, 5, null][i], daily: series(Math.min(days, 90), 20 + i * 3, i % 2 ? -1 : 2) }));
  return {
    days,
    totals: { plays: 1704, prev_plays: 1250, listeners: 158, prev_listeners: 140, songs: 230, new_songs: 41 },
    songs: list,
    artists: music.artists.map((a, i) => ({ ...a, prev_plays: [400, 320, 120, 254, 0][i], rank: i + 1, prev_rank: [1, 2, 4, 3, null][i] })),
    languages: music.languages.map((l, i) => ({ ...l, prev_plays: [800, 450, 180, 80, 0][i] })),
  };
};
const searchPins = { 'naatu song': { id: 's1', title: 'Naatu Naatu', artist: 'Rahul Sipligunj, Kaala Bhairava', image: IMG } };
const searchSynonyms = { arr: 'A. R. Rahman', dsp: 'Devi Sri Prasad' };
const searches = (days) => ({
  days,
  totals: { searches: 642, people: 121, zero: 58, queries: 310, prev_searches: 590, prev_people: 112, prev_zero: 71 },
  top: [['srivalli', 44, 30, 0, 38], ['arijit singh', 39, 28, 0, 41], ['naatu song', 21, 15, 9, 10], ['kesariya remix', 18, 14, 18, 4], ['telugu hits 2026', 15, 12, 3, 0]]
    .map(([query, n, people, zero, prev]) => ({ query, searches: n, people, zero, prev_searches: prev, last_at: ago(30) })),
  zero: [['kesariya remix', 18, 14, 0, 40], ['naatu song', 9, 8, 12, 300], ['pushpa 3 songs', 7, 6, 0, 90], ['bday song telugu', 5, 5, 1, 900]]
    .map(([query, n, people, found, min]) => ({ query, searches: n, people, found, last_at: ago(min) })),
  rising: [['telugu hits 2026', 15, 0, 12], ['kesariya remix', 18, 4, 14], ['naatu song', 21, 10, 15]].map(([query, n, prev, people]) => ({ query, searches: n, prev_searches: prev, people })),
  daily: Array.from({ length: Math.min(days, 90) }, (_, i) => ({ day: day(Math.min(days, 90) - 1 - i), searches: 80 + (i % 4) * 9, zero: 6 + (i % 3) })),
});

const feedbackRows = [
  { id: 41, at: ago(12), kind: 'bug', message: 'Songs stop playing when the screen turns off on my Redmi phone.', status: 'new', note: null, platform: 'android', appVersion: '1.8.3', country: 'IN', city: 'Hyderabad', name: 'Ravi', user: { id: '1001', name: 'Ravi Kumar', email: 'ravi@example.com', picture: null }, canReply: true },
  { id: 40, at: ago(95), kind: 'idea', message: 'Please add a sleep timer for 15 minutes.', status: 'new', note: null, platform: 'web', appVersion: '1.8.2', country: 'IN', city: 'Chennai', name: 'Priya', user: { id: '1002', name: 'Priya S', email: 'priya@example.com', picture: null }, canReply: false },
  { id: 39, at: ago(60 * 26), kind: 'content', message: 'The song "Srivalli" plays the wrong audio.', status: 'read', note: null, platform: 'android', appVersion: '1.8.1', country: 'IN', city: 'Vijayawada', name: null, user: null, canReply: false },
  { id: 38, at: ago(60 * 80), kind: 'other', message: 'Love the app! Thank you.', status: 'resolved', note: 'Replied by notification', platform: 'web', appVersion: '1.8.0', country: 'US', city: 'Dallas', name: 'Sam', user: { id: '1003', name: 'Sam', email: 'sam@example.com', picture: null }, canReply: true },
];

/** Schema 14 — stats_listening: listening seconds by weekday × hour, per day, per person. */
function listening(days) {
  const cells = Array.from({ length: 7 }, (_, d) => Array.from({ length: 24 }, (_, h) => Math.max(0, Math.round(5400 * Math.sin((h - 6) / 24 * Math.PI) + (d === 0 || d === 6 ? 1500 : 0) + (h === 21 && d === 5 ? 4000 : 0)))));
  const byHour = Array.from({ length: 24 }, (_, h) => cells.reduce((t, r) => t + r[h], 0));
  const total = byHour.reduce((t, v) => t + v, 0);
  return {
    since: new Date(Date.now() - days * 86_400_000).toISOString(), total, people: 158, perPerson: Math.round(total / 158), perPersonDay: 2700,
    hourly: { cells, byHour, peak: { day: 5, hour: 21, seconds: cells[5][21] } },
    timeline: Array.from({ length: days }, (_, i) => ({ day: day(days - 1 - i), seconds: 90000 + i * 3000 + (i % 3) * 8000, people: 30 + (i % 5) * 3 })),
    buckets: { light: 70, regular: 66, heavy: 22 },
  };
}

export default {
  'GET /api/admin/feedback': (url) => {
    const status = url.searchParams.get('status') || 'new';
    const kind = url.searchParams.get('kind');
    const platform = url.searchParams.get('platform');
    let rows = feedbackRows.filter((r) => (!kind || r.kind === kind) && (!platform || r.platform === platform));
    const counts = { new: rows.filter((r) => r.status === 'new').length, read: rows.filter((r) => r.status === 'read').length, resolved: rows.filter((r) => r.status === 'resolved').length };
    counts.all = counts.new + counts.read + counts.resolved;
    if (status !== 'all') rows = rows.filter((r) => r.status === status);
    return { configured: true, total: rows.length, limit: 50, offset: 0, counts, rows };
  },
  'POST /api/admin/feedback': (url, b) => (b.action === 'reply' ? { ok: true, sent: 1, devices: 1 } : { ok: true, row: feedbackRows.find((r) => r.id === b.id) || null, deleted: 1 }),

  'GET /api/admin/analytics': (url) => {
    const view = url.searchParams.get('view');
    const days = Number(url.searchParams.get('days') || 7);
    const base = { configured: true, days, view };
    if (view === 'music' || view === 'rising') return { ...base, data: music };
    if (view === 'geo') return { ...base, data: {
      countries: [{ country: 'IN', listeners: 140, plays: 1620 }, { country: 'US', listeners: 12, plays: 90 }, { country: 'AE', listeners: 6, plays: 44 }],
      regions: [{ country: 'IN', region: 'Telangana', listeners: 70, plays: 820 }, { country: 'IN', region: 'Andhra Pradesh', listeners: 41, plays: 460 }, { country: 'IN', region: 'Tamil Nadu', listeners: 20, plays: 240 }, { country: 'US', region: 'Texas', listeners: 7, plays: 50 }],
      cities: [{ country: 'IN', region: 'Telangana', city: 'Hyderabad', listeners: 61, plays: 700 }, { country: 'IN', region: 'Andhra Pradesh', city: 'Vijayawada', listeners: 22, plays: 260 }, { country: 'IN', region: 'Tamil Nadu', city: 'Chennai', listeners: 18, plays: 220 }, { country: 'US', region: 'Texas', city: 'Dallas', listeners: 7, plays: 50 }],
    } };
    if (view === 'engagement') {
      const cells = Array.from({ length: 7 }, (_, d) => Array.from({ length: 24 }, (_, h) => Math.max(0, Math.round(30 * Math.sin((h - 6) / 24 * Math.PI) + (d === 0 || d === 6 ? 8 : 0)))));
      return { ...base, data: {
        byKind: [{ kind: 'play', n: 1700, listeners: 150 }, { kind: 'search', n: 600, listeners: 120 }],
        byPlatform: [{ platform: 'android', n: 1500, listeners: 110 }, { platform: 'web', n: 800, listeners: 50 }],
        hourly: { cells, peak: { day: 5, hour: 21, n: 30 } },
        perUser: { people: 158, playsPerPerson: 10.8, daysPerPerson: 3.1, buckets: { light: 90, regular: 55, heavy: 13 } },
        segments: { new7d: 19, returning7d: 80, inactive30d: 30, dormant: 12, power: 21 },
        total: 2300,
        timeline: Array.from({ length: days }, (_, i) => ({ day: day(days - 1 - i), plays: 180 + i * 7, listeners: 30 + (i % 5) * 3, newListeners: 2 + (i % 3), errors: 3, searches: 60, heartbeats: 0 })),
        platforms: [{ platform: 'android', users: 110 }, { platform: 'web', users: 48 }],
        versions: [],
        listening: listening(days),
      } };
    }
    if (view === 'listening') return { ...base, data: listening(days) };
    if (view === 'retention') return { ...base, data: Array.from({ length: 8 }, (_, i) => ({ week: day(7 * i), size: 30 - i * 2, d1: i ? 14 - i : 4, d7: i ? 9 - Math.min(i, 8) : 0, d30: i > 4 ? 6 - (i - 4) : 0, d1Of: i ? 30 - i * 2 : 9, d7Of: i ? 30 - i * 2 : 0, d30Of: i > 4 ? 30 - i * 2 : 0 })) };
    if (view === 'funnel') return { ...base, data: [{ id: 'open', label: 'Opened the app', listeners: 410 }, { id: 'play', label: 'Played a song', listeners: 352 }, { id: 'signin', label: 'Signed in with Google', listeners: 158 }, { id: 'return', label: 'Came back another day', listeners: 97 }] };
    if (view === 'skips') return { ...base, data: songs.map((s, i) => ({ id: s.id, title: s.title, artist: s.artist, image: s.image, plays: s.plays, skips: Math.round(s.plays * (0.6 - i * 0.08)), rate: Math.round((0.6 - i * 0.08) * 100) })) };
    return { ...base, data: {} };
  },

  'GET /api/admin/content': () => ({
    configured: true,
    reasons: ['Copyright', 'Wrong audio', 'Offensive', 'Other'],
    blocked: [
      { id: 7, kind: 'song', value: 's9', label: 'Fake Remix 2024', reason: 'Copyright', blockedBy: 'owner@example.com', createdAt: ago(60 * 30) },
      { id: 6, kind: 'album', value: 'al3', label: 'Unofficial Hits Vol 2', reason: 'Wrong audio', blockedBy: 'editor@example.com', createdAt: ago(60 * 24 * 4) },
      { id: 5, kind: 'keyword', value: 'nightcore', label: null, reason: 'Other', blockedBy: 'owner', createdAt: ago(60 * 24 * 20) },
    ],
    suggestions: songs,
  }),
  'POST /api/admin/content': (url, b) => ({ ok: true, row: { id: 99, kind: b.kind, value: b.value, label: b.label, reason: b.reason || null, blockedBy: 'owner@example.com', createdAt: new Date().toISOString() } }),

  'GET /api/admin/catalog-search': (url) => {
    const type = url.searchParams.get('type') || 'songs';
    const q = url.searchParams.get('q') || '';
    const items = [1, 2, 3, 4].map((i) => ({
      id: `${type.slice(0, 2)}${i}`, title: `${q || 'Song'} ${type === 'songs' ? '' : type.slice(0, -1) + ' '}${i}`.replace(/\s+/g, ' ').trim(), name: `${q} ${i}`,
      subtitle: type === 'artists' ? 'Artist' : 'Sid Sriram', image: IMG, type: type.slice(0, -1), language: 'telugu', year: '2024', duration: 214,
      album: type === 'songs' ? { id: 'al' + i, name: 'Album ' + i } : null, preview: null,
    }));
    return { items, type, source: 'mock', error: null };
  },
  'GET /api/admin/trends': (url) => {
    const view = url.searchParams.get('view');
    const days = Number(url.searchParams.get('days') || 7);
    if (view === 'trending') return { configured: true, days, view, data: trending(days) };
    if (view === 'search') return { configured: true, days, view, data: searches(days), pins: searchPins, synonyms: searchSynonyms };
    if (view === 'pins') return { configured: true, view, pins: searchPins, synonyms: searchSynonyms };
    return { __status: 400, error: 'unknown_view' };
  },
  'POST /api/admin/trends': (url, b) => {
    if (b.action === 'synonym') return { ok: true, key: 'search-synonyms', value: { ...searchSynonyms, [b.typed]: b.meant } };
    if (b.action === 'pin') return { ok: true, key: 'search-pins', value: { ...searchPins, [b.query]: b.song } };
    if (b.action === 'unpin') { const v = { ...searchPins }; delete v[b.query]; return { ok: true, key: 'search-pins', value: v }; }
    return { __status: 400, error: 'unknown_action' };
  },
  'GET /api/blocklist': () => ({ ids: ['s9'], albums: ['al3'], artists: [], keywords: ['nightcore'] }),
};
