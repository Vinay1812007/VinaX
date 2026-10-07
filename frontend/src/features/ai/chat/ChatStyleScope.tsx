import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { CHAT_STYLES, chatStyle as styleOf, layoutAttrs, loadChatStylePref, resolveChatStyle, saveChatStylePref, type ChatStyleId, type ChatStylePref } from './chatStyle';
import { contextBadge } from './models';
import type { ModelChoice, Provider } from './types';

export interface ChatStyleState {
  /** The style on screen now. */
  style: ChatStyleId;
  /** What the listener asked for: follow the model, or one fixed style. */
  pref: ChatStylePref;
  setPref: (pref: ChatStylePref) => void;
  /** Flips between 'a' and 'b' on each change so the cross-fade restarts; unset until the first change. */
  tick: 'a' | 'b' | undefined;
  /** The context size of the model that answered ("128K"), for styles whose answered-by tag shows it. */
  engineContext: (engine: string) => string | null;
}

const FALLBACK: ChatStyleState = { style: 'vinax', pref: 'match', setPref: () => undefined, tick: undefined, engineContext: () => null };
export const ChatStyleContext = createContext<ChatStyleState>(FALLBACK);
export const useChatStyleState = (): ChatStyleState => useContext(ChatStyleContext);

/** The page's one source of truth: the style follows the SELECTED model at once. */
export function useChatStyle(choice: ModelChoice, providers: readonly Provider[]): ChatStyleState {
  const [pref, setPrefState] = useState<ChatStylePref>(loadChatStylePref);
  const style = resolveChatStyle(pref, choice, providers);
  const first = useRef(style);
  const [tick, setTick] = useState<'a' | 'b' | undefined>(undefined);
  useEffect(() => {
    if (first.current === style) return;
    first.current = style;
    setTick((t) => (t === 'a' ? 'b' : 'a'));
  }, [style]);
  const setPref = useCallback((next: ChatStylePref) => {
    setPrefState(next);
    saveChatStylePref(next);
  }, []);
  const engineContext = useCallback(
    (engine: string) => {
      if (styleOf(style).layout.engine !== 'tag') return null;
      for (const p of providers) for (const m of p.models) if (m.name === engine || m.id === engine) return contextBadge(m.context ?? null);
      return null;
    },
    [style, providers],
  );
  return useMemo(() => ({ style, pref, setPref, tick, engineContext }), [style, pref, setPref, tick, engineContext]);
}

/**
 * Dropped inside a portalled sheet: stamps the current style on the nearest
 * `.ai-scope`, so the sheet wears the same style as the chat behind it.
 */
export function ChatStyleMark(): ReactNode {
  const { style } = useChatStyleState();
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    ref.current?.closest('.ai-scope')?.setAttribute('data-chat-style', style);
  }, [style]);
  return <span ref={ref} hidden />;
}

/** The context size beside the answered-by name; renders nothing unless the
 *  style's layout asks for the tag form and the catalogue knows the size. */
export function EngineContext({ engine }: { engine: string }): ReactNode {
  const ctx = useChatStyleState().engineContext(engine);
  return ctx ? <span className="ai-engine-ctx">{ctx}</span> : null;
}

/** The app's own tokens, read from the page root, so the "VinaX" miniature
 *  shows the house look even while the dialog around it wears another style. */
const ROOT_TOKENS = ['--ink-950', '--ink-900', '--ink-850', '--ink-800', '--ink-700', '--ink-500', '--ink-400', '--ink-300', '--ink-200', '--ink-100', '--ember-300', '--ember-400', '--ember-500', '--ember-600', '--tide-400', '--tide-500', '--vx-border', '--glass-border-strong'];
function rootTokens(): CSSProperties {
  const out: Record<string, string> = {};
  try {
    const cs = getComputedStyle(document.documentElement);
    for (const t of ROOT_TOKENS) {
      const v = cs.getPropertyValue(t).trim();
      if (v) out[t] = v;
    }
  } catch {
    /* no computed style: the miniature inherits */
  }
  return out as CSSProperties;
}

function Preview({ id, house }: { id: ChatStyleId; house: CSSProperties }): ReactNode {
  return (
    <span className="ai-scope ai-style-pv" data-chat-style={id} {...layoutAttrs(id)} style={id === 'vinax' ? house : undefined} aria-hidden>
      <i />
      <b />
      <u />
    </span>
  );
}

/** The "Chat style" row in chat settings: a radio group with drawn miniatures. */
export function ChatStyleSetting(): ReactNode {
  const { pref, setPref, style } = useChatStyleState();
  const uid = useId();
  const [house] = useState(rootTokens);
  const options: Array<{ value: ChatStylePref; label: string; description: string; preview: ChatStyleId; audience?: string }> = [
    { value: 'match', label: 'Match the model', description: 'The chat follows the model you pick. Auto uses the VinaX look.', preview: pref === 'match' ? style : 'vinax' },
    ...CHAT_STYLES.map((s) => ({ value: s.id, label: s.id === 'vinax' ? 'Always VinaX' : s.label, description: s.description, preview: s.id, audience: s.audience })),
  ];
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const i = options.findIndex((o) => o.value === pref);
    const next = options[(i + step + options.length) % options.length];
    setPref(next.value);
    e.currentTarget.querySelector<HTMLElement>(`[data-style-value="${next.value}"]`)?.focus();
  };
  return (
    <div className="ai-set-block" data-tour="chat-style">
      <span id={`${uid}-style`} className="text-[14px] font-semibold ai-t1">
        Chat style
      </span>
      <div role="radiogroup" aria-labelledby={`${uid}-style`} className="ai-style-list" onKeyDown={onKeyDown}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={pref === o.value}
            tabIndex={pref === o.value ? 0 : -1}
            data-style-value={o.value}
            onClick={() => setPref(o.value)}
            className="ai-style-opt"
          >
            <Preview id={o.preview} house={house} />
            <span className="min-w-0">
              <span className="ai-style-opt-name">{o.label}</span>
              <span className="ai-style-opt-desc">{o.description}</span>
              <span className="ai-style-opt-for">{o.audience ?? 'For every model'}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
