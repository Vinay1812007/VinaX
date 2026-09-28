// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '@/types';

vi.mock('@/services/native', () => ({ isNativePlatform: () => false }));

import {
  __resetEmbeddingsForTests,
  activeEmbeddingModel,
  cosine,
  embedQuery,
  embedQueryDetailed,
  embedSongs,
  eraseEmbeddings,
  getCachedEmbedding,
  songPassage,
  type StoredVector,
  type VectorStore,
} from './embeddings';
import { useSettingsStore } from '@/store/settingsStore';

const song = (id: string, over: Partial<Song> = {}): Song =>
  ({ kind: 'song', id, title: `Title ${id}`, subtitle: 'Singer', artists: [{ id: 'a', name: 'Singer' }], album: null, images: [], audio: [], duration: null, language: 'telugu', year: '2020', explicit: false, hasLyrics: false, playCount: null, ...over }) as Song;

function memoryStore(rows: StoredVector[] = []): VectorStore & { rows: StoredVector[] } {
  return {
    rows,
    load: async (model) => rows.filter((r) => r.model === model),
    put: async (add) => {
      for (const r of add) {
        const i = rows.findIndex((x) => x.key === r.key);
        if (i >= 0) rows[i] = r;
        else rows.push(r);
      }
    },
    prune: async () => undefined,
  };
}

const vec = (seed: number, dim = 16): number[] => Array.from({ length: dim }, (_, i) => Math.sin(seed * 7 + i) + 0.01);

interface Sent {
  texts: string[];
  kind: string;
  prefer?: string;
}

function stubEmbed(model = 'model-a', status = 200): Sent[] {
  const sent: Sent[] = [];
  vi.stubGlobal('fetch', async (_url: unknown, init?: { body?: string }) => {
    const body = JSON.parse(init?.body ?? '{}') as Sent;
    sent.push(body);
    if (status !== 200) return new Response(JSON.stringify({ error: 'no_engine' }), { status });
    return new Response(JSON.stringify({ model, dim: 16, vectors: body.texts.map((_, i) => vec(i + body.texts.length)) }), { status: 200 });
  });
  return sent;
}

beforeEach(() => {
  window.localStorage.clear();
  __resetEmbeddingsForTests(memoryStore());
  useSettingsStore.setState({ aiAssist: true });
});
afterEach(() => vi.unstubAllGlobals());

describe('songPassage', () => {
  it('describes the song from its metadata', () => {
    const p = songPassage(song('1', { album: { id: 'al', name: 'Album X' }, genre: 'folk', mood: 'melancholy', vibes: ['rainy'] }));
    expect(p).toBe('Title 1 by Singer. Album: Album X. Language: telugu. Year: 2020. Genre: folk. Mood: melancholy. Vibe: rainy');
  });
});

describe('embedSongs / getCachedEmbedding', () => {
  it('batches by 64, de-duplicates, and serves unit vectors synchronously afterwards', async () => {
    const sent = stubEmbed();
    const songs = Array.from({ length: 70 }, (_, i) => song(`s${i}`));
    await embedSongs([...songs, songs[0], songs[1]]);
    expect(sent.map((s) => s.texts.length)).toEqual([64, 6]);
    expect(sent[0].kind).toBe('passage');
    const v = getCachedEmbedding('s5')!;
    expect(v).toBeInstanceOf(Float32Array);
    expect(Math.hypot(...v)).toBeCloseTo(1, 5);
    expect(activeEmbeddingModel()).toBe('model-a');
    // Already cached: no second request.
    await embedSongs(songs.slice(0, 3));
    expect(sent).toHaveLength(2);
  });

  it('persists vectors keyed by model and hydrates them on a fresh start', async () => {
    const store = memoryStore();
    __resetEmbeddingsForTests(store);
    stubEmbed('model-a');
    await embedSongs([song('x')]);
    await new Promise((r) => setTimeout(r, 0));
    expect(store.rows.map((r) => r.key)).toEqual(['model-a:x']);
    // A fresh start with the same store: the vector comes back without a request.
    __resetEmbeddingsForTests(store);
    expect(activeEmbeddingModel()).toBe('model-a');
    const sent = stubEmbed('model-a');
    expect(getCachedEmbedding('x')).toBeNull(); // first read starts the load
    await new Promise((r) => setTimeout(r, 0));
    expect(getCachedEmbedding('x')).not.toBeNull();
    await embedSongs([song('x')]);
    expect(sent).toHaveLength(0);
  });

  it('sends the active model as prefer and switches spaces when the server changes model', async () => {
    stubEmbed('model-a');
    await embedSongs([song('a1')]);
    expect(getCachedEmbedding('a1')).not.toBeNull();
    const sent = stubEmbed('model-b');
    await embedSongs([song('b1')]);
    expect(sent[0].prefer).toBe('model-a');
    expect(activeEmbeddingModel()).toBe('model-b');
    // model-a vectors are a different space: no longer served.
    expect(getCachedEmbedding('a1')).toBeNull();
    expect(getCachedEmbedding('b1')).not.toBeNull();
  });

  it('erases every vector, the remembered model and the database (Erase everything)', async () => {
    stubEmbed('model-a');
    await embedSongs([song('e1')]);
    expect(getCachedEmbedding('e1')).not.toBeNull();
    const deleted: string[] = [];
    const idb = window.indexedDB;
    Object.defineProperty(window, 'indexedDB', {
      configurable: true,
      value: {
        deleteDatabase: (name: string) => {
          deleted.push(name);
          const req: { onsuccess?: () => void } = {};
          setTimeout(() => req.onsuccess?.(), 0);
          return req;
        },
      },
    });
    try {
      await eraseEmbeddings();
    } finally {
      Object.defineProperty(window, 'indexedDB', { configurable: true, value: idb });
    }
    expect(deleted).toEqual(['vinax-embeddings']);
    expect(getCachedEmbedding('e1')).toBeNull();
    expect(activeEmbeddingModel()).toBeNull();
  });

  it('backs off after a failure instead of retrying every call', async () => {
    const sent = stubEmbed('model-a', 503);
    await embedSongs([song('f1')]);
    await embedSongs([song('f2')]);
    expect(sent).toHaveLength(1);
    expect(getCachedEmbedding('f1')).toBeNull();
    expect(await embedQuery('sad songs')).toBeNull();
  });

  it('stays off the network when the listener turned AI assist off', async () => {
    useSettingsStore.setState({ aiAssist: false });
    const sent = stubEmbed();
    await embedSongs([song('o1')]);
    expect(await embedQuery('anything')).toBeNull();
    expect(sent).toHaveLength(0);
  });

  it('never throws on a malformed answer', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ model: 'm', vectors: [[1, 'x']] }), { status: 200 }));
    await expect(embedSongs([song('bad')])).resolves.toBeUndefined();
    expect(getCachedEmbedding('bad')).toBeNull();
  });
});

describe('embedQuery', () => {
  it('asks for a query vector, caches it, and returns it in the active space', async () => {
    const sent = stubEmbed('model-a');
    const v = await embedQuery('sad telugu songs');
    expect(v).not.toBeNull();
    expect(sent[0]).toMatchObject({ texts: ['sad telugu songs'], kind: 'query' });
    const again = await embedQueryDetailed('sad telugu songs');
    expect(again?.model).toBe('model-a');
    expect(sent).toHaveLength(1);
  });
});

describe('cosine', () => {
  it('is 0 for missing or mismatched vectors', () => {
    expect(cosine(null, new Float32Array([1]))).toBe(0);
    expect(cosine(new Float32Array([1, 0]), new Float32Array([1]))).toBe(0);
    expect(cosine(new Float32Array([0.6, 0.8]), new Float32Array([0.6, 0.8]))).toBeCloseTo(1, 5);
  });
});
