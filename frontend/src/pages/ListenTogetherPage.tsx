import { useEffect, useState, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { usePageTitle } from '@/hooks/usePageTitle';
import { PageHeader } from '@/components/PageHeader';
import { usePlayerStore, useCurrentSong } from '@/store/playerStore';
import { createRoom, updateRoom, heartbeat, leaveRoom, endRoom, getRoom, requestSong, sendReaction, REACTION_EMOJI, type RoomReaction, type RoomTrack } from '@/services/together';
import { searchSongs } from '@/services/api';
import { bestImage } from '@/utils/images';
import type { Song } from '@/types';
import { shareLink } from '@/utils/share';
import { toast } from '@/store/toastStore';
import { PlusIcon, UsersIcon } from '@/components/Icons';

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
    <div className="glass-panel rounded-2xl p-4 mb-4">
      <p className="text-sm font-bold mb-2 flex items-center gap-1.5">
        <PlusIcon className="w-4 h-4 text-ember-400" /> {label}
      </p>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search songs to add…"
        className="glass-input w-full px-4 py-2.5 rounded-xl text-sm"
      />
      {results.length > 0 && (
        <ul className="mt-2 divide-y divide-white/5">
          {results.map((s) => (
            <li key={s.id}>
              <button
                onClick={() => {
                  onPick(s);
                  setQ('');
                  setResults([]);
                }}
                className="w-full flex items-center gap-3 py-2 px-1.5 text-left rounded-lg hover:bg-ink-800/40 transition-colors"
              >
                <img src={bestImage(s.images, 100)} alt="" className="w-9 h-9 rounded-lg object-cover" loading="lazy" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold truncate">{s.title}</span>
                  <span className="block text-xs text-ink-400 truncate">{s.subtitle}</span>
                </span>
                <PlusIcon className="w-4 h-4 text-ink-400 shrink-0" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
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
      <div className="max-w-xl mx-auto">
        <PageHeader title="Listen Together" />
        <p className="text-sm text-ink-400 -mt-2 mb-6">Play the same music in sync with friends. Start a session and share the code, or join one.</p>

        <div className="glass-panel rounded-2xl p-5 mb-4">
          <h2 className="text-base font-bold mb-1 flex items-center gap-2"><UsersIcon className="w-5 h-5 text-ember-400" /> Start a session</h2>
          <p className="text-xs text-ink-400 mb-4">You become the host — whatever you play, everyone hears.</p>
          <button onClick={() => void host()} disabled={busy} className="px-5 py-2.5 rounded-full btn-primary">
            {busy ? 'Starting…' : 'Start session'}
          </button>
        </div>

        <div className="glass-panel rounded-2xl p-5">
          <h2 className="text-base font-bold mb-3">Join a session</h2>
          <div className="flex gap-2">
            <input
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="Room code"
              maxLength={8}
              className="glass-input flex-1 px-4 py-2.5 rounded-xl text-sm tracking-widest font-bold"
            />
            <button onClick={() => void join()} disabled={busy} className="px-5 py-2.5 rounded-full bg-ink-700 text-ink-100 font-bold hover:bg-ink-600 disabled:opacity-60">
              Join
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto">
      <PageHeader title="Listen Together" />

      <div className="glass-panel rounded-2xl p-6 text-center mb-4 relative overflow-hidden">
        {/* D11 — floating reactions from everyone in the room. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 z-10">
          {floats.map((f) => (
            <span key={f.id} className="vx-react" style={{ left: `${f.left}%` }}>{f.e}</span>
          ))}
        </div>
        <p className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-ember-300 mb-2 flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-ember-400 animate-pulse" aria-hidden />{mode === 'host' ? 'Live session · You\u2019re hosting' : `Following ${hostName ?? 'the host'}`}</p>
        <p className="text-4xl font-extrabold tracking-[0.3em] text-ember-400">{code}</p>
        {/* D11 — react to what's playing; everyone in the room sees it rise. */}
        <div className="flex items-center justify-center gap-1.5 mt-4" role="group" aria-label="React to the music">
          {REACTION_EMOJI.map((e) => (
            <button
              key={e}
              onClick={() => react(e)}
              aria-label={`React ${e}`}
              className="w-10 h-10 rounded-full bg-white/[0.06] border border-glass-strong text-lg hover:bg-white/[0.14] active:scale-90 transition"
            >
              {e}
            </button>
          ))}
        </div>
        {mode === 'host' && (
          <>
            {qr && (
              <img
                src={qr}
                alt={`QR code to join room ${code}`}
                className="mx-auto mt-4 w-36 h-36 rounded-xl bg-white p-1.5"
              />
            )}
            <div className="flex items-center justify-center gap-2 mt-4">
              <button
                onClick={() => void shareLink(inviteLink, 'Listen with me on VinaX').then((r) => toast(r === 'copied' ? 'Invite copied' : 'Invite shared'))}
                className="px-4 py-2 rounded-full btn-primary text-sm font-bold"
              >
                Share invite
              </button>
              <button onClick={() => void navigator.clipboard?.writeText(code).then(() => toast('Code copied'))} className="px-4 py-2 rounded-full border border-ink-600 text-sm font-semibold">
                Copy code
              </button>
            </div>
          </>
        )}
      </div>

      {current && (
        <div className="glass-panel rounded-2xl p-4 mb-4 flex items-center gap-3">
          <img src={bestImage(current.images, 200)} alt="" className="w-14 h-14 rounded-xl object-cover" />
          <span className="min-w-0 flex-1">
            <span className="block text-[10px] uppercase tracking-widest text-ink-400 mb-0.5">Now playing</span>
            <span className="block text-sm font-bold truncate">{current.title}</span>
            <span className="block text-xs text-ink-400 truncate">{current.subtitle}</span>
          </span>
        </div>
      )}

      <AddSong
        label={mode === 'host' ? 'Add to the queue' : 'Add a song — plays for everyone'}
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
        <div className="glass-card rounded-2xl p-4 mb-4">
          <p className="text-xs text-ink-400 mb-2">Up next</p>
          <ul className="divide-y divide-white/5">
            {queue.map((t, i) => (
              <li key={`${t.song.id}-${i}`} className="flex items-center gap-3 py-2">
                <img src={bestImage(t.song.images, 100)} alt="" className="w-9 h-9 rounded-lg object-cover" loading="lazy" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold truncate">{t.song.title}</span>
                  <span className="block text-xs text-ink-400 truncate">{t.by ? `Added by ${t.by}` : t.song.subtitle}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="glass-card rounded-2xl p-4 mb-4">
        <p className="text-xs text-ink-400 mb-2 flex items-center gap-1.5"><UsersIcon className="w-4 h-4" /> {Math.max(listenerCount, members.length, 1)} listening</p>
        <div className="flex flex-wrap gap-2">
          {/* Names render only when the server shared them (the host's view);
              guests see the honest count above — never each other's names. */}
          {(members.length ? members : ['You']).map((m, i) => (
            <span key={`${m}-${i}`} className="glass-card rounded-full px-3 py-1 text-xs">{m}</span>
          ))}
        </div>
      </div>

      <p className="text-xs text-ink-500 mb-4 leading-relaxed">
        {mode === 'host'
          ? 'Play, pause, and skip as usual — everyone in the room follows you.'
          : 'The host controls playback — your player follows automatically. Songs you add join the shared queue for everyone.'}
      </p>

      <button onClick={leave} className="px-5 py-2.5 rounded-full border border-ink-600 text-sm font-semibold hover:border-red-400 hover:text-red-300">
        {mode === 'host' ? 'End for all' : 'Leave session'}
      </button>
    </div>
  );
}
