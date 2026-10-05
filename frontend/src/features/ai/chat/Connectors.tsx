import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import { GlobeIcon, MusicIcon, XIcon } from '@/components/Icons';
import {
  activeConnectors,
  connectorViews,
  onConnectorsChange,
  placeConnectorOn,
  setPlaceConnectorOn,
  type ConnectorId,
  type ConnectorView,
} from '@/features/ai/connectors';
import { loadMemories, memoryEnabled, setMemoryEnabled } from '@/features/ai/memory';
import { assistantPlace, type AssistantPlace } from '@/services/location/assistantPlace';
import { usePlayerStore } from '@/store/playerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { cn } from '@/utils/cn';
import { BookIcon, BulbIcon, MemoryIcon, PlaceIcon } from './icons';

const ICON: Record<ConnectorId, (p: { className?: string }) => ReactNode> = {
  web: GlobeIcon,
  research: BookIcon,
  think: BulbIcon,
  nowPlaying: MusicIcon,
  memory: MemoryIcon,
  place: PlaceIcon,
};

/** "Hyderabad, Telangana, IN · Asia/Kolkata" — what the place connector would send. */
export function placeLabel(p: AssistantPlace | undefined): string | null {
  if (!p) return null;
  const where = [p.city, p.region, p.country].filter(Boolean).join(', ');
  return [where, p.timezone].filter(Boolean).join(' · ') || null;
}

/** The page-owned switches the composer passes through. */
export interface TurnConnectors {
  web: boolean;
  research: boolean;
  think: boolean;
  nowPlaying: boolean;
  onWeb: (on: boolean) => void;
  onResearch: (on: boolean) => void;
  onThink: (on: boolean) => void;
  onNowPlaying: (on: boolean) => void;
}

/** How long "tap again to forget" waits for the second tap. */
const ARM_MS = 5000;

/**
 * 10.0 — every connector's state in one place: the page's per-turn switches as
 * given, plus the two that are stored on the device (memory, place), kept in
 * step with the settings dialog through the connectors event.
 *
 * Switching Memory OFF forgets every saved line (that is what the switch has
 * always meant, ../memory.ts). From a quick menu that deserves a second tap:
 * the first one ARMS it ("Tap again to forget 3 saved lines"), the second,
 * within a few seconds, does it. With nothing saved there is nothing to lose
 * and one tap is enough.
 */
export function useConnectors(turn: TurnConnectors): {
  views: ConnectorView[];
  active: ConnectorView[];
  armed: ConnectorId | null;
  memoryCount: number;
  toggle: (id: ConnectorId) => void;
} {
  const [stored, setStored] = useState(() => ({ memoryOn: memoryEnabled(), memoryCount: loadMemories().length, placeOn: placeConnectorOn() }));
  const [armed, setArmed] = useState<ConnectorId | null>(null);
  useEffect(
    () =>
      onConnectorsChange(() =>
        setStored({ memoryOn: memoryEnabled(), memoryCount: loadMemories().length, placeOn: placeConnectorOn() }),
      ),
    [],
  );
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(null), ARM_MS);
    return () => window.clearTimeout(t);
  }, [armed]);
  // The app-wide region setting decides whether there is a place to send at
  // all. Selected as one string, so only a change to it re-renders.
  const place = useSettingsStore(() => placeLabel(assistantPlace()));
  // Read, not subscribed: the title only matters while the menu is open, and
  // a subscription would re-render the composer on every track change.
  const st = usePlayerStore.getState();
  const song = st.queue[st.index]?.title ?? null;

  const views = connectorViews({
    web: turn.web,
    research: turn.research,
    think: turn.think,
    nowPlaying: turn.nowPlaying,
    song,
    memoryOn: stored.memoryOn,
    memoryCount: stored.memoryCount,
    placeOn: stored.placeOn,
    placeLabel: place,
  });

  const toggle = useCallback(
    (id: ConnectorId): void => {
      const view = views.find((v) => v.id === id);
      if (!view || view.disabled) return;
      const on = !view.on;
      if (id !== 'memory' && armed) setArmed(null);
      switch (id) {
        case 'web':
          turn.onWeb(on);
          // Research always searches: switching the web off ends it too.
          if (!on) turn.onResearch(false);
          return;
        case 'research':
          turn.onResearch(on);
          return;
        case 'think':
          turn.onThink(on);
          return;
        case 'nowPlaying':
          turn.onNowPlaying(on);
          return;
        case 'place':
          setPlaceConnectorOn(on);
          return;
        case 'memory':
          if (!on && stored.memoryCount > 0 && armed !== 'memory') {
            setArmed('memory');
            return;
          }
          setArmed(null);
          setMemoryEnabled(on);
          return;
      }
    },
    [views, armed, stored.memoryCount, turn],
  );

  return { views, active: activeConnectors(views), armed, memoryCount: stored.memoryCount, toggle };
}

const forgetLine = (n: number): string => `Tap again to forget ${n === 1 ? 'the saved line' : `all ${n} saved lines`}`;

/**
 * The Connectors section of the + menu: one switch per context source. The
 * whole row is the switch (a 56px target); its name labels it and its one
 * line describes it. A connector that cannot be switched on from here says
 * why and stays focusable, so the reason can be read.
 */
export function ConnectorList({
  views,
  armed,
  memoryCount,
  onToggle,
}: {
  views: ConnectorView[];
  armed: ConnectorId | null;
  memoryCount: number;
  onToggle: (id: ConnectorId) => void;
}): ReactNode {
  const uid = useId();
  return (
    <div role="group" aria-labelledby={`${uid}-h`} className="ai-conn">
      <p id={`${uid}-h`} className="ai-menu-heading">
        Connectors
      </p>
      {views.map((v) => {
        const Icon = ICON[v.id];
        const isArmed = armed === v.id;
        return (
          <button
            key={v.id}
            type="button"
            role="switch"
            aria-checked={v.on}
            aria-disabled={v.disabled || undefined}
            aria-labelledby={`${uid}-${v.id}-n`}
            aria-describedby={`${uid}-${v.id}-d`}
            data-connector={v.id}
            className={cn('ai-conn-row', isArmed && 'is-armed')}
            onClick={() => onToggle(v.id)}
          >
            <span className="ai-conn-icon" aria-hidden>
              <Icon className="w-4 h-4" />
            </span>
            <span className="ai-conn-text">
              <span id={`${uid}-${v.id}-n`} className="ai-conn-name">
                {v.name}
              </span>
              <span id={`${uid}-${v.id}-d`} className="ai-conn-desc" aria-live={v.id === 'memory' ? 'polite' : undefined}>
                {isArmed ? forgetLine(memoryCount) : v.description}
              </span>
            </span>
            <span className="ai-switch ai-conn-switch" aria-hidden>
              <span className="ai-switch-thumb" />
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** The connectors that are on, as small chips above the composer. Each chip's
 *  × switches its connector off (Memory asks for a second tap first). */
export function ConnectorChips({
  active,
  armed,
  memoryCount,
  onToggle,
}: {
  active: ConnectorView[];
  armed: ConnectorId | null;
  memoryCount: number;
  onToggle: (id: ConnectorId) => void;
}): ReactNode {
  if (!active.length) return null;
  return (
    <div className="ai-conn-chips" role="group" aria-label="Active connectors">
      {active.map((v) => {
        const Icon = ICON[v.id];
        const isArmed = armed === v.id;
        return (
          <span key={v.id} className={cn('ai-conn-chip', isArmed && 'is-armed')} data-connector={v.id}>
            <Icon className="ai-conn-chip-icon" />
            <span className="ai-conn-chip-name">{isArmed ? `Forget ${memoryCount === 1 ? '1 line' : `${memoryCount} lines`}?` : v.name}</span>
            <button
              type="button"
              className="ai-conn-chip-x"
              aria-label={isArmed ? forgetLine(memoryCount) : `Turn off ${v.name}`}
              title={isArmed ? forgetLine(memoryCount) : `Turn off ${v.name}`}
              onClick={() => onToggle(v.id)}
            >
              <XIcon className="w-3 h-3" />
            </button>
          </span>
        );
      })}
    </div>
  );
}
