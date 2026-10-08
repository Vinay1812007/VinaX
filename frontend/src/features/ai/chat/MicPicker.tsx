import { useEffect, useId, useState, type ReactNode } from 'react';
import { listMics, loadMicChoice, saveMicChoice, type MicInput } from '@/features/voice/mic';

/**
 * 11.3.2 — Settings → Voice → Microphone: which input the mic button and live
 * voice chat record from. "Automatic" is the browser's choice, with a silent
 * input (a virtual audio cable) swapped for a working one on the fly.
 * The names appear once the site has been allowed to use a microphone.
 */
export function MicPicker(): ReactNode {
  const id = useId();
  const [mics, setMics] = useState<MicInput[]>([]);
  const [choice, setChoice] = useState(loadMicChoice);
  useEffect(() => {
    let live = true;
    const load = (): void => {
      void listMics().then((m) => {
        if (live) setMics(m);
      });
    };
    load();
    navigator.mediaDevices?.addEventListener?.('devicechange', load);
    return () => {
      live = false;
      navigator.mediaDevices?.removeEventListener?.('devicechange', load);
    };
  }, []);
  if (!navigator.mediaDevices) return null;
  const named = mics.some((m) => m.label !== 'Microphone');
  return (
    <div className="ai-set-block">
      <label htmlFor={id} className="block text-[14px] font-semibold ai-t1 mb-1.5">
        Microphone
      </label>
      <select
        id={id}
        className="ai-field w-full px-3 py-2 text-[14px]"
        value={mics.some((m) => m.id === choice) ? choice : ''}
        onChange={(e) => {
          setChoice(e.target.value);
          saveMicChoice(e.target.value);
        }}
      >
        <option value="">Automatic</option>
        {mics
          .filter((m) => m.id !== 'default')
          .map((m, i) => (
            <option key={m.id} value={m.id}>
              {m.label === 'Microphone' ? `Microphone ${i + 1}` : m.label}
            </option>
          ))}
      </select>
      <p className="mt-1.5 text-[13px] ai-t3 leading-snug">
        {named
          ? 'What the mic button and voice chat listen with. Automatic skips an input that sends no sound, such as a virtual audio cable.'
          : 'Use the mic once and the names of your microphones appear here.'}
      </p>
    </div>
  );
}
