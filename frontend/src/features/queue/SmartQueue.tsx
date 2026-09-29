import { Link } from 'react-router-dom';
import { useSettingsStore } from '@/store/settingsStore';
import { toast } from '@/store/toastStore';
import '@/styles/pages/radio.css';

/**
 * 8.2.0 — Smart Queue: one switch on the Queue page for two existing
 * settings, never a third one. On = Autoplay AND "DJ builds every queue"
 * (Settings → Recommendations): the song you start leads and the DJ builds
 * what follows, endlessly. Turning it off switches the DJ takeover off and
 * leaves Autoplay as it was, so the listener's list plays in order.
 */
export function smartQueueOn(s: { autoplay: boolean; djTakeover: boolean }): boolean {
  return s.autoplay && s.djTakeover;
}

/** What Smart Queue does right now, in one or two plain sentences. */
export function smartQueueExplanation(s: { autoplay: boolean; djTakeover: boolean; aiDj: boolean }): string {
  if (smartQueueOn(s)) {
    return `The DJ builds what plays next around each song you start and keeps the music going. Songs you add always play first.${
      s.aiDj ? '' : ' AI DJ is off, so picks come from on-device recommendations.'
    }`;
  }
  return s.autoplay
    ? 'Songs play in the order you chose. When the list ends, similar songs keep the music going.'
    : 'Songs play in the order you chose and stop at the end.';
}

export function SmartQueue() {
  const autoplay = useSettingsStore((s) => s.autoplay);
  const djTakeover = useSettingsStore((s) => s.djTakeover);
  const aiDj = useSettingsStore((s) => s.aiDj && s.aiAssist);
  const on = smartQueueOn({ autoplay, djTakeover });
  const toggle = (): void => {
    const st = useSettingsStore.getState();
    if (on) {
      st.setDjTakeover(false);
      toast('Smart Queue is off. Your songs play in the order you chose.');
    } else {
      if (!st.autoplay) st.setAutoplay(true);
      st.setDjTakeover(true);
      toast('Smart Queue is on. The next song you start leads, and the DJ builds the rest.');
    }
  };
  return (
    <div className="vx-smartq">
      <span className="vx-smartq-text">
        <span id="vx-smartq-label" className="vx-smartq-label">Smart Queue</span>
        <span id="vx-smartq-desc" className="vx-smartq-desc">
          {smartQueueExplanation({ autoplay, djTakeover, aiDj })} <Link to="/settings">More in Settings</Link>
        </span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-labelledby="vx-smartq-label"
        aria-describedby="vx-smartq-desc"
        onClick={toggle}
      >
        <span />
      </button>
    </div>
  );
}
