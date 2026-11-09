// Mock answers for Automatic Notifications (schema 18): the weekly recap,
// win-back and new-release pushes the Worker sends on its own.
const now = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const H = 3600e3;

const KINDS = {
  recap: { label: 'Weekly recap', when: 'Sunday from 7 PM in each person’s own time (a missed Sunday is caught up Monday morning)', cap: 'once a week, only to people who listened 30 minutes or more that week', rule: null },
  winback: { label: 'Win-back', when: 'in the daytime (9 AM – 9 PM, their time) once nothing has come from any of their devices for 7 days', cap: 'one a week per person; no more after three in a row go unanswered', rule: 'reminders' },
  release: { label: 'New releases', when: 'in the daytime, within a day and a half of a release by one of their top three artists', cap: 'one a day per person, never the same song twice', rule: 'releases' },
};

const PEOPLE = [
  ['110000000000000000010', 'Asha Rao', 'asha.rao@gmail.com'],
  ['110000000000000000011', 'Vikram Singh', 'vikram.s@gmail.com'],
  ['110000000000000000012', 'Meena Iyer', 'meena.iyer@gmail.com'],
  ['110000000000000000013', 'Rahul Verma', 'rahulv@gmail.com'],
  ['110000000000000000014', 'Kavya Reddy', 'kavya.r@gmail.com'],
];
const person = (i, extra) => ({ id: PEOPLE[i][0], name: PEOPLE[i][1], email: PEOPLE[i][2], picture: null, ...extra });

const RUNS = [
  { kind: 'release', notificationId: 61, at: iso(now - 5 * H), people: 3, sent: 4, devices: 5, opened: 1 },
  { kind: 'winback', notificationId: 60, at: iso(now - 28 * H), people: 2, sent: 2, devices: 2, opened: 0 },
  { kind: 'recap', notificationId: 59, at: iso(now - 2 * 24 * H), people: 5, sent: 7, devices: 8, opened: 3 },
  { kind: 'release', notificationId: 58, at: iso(now - 3 * 24 * H), people: 1, sent: 1, devices: 1, opened: 1 },
  { kind: 'recap', notificationId: 50, at: iso(now - 9 * 24 * H), people: 4, sent: 5, devices: 6, opened: 2 },
];

const LATEST = [
  person(0, { kind: 'release', at: iso(now - 5 * H), title: 'New from Anirudh', body: '“Chuttamalle” is out now. Tap to listen.', link: '/song/abc123', sent: 2, devices: 2, facts: { songIds: ['abc123'] } }),
  person(1, { kind: 'release', at: iso(now - 5 * H), title: 'New from Arijit Singh', body: '“Tum Se” is out now. Tap to listen.', link: '/song/def456', sent: 1, devices: 2, facts: { songIds: ['def456'] } }),
  person(2, { kind: 'release', at: iso(now - 5 * H), title: '2 new songs from Anirudh and Sid Sriram', body: '“Chuttamalle” by Anirudh, “Srivalli” by Sid Sriram. Tap to listen.', link: '/song/abc123', sent: 1, devices: 1, facts: { songIds: ['abc123', 'ghi789'] } }),
  person(3, { kind: 'winback', at: iso(now - 28 * H), title: 'New from Arijit Singh', body: '“Kesariya” and more from Arijit Singh are waiting for you on VinaX.', link: '/song/kes1', sent: 1, devices: 1, facts: { topArtist: 'Arijit Singh' } }),
  person(4, { kind: 'winback', at: iso(now - 28 * H), title: 'Kavya, your music missed you', body: 'Songs from Sid Sriram are waiting for you. Tap to pick up where you left off.', link: '/', sent: 1, devices: 1, facts: { topArtist: 'Sid Sriram' } }),
  ...PEOPLE.map((p, i) => person(i, { kind: 'recap', at: iso(now - 2 * 24 * H), title: 'Your week in VinaX', body: `${3 - (i % 3)} h ${12 + i * 5} min of music · top artist Anirudh · most played “Vaathi Coming”. Tap for your week.`, link: '/weekly', sent: i < 4 ? 1 : 0, devices: 1, facts: { seconds: 11520 - i * 600 } })),
];

const BY_DAY = Array.from({ length: 14 }, (_, i) => {
  const d = new Date(now - (13 - i) * 24 * H).toISOString().slice(0, 10);
  return { day: d, recap: i === 4 || i === 11 ? 4 + (i % 2) : 0, winback: i === 12 ? 2 : 0, release: i === 13 ? 3 : i === 10 ? 1 : 0 };
});

function summary(days) {
  const runs = RUNS.filter((r) => now - Date.parse(r.at) <= days * 24 * H);
  const kinds = {};
  for (const k of Object.keys(KINDS)) {
    const mine = runs.filter((r) => r.kind === k);
    kinds[k] = { runs: mine.length, people: mine.reduce((t, r) => t + r.people, 0), sent: mine.reduce((t, r) => t + r.sent, 0), opened: mine.reduce((t, r) => t + r.opened, 0), lastAt: mine[0]?.at ?? null };
  }
  return { days, kinds, runs, latest: LATEST, byDay: BY_DAY.slice(-days) };
}

export default {
  'GET /api/admin/outreach': (url) => {
    const days = Number(url.searchParams.get('days')) || 14;
    return {
      configured: true,
      settings: { recap: true, winback: true, release: true },
      rules: { reminders: true, releases: true, minGapHours: 12, quiet: { enabled: true, start: '22:00', end: '08:00' } },
      kinds: KINDS,
      job: { at: iso(now - 40 * 60e3), ok: true, summary: { recap: { candidates: 12, due: 0, people: 0, sent: 0, skipped: { notTheirEveningYet: 12 } }, winback: { candidates: 3, due: 1, people: 1, sent: 1, skipped: { nudgedThisWeek: 2 } }, release: { candidates: 30, due: 30, people: 3, sent: 4, found: 6, skipped: { nothingNewForThem: 27 } } } },
      summary: summary(days),
    };
  },
  'POST /api/admin/outreach': (url, body) => {
    if (body?.action === 'preview') return { ok: true, devices: 2, sent: 2, real: true, message: { title: `[Preview] ${KINDS[body.kind]?.label ?? 'Message'}`, body: 'Preview', link: '/' } };
    if (body?.action === 'run') return { ok: true, startedAt: iso(now), ms: 1200, summary: { recap: 'off', winback: { candidates: 3, due: 0, people: 0, sent: 0, skipped: { nudgedThisWeek: 3 } }, release: { candidates: 30, due: 30, people: 2, sent: 2, skipped: {} } } };
    return { __status: 400, error: 'unknown_action' };
  },
};
