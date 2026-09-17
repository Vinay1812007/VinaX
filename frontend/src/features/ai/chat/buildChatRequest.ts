import { buildTasteSnapshot } from '@/services/ai/taste';
import { extractRecommendedFromThread } from '@/services/ai/threadMemory';
import { getSong } from '@/services/api';
import { detectSongLinks, prefRuleMessage, songContextBlock } from '@/features/ai/replyPrefs';
import type { Song } from '@/types';
import { catalogModelForSend } from './models';
import type { ModelChoice, Msg } from './types';

/** Time-sensitive questions — "who won today", "202X releases", live scores,
 *  weather — switch web search on for the turn so the reply gets fresh
 *  sources instead of the model's training-time snapshot. The heuristic lives
 *  on the client (not the server) so the listener always sees that a live-web
 *  hop happened. */
export const FRESH_TRIGGER =
  /\b(today|tonight|yesterday|this (?:week|month|year|weekend|season)|right now|as of (?:now|today)|breaking(?: news)?|who won|live scores?|box office|standings|weather|price of|stock price|202[6-9]|latest|recently released)\b/i;

const VOICE_RULE =
  'SYSTEM RULE for this voice conversation: every reply is spoken aloud — 1-3 short conversational sentences of plain text, no markdown, no lists, no emojis.';
const THINK_RULE =
  'SYSTEM RULE for this reply: reason it through privately first, then present a short structured summary of the key steps followed by a clear final answer. Raw chain-of-thought never appears in the reply.';
const RESEARCH_RULE =
  'SYSTEM RULE for this reply: research mode. Work from the web results, cross-check at least two independent sources, flag where they disagree, and tie each key fact to the source that backs it.';
const REGENERATE_RULE =
  'Regenerate your answer to my last question. Take a meaningfully different approach, preserve correct facts, and avoid the songs you just recommended. Deliver the new answer directly.';

export interface TurnSettings {
  /** A live voice chat is running: replies are spoken, other rules step aside. */
  voiceLive: boolean;
  choice: ModelChoice;
  /** Agent mode is on AND the chosen model is agent-capable. */
  agent: boolean;
  web: boolean;
  think: boolean;
  research: boolean;
  replyLang: string;
  replyStyle: string;
  profile: string;
  /** The song playing now, when the listener allowed the assistant to see it. */
  song: Song | null;
}

export interface TurnInput {
  /** The thread before this turn. */
  conversation: Msg[];
  userMsg: Msg;
  /** The listener's typed text (link detection, freshness). */
  query: string;
  images: string[];
  /** Regenerate: the reply being replaced. */
  previousReply?: string;
}

/** The JSON body for POST /api/vinaxai. The wire format is unchanged from
 *  earlier builds: rule and context messages first, then the thread. */
export async function buildChatRequest(s: TurnSettings, t: TurnInput): Promise<Record<string, unknown>> {
  const think = !s.voiceLive && s.think;
  const research = !s.voiceLive && s.research;
  const prefRule = s.voiceLive ? '' : prefRuleMessage(s.replyLang, s.replyStyle);
  const ctxBlocks: string[] = [];
  if (!s.voiceLive) {
    if (s.song) ctxBlocks.push(await songContextBlock(s.song, 'now playing').catch(() => ''));
    for (const id of detectSongLinks(t.query)) {
      const sg = await getSong(id).catch(() => null);
      if (sg) ctxBlocks.push(await songContextBlock(sg, 'song the user linked').catch(() => ''));
    }
  }
  const user = (content: string): { role: 'user'; content: string } => ({ role: 'user', content });
  const messages = [
    ...(prefRule ? [user(prefRule)] : []),
    ...ctxBlocks.filter(Boolean).map(user),
    ...(s.voiceLive ? [user(VOICE_RULE)] : []),
    ...(think ? [user(THINK_RULE)] : []),
    ...(research ? [user(RESEARCH_RULE)] : []),
    ...t.conversation,
    t.userMsg,
    ...(t.previousReply
      ? [{ role: 'assistant' as const, content: t.previousReply.slice(0, 12000) }, user(REGENERATE_RULE)]
      : []),
  ].map((m) => ({ role: m.role, content: m.content }));

  return {
    messages,
    // Think sends this message to the deep engine — unless an agent model is
    // doing the work, which must stay on the model the listener chose.
    mode: s.voiceLive ? 'voice' : think && !s.agent ? 'sage' : s.choice.mode,
    // Catalogue seats only: the exact model the listener picked. The server
    // re-checks it against the live catalogue; other seats ignore it.
    model: catalogModelForSend(s.choice),
    // Research always searches, and its multi-source rule is prepended above.
    web: s.web || research || FRESH_TRIGGER.test(t.query),
    images: t.images,
    // The taste snapshot plus this thread's own memory: everything already
    // recommended in this conversation, so "give me more" reaches into fresh
    // territory instead of looping.
    taste: {
      ...buildTasteSnapshot(),
      alreadyRecommendedThisChat: extractRecommendedFromThread(
        t.previousReply ? [...t.conversation, { role: 'assistant', content: t.previousReply }] : t.conversation,
        32,
      ),
    },
    profile: s.profile || undefined,
  };
}
