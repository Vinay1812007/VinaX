import { describe, expect, it } from 'vitest';
import { videoSources, type Video } from './videos';

const video = (over: Partial<Video> = {}): Video =>
  ({
    id: 'v1',
    title: 'Song',
    subtitle: '',
    language: null,
    year: null,
    duration: null,
    thumbnail: null,
    previewUrl: 'https://v/preview.mp4',
    streamUrl: 'https://v/full.mp4',
    artists: [],
    songIds: [],
    ...over,
  }) as Video;

describe('videoSources', () => {
  it('tries the preview clip first, so a video never waits on the full stream 404', () => {
    expect(videoSources(video())).toEqual(['https://v/preview.mp4', 'https://v/full.mp4']);
  });

  it('falls back to whichever exists, once each', () => {
    expect(videoSources(video({ previewUrl: null }))).toEqual(['https://v/full.mp4']);
    expect(videoSources(video({ streamUrl: null }))).toEqual(['https://v/preview.mp4']);
    expect(videoSources(video({ streamUrl: 'https://v/preview.mp4' }))).toEqual(['https://v/preview.mp4']);
    expect(videoSources(video({ previewUrl: null, streamUrl: null }))).toEqual([]);
  });
});
