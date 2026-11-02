/**
 * VinaX AI — the project dialogs: New project / Edit details, Delete project
 * (keep its chats or delete them too) and Move to project. Each moves focus
 * in, keeps Tab inside, closes on Escape or the back button and gives focus
 * back. Loaded only when one opens.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useDismissOnBack } from '@/hooks/useDismissOnBack';
import { toast } from '@/store/toastStore';
import { AiError, listProjects, patchConversation, PROJECT_LIMITS, projectNotice, PROJECTS_KEY } from './api';
import { CheckIcon, CloseIcon, FolderIcon } from './icons';
import { useChatStore } from './store';
import type { ConversationSummary, Project } from './types';

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), a[href], [role="radio"]';

/** A modal box: focus in on open, Tab kept inside, Escape and back close it, focus back on close. */
export function Modal({ label, onClose, className, children, role = 'dialog' }: { label: string; onClose(): void; className?: string; children: ReactNode; role?: 'dialog' | 'alertdialog' }): ReactNode {
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDismissOnBack(true, onClose);
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    const first = box.current?.querySelector<HTMLElement>('[data-autofocus]') ?? box.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    return () => back?.focus?.();
  }, []);
  return (
    <div className="vx-ai-scrim" onClick={onClose}>
      <div
        ref={box}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        className={`vx-ai-dialog vx-ai-share${className ? ` ${className}` : ''}`}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
          if (e.key === 'Tab') {
            const f = [...(box.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter((el) => el.tabIndex >= 0);
            if (!f.length) return;
            const i = f.indexOf(document.activeElement as HTMLElement);
            e.preventDefault();
            f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length]?.focus();
          }
        }}
      >
        <div className="vx-ai-share-head">
          <h2 id={titleId}>{label}</h2>
          <button type="button" className="vx-ai-icon-btn" onClick={onClose} aria-label="Close">
            <CloseIcon className="w-5 h-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** New project, or Edit details of one: a name (required) and a description. */
export function ProjectFormDialog({ project, onSave, onClose }: { project?: Project; onSave(v: { name: string; description: string | null }): Promise<void>; onClose(): void }): ReactNode {
  const [name, setName] = useState(project?.name ?? '');
  const [description, setDescription] = useState(project?.description ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clean = name.replace(/\s+/g, ' ').trim();
  const submit = async () => {
    if (!clean || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSave({ name: clean, description: description.trim() || null });
    } catch (e) {
      setError(projectNotice(e instanceof AiError ? e.code : 'network'));
      setBusy(false);
    }
  };
  return (
    <Modal label={project ? 'Edit project' : 'New project'} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <div className="vx-ai-field">
          <label htmlFor="vx-ai-proj-name">Name</label>
          <input id="vx-ai-proj-name" data-autofocus type="text" required maxLength={PROJECT_LIMITS.name} value={name} placeholder="Raga study" onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="vx-ai-field">
          <label htmlFor="vx-ai-proj-desc">Description <span className="vx-ai-optional">(optional)</span></label>
          <textarea id="vx-ai-proj-desc" rows={3} maxLength={PROJECT_LIMITS.description} value={description} placeholder="What this project is for" onChange={(e) => setDescription(e.target.value)} />
        </div>
        {error && <p className="vx-ai-share-error" role="alert">{error}</p>}
        <div className="vx-ai-dialog-row">
          <button type="button" className="vx-ai-chip" onClick={onClose}>Cancel</button>
          <button type="submit" className="vx-ai-chip is-primary" disabled={!clean || busy}>{project ? 'Save' : 'Create project'}</button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Delete a project. Its files always go. Its chats stay as ordinary chats
 * unless "Delete its chats too" is picked: keeping them is the default, as
 * the less destructive choice.
 */
export function DeleteProjectDialog({ project, chats, onDelete, onClose }: { project: Project; chats: number; onDelete(mode: 'keep' | 'delete'): Promise<void>; onClose(): void }): ReactNode {
  const [mode, setMode] = useState<'keep' | 'delete'>('keep');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = chats === 1 ? '1 chat' : `${chats} chats`;
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      await onDelete(mode);
    } catch (e) {
      setError(projectNotice(e instanceof AiError ? e.code : 'network'));
      setBusy(false);
    }
  };
  return (
    <Modal label="Delete this project?" onClose={onClose} role="alertdialog">
      <p>“{project.name}”, its instructions and its files will be deleted. This can’t be undone.</p>
      {chats > 0 && (
        <fieldset className="vx-ai-choice">
          <legend>Its {n}</legend>
          <label><input type="radio" name="vx-ai-del-chats" checked={mode === 'keep'} onChange={() => setMode('keep')} /> Keep them as ordinary chats</label>
          <label><input type="radio" name="vx-ai-del-chats" checked={mode === 'delete'} onChange={() => setMode('delete')} /> Delete them too</label>
        </fieldset>
      )}
      {error && <p className="vx-ai-share-error" role="alert">{error}</p>}
      <div className="vx-ai-dialog-row">
        <button type="button" className="vx-ai-chip" data-autofocus onClick={onClose}>Cancel</button>
        <button type="button" className="vx-ai-chip is-danger" disabled={busy} onClick={() => void go()}>Delete project</button>
      </div>
    </Modal>
  );
}

/** Move a chat into a project, to another one, or out of its project. */
export function MoveToProjectDialog({ chat, onClose }: { chat: ConversationSummary; onClose(): void }): ReactNode {
  const qc = useQueryClient();
  const projects = useQuery({ queryKey: PROJECTS_KEY, queryFn: listProjects, staleTime: 30_000 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = chat.projectId ?? null;
  const items = projects.data?.items ?? [];
  const move = async (to: Project | null) => {
    if (busy) return;
    if ((to?.id ?? null) === current) { onClose(); return; }
    setBusy(true);
    setError(null);
    try {
      await patchConversation(chat.id, { projectId: to?.id ?? null });
      if (useChatStore.getState().conversationId === chat.id) useChatStore.getState().dispatch({ type: 'project', projectId: to?.id ?? null });
      void qc.invalidateQueries({ queryKey: ['vinaxai', 'conversations'] });
      void qc.invalidateQueries({ queryKey: PROJECTS_KEY });
      void qc.invalidateQueries({ queryKey: ['vinaxai', 'project'] });
      toast(to ? `Moved to ${to.name}` : 'Removed from its project');
      onClose();
    } catch (e) {
      setError(projectNotice(e instanceof AiError ? e.code : 'network'));
      setBusy(false);
    }
  };
  const option = (p: Project | null) => {
    const on = (p?.id ?? null) === current;
    return (
      <li key={p?.id ?? 'none'}>
        <button type="button" className="vx-ai-move-opt" aria-current={on ? 'true' : undefined} disabled={busy} onClick={() => void move(p)}>
          <FolderIcon className="w-4 h-4" />
          <span>{p ? p.name : 'No project'}</span>
          {on && <CheckIcon className="w-4 h-4 vx-ai-move-check" />}
        </button>
      </li>
    );
  };
  return (
    <Modal label="Move to project" onClose={onClose}>
      <p className="vx-ai-share-note">“{chat.title ?? 'New chat'}” follows the instructions and can read the files of the project it is in.</p>
      {projects.isPending && <p className="vx-ai-share-note" aria-busy="true">Loading projects…</p>}
      {projects.isError && <p className="vx-ai-share-error" role="alert">Couldn’t load your projects.</p>}
      {projects.isSuccess && (
        <ul className="vx-ai-move-list" aria-label="Projects">
          {items.map(option)}
          {current && option(null)}
        </ul>
      )}
      {projects.isSuccess && !items.length && (
        <p className="vx-ai-share-note">You have no projects yet. <Link to="/vinaxai/projects" onClick={onClose}>Create one</Link>.</p>
      )}
      {error && <p className="vx-ai-share-error" role="alert">{error}</p>}
    </Modal>
  );
}
