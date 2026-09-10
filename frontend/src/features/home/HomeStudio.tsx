import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { HOME_BLOCKS, HOME_PRESETS, orderHomeBlocks } from '@/constants/homeBlocks';
import { useSettingsStore } from '@/store/settingsStore';
import { useTutorialStore } from '@/store/tutorialStore';
import { useHistoryStore } from '@/store/historyStore';
import { useLibraryStore } from '@/store/libraryStore';
import { moveHomeBlock, resetHomeLayout, toggleHomeBlock } from '@/features/settings/homeLayout';
import { SparkleIcon, SettingsIcon, ChevronDownIcon } from '@/components/Icons';
import { toast } from '@/store/toastStore';

/** Immediate, device-local controls. Admin-disabled blocks remain disabled. */
export function HomeStudio({ availableOrder }: { availableOrder: string[] }) {
  const [open, setOpen] = useState(false);
  const hidden = useSettingsStore((s) => s.hiddenHome);
  const savedOrder = useSettingsStore((s) => s.homeOrder);
  const explore = useSettingsStore((s) => s.exploreMode);
  const intensity = useSettingsStore((s) => s.recommendationIntensity);
  const queryClient = useQueryClient();
  const order = orderHomeBlocks(savedOrder, availableOrder);
  function tune(adventurous: boolean, strength: number) {
    useSettingsStore.setState({ exploreMode: adventurous, recommendationIntensity: strength });
    void queryClient.invalidateQueries({
      predicate: (q) => /recommend|mix|ai-home/.test(String(q.queryKey[0])),
    });
    toast(
      adventurous
        ? 'More discovery in your mixes'
        : strength > 0.8
          ? 'Your taste takes the lead'
          : 'A balance of familiar and fresh',
    );
  }
  return (
    <section data-tour="home-studio" className="vx-studio" aria-label="Personalize your listening">
      <div className="vx-studio-bar">
        <div>
          <p className="vx-eyebrow">THE WAY YOU LISTEN</p>
          <h2>Your music. Your balance.</h2>
        </div>
        <div
          data-tour="recommendation-style"
          className="vx-segment"
          aria-label="Recommendation style"
        >
          <button aria-pressed={!explore && intensity > 0.8} onClick={() => tune(false, 1)}>
            Familiar
          </button>
          <button aria-pressed={!explore && intensity <= 0.8} onClick={() => tune(false, 0.65)}>
            Balanced
          </button>
          <button aria-pressed={explore} onClick={() => tune(true, 0.65)}>
            <SparkleIcon className="w-3.5 h-3.5" /> Discover
          </button>
        </div>
        <button
          className="vx-layout-toggle"
          aria-expanded={open}
          aria-controls="home-studio-layout"
          onClick={() => setOpen(!open)}
        >
          <SettingsIcon className="w-4 h-4" /> Edit home{' '}
          <ChevronDownIcon className={`w-4 h-4 ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>
      <p className="vx-studio-hint">
        {explore
          ? 'Invites new artists into your recommendations while keeping your language preferences.'
          : intensity > 0.8
            ? 'Leans into artists and languages you return to most.'
            : 'Blends your listening taste with popular picks and fresh releases.'}{' '}
        <Link to="/taste-profile">Fine-tune your taste →</Link>
      </p>
      {open && (
        <div id="home-studio-layout" className="vx-layout-editor">
          <div className="vx-preset-grid">
            {HOME_PRESETS.map((preset) => (
              <button
                key={preset.id}
                onClick={() => {
                  useSettingsStore.setState({
                    homeOrder: [...preset.order],
                    hiddenHome: [...preset.hidden],
                  });
                  toast(`${preset.label} home applied`);
                }}
              >
                <strong>{preset.label}</strong>
                <span>{preset.hint}</span>
              </button>
            ))}
          </div>
          <p className="text-xs text-ink-400 mb-3">
            Changes save automatically on this device. Move shelves or choose which ones appear.
          </p>
          <div className="vx-layout-list">
            {order.map((key, i) => {
              const block = HOME_BLOCKS.find((b) => b.key === key);
              if (!block) return null;
              return (
                <div key={key} className="vx-layout-row">
                  <label>
                    <input
                      type="checkbox"
                      checked={!hidden.includes(key)}
                      onChange={() => toggleHomeBlock(key)}
                    />
                    <span>{block.label}</span>
                  </label>
                  <div>
                    <button
                      aria-label={`Move ${block.label} up`}
                      disabled={i === 0}
                      onClick={() => moveHomeBlock(key, -1, order)}
                    >
                      ↑
                    </button>
                    <button
                      aria-label={`Move ${block.label} down`}
                      disabled={i === order.length - 1}
                      onClick={() => moveHomeBlock(key, 1, order)}
                    >
                      ↓
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-6 flex-wrap">
            <button
              className="vx-text-action"
              onClick={() => {
                resetHomeLayout();
                toast('Home layout restored');
              }}
            >
              Restore default layout
            </button>
            <button
              className="vx-text-action"
              onClick={() => useTutorialStore.getState().start('home-studio')}
            >
              Show me around
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

export function ListeningGuide() {
  const plays = useHistoryStore((s) => s.entries.length);
  const favorites = useLibraryStore((s) => s.favorites.length);
  const done = useTutorialStore((s) => s.done);
  if (plays >= 5 && favorites > 0) return null;
  const completed = Number(plays > 0) + Number(favorites > 0) + Number(done.includes('first-song'));
  return (
    <section className="vx-listening-guide" aria-label="Getting started">
      <div>
        <p className="vx-eyebrow">MAKE YOURSELF AT HOME · {completed}/3</p>
        <h2>A little listening goes a long way.</h2>
        <p>Play a song, save a favourite, and let your next mix take shape.</p>
      </div>
      <div className="vx-guide-actions">
        <Link to="/search">
          {plays > 0 ? '✓ First song played' : '01 Find your first song'} <span>↗</span>
        </Link>
        <Link to={favorites ? '/favorites' : '/made-for-you'}>
          {favorites > 0 ? '✓ Favourite saved' : '02 Find a song to love'} <span>↗</span>
        </Link>
        <button onClick={() => useTutorialStore.getState().start('first-song')}>
          {done.includes('first-song') ? '✓ Replay the walkthrough' : '03 Take a guided tour'}{' '}
          <span>↗</span>
        </button>
      </div>
    </section>
  );
}
