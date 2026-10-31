/**
 * A fake Supabase Storage for the VinaX AI attachment tests: answers the
 * object upload / download / remove calls the Worker makes, and keeps the
 * bytes in memory. Use it as fakeDb's fallback (or inside one).
 */
import { DB_URL } from './fakeDb';

export interface FakeStorage {
  objects: Map<string, { bytes: Uint8Array; mime: string; length: string | null }>;
  removed: string[];
  /** Answer a non-database request, or null when it is not for Storage. */
  handle(url: string, init?: RequestInit): Promise<Response> | null;
}

async function bodyBytes(body: unknown): Promise<Uint8Array> {
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (body instanceof ReadableStream) return new Uint8Array(await new Response(body).arrayBuffer());
  if (typeof body === 'string') return new TextEncoder().encode(body);
  return new Uint8Array(await new Response(body as BodyInit).arrayBuffer());
}

export function fakeStorage(): FakeStorage {
  const objects: FakeStorage['objects'] = new Map();
  const removed: string[] = [];
  const base = `${DB_URL}/storage/v1/object/ai-attachments`;
  return {
    objects,
    removed,
    handle(url, init) {
      if (!url.startsWith(base)) return null;
      const method = init?.method ?? 'GET';
      const path = decodeURIComponent(url.slice(base.length + 1));
      return (async () => {
        if (method === 'POST') {
          if (objects.has(path)) return new Response('{"error":"Duplicate"}', { status: 400 });
          const h = init?.headers as Record<string, string>;
          try {
            objects.set(path, { bytes: await bodyBytes(init?.body), mime: h['content-type'], length: h['content-length'] ?? null });
          } catch {
            return new Response('{"error":"broken body"}', { status: 400 });
          }
          return new Response('{"Key":"x"}', { status: 200 });
        }
        if (method === 'DELETE') {
          const { prefixes } = JSON.parse(String(init?.body)) as { prefixes: string[] };
          for (const p of prefixes) { objects.delete(p); removed.push(p); }
          return new Response('[]', { status: 200 });
        }
        const o = objects.get(path);
        return o ? new Response(new Uint8Array(o.bytes), { status: 200, headers: { 'content-type': o.mime } }) : new Response('{}', { status: 404 });
      })();
    },
  };
}
