import { useEffect, useRef, useState, type ReactNode } from 'react';
import { DownloadIcon } from '@/components/Icons';
import { usePlayerStore } from '@/store/playerStore';
import { dataUrlToBlob, mediaAttribution, mediaFileName } from './media';
import { ProviderLogo } from './ProviderLogo';
import type { MsgMedia } from './types';

/**
 * 10.3 — a picture or a music clip made in the chat, with who made it and a
 * Download link. Media is never kept on the device (storage.ts empties `src`
 * before a chat is saved), so after a reload the card is one quiet line.
 *
 * A clip never plays by itself. When it starts, the main player pauses (the
 * video page's rule: one sound at a time), and when the main player starts
 * again, the clip pauses.
 */
export function MediaCard({ media }: { media: MsgMedia }): ReactNode {
  const audioRef = useRef<HTMLAudioElement>(null);
  // A clip plays from a blob: URL — the content policy allows no data: audio.
  const [clipUrl, setClipUrl] = useState<string | null>(null);
  useEffect(() => {
    if (media.kind !== 'music' || !media.src) return;
    const blob = dataUrlToBlob(media.src);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    setClipUrl(url);
    return () => {
      URL.revokeObjectURL(url);
      setClipUrl(null);
    };
  }, [media.kind, media.src]);
  useEffect(() => {
    if (media.kind !== 'music' || !media.src) return;
    return usePlayerStore.subscribe((st, prev) => {
      if (st.isPlaying && !prev.isPlaying) audioRef.current?.pause();
    });
  }, [media.kind, media.src]);

  const by = (
    <span className="ai-media-by">
      {media.provider && <ProviderLogo provider={media.provider} size={14} />}
      <span className="min-w-0 truncate">Made with {mediaAttribution(media)}</span>
    </span>
  );

  if (!media.src) {
    return (
      <div className="ai-media ai-media-gone" data-media={media.kind}>
        <p>
          {media.kind === 'image'
            ? 'Pictures aren’t kept on this device — ask again to make a new one.'
            : 'Music clips aren’t kept on this device — ask again to make a new one.'}
        </p>
        <div className="ai-media-cap">{by}</div>
      </div>
    );
  }

  return (
    <figure className="ai-media" data-media={media.kind}>
      {media.kind === 'image' ? (
        <img src={media.src} alt={media.prompt ? `Picture of: ${media.prompt}` : 'Created picture'} className="ai-media-img" />
      ) : (
        <audio
          ref={audioRef}
          src={clipUrl ?? undefined}
          controls
          preload="metadata"
          className="ai-media-audio"
          aria-label={media.prompt ? `Music clip: ${media.prompt}` : 'Music clip'}
          onPlay={() => {
            const st = usePlayerStore.getState();
            if (st.isPlaying) st.togglePlay();
          }}
        />
      )}
      <figcaption className="ai-media-cap">
        {by}
        <a href={media.kind === 'music' ? (clipUrl ?? media.src) : media.src} download={mediaFileName(media)} className="ai-btn ai-media-dl">
          <DownloadIcon className="w-4 h-4" /> Download
        </a>
      </figcaption>
    </figure>
  );
}
