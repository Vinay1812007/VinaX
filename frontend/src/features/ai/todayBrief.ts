import { activeFestival, nextFestival } from '@/constants/festivals';
import { useHistoryStore } from '@/store/historyStore';
import { loadProfile } from '@/services/personalization/storage';
import { topArtists, topLanguages } from '@/services/personalization/profile';
import { minutesToday } from '@/features/home/onThisDay';

/**
 * v5.16.0 — "Today for you": a small brief on the AI welcome screen built
 * entirely on the device (date, festival, listening so far, taste) plus three
 * prompts tailored to it. No engine call; nothing leaves the phone.
 */
export interface TodayBrief {
  date: string;
  lines: string[];
  prompts: string[];
}

export function buildTodayBrief(now = new Date()): TodayBrief {
  const date = now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
  const lines: string[] = [];
  const prompts: string[] = [];
  const fest = activeFestival(now);
  const next = nextFestival(now);
  const entries = useHistoryStore.getState().entries;
  const mins = minutesToday(entries, now.getTime());
  const profile = loadProfile();
  const lang = topLanguages(profile, 1)[0]?.id;
  const artist = topArtists(profile, 1)[0]?.affinity.name;
  const Lang = lang ? lang.charAt(0).toUpperCase() + lang.slice(1) : 'Telugu';

  if (fest) {
    lines.push(`${fest.name} is today.`);
    prompts.push(`Make me a ${fest.name} playlist in ${Lang}`);
  } else if (next && next.inDays <= 7) {
    lines.push(`${next.festival.name} in ${next.inDays} day${next.inDays === 1 ? '' : 's'}.`);
    prompts.push(`Plan a ${next.festival.name} party playlist`);
  }
  if (mins > 0) lines.push(`${mins} min of music so far today.`);
  if (artist) {
    lines.push(`You've been on a ${artist} streak.`);
    prompts.push(`Tell me something I don't know about ${artist}`);
  }
  const hour = now.getHours();
  const slot = hour < 11 ? 'morning' : hour < 16 ? 'afternoon' : hour < 21 ? 'evening' : 'late-night';
  prompts.push(`Suggest 5 ${Lang} songs for a ${slot} ${hour < 11 ? 'start' : hour < 21 ? 'break' : 'wind-down'}`);
  if (prompts.length < 3) prompts.push('What can you help me with today?');
  return { date, lines, prompts: prompts.slice(0, 3) };
}
