import { useEffect, useRef, useState } from 'react';
import { audioEngine } from '@/services/audio/engine';
import { useCastStore } from '@/services/cast';
import { clearBypass, hasWebAudio, setVocals, useEffectsStatus, VOCAL_MODES, type VocalMode } from '@/services/audio/effects';
import { iosWeb } from '@/utils/platform';
import { VOCALS_HINT, vocalsBlocked } from './vocals';

/**
 * Karaoke's Vocals control (Full / Low / Off). Lives in the lazy karaoke
 * chunk, as does the effects module it drives. The chain is only asked for
 * the first time the listener picks Low or Off (attaching reloads the song in
 * CORS mode, as disco lights do), so opening karaoke alone changes nothing.
 * Leaving karaoke puts the vocals back to Full and hands the chain back to
 * the engine, which leaves a flat chain until the next song loads, so the
 * song is never interrupted.
 */
export function VocalsControl() {
  const casting = useCastStore((s) => s.connected);
  const bypassed = useEffectsStatus((s) => s.bypassed);
  const [mode, setMode] = useState<VocalMode>('full');
  // An old verdict from before karaoke opened does not count; only this page's own attempt.
  const [asked, setAsked] = useState(false);
  const askedRef = useRef(false);

  useEffect(
    () => () => {
      setVocals('full');
      if (askedRef.current) audioEngine.setAnalysisEnabled(false);
    },
    [],
  );

  const blocked = vocalsBlocked({ ios: iosWeb(), casting, webAudio: hasWebAudio(), bypassed: asked && bypassed });

  const choose = (next: VocalMode) => {
    if (blocked) return;
    if (next !== 'full' && !askedRef.current) {
      askedRef.current = true;
      setAsked(true);
      clearBypass();
      audioEngine.setAnalysisEnabled(true);
    }
    setVocals(next);
    setMode(next);
  };

  return (
    <div className="vx-karaoke-vocals">
      <div role="group" aria-label="Vocals" aria-describedby="vx-karaoke-vocals-note" className="vx-karaoke-vocals-row">
        <span className="vx-karaoke-vocals-label" aria-hidden>Vocals</span>
        {VOCAL_MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            className="vx-np-pill"
            aria-pressed={!blocked && mode === m.id}
            disabled={!!blocked}
            onClick={() => choose(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p id="vx-karaoke-vocals-note" className="vx-karaoke-vocals-note">{blocked ?? VOCALS_HINT}</p>
    </div>
  );
}
