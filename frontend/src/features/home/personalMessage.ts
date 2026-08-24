import { languageLabel } from '@/constants/languages';

/**
 * Personalized home message — a different greeting for every listener, every
 * day, computed ENTIRELY on-device from their own name, history, streak and
 * taste profile (no server, no cohorts, nothing uploaded — the invariant).
 *
 * Pure and injectable: the page gathers the signals, this ranks which
 * message matters most right now. Priority runs from "rare and personal"
 * (festival, comeback, streak) down to a deterministic daily rotation so the
 * default greeting still changes day to day — but never mid-session.
 */
export interface MessageInput {
  name: string;
  hour: number; // 0–23 local
  dayOfWeek: number; // 0 = Sunday
  dateKey: string; // YYYY-MM-DD — pins the daily rotation
  totalPlays: number; // lifetime local history length
  weekPlays: number;
  weekMinutes: number;
  streakDays: number;
  daysSinceLastListen: number; // Infinity when never
  topLanguage: string | null; // profile language id, e.g. 'telugu'
  topArtist: string | null; // display name
  festivalId: string | null; // e.g. 'diwali'
}

export interface PersonalMessage {
  title: string;
  subtitle: string;
}

/** Tiny deterministic hash — same (name, day) → same pick all day. */
function seed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

const FESTIVAL_NAMES: Record<string, string> = {
  sankranti: 'Sankranti',
  holi: 'Holi',
  eid: 'Eid',
  onam: 'Onam',
  ganesh: 'Ganesh Chaturthi',
  dussehra: 'Dussehra',
  diwali: 'Diwali',
  christmas: 'Christmas',
};

function dayPartTitle(hour: number, name: string): string {
  const who = name ? `, ${name}` : '';
  if (hour >= 5 && hour < 12) return `Good morning${who}`;
  if (hour >= 12 && hour < 17) return `Good afternoon${who}`;
  if (hour >= 17 && hour < 23) return `Good evening${who}`;
  return `Late night waves${who}`;
}

export function personalMessage(i: MessageInput): PersonalMessage {
  const name = i.name.trim();
  const lang = i.topLanguage ? languageLabel(i.topLanguage) : null;

  // 1 · Festival days beat everything — they're rare and shared.
  if (i.festivalId && FESTIVAL_NAMES[i.festivalId]) {
    return {
      title: `Happy ${FESTIVAL_NAMES[i.festivalId]}${name ? `, ${name}` : ''}!`,
      subtitle: 'Festival specials are on your home today.',
    };
  }

  // 2 · First open ever — set expectations honestly.
  if (i.totalPlays === 0) {
    return {
      title: `Welcome${name ? `, ${name}` : ''}`,
      subtitle: 'Play anything — VinaX learns your taste from the very first song, right on this device.',
    };
  }

  // 3 · Coming back after a real gap.
  if (Number.isFinite(i.daysSinceLastListen) && i.daysSinceLastListen >= 7) {
    return {
      title: `Welcome back${name ? `, ${name}` : ''}`,
      subtitle: lang
        ? `Fresh ${lang} finds landed while you were away.`
        : 'Fresh finds landed while you were away.',
    };
  }

  // 4 · An active streak is worth celebrating (3+ days).
  if (i.streakDays >= 3) {
    return {
      title: `Day ${i.streakDays} streak${name ? `, ${name}` : ''} 🔥`,
      subtitle: lang ? `${lang} picks are queued to keep it alive.` : 'Today’s picks are queued to keep it alive.',
    };
  }

  // 5 · Friday/Saturday evening has its own energy.
  if ((i.dayOfWeek === 5 || i.dayOfWeek === 6) && i.hour >= 18 && i.hour < 23) {
    return {
      title: `${i.dayOfWeek === 5 ? 'Friday' : 'Saturday'} night${name ? `, ${name}` : ''}`,
      subtitle: 'Party picks are running hot — turn it up.',
    };
  }

  // 6 · Deep late night gets calm, not confetti.
  if (i.hour >= 23 || i.hour < 5) {
    return {
      title: dayPartTitle(i.hour, name),
      subtitle: 'Gentle picks for the quiet hours.',
    };
  }

  // 7 · A heavy listening week deserves a nod.
  if (i.weekMinutes >= 180) {
    return {
      title: dayPartTitle(i.hour, name),
      subtitle: `${i.weekMinutes} minutes this week — your mixes get sharper with every play.`,
    };
  }

  // 8 · Default: deterministic daily rotation, personal where the profile
  //     allows. Same message all day; different tomorrow; different per user.
  const pool: string[] = [
    lang ? `Your ${lang} favorites are waiting.` : 'Your favorites are waiting.',
    i.topArtist ? `More ${i.topArtist} today? Your mixes think so.` : 'Your Daily Mix is freshly built.',
    'Your Daily Mix is freshly built for today.',
    lang ? `New ${lang} releases landed on your home.` : 'New releases landed on your home.',
    'Something Different is hiding on your home — scroll for it.',
    i.weekPlays > 0 ? `${i.weekPlays} plays this week — the profile is listening too.` : 'Every play tunes your home a little more.',
  ];
  return {
    title: dayPartTitle(i.hour, name),
    subtitle: pool[seed(`${i.dateKey}|${name}`) % pool.length],
  };
}
