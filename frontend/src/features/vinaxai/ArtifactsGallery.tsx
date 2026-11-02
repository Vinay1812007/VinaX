/**
 * VinaX AI — the artifacts gallery at /vinaxai/artifacts: every page,
 * component, diagram, image, document and piece of code the listener's chats
 * made, newest first, one card per artifact per chat. Filter by kind, search
 * titles, and open a card in the artifact panel (Preview / Code, versions,
 * Copy, Download, Open chat). Cards show a kind icon rather than a live
 * preview, so the page never starts a sandbox runner per card.
 *
 *   wide (≥1024px):  [ sidebar ] [ header · filters · cards ] [ panel ]
 *   narrow:          [ header ← · filters · cards ]  + the panel as a full-screen sheet
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useDismissOnBack } from '@/hooks/useDismissOnBack';
import { ArtifactPanel } from './ArtifactPanel';
import { usePanel } from './artifactStore';
import { hasPreview } from './artifacts';
import { chatLink, galleryDate, KIND_FILTERS, kindLabel, panelVersions, useGallery, useGalleryArtifact, type GalleryKind } from './gallery';
import { usePrefs } from './prefs';
import { Sidebar } from './Sidebar';
import { resetChat } from './store';
import {
  ArrowLeftIcon, ArtifactsIcon, CloseIcon, CodeIcon, ComponentIcon, DiagramIcon, FileIcon, ImageIcon, NewChatIcon, PageIcon, SearchSmallIcon, SidebarIcon,
} from './icons';
import type { GalleryItem } from './types';

const KIND_ICON: Record<GalleryKind, (p: { className?: string }) => ReactNode> = {
  html: PageIcon, react: ComponentIcon, mermaid: DiagramIcon, svg: ImageIcon, markdown: FileIcon, code: CodeIcon,
};

const keyOf = (i: Pick<GalleryItem, 'conversationId' | 'artifactId'>): string => `${i.conversationId}/${i.artifactId}`;

function Card({ item, onOpen }: { item: GalleryItem; onOpen(): void }): ReactNode {
  const Icon = KIND_ICON[item.kind];
  return (
    // Its visible text is its name (title, kind, chat, date), so speech and sight agree.
    <button type="button" className="vx-ai-gallery-card" data-key={keyOf(item)} onClick={onOpen}>
      <span className="vx-ai-gallery-thumb" data-kind={item.kind} aria-hidden>
        <Icon className="w-7 h-7" />
      </span>
      <span className="vx-ai-gallery-text">
        <span className="vx-ai-gallery-title">{item.title}</span>
        <span className="vx-ai-gallery-meta">
          {kindLabel(item)}{item.versions > 1 ? ` · ${item.versions} versions` : ''}{item.incomplete ? ' · incomplete' : ''}
        </span>
        <span className="vx-ai-gallery-meta vx-ai-gallery-from">
          <span className="vx-ai-gallery-chat">{item.conversationTitle || 'Untitled chat'}</span>
          <span className="vx-ai-gallery-when">{'\u00a0· '}{galleryDate(item.createdAt)}</span>
        </span>
      </span>
    </button>
  );
}

/** While the versions load, or when the artifact is gone: the panel's frame with a note. */
function PanelNote({ title, note, sheet, busy }: { title: string; note: string; sheet: boolean; busy: boolean }): ReactNode {
  const close = usePanel((s) => s.close);
  useDismissOnBack(sheet, close);
  const root = useRef<HTMLElement>(null);
  useEffect(() => { if (sheet) root.current?.querySelector<HTMLElement>('button')?.focus(); }, [sheet]);
  return (
    <aside
      ref={root}
      className={`vx-ai-artifact${sheet ? ' is-sheet' : ''}`}
      style={sheet ? undefined : { flexBasis: `${usePanel.getState().width}%` }}
      aria-label={`Artifact: ${title}`}
      aria-busy={busy || undefined}
      {...(sheet ? { role: 'dialog', 'aria-modal': true } : {})}
      onKeyDown={(e) => { if (e.key === 'Escape' && sheet) { e.stopPropagation(); close(); } }}
    >
      <header className="vx-ai-artifact-head">
        <div className="vx-ai-artifact-title"><h2>{title}</h2></div>
        <div className="vx-ai-artifact-tools">
          <button type="button" className="vx-ai-act" onClick={close} aria-label="Close the artifact" title="Close">
            <CloseIcon className="w-4 h-4" />
          </button>
        </div>
      </header>
      <p className="vx-ai-gallery-note" role="status">{note}</p>
    </aside>
  );
}

export function ArtifactsGallery(): ReactNode {
  usePageTitle('Artifacts');
  const navigate = useNavigate();
  const wide = useMediaQuery('(min-width: 1024px)');
  const prefs = usePrefs();
  const sideOpen = wide && !prefs.sidebarCollapsed;

  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQ(search.replace(/\s+/g, ' ').trim()), 250);
    return () => clearTimeout(t);
  }, [search]);
  const [kind, setKind] = useState<GalleryKind | null>(null);
  const list = useGallery(kind, q);
  const items = useMemo(() => list.data?.pages.flatMap((p) => (Array.isArray(p?.items) ? p.items : [])) ?? [], [list.data]);

  // The open card: its versions load while the panel shows a note.
  const panel = usePanel();
  const [current, setCurrent] = useState<GalleryItem | null>(null);
  const one = useGalleryArtifact(current);
  const versions = useMemo(() => panelVersions(one.data?.artifact), [one.data]);
  const lastOpened = useRef<string | null>(null);
  const grid = useRef<HTMLUListElement>(null);
  const open = (item: GalleryItem) => {
    lastOpened.current = keyOf(item);
    setCurrent(item);
    usePanel.getState().show(keyOf(item), null, { tab: hasPreview(item.kind) ? 'preview' : 'code' });
  };
  // Closing the panel hands focus back to its card.
  useEffect(() => {
    if (panel.open) return;
    setCurrent(null);
    const k = lastOpened.current;
    if (!k) return;
    lastOpened.current = null;
    [...(grid.current?.querySelectorAll<HTMLElement>('[data-key]') ?? [])].find((el) => el.dataset.key === k)?.focus();
  }, [panel.open]);
  // Leaving the page closes the panel.
  useEffect(() => () => usePanel.getState().close(), []);

  const openChat = (messageId: string) => {
    if (!current) return;
    navigate(chatLink(current.conversationId, messageId, current.artifactId));
  };
  const newChat = () => {
    resetChat();
    navigate('/vinaxai');
  };

  // More cards as the end of the list scrolls near (Load more does the same).
  const scroller = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = list;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage) void fetchNextPage();
    }, { root: scroller.current, rootMargin: '400px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const filtered = !!q || kind !== null;
  let status: ReactNode = null;
  if (list.isPending) status = <p className="vx-ai-gallery-note" aria-busy="true">Loading artifacts…</p>;
  else if (list.isError) {
    status = (
      <div className="vx-ai-gallery-note" role="alert">
        <p>Couldn’t load your artifacts.</p>
        <button type="button" className="vx-ai-chip" onClick={() => void list.refetch()}>Try again</button>
      </div>
    );
  } else if (!items.length) {
    status = filtered ? (
      <p className="vx-ai-gallery-note" role="status">No artifacts match that.</p>
    ) : (
      <div className="vx-ai-calm vx-ai-gallery-empty" role="status">
        <ArtifactsIcon className="w-8 h-8" />
        <h2>No artifacts yet</h2>
        <p>When VinaX AI makes a page, a component, a diagram, an image, a document or code in a chat, you’ll find it here.</p>
        <button type="button" className="vx-ai-chip" onClick={newChat}>Start a chat</button>
      </div>
    );
  }

  const title = current?.title ?? 'Artifact';
  return (
    <div className={`vx-ai vx-ai-gallery-page${sideOpen ? ' has-side' : ''}`}>
      {sideOpen && (
        <div className="vx-ai-side">
          <Sidebar onNavigate={() => undefined} onNewChat={newChat} onCollapse={() => prefs.set({ sidebarCollapsed: true })} />
        </div>
      )}
      <div className="vx-ai-pane">
        <header className="vx-ai-header">
          {wide ? (
            !sideOpen && (
              <button type="button" className="vx-ai-icon-btn" onClick={() => prefs.set({ sidebarCollapsed: false })} aria-label="Open sidebar">
                <SidebarIcon className="w-5 h-5" />
              </button>
            )
          ) : (
            <Link to="/vinaxai" className="vx-ai-icon-btn" aria-label="Back to chats" title="Back to chats">
              <ArrowLeftIcon className="w-5 h-5" />
            </Link>
          )}
          <div className="vx-ai-brand">
            <h1 className="vx-ai-wordmark">Artifacts</h1>
          </div>
          <div className="vx-ai-header-end">
            {!sideOpen && (
              <button type="button" className="vx-ai-icon-btn" onClick={newChat} aria-label="New chat" title="New chat">
                <NewChatIcon className="w-5 h-5" />
              </button>
            )}
          </div>
        </header>
        <div className="vx-ai-main">
          <div className="vx-ai-scroll" ref={scroller}>
            <div className="vx-ai-gallery">
              <div className="vx-ai-gallery-tools">
                <div className="vx-ai-side-search vx-ai-gallery-search">
                  <SearchSmallIcon className="w-4 h-4" />
                  <input type="search" aria-label="Search artifacts" placeholder="Search artifacts" value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
                <div className="vx-ai-gallery-kinds" role="group" aria-label="Kind">
                  {KIND_FILTERS.map((f) => (
                    <button key={f.label} type="button" className={`vx-ai-chip${kind === f.kind ? ' is-primary' : ''}`} aria-pressed={kind === f.kind} onClick={() => setKind(f.kind)}>
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
              {status}
              {items.length > 0 && (
                <ul className="vx-ai-gallery-grid" ref={grid} aria-label="Artifacts" aria-busy={list.isFetching || undefined}>
                  {items.map((item) => (
                    <li key={keyOf(item)}>
                      <Card item={item} onOpen={() => open(item)} />
                    </li>
                  ))}
                </ul>
              )}
              <div ref={sentinel} aria-hidden />
              {list.hasNextPage && (
                <div className="vx-ai-gallery-more">
                  <button type="button" className="vx-ai-chip" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}>
                    {list.isFetchingNextPage ? 'Loading…' : 'Load more'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      {panel.open && current && (versions.length ? (
        <ArtifactPanel versions={versions} live={false} sheet={!wide} from={one.data?.artifact.conversationTitle || current.conversationTitle || 'Untitled chat'} onOpenChat={openChat} />
      ) : (
        <PanelNote title={title} sheet={!wide} busy={one.isPending} note={one.isError ? 'This artifact isn’t available any more. Its chat may have been deleted.' : 'Loading…'} />
      ))}
    </div>
  );
}
