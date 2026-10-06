import { buildTasteSnapshot } from '@/services/ai/taste';
import { extractRecommendedFromThread } from '@/services/ai/threadMemory';
import { getSong } from '@/services/api';
import { detectSongLinks, prefRuleMessage, songContextBlock } from '@/features/ai/replyPrefs';
import type { Song } from '@/types';
import type { ModelChoice, Msg } from './types';
import { assistantPlace } from '@/services/location/assistantPlace';
import { trimThread } from './longThread';
import { memoryBlock } from '../memory';
import { placeConnectorOn } from '../connectors';
import { projectBlock, projectById } from '../projects';

const VOICE_RULE =
  'SYSTEM RULE for this voice conversation: every reply is spoken aloud — 1-3 short conversational sentences of plain text, no markdown, no lists, no emojis.';
const THINK_RULE =
  'SYSTEM RULE for this reply: reason it through privately first, then present a short structured summary of the key steps followed by a clear final answer. Raw chain-of-thought never appears in the reply.';
const REGENERATE_RULE =
  'Regenerate your answer to my last question. Take a meaningfully different approach, preserve correct facts, and avoid the songs you just recommended. Deliver the new answer directly.';

export interface TurnSettings {
  /** A live voice chat is running: replies are spoken, other rules step aside. */
  voiceLive: boolean;
  choice: ModelChoice;
  think: boolean;
  replyLang: string;
  replyStyle: string;
  profile: string;
  /** The song playing now, when the listener allowed the assistant to see it. */
  song: Song | null;
  /** 9.1.0 — the project this chat belongs to, when it is in one. */
  projectId?: string;
}

export interface TurnInput {
  /** The thread before this turn. */
  conversation: Msg[];
  userMsg: Msg;
  /** The listener's typed text (link detection). */
  query: string;
  images: string[];
  /** Regenerate: the reply being replaced. */
  previousReply?: string;
}

/** The JSON body for POST /api/vinaxai. The wire format is unchanged from
 *  earlier builds: rule and context messages first, then the thread. */
export async function buildChatRequest(s: TurnSettings, t: TurnInput): Promise<Record<string, unknown>> {
  const think = !s.voiceLive && s.think;
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
  const trimmed = trimThread(t.conversation);
  // 9.1.0 — things the listener asked VinaX AI to remember. Empty unless they
  // turned memory on (../memory.ts), and fenced as data like the profile text.
  const remembered = s.voiceLive ? '' : memoryBlock();
  // 9.1.0 — the project's standing instructions and reference files. A project
  // is the listener's own framing of the work, so it leads the context blocks.
  const project = s.voiceLive ? '' : projectBlock(projectById(s.projectId));
  const messages = [
    ...(prefRule ? [user(prefRule)] : []),
    ...(project ? [user(project)] : []),
    ...(remembered ? [user(remembered)] : []),
    ...ctxBlocks.filter(Boolean).map(user),
    ...(s.voiceLive ? [user(VOICE_RULE)] : []),
    ...(think ? [user(THINK_RULE)] : []),
    // 9.1.0 — a long thread is trimmed to its recent window, with a digest of
    // the questions that fell outside it, so the opening of a fifty-turn
    // conversation is not silently forgotten (./longThread.ts).
    // 8.2.0 — a failure line is the app talking, not the assistant: it is never
    // sent back (trimThread drops it).
    ...(trimmed.digest ? [user(trimmed.digest)] : []),
    ...trimmed.turns,
    t.userMsg,
    ...(t.previousReply
      ? [{ role: 'assistant' as const, content: t.previousReply.slice(0, 12000) }, user(REGENERATE_RULE)]
      : []),
  ].map((m) => ({ role: m.role, content: m.content }));

  // 10.3 — a listener pick is `{ mode: 'auto' }` or `{ mode: 'model',
  // provider, model }`; the server re-checks the slug against that provider's
  // live list. Live voice keeps its own internal seat, and Think on Auto keeps
  // the deep seat it has always sent (the server reads it as Auto) — Think on
  // an exact model never overrides the listener's pick, the Think rule above
  // does the work.
  const picked = !s.voiceLive && s.choice.mode === 'model' ? s.choice : null;
  return {
    messages,
    mode: s.voiceLive ? 'voice' : picked ? 'model' : think ? 'sage' : 'auto',
    ...(picked ? { provider: picked.provider, model: picked.model } : {}),
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
    // 9.1.0 — coarse place, so date/time answers suit the
    // listener instead of always assuming IST. `assistantPlace()` returns
    // undefined whenever "Allow region inference" is off AND no manual override
    // is set, so a listener who declined inference sends nothing and the server
    // falls back to the IST line. Country, region, approximate city and an IANA
    // zone only — never an IP, never coordinates. The listener's languages are
    // sent separately (in `taste`) and always outrank this.
    // 10.0 — the Place connector (composer + menu) can hold it back for the
    // chat as well; it is on unless the listener switched it off there.
    place: placeConnectorOn() ? assistantPlace() : undefined,
  };
}
