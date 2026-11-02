/**
 * VinaX AI — the artifacts gallery's data: the list (pages of cards, newest
 * first, by kind and title) and one artifact with its versions. Both read
 * what the chats already saved; nothing new is kept.
 */
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { AiError, getArtifact, listArtifacts } from './api';
import type { Artifact } from './artifacts';
import type { GalleryArtifact, GalleryItem } from './types';

export const GALLERY_KEY = ['vinaxai', 'artifacts'] as const;

export type GalleryKind = GalleryItem['kind'];

/** The filter chips, in order. */
export const KIND_FILTERS: Array<{ kind: GalleryKind | null; label: string }> = [
  { kind: null, label: 'All' },
  { kind: 'html', label: 'Pages' },
  { kind: 'react', label: 'Components' },
  { kind: 'mermaid', label: 'Diagrams' },
  { kind: 'svg', label: 'Images' },
  { kind: 'markdown', label: 'Documents' },
  { kind: 'code', label: 'Code' },
];

const KIND_NAME: Record<GalleryKind, string> = {
  html: 'HTML page', react: 'React component', mermaid: 'Diagram', svg: 'SVG', markdown: 'Document', code: 'Code',
};

/** What a card calls its kind: "Code · Python" names the language. */
export function kindLabel(item: Pick<GalleryItem, 'kind' | 'language'>): string {
  if (item.kind !== 'code' || !item.language) return KIND_NAME[item.kind];
  const lang = item.language.trim();
  return `Code · ${lang.length <= 3 ? lang.toUpperCase() : lang.slice(0, 1).toUpperCase() + lang.slice(1)}`;
}

/** "Today", "Yesterday", "3 Nov" or "3 Nov 2025". */
export function galleryDate(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, d.getFullYear() === now.getFullYear() ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
}

/** The gallery's cards for a kind and a title search, a page at a time. */
export function useGallery(kind: GalleryKind | null, q: string) {
  return useInfiniteQuery({
    queryKey: [...GALLERY_KEY, 'list', kind ?? 'all', q],
    queryFn: ({ pageParam }) => listArtifacts({ kind, q, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last?.nextCursor ?? null,
    staleTime: 30_000,
  });
}

/** One artifact with every version's content, while a card is open. */
export function useGalleryArtifact(item: Pick<GalleryItem, 'conversationId' | 'artifactId'> | null) {
  return useQuery({
    queryKey: [...GALLERY_KEY, 'one', item?.conversationId ?? '', item?.artifactId ?? ''],
    queryFn: () => getArtifact(item!.conversationId, item!.artifactId),
    enabled: !!item,
    staleTime: 60_000,
    retry: (n, e) => !(e instanceof AiError && e.status === 404) && n < 1,
  });
}

/** The versions in the shape the artifact panel takes. */
export function panelVersions(a: GalleryArtifact | undefined): Array<{ messageId: string; artifact: Artifact }> {
  if (!a) return [];
  return a.versions.map((v) => ({
    messageId: v.messageId,
    artifact: { id: a.artifactId, type: v.type, title: v.title, language: v.language, content: v.content, incomplete: v.incomplete },
  }));
}

/** The chat address that opens on the reply (and its artifact). */
export const chatLink = (conversationId: string, messageId: string, artifactId: string): string =>
  `/vinaxai/c/${encodeURIComponent(conversationId)}?m=${encodeURIComponent(messageId)}&a=${encodeURIComponent(artifactId)}`;
