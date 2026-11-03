/**
 * VinaX AI — projects, inside the chat page (the sidebar and header stay):
 *
 *   /vinaxai/projects      every project, starred first; New project
 *   /vinaxai/project/:id   one project: a composer that starts a chat in it,
 *                          its chats, its instructions and its files
 *
 * Every chat in a project follows its instructions and can read its files
 * (docs/ai.md → Projects). Loaded only when a project page opens.
 */
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/store/toastStore';
import { AiError, createProject, deleteProject, getProject, listProjects, patchProject, PROJECT_LIMITS, projectNotice, PROJECTS_KEY } from './api';
import { ACCEPT, fileLimits, kindOf, MAX_IMAGE_SOURCE_BYTES, removeUpload, sendPdfText, shrinkImage, uploadBlob } from './files';
import { ArrowLeftIcon, FileIcon, FolderIcon, PaperclipIcon, PencilIcon, PlusSmallIcon, StarIcon, TrashIcon } from './icons';
import { DeleteProjectDialog, ProjectFormDialog } from './projectDialogs';
import { PaneSkeleton } from './Skeleton';
import { useChatStore } from './store';
import type { KnowledgeFile, Project, ProjectDetail } from './types';

export const projectKey = (id: string) => ['vinaxai', 'project', id] as const;

/** Starred first, then the most recently changed. */
export function sortProjects(items: readonly Project[]): Project[] {
  return [...items].sort((a, b) => (a.starred === b.starred ? (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0) : a.starred ? -1 : 1));
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const fmtChars = (n: number) => n.toLocaleString('en-US');
export const fmtSize = (bytes: number): string => (bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

function Calm({ title, body, action }: { title: string; body: string; action?: ReactNode }): ReactNode {
  return (
    <div className="vx-ai-calm" role="status">
      <FolderIcon className="w-8 h-8" />
      <h2>{title}</h2>
      <p>{body}</p>
      {action}
    </div>
  );
}

// ------------------------------------------------------------- the list

export function ProjectsList(): ReactNode {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const projects = useQuery({ queryKey: PROJECTS_KEY, queryFn: listProjects, staleTime: 30_000 });
  const items = useMemo(() => sortProjects(projects.data?.items ?? []), [projects.data]);
  const [creating, setCreating] = useState(false);
  const create = async (v: { name: string; description: string | null }) => {
    const { project } = await createProject(v);
    void qc.invalidateQueries({ queryKey: PROJECTS_KEY });
    setCreating(false);
    navigate(`/vinaxai/project/${project.id}`);
  };
  const newButton = (
    <button type="button" className="vx-ai-chip is-primary" onClick={() => setCreating(true)} aria-haspopup="dialog">
      <PlusSmallIcon className="w-4 h-4" /> New project
    </button>
  );
  return (
    <div className="vx-ai-scroll">
      <div className="vx-ai-column vx-ai-proj">
        <div className="vx-ai-proj-top">
          <h2>Projects</h2>
          {items.length > 0 && newButton}
        </div>
        {projects.isPending && <p className="vx-ai-side-note" aria-busy="true">Loading projects…</p>}
        {projects.isError && <Calm title="Couldn’t load your projects" body="Check your connection, then try again." action={<button type="button" className="vx-ai-chip" onClick={() => void projects.refetch()}>Try again</button>} />}
        {projects.isSuccess && !items.length && (
          <Calm title="Keep related chats together" body="A project holds instructions and files that every chat in it uses." action={newButton} />
        )}
        {items.length > 0 && (
          <ul className="vx-ai-proj-grid" aria-label="Your projects">
            {items.map((p) => (
              <li key={p.id}>
                <Link to={`/vinaxai/project/${p.id}`} className="vx-ai-proj-card">
                  <span className="vx-ai-proj-card-name">
                    {p.starred && <StarIcon className="w-3.5 h-3.5 vx-ai-row-star" filled />}
                    <span>{p.name}</span>
                    {p.starred && <span className="sr-only"> (starred)</span>}
                  </span>
                  {p.description && <span className="vx-ai-proj-card-desc">{p.description}</span>}
                  <span className="vx-ai-proj-card-meta">{count(p.chatCount ?? 0, 'chat', 'chats')} · {count(p.fileCount ?? 0, 'file', 'files')}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      {creating && <ProjectFormDialog onSave={create} onClose={() => setCreating(false)} />}
    </div>
  );
}

// ------------------------------------------------------- knowledge files

interface Upload { key: string; name: string; error?: string }
let seq = 0;

/** Add files to a project's knowledge: the same checks and preparation as a chat's files. */
function useKnowledgeUpload(projectId: string, detail: ProjectDetail | undefined) {
  const qc = useQueryClient();
  const [uploads, setUploads] = useState<Upload[]>([]);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: projectKey(projectId) });
    void qc.invalidateQueries({ queryKey: PROJECTS_KEY });
  };
  const fail = (key: string, error: string) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, error } : x)));
  const one = async (file: File, key: string) => {
    const kind = kindOf(file);
    try {
      if (!kind) throw new Error(`${file.name}: this type of file can’t be added. Images, PDFs and text or code files can.`);
      // The owner's size limits, the same as for a chat's files.
      const lim = fileLimits();
      if ((kind === 'pdf' && file.size > lim.pdfMB * 1024 * 1024) || (kind === 'text' && file.size > lim.textMB * 1024 * 1024) || (kind === 'image' && file.size > MAX_IMAGE_SOURCE_BYTES)) throw new Error(`${file.name} is too large.`);
      if (kind === 'image') {
        const small = await shrinkImage(file);
        await uploadBlob(small, file.name.replace(/\.[^.]+$/, '') + (small.type === 'image/webp' ? '.webp' : '.jpg'), small.type, null, undefined, projectId);
      } else if (kind === 'pdf') {
        const { readPdf } = await import('./pdf');
        const read = await readPdf(file).catch(() => null);
        if (read && read.pages > fileLimits().pdfPages) throw new Error(`${file.name} has more than ${fileLimits().pdfPages} pages.`);
        const up = await uploadBlob(file, file.name, 'application/pdf', null, undefined, projectId);
        if (read) {
          try {
            await sendPdfText(up.id, read.text, read.pages);
          } catch (e) {
            // Its text would take the project past its limit: take the file back out.
            if (e instanceof AiError && e.code === 'knowledge_full') { await removeUpload(up.id); throw e; }
          }
        }
      } else {
        await uploadBlob(file, file.name, file.type || 'text/plain', null, undefined, projectId);
      }
      setUploads((u) => u.filter((x) => x.key !== key));
      refresh();
    } catch (e) {
      fail(key, e instanceof AiError ? `${file.name}: ${projectNotice(e.code)}` : e instanceof Error ? e.message : `${file.name} couldn’t be added.`);
    }
  };
  const add = (list: FileList | File[]) => {
    const files = [...list];
    const room = (detail?.limits.files ?? PROJECT_LIMITS.files) - (detail?.files.length ?? 0) - uploads.filter((u) => !u.error).length;
    const added: Upload[] = files.map((f, i) => ({ key: `k${++seq}`, name: f.name, ...(i >= room ? { error: `${f.name}: ${projectNotice('too_many_files')}` } : {}) }));
    setUploads((u) => [...u, ...added]);
    files.forEach((f, i) => { if (i < room) void one(f, added[i].key); });
  };
  const dismiss = (key: string) => setUploads((u) => u.filter((x) => x.key !== key));
  return { uploads, add, dismiss, busy: uploads.some((u) => !u.error) };
}

function Knowledge({ projectId, detail }: { projectId: string; detail: ProjectDetail }): ReactNode {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const up = useKnowledgeUpload(projectId, detail);
  const [status, setStatus] = useState('');
  const remove = async (f: KnowledgeFile) => {
    await removeUpload(f.id);
    setStatus(`${f.name} removed.`);
    void qc.invalidateQueries({ queryKey: projectKey(projectId) });
    void qc.invalidateQueries({ queryKey: PROJECTS_KEY });
  };
  const { limits, files } = detail;
  return (
    <section className="vx-ai-proj-box" aria-labelledby="vx-ai-proj-files-h">
      <div className="vx-ai-proj-box-head">
        <h3 id="vx-ai-proj-files-h">Files</h3>
        <button type="button" className="vx-ai-chip" onClick={() => input.current?.click()} disabled={files.length >= limits.files}>
          <PaperclipIcon className="w-4 h-4" /> Add files
        </button>
        <input ref={input} type="file" multiple accept={ACCEPT} hidden tabIndex={-1} aria-hidden="true" onChange={(e) => { if (e.target.files?.length) up.add(e.target.files); e.target.value = ''; }} />
      </div>
      <p className="vx-ai-proj-hint">Every chat in this project can read these. Text, code, PDFs and images.</p>
      <p className="vx-ai-proj-usage">{count(files.length, 'file', 'files')} of {limits.files} · {fmtChars(limits.usedChars)} of {fmtChars(limits.chars)} characters of text</p>
      {(files.length > 0 || up.uploads.length > 0) && (
        <ul className="vx-ai-proj-files" aria-label="Project files">
          {files.map((f) => (
            <li key={f.id}>
              <FileIcon className="w-4 h-4" />
              <span className="vx-ai-proj-file-text">
                <span className="vx-ai-proj-file-name">{f.name}</span>
                <span className="vx-ai-opt-sub">{f.kind === 'pdf' ? `PDF${f.pages ? ` · ${f.pages} pages` : ''}` : f.kind === 'image' ? 'Image' : 'Text'} · {fmtSize(f.size)}</span>
              </span>
              <button type="button" className="vx-ai-icon-btn" onClick={() => void remove(f)} aria-label={`Remove ${f.name}`} title="Remove">
                <TrashIcon className="w-4 h-4" />
              </button>
            </li>
          ))}
          {up.uploads.map((u) => (
            <li key={u.key} className={u.error ? 'is-error' : 'is-busy'}>
              <FileIcon className="w-4 h-4" />
              <span className="vx-ai-proj-file-text">
                <span className="vx-ai-proj-file-name">{u.name}</span>
                <span className="vx-ai-opt-sub" role={u.error ? 'alert' : undefined}>{u.error ?? 'Adding…'}</span>
              </span>
              {u.error && (
                <button type="button" className="vx-ai-icon-btn" onClick={() => up.dismiss(u.key)} aria-label={`Dismiss ${u.name}`} title="Dismiss">×</button>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="sr-only" role="status" aria-live="polite">{up.busy ? 'Adding files…' : status}</p>
    </section>
  );
}

// ---------------------------------------------------------- instructions

function Instructions({ project }: { project: Project }): ReactNode {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(project.instructions ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await patchProject(project.id, { instructions: text.trim() || null });
      void qc.invalidateQueries({ queryKey: projectKey(project.id) });
      void qc.invalidateQueries({ queryKey: PROJECTS_KEY });
      setEditing(false);
      toast('Instructions saved');
      requestAnimationFrame(() => editButton.current?.focus());
    } catch (e) {
      setError(projectNotice(e instanceof AiError ? e.code : 'network'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="vx-ai-proj-box" aria-labelledby="vx-ai-proj-instr-h">
      <div className="vx-ai-proj-box-head">
        <h3 id="vx-ai-proj-instr-h">Instructions</h3>
        {!editing && (
          <button ref={editButton} type="button" className="vx-ai-chip" onClick={() => { setText(project.instructions ?? ''); setEditing(true); }}>
            <PencilIcon className="w-4 h-4" /> {project.instructions ? 'Edit' : 'Add'}
          </button>
        )}
      </div>
      {editing ? (
        <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <div className="vx-ai-field">
            <label htmlFor="vx-ai-proj-instr" className="sr-only">Project instructions</label>
            <textarea id="vx-ai-proj-instr" rows={8} autoFocus maxLength={PROJECT_LIMITS.instructions} aria-describedby="vx-ai-proj-instr-hint" value={text} placeholder="Answer as a music teacher. Use sargam notation. Keep replies under 200 words…" onChange={(e) => setText(e.target.value)} />
            <small id="vx-ai-proj-instr-hint">Every chat in this project follows these. {fmtChars(text.length)} of {fmtChars(PROJECT_LIMITS.instructions)} characters.</small>
          </div>
          {error && <p className="vx-ai-share-error" role="alert">{error}</p>}
          <div className="vx-ai-dialog-row">
            <button type="button" className="vx-ai-chip" onClick={() => { setEditing(false); setError(null); }}>Cancel</button>
            <button type="submit" className="vx-ai-chip is-primary" disabled={busy}>Save instructions</button>
          </div>
        </form>
      ) : project.instructions ? (
        <p className="vx-ai-proj-instr">{project.instructions}</p>
      ) : (
        <p className="vx-ai-proj-hint">Tell VinaX AI how to work in this project: a role, a tone, a format, what to focus on.</p>
      )}
    </section>
  );
}

// ------------------------------------------------------------ one project

export function ProjectPage({ id, composer }: { id: string; composer: ReactNode }): ReactNode {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const detail = useQuery({ queryKey: projectKey(id), queryFn: () => getProject(id), staleTime: 15_000, retry: (n, e) => !(e instanceof AiError && e.status === 404) && n < 1 });
  const [dialog, setDialog] = useState<null | 'edit' | 'delete'>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: projectKey(id) });
    void qc.invalidateQueries({ queryKey: PROJECTS_KEY });
  };
  const back = (
    <Link to="/vinaxai/projects" className="vx-ai-proj-back">
      <ArrowLeftIcon className="w-4 h-4" /> All projects
    </Link>
  );
  if (detail.isPending) return <PaneSkeleton kind="cards" label="Loading the project" />;
  if (detail.isError || !detail.data) {
    return <Calm title="This project isn’t available" body="It may have been deleted, or it belongs to another account." action={back} />;
  }
  const { project, chats } = detail.data;
  const star = () => {
    patchProject(id, { starred: !project.starred }).then(refresh, () => toast('Couldn’t update that project'));
  };
  const edit = async (v: { name: string; description: string | null }) => {
    await patchProject(id, v);
    refresh();
    setDialog(null);
  };
  const remove = async (mode: 'keep' | 'delete') => {
    const r = await deleteProject(id, mode);
    if (useChatStore.getState().projectId === id) useChatStore.getState().dispatch({ type: 'project', projectId: null });
    qc.removeQueries({ queryKey: projectKey(id) });
    void qc.invalidateQueries({ queryKey: PROJECTS_KEY });
    void qc.invalidateQueries({ queryKey: ['vinaxai', 'conversations'] });
    toast(mode === 'delete' && r.chats ? `Project and ${count(r.chats, 'chat', 'chats')} deleted` : 'Project deleted');
    navigate('/vinaxai/projects');
  };
  return (
    <div className="vx-ai-scroll">
      <div className="vx-ai-column vx-ai-proj">
        {back}
        <div className="vx-ai-proj-head">
          <h2>{project.name}</h2>
          <div className="vx-ai-proj-tools">
            <button type="button" className={`vx-ai-icon-btn${project.starred ? ' is-on' : ''}`} onClick={star} aria-pressed={project.starred} aria-label="Star project" title={project.starred ? 'Unstar' : 'Star'}>
              <StarIcon className="w-5 h-5" filled={project.starred} />
            </button>
            <button type="button" className="vx-ai-icon-btn" onClick={() => setDialog('edit')} aria-label="Edit project name and description" title="Edit" aria-haspopup="dialog">
              <PencilIcon className="w-5 h-5" />
            </button>
            <button type="button" className="vx-ai-icon-btn" onClick={() => setDialog('delete')} aria-label="Delete project" title="Delete" aria-haspopup="dialog">
              <TrashIcon className="w-5 h-5" />
            </button>
          </div>
        </div>
        {project.description && <p className="vx-ai-proj-desc">{project.description}</p>}
        <div className="vx-ai-proj-layout">
          <div className="vx-ai-proj-main">
            <section className="vx-ai-proj-new" aria-labelledby="vx-ai-proj-new-h">
              <h3 id="vx-ai-proj-new-h" className="sr-only">New chat in this project</h3>
              {composer}
            </section>
            <section aria-labelledby="vx-ai-proj-chats-h">
              <h3 id="vx-ai-proj-chats-h" className="vx-ai-proj-h">Chats in this project</h3>
              {chats.length ? (
                <ul className="vx-ai-proj-chats">
                  {chats.map((c) => (
                    <li key={c.id}>
                      <Link to={`/vinaxai/c/${c.id}`}>
                        <span className="vx-ai-proj-chat-title">{c.title ?? 'New chat'}</span>
                        <span className="vx-ai-opt-sub">{new Date(c.updatedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="vx-ai-proj-hint">No chats yet. Start one above, or move a chat here from its ⋯ menu.</p>
              )}
            </section>
          </div>
          <aside className="vx-ai-proj-side" aria-label="Project knowledge">
            <Instructions key={project.id} project={project} />
            <Knowledge projectId={id} detail={detail.data} />
          </aside>
        </div>
      </div>
      {dialog === 'edit' && <ProjectFormDialog project={project} onSave={edit} onClose={() => setDialog(null)} />}
      {dialog === 'delete' && <DeleteProjectDialog project={project} chats={chats.length} onDelete={remove} onClose={() => setDialog(null)} />}
    </div>
  );
}

/** The page for /vinaxai/projects or /vinaxai/project/:id. */
export default function ProjectsArea({ projectId, composer }: { projectId: string | null; composer: ReactNode }): ReactNode {
  return projectId ? <ProjectPage key={projectId} id={projectId} composer={composer} /> : <ProjectsList />;
}
