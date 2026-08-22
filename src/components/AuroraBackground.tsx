import { useEffect, useState } from 'react';
import { usePlayerStore, useCurrentSong } from '@/store/playerStore';
import { extractAverageColor } from '@/utils/color';
import { bestImage } from '@/utils/images';

/**
 * Fixed, GPU-light living backdrop: four slow-drifting blobs in brand hues,
 * the first tinted by the current track's artwork. Radial gradients (not
 * filter: blur), so the always-on drift costs almost nothing to composite.
 * Pastel over the light canvas, glowing in the dark. Reduced-motion safe.
 */
export function AuroraBackground() {
  const song = useCurrentSong();
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const [accent, setAccent] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (song) {
      void extractAverageColor(bestImage(song.images, 150)).then((c) => alive && setAccent(c));
    }
    return () => {
      alive = false;
    };
  }, [song]);
  const tint = accent ?? 'rgba(34, 211, 238, 0.9)';
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none" aria-hidden>
      <div className="absolute inset-0 bg-ink-900" />
      <div
        className="vx-blob vx-blob-a -top-[18%] -left-[14%] w-[62vw] h-[62vw] opacity-20"
        style={{ background: `radial-gradient(circle at center, ${tint} 0%, transparent 68%)` }}
      />
      <div
        className="vx-blob vx-blob-b -top-[10%] -right-[16%] w-[52vw] h-[52vw] opacity-[0.15]"
        style={{ background: 'radial-gradient(circle at center, rgba(34, 211, 238, 0.8) 0%, transparent 68%)' }}
      />
      <div
        className="vx-blob vx-blob-c -bottom-[22%] -left-[8%] w-[56vw] h-[56vw] opacity-[0.14]"
        style={{ background: 'radial-gradient(circle at center, rgba(167, 139, 250, 0.8) 0%, transparent 68%)' }}
      />
      <div
        className="vx-blob vx-blob-d top-1/3 left-1/3 w-[64vw] h-[64vw] opacity-[0.1]"
        style={{ background: 'radial-gradient(circle at center, rgba(96, 165, 250, 0.72) 0%, transparent 70%)' }}
      />
      {/* settle when paused */}
      <div className={`absolute inset-0 transition-opacity duration-1000 ${isPlaying ? 'opacity-0' : 'opacity-40'} bg-ink-900`} />
    </div>
  );
}
