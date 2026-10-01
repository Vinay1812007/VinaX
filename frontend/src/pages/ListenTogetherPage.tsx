import { useEffect, useState, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { usePageTitle } from '@/hooks/usePageTitle';
import { PageHeader } from '@/components/PageHeader';
import { SectionHeader } from '@/components/SectionHeader';
import { StepList } from '@/features/settings/StepList';
import { ArtistAvatar } from '@/features/stats/artwork';
import { usePlayerStore, useCurrentSong } from '@/store/playerStore';
import { createRoom, updateRoom, heartbeat, leaveRoom, endRoom, getRoom, requestSong, sendReaction, REACTION_EMOJI, type RoomReaction, type RoomTrack } from '@/services/together';
import { searchSongs } from '@/services/api';
import { bestImage } from '@/utils/images';
import type { Song } from '@/types';
import { shareLink } from '@/utils/share';
import { toast } from '@/store/toastStore';
import { PlusIcon, UsersIcon } from '@/components/Icons';
import '@/styles/pages/secondary.css';

type Mode = 'idle' | 'host' | 'guest';

function AddSong({ label, onPick }: { label: string; onPick: (s: Song) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Song[]>([]);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      return;
    }
    const t = window.setTimeout(() => {
      searchSongs(term, 6).then(setResults).catch(() => setResults([]));
    }, 350);
    return () => window.clearTimeout(t);
  }, [q]);
  return (
    <section className="vx-sec-block" aria-label={label}>
      <h2 className="vx-sec-title">{label}</h2>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search songs to add"
        aria-label={label}
        type="search"
        className="vx-sec-field"
      />
      {results.length > 0 && (
        <ul className="vx-group mt-3">
          {results.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                aria-label={`Add ${s.title}`}
                onClick={() => {
                  onPick(s);
                  setQ('');
                  setResults([]);
                }}
                className="vx-row"
              >
                <img src={bestImage(s.images, 100)} alt="" className="vx-row-art" loading="lazy" />
                <span className="vx-row-main">
                  <span className="vx-row-label truncate-1">{s.title}</span>
                  <span className="vx-row-hint truncate-1">{s.subtitle}</span>
                </span>
                <PlusIcon className="w-5 h-5 text-ink-300 shrink-0" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function ListenTogetherPage() {
  usePageTitle('Listen Together');
  const [params] = useSearchParams();
  const current = useCurrentSong();
  const [mode, setMode] = useState<Mode>('idle');
  const [code, setCode] = useState('');
  const [joinCode, setJoinCode] = useState((params.get('code') ?? '').toUpperCase());
  const [members, setMembers] = useState<string[]>([]);
  const [listenerCount, setListenerCount] = useState(1);
  const [hostName, setHostName] = useState<string | null>(null);
  const [queue, setQueue] = useState<RoomTrack[]>([]);
  const [busy, setBusy] = useState(false);

  // Arriving via an invite link (?code=…) joins automatically — one tap on
  // mobile instead of copy-the-code-then-press-Join. Manual typing never
  // triggers this: it only fires for a code that came in the URL.
  const autoJoined = useRef(false);
  // Explicit deps so this only runs when the ?code URL param, current mode,
  // or busy flag actually changes — not on every render (audit finding M2).
  // `join` is intentionally omitted from deps: it depends on component state
  // that changes on every keystroke in the join input, but this effect only
  // ever runs once per link-visit thanks to the autoJoined ref.
  useEffect(() => {
    const linkCode = (params.get('code') ?? '').trim();
    if (autoJoined.current || !linkCode || mode !== 'idle' || busy) return;
    autoJoined.current = true;
    void join();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, mode, busy]);

  // Host: broadcast player state on change + every 5s; refresh members.
  useEffect(() => {
    if (mode !== 'host' || !code) return;
    let last = '';
    let lastT = 0;
    let lastW = Date.now();
    const requestedBy = new Map<string, string>();
    const consumed = new Set<string>();
    const push = () => {
      const s = usePlayerStore.getState();
      const song = s.queue[s.index] ?? null;
      const up = s.queue.slice(s.index + 1, s.index + 9).map((sg) => ({ song: sg, by: requestedBy.get(sg.id) ?? null }));
      setQueue(up);
      void updateRoom(code, song, s.currentTime, s.isPlaying, up, [...consumed]);
    };
    const unsub = usePlayerStore.subscribe((s) => {
      const song = s.queue[s.index] ?? null;
      const key = (song?.id ?? '') + '|' + String(s.isPlaying) + '|' + s.queue.length;
      // Seeks change neither song nor playing — catch them as a jump against
      // natural time progression so guests re-sync immediately, not in 5s.
      const wall = Date.now();
      const expected = lastT + (s.isPlaying ? (wall - lastW) / 1000 : 0);
      const jumped = Math.abs(s.currentTime - expected) > 2;
      lastT = s.currentTime;
      lastW = wall;
      if (key !== last || jumped) {
        last = key;
        push();
      }
    });
    push();
    void heartbeat(code);
    const iv = window.setInterval(() => {
      void heartbeat(code);
      void getRoom(code).then((d) => {
        if (!d) return;
        // Names come back only for the authorized host; the count always does.
        setMembers(d.members ?? []);
        setListenerCount(d.memberCount ?? d.members?.length ?? 1);
        absorbRef.current(d.reactions);
        // Adopt guest song requests into the live queue, with attribution.
        for (const t of d.room?.requests ?? []) {
          if (!t.song || consumed.has(t.song.id)) continue;
          consumed.add(t.song.id);
          requestedBy.set(t.song.id, t.by ?? 'A guest');
          usePlayerStore.getState().enqueue(t.song);
          toast(`${t.by ?? 'A guest'} added “${t.song.title}”`);
        }
        push();
      });
    }, 5000);
    return () => {
      unsub();
      window.clearInterval(iv);
    };
  }, [mode, code]);

  // Guest: poll every 2s and follow the host (drift-compensated).
  // A correction cooldown prevents flapping when the guest happens to buffer
  // right after a seek — the local player briefly lags, we correct, the seek
  // makes it buffer more, and we'd overcorrect on the next tick.
  const lastCorrectionRef = useRef(0);
  useEffect(() => {
    if (mode !== 'guest' || !code) return;
    usePlayerStore.getState().setFollowMode(true);
    let alive = true;
    // Anchor the host position on updated_at *changes*, timed with our own
    // clock — immune to device clock skew; only network latency remains.
    let anchorU = '';
    let anchorAt = 0;
    let anchorPos = 0;
    const tick = async () => {
      const d = await getRoom(code);
      if (!alive) return;
      if (d && !d.room) {
        toast('The session has ended');
        setMode('idle');
        setCode('');
        setMembers([]);
        setListenerCount(1);
        setHostName(null);
        setQueue([]);
        return;
      }
      if (!d) return;
      setMembers(d.members ?? []);
      setListenerCount(d.memberCount ?? d.members?.length ?? 1);
      absorbRef.current(d.reactions);
      setHostName(d.room?.host_name ?? null);
      setQueue(d.room?.queue ?? []);
      const r = d.room;
      if (r && r.song) {
        if (r.updated_at !== anchorU) {
          anchorU = r.updated_at;
          anchorAt = Date.now();
          anchorPos = r.position;
        }
        const cur = usePlayerStore.getState();
        if ((cur.queue[cur.index]?.id ?? null) !== r.song.id) {
          cur.playSong(r.song);
          // Let the new track load; fine alignment lands on the next tick.
          void heartbeat(code);
          return;
        }
        const elapsed = r.playing ? (Date.now() - anchorAt) / 1000 + 0.35 : 0;
        const expected = Math.max(0, anchorPos + elapsed);
        const st = usePlayerStore.getState();
        // Cool off between corrections so a buffering guest doesn't oscillate.
        const canCorrect = Date.now() - lastCorrectionRef.current > 4000 && !st.isBuffering;
        if (st.isPlaying !== r.playing && canCorrect) {
          // togglePlay reads current state so it lands in the right direction;
          // cool-down + !isBuffering above prevent flapping.
          st.togglePlay();
          lastCorrectionRef.current = Date.now();
        } else if (canCorrect && Math.abs(st.currentTime - expected) > 1.2) {
          st.seek(expected);
          lastCorrectionRef.current = Date.now();
        }
      }
      void heartbeat(code);
    };
    void tick();
    const iv = window.setInterval(() => void tick(), 2000);
    return () => {
      alive = false;
      window.clearInterval(iv);
      usePlayerStore.getState().setFollowMode(false);
    };
  }, [mode, code]);

  const host = async () => {
    setBusy(true);
    const r = await createRoom(current ?? null);
    setBusy(false);
    if (!r.code) {
      // Honest, cause-specific messages — the generic toast hid a server
      // schema gap for weeks.
      toast(
        r.reason === 'needs_migration' || r.reason === 'not_configured'
          ? 'Sessions aren’t set up on the server yet — the owner needs to run the rooms database update.'
          : r.reason === 'rate_limited'
            ? 'Too many tries — wait a minute and try again.'
            : 'Could not start a session — check your connection and try again.',
      );
      return;
    }
    setCode(r.code);
    setMode('host');
  };

  const join = async () => {
    const c = joinCode.trim().toUpperCase();
    if (c.length < 4) {
      toast('Enter a valid room code');
      return;
    }
    setBusy(true);
    const d = await getRoom(c);
    setBusy(false);
    if (!d || !d.room) {
      toast('Room not found');
      return;
    }
    // Start playback inside this click — the browser's autoplay policy is
    // satisfied once, and following then only adjusts an unlocked player.
    if (d.room.song) {
      usePlayerStore.getState().playSong(d.room.song);
      if (!d.room.playing) window.setTimeout(() => usePlayerStore.getState().togglePlay(), 600);
    }
    setCode(c);
    setMode('guest');
  };

  const leave = () => {
    if (code) void (mode === 'host' ? endRoom(code) : leaveRoom(code));
    setMode('idle');
    setCode('');
    setMembers([]);
    setHostName(null);
    setQueue([]);
  };

  const inviteLink = `/together?code=${code}`;

  // Package D11 — emoji reactions. Every member's poll carries the room's
  // recent reactions (anonymous: emoji + stamp only); new ones float up over
  // the session card. Your own tap floats instantly, and lastReactRef advances
  // so the next poll doesn't replay it.
  const [floats, setFloats] = useState<Array<{ id: number; e: string; left: number }>>([]);
  const floatSeq = useRef(0);
  const lastReactRef = useRef(Date.now());
  const spawnFloats = (emojis: string[]): void => {
    const batch = emojis.slice(0, 6).map((e) => ({
      id: ++floatSeq.current,
      e,
      left: 10 + Math.random() * 78,
    }));
    if (!batch.length) return;
    setFloats((p) => [...p, ...batch]);
    const ids = new Set(batch.map((b) => b.id));
    window.setTimeout(() => setFloats((p) => p.filter((f) => !ids.has(f.id))), 2600);
  };
  // Routed through a ref so the poll effects (whose dep arrays are deliberately
  // minimal) always call the latest closure without re-attaching.
  const absorbRef = useRef<(list?: RoomReaction[]) => void>(() => undefined);
  const absorbReactions = (list?: RoomReaction[]): void => {
    if (!list?.length) return;
    const fresh = list
      .map((r) => ({ e: r.e, t: Date.parse(r.at) }))
      .filter((r) => Number.isFinite(r.t) && r.t > lastReactRef.current);
    if (!fresh.length) return;
    lastReactRef.current = Math.max(...fresh.map((r) => r.t));
    spawnFloats(fresh.map((r) => r.e));
  };
  absorbRef.current = absorbReactions;
  const react = (emoji: string): void => {
    lastReactRef.current = Date.now(); // don't re-float our own from the poll
    spawnFloats([emoji]);
    void sendReaction(code, emoji).then((ok) => {
      if (!ok) toast('Reactions aren’t enabled on this server yet');
    });
  };

  // A QR of the invite link, so a friend in the room joins by
  // pointing their camera instead of typing a code. Generated locally.
  const [qr, setQr] = useState('');
  useEffect(() => {
    if (mode !== 'host' || !code) {
      setQr('');
      return;
    }
    let alive = true;
    void import('qrcode')
      .then(({ toDataURL }) =>
        toDataURL(`${window.location.origin}${inviteLink}`, { margin: 1, width: 240, errorCorrectionLevel: 'M' }),
      )
      .then((url) => {
        if (alive) setQr(url);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [mode, code, inviteLink]);

  if (mode === 'idle') {
    return (
      <div className="vx-sec">
        <PageHeader title="Listen Together" subtitle="Play the same music in sync with friends — a room code is all it takes." />

        <div className="vx-two">
          <section className="vx-panel" aria-labelledby="vx-lt-start">
            <span className="vx-row-lead mb-4" aria-hidden><UsersIcon className="w-5 h-5" /></span>
            <h2 id="vx-lt-start" className="vx-sec-title !mb-1">Host a session</h2>
            <p className="text-[14px] text-ink-400 mb-5">Whatever you play, everyone hears.</p>
            <StepList
              label="How hosting works"
              steps={[
                { title: 'Start a session', note: 'You get a room code and a QR.', state: busy ? 'current' : 'upcoming' },
                { title: 'Share the code or the invite link', note: 'Friends join from any browser or the app.', state: 'upcoming' },
                { title: 'Play as usual', note: 'Everyone’s player follows yours.', state: 'upcoming' },
              ]}
            />
            <button type="button" onClick={() => void host()} disabled={busy} className="mt-6 w-full !min-h-[48px] rounded-full btn-primary">
              {busy ? 'Starting…' : 'Start session'}
            </button>
          </section>

          <section className="vx-panel" aria-labelledby="vx-lt-join">
            <span className="vx-row-lead mb-4" aria-hidden><PlusIcon className="w-5 h-5" /></span>
            <h2 id="vx-lt-join" className="vx-sec-title !mb-1">Join a session</h2>
            <p className="text-[14px] text-ink-400 mb-5">Type the code the host shared. An invite link joins by itself.</p>
            <label className="vx-label" htmlFor="vx-lt-code">Room code</label>
            <div className="flex gap-2">
              <input
                id="vx-lt-code"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void join();
                }}
                placeholder="ABCDEF"
                aria-label="Room code"
                maxLength={8}
                autoCapitalize="characters"
                autoCorrect="off"
                className="vx-sec-field flex-1 min-w-0 tracking-[0.2em] font-bold tabular-nums"
              />
              <button type="button" onClick={() => void join()} disabled={busy} className="vx-sec-pill !min-h-[48px] px-6 shrink-0">
                Join
              </button>
            </div>
            <p className="vx-sec-foot">Your player follows the host. Songs you add join the shared queue.</p>
          </section>
        </div>
      </div>
    );
  }

  const people = members.length ? members : ['You'];
  return (
    <div className="vx-sec is-narrow">
      <PageHeader title="Listen Together" />

      <section className="vx-sec-block vx-panel text-center overflow-hidden" aria-label="Room">
        {/* D11 — floating reactions from everyone in the room. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 z-10">
          {floats.map((f) => (
            <span key={f.id} className="vx-react" style={{ left: `${f.left}%` }}>{f.e}</span>
          ))}
        </div>
        <p className="vx-live-label mb-3" role="status">
          <span className="vx-status-dot" aria-hidden />
          {mode === 'host' ? 'Live · you’re hosting' : `Live · following ${hostName ?? 'the host'}`}
        </p>
        <p className="text-[13px] font-semibold text-ink-400">Room code</p>
        <p className="vx-code mt-1">{code}</p>
        {mode === 'host' && (
          <>
            {qr && <img src={qr} alt={`QR code to join room ${code}`} className="vx-qr is-small mt-6" />}
            <div className="flex flex-wrap items-center justify-center gap-2 mt-6">
              <button
                type="button"
                onClick={() => void shareLink(inviteLink, 'Listen with me on VinaX').then((r) => toast(r === 'copied' ? 'Invite copied' : 'Invite shared'))}
                className="px-5 rounded-full btn-primary text-sm"
              >
                Share invite
              </button>
              <button type="button" onClick={() => void navigator.clipboard?.writeText(code).then(() => toast('Code copied'))} className="vx-sec-pill">
                Copy code
              </button>
            </div>
          </>
        )}
        {/* D11 — react to what's playing; everyone in the room sees it rise. */}
        <div className="flex items-center justify-center gap-2 mt-6" role="group" aria-label="React to the music">
          {REACTION_EMOJI.map((e) => (
            <button key={e} type="button" onClick={() => react(e)} aria-label={`React ${e}`} className="vx-react-btn">
              {e}
            </button>
          ))}
        </div>
      </section>

      {current && (
        <section className="vx-sec-block" aria-label="Now playing">
          <SectionHeader title="Now playing" explanation={mode === 'host' ? 'Everyone hears this.' : 'Playing in sync with the host.'} />
          <div className="flex items-center gap-4">
            <img src={bestImage(current.images, 300)} alt="" className="w-20 h-20 rounded-[var(--vx-radius-card)] object-cover shrink-0 shadow-[var(--vx-art-shadow)]" />
            <span className="min-w-0">
              <span className="block text-[17px] font-bold text-ink-100 truncate-1">{current.title}</span>
              <span className="block mt-1 text-[14px] text-ink-400 truncate-1">{current.subtitle}</span>
            </span>
          </div>
        </section>
      )}

      <AddSong
        label={mode === 'host' ? 'Add to the queue' : 'Add a song for everyone'}
        onPick={(s) => {
          if (mode === 'host') {
            usePlayerStore.getState().enqueue(s);
            toast(`Added “${s.title}”`);
          } else {
            void requestSong(code, s);
            toast(`Sent — “${s.title}” joins the queue in a moment`);
          }
        }}
      />

      {queue.length > 0 && (
        <section className="vx-sec-block" aria-label="Up next">
          <SectionHeader title="Up next" />
          <ul className="vx-group">
            {queue.map((t, i) => (
              <li key={`${t.song.id}-${i}`} className="vx-row">
                <img src={bestImage(t.song.images, 100)} alt="" className="vx-row-art" loading="lazy" />
                <span className="vx-row-main">
                  <span className="vx-row-label truncate-1">{t.song.title}</span>
                  <span className="vx-row-hint truncate-1">{t.by ? `Added by ${t.by}` : t.song.subtitle}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="vx-sec-block" aria-labelledby="vx-lt-people">
        <h2 id="vx-lt-people" className="vx-sec-title tabular-nums">{Math.max(listenerCount, members.length, 1)} listening</h2>
        {/* Names render only when the server shared them (the host's view);
            guests see the honest count above — never each other's names. */}
        <ul className="vx-people">
          {people.map((m, i) => (
            <li key={`${m}-${i}`} className="vx-person">
              <ArtistAvatar name={m} size={36} />
              {m}
            </li>
          ))}
        </ul>
        <p className="vx-sec-foot">
          {mode === 'host'
            ? 'Play, pause, and skip as usual — everyone in the room follows you.'
            : 'The host controls playback — your player follows automatically. Songs you add join the shared queue for everyone.'}
        </p>
      </section>

      <button type="button" onClick={leave} className="vx-sec-pill is-danger">
        {mode === 'host' ? 'End for all' : 'Leave session'}
      </button>
    </div>
  );
}
