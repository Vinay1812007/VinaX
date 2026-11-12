/**
 * VinaX AI Cowork at /vinaxai/cowork: give Claude a task, watch it plan and
 * work step by step in its own workspace (commands, files, web), approve the
 * steps it asks about, and download what it made. Claude's accounts only
 * (claudeAccess.ts); everyone else sees it locked.
 *
 *   /vinaxai/cowork            new task + the list of tasks
 *   /vinaxai/cowork/:taskId    one task: timeline, approvals, files, follow-ups
 *
 * The task's stream is open while it works (or waits on an approval) and
 * closes when it is done; sending anything opens it again first, so no event
 * is missed. Opening a task reads its whole history, then the live stream,
 * applying each event once (events.ts).
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useAccount } from '@/components/useAccount';
import { toast } from '@/store/toastStore';
import { Markdown } from '../Markdown';
import { ConfirmDialog } from '../ConfirmDialog';
import { usePrefs } from '../prefs';
import { Sidebar } from '../Sidebar';
import { resetChat } from '../store';
import { ArrowLeftIcon, ArrowUpIcon, CloseIcon, FileIcon, SidebarIcon, StopIcon, TrashIcon } from '../icons';
import {
  addTaskFile, confirmTool, COWORK_KEY, coworkNotice, createTask, deleteTask, dollars, downloadOutput, getCowork, getTask, interruptTask, listOutputs,
  openStream, sendMessage, setBudget, setupCowork, taskHistory, uploadFile, type CoworkInfo, type CoworkTask, type OutputFile,
} from './api';
import { applyAll, emptyTask, isActive, pendingApprovals, titleFrom, toolLine, type CoworkEvent, type Item, type TaskState, LOCAL } from './events';

const STATUS_NAMES: Record<string, string> = { running: 'Working', idle: 'Done', rescheduling: 'Resuming', terminated: 'Ended', unknown: '…' };

function statusText(s: Pick<TaskState, 'status' | 'stopReason' | 'working'>): string {
  if (s.status === 'idle') {
    if (s.stopReason === 'requires_action') return 'Waiting for you';
    if (s.stopReason === 'budget_reached') return 'Paused at its spend cap';
    if (s.stopReason === 'retries_exhausted') return 'Stopped after an error';
    return 'Done';
  }
  return STATUS_NAMES[s.status] ?? s.status;
}

const when = (iso: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

const kb = (n: number): string => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Files picked for a task: uploaded to Anthropic's Files API one by one. */
async function uploadAll(files: File[], max: number): Promise<Array<{ id: string; name: string }>> {
  const out: Array<{ id: string; name: string }> = [];
  for (const f of files) {
    if (f.size > max) throw Object.assign(new Error('too_large'), { code: 'too_large' });
    const up = await uploadFile(f);
    out.push({ id: up.id, name: f.name });
  }
  return out;
}

export function CoworkView(): ReactNode {
  usePageTitle('Cowork');
  const { taskId } = useParams<{ taskId?: string }>();
  const navigate = useNavigate();
  const account = useAccount();
  const wide = useMediaQuery('(min-width: 1024px)');
  const prefs = usePrefs();
  const sideOpen = wide && !prefs.sidebarCollapsed;
  const info = useQuery({ queryKey: [...COWORK_KEY, account?.session ?? ''], queryFn: getCowork, staleTime: 15_000, retry: 1, enabled: !!account });
  const newChat = () => {
    resetChat();
    navigate('/vinaxai');
  };

  let body: ReactNode;
  if (!account) body = <Calm title="Sign in to use Cowork" text="Cowork works on tasks for you with Claude." />;
  else if (info.isPending) body = <p className="vx-cw-note" aria-busy="true">Loading Cowork…</p>;
  else if (info.isError) body = <Calm title="Couldn’t open Cowork" text={coworkNotice(info.error)} action={<button type="button" className="vx-ai-chip" onClick={() => void info.refetch()}>Try again</button>} />;
  else if (!info.data.allowed) body = <Calm locked title="Cowork is locked" text="Cowork runs on Claude, which isn’t open to this account. VinaX AI chat works as usual." action={<Link className="vx-ai-chip" to="/vinaxai">Back to chat</Link>} />;
  else if (!info.data.configured) body = <Calm title="Cowork isn’t set up yet" text="Add the Anthropic API key to the Worker (ANTHROPIC_API_KEY), then come back." />;
  else if (taskId) body = <TaskView key={taskId} id={taskId} info={info.data} />;
  else body = <Home info={info.data} />;

  return (
    <div className={`vx-ai vx-cw-page${sideOpen ? ' has-side' : ''}`}>
      {sideOpen && (
        <div className="vx-ai-side">
          <Sidebar onNavigate={() => undefined} onNewChat={newChat} onCollapse={() => prefs.set({ sidebarCollapsed: true })} />
        </div>
      )}
      <div className="vx-ai-pane">
        <header className="vx-ai-header">
          {wide && !taskId ? (
            !sideOpen && (
              <button type="button" className="vx-ai-icon-btn" onClick={() => prefs.set({ sidebarCollapsed: false })} aria-label="Open sidebar">
                <SidebarIcon className="w-5 h-5" />
              </button>
            )
          ) : (
            <Link to={taskId ? '/vinaxai/cowork' : '/vinaxai'} className="vx-ai-icon-btn" aria-label={taskId ? 'All tasks' : 'Back to chats'} title={taskId ? 'All tasks' : 'Back to chats'}>
              <ArrowLeftIcon className="w-5 h-5" />
            </Link>
          )}
          <div className="vx-ai-brand">
            <h1 className="vx-ai-wordmark">Cowork</h1>
          </div>
          <div className="vx-ai-header-end" />
        </header>
        <div className="vx-ai-main">{body}</div>
      </div>
    </div>
  );
}

function Calm({ title, text, action, locked }: { title: string; text: string; action?: ReactNode; locked?: boolean }): ReactNode {
  return (
    <div className="vx-ai-scroll">
      <div className="vx-ai-calm vx-cw-calm" role="status">
        {locked && <span className="vx-ai-badge">Locked</span>}
        <h2>{title}</h2>
        <p>{text}</p>
        {action}
      </div>
    </div>
  );
}

/** A new task, then the list of tasks. */
function Home({ info }: { info: CoworkInfo }): ReactNode {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [model, setModel] = useState(info.models[0]?.id ?? '');
  const [effort, setEffort] = useState(info.defaultEffort);
  const [budget, setBudgetText] = useState(((info.budgetCents ?? 500) / 100).toFixed(2));
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<CoworkTask | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  const start = async (e: FormEvent) => {
    e.preventDefault();
    const ask = text.trim();
    if (!ask || busy) return;
    const cents = Math.round(Number(budget) * 100);
    if (!Number.isFinite(cents) || cents < info.minBudgetCents || cents > info.maxBudgetCents) {
      toast(`Set a spend cap between ${dollars(info.minBudgetCents)} and ${dollars(info.maxBudgetCents)}.`);
      return;
    }
    try {
      if (!info.ready) {
        setBusy('Setting up Cowork…');
        await setupCowork();
      }
      setBusy(files.length ? 'Uploading files…' : 'Starting…');
      const uploaded = await uploadAll(files, info.maxUploadBytes);
      setBusy('Starting…');
      const { task } = await createTask({ title: titleFrom(ask), model, effort, budgetCents: cents, files: uploaded });
      const note = uploaded.length ? `\n\nAttached files (in /mnt/session/uploads/): ${uploaded.map((f) => f.name).join(', ')}` : '';
      void qc.invalidateQueries({ queryKey: COWORK_KEY });
      navigate(`/vinaxai/cowork/${encodeURIComponent(task.id)}`, { state: { firstMessage: ask + note } });
    } catch (err) {
      toast(coworkNotice(err));
      setBusy(null);
    }
  };

  const remove = async (t: CoworkTask) => {
    setToDelete(null);
    try {
      if (t.status === 'running') await interruptTask(t.id).catch(() => undefined);
      await deleteTask(t.id);
      toast('Task deleted');
    } catch (err) {
      toast(coworkNotice(err));
    }
    void qc.invalidateQueries({ queryKey: COWORK_KEY });
  };

  return (
    <div className="vx-ai-scroll">
      <div className="vx-ai-column vx-cw-home">
        <form className="vx-cw-new" onSubmit={(e) => void start(e)}>
          <h2 className="vx-cw-h">What should Claude work on?</h2>
          <p className="vx-cw-sub">Claude plans the task, works through it in its own workspace (commands, files, the web), asks before risky steps, and hands back the files it makes.</p>
          <label className="sr-only" htmlFor="vx-cw-task">Task</label>
          <textarea
            id="vx-cw-task"
            className="vx-cw-input"
            rows={5}
            placeholder="e.g. Research the top 10 Telugu film songs of 2026 and make a spreadsheet with streams, composers and release dates, plus a one-page summary."
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void start(e); }}
            disabled={!!busy}
          />
          {files.length > 0 && (
            <ul className="vx-cw-files" aria-label="Files to attach">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="vx-cw-file">
                  <FileIcon className="w-4 h-4" />
                  <span>{f.name}</span>
                  <span className="vx-cw-dim">{kb(f.size)}</span>
                  <button type="button" className="vx-ai-icon-btn" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}><CloseIcon className="w-4 h-4" /></button>
                </li>
              ))}
            </ul>
          )}
          <div className="vx-cw-options">
            <label className="vx-cw-field">
              <span>Model</span>
              <select value={model} onChange={(e) => setModel(e.target.value)} disabled={!!busy}>
                {info.models.map((m) => <option key={m.id} value={m.id}>{m.name}: {m.description}</option>)}
              </select>
            </label>
            <label className="vx-cw-field">
              <span>Effort</span>
              <select value={effort} onChange={(e) => setEffort(e.target.value)} disabled={!!busy}>
                {info.efforts.map((x) => <option key={x} value={x}>{x === 'xhigh' ? 'Extra high' : x[0].toUpperCase() + x.slice(1)}</option>)}
              </select>
            </label>
            <label className="vx-cw-field vx-cw-budget">
              <span>Spend cap (USD)</span>
              <input type="number" inputMode="decimal" min={info.minBudgetCents / 100} max={info.maxBudgetCents / 100} step="0.5" value={budget} onChange={(e) => setBudgetText(e.target.value)} disabled={!!busy} />
            </label>
          </div>
          <div className="vx-cw-actions">
            <input ref={picker} type="file" multiple hidden onChange={(e) => { setFiles([...files, ...Array.from(e.target.files ?? [])].slice(0, 20)); e.target.value = ''; }} />
            <button type="button" className="vx-ai-chip" onClick={() => picker.current?.click()} disabled={!!busy}>Attach files</button>
            <button type="submit" className="vx-ai-chip is-primary" disabled={!text.trim() || !!busy}>{busy ?? 'Start task'}</button>
          </div>
        </form>

        <section className="vx-cw-list" aria-label="Tasks">
          <h2 className="vx-cw-h">Tasks</h2>
          {!info.tasks.length && <p className="vx-cw-note">Your tasks will appear here.</p>}
          <ul>
            {info.tasks.map((t) => (
              <li key={t.id} className="vx-cw-task">
                <Link to={`/vinaxai/cowork/${encodeURIComponent(t.id)}`} className="vx-cw-task-link">
                  <span className="vx-cw-task-title">{t.title}</span>
                  <span className="vx-cw-dim">
                    <span className={`vx-cw-dot is-${t.status}`} aria-hidden /> {STATUS_NAMES[t.status] ?? t.status} · {dollars(t.costCents)}{t.budgetCents != null ? ` of ${dollars(t.budgetCents)}` : ''} · {when(t.updatedAt ?? t.createdAt)}
                  </span>
                </Link>
                <button type="button" className="vx-ai-icon-btn" aria-label={`Delete ${t.title}`} title="Delete" onClick={() => setToDelete(t)}><TrashIcon className="w-4 h-4" /></button>
              </li>
            ))}
          </ul>
        </section>
      </div>
      {toDelete && (
        <ConfirmDialog
          title="Delete this task?"
          body={`“${toDelete.title}” and everything it made (its workspace and its files) will be deleted. This can’t be undone.`}
          confirm="Delete"
          onConfirm={() => void remove(toDelete)}
          onCancel={() => setToDelete(null)}
        />
      )}
    </div>
  );
}

type Action = { type: 'events'; events: CoworkEvent[] } | { type: 'local'; text: string } | { type: 'decided'; id: string; allow: boolean };

function reducer(s: TaskState, a: Action): TaskState {
  if (a.type === 'events') return applyAll(s, a.events);
  if (a.type === 'local') return { ...s, items: [...s.items, { kind: 'user', id: `${LOCAL}${Date.now()}`, text: a.text, queued: true }] };
  return { ...s, items: s.items.map((it) => (it.kind === 'tool' && it.id === a.id ? { ...it, decided: a.allow ? 'allow' : 'deny' } : it)) };
}

/** One task: its timeline, approvals, files and follow-ups. */
function TaskView({ id, info }: { id: string; info: CoworkInfo }): ReactNode {
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [state, dispatch] = useReducer(reducer, undefined, emptyTask);
  const [meta, setMeta] = useState<CoworkTask | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [outputs, setOutputs] = useState<OutputFile[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [raise, setRaise] = useState('');
  const picker = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const live = useRef<{ ac: AbortController; open: Promise<void> } | null>(null);
  /** Reconnects in a row without an event in between: each waits longer, and after 12 the view stops trying. */
  const retries = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  usePageTitle(meta?.title ?? 'Cowork');

  const refreshOutputs = useCallback(async (retry = true) => {
    try {
      const r = await listOutputs(id);
      setOutputs(r.files);
      // Files appear a second or two after the task goes idle.
      if (retry && !r.files.length) setTimeout(() => void refreshOutputs(false), 2_500);
    } catch {
      // The list is a convenience; the timeline still says what it saved.
    }
  }, [id]);

  /** The live stream, opened once at a time; resolves when connected. */
  const connect = useCallback(async (): Promise<void> => {
    if (live.current) return live.current.open;
    const ac = new AbortController();
    const open = (async () => {
      const buffered: CoworkEvent[] = [];
      let historyDone = false;
      const { done } = await openStream(id, (ev) => {
        retries.current = 0;
        if (historyDone) dispatch({ type: 'events', events: [ev] });
        else buffered.push(ev);
      }, ac.signal);
      // Connected: read the history to cover anything before (events apply once).
      try {
        const history = await taskHistory(id, ac.signal);
        dispatch({ type: 'events', events: history });
      } catch {
        // The live stream still runs.
      }
      historyDone = true;
      dispatch({ type: 'events', events: buffered });
      setLoaded(true);
      void done.then(() => {
        if (live.current?.ac === ac) live.current = null;
        // Dropped while it was still working: reconnect, waiting longer each time it closes at once.
        if (ac.signal.aborted || !isActive(stateRef.current) || retries.current >= 12) return;
        retries.current += 1;
        setTimeout(() => void connect().catch(() => undefined), Math.min(30_000, 1_500 * retries.current));
      });
    })();
    live.current = { ac, open };
    try {
      await open;
    } catch (e) {
      if (live.current?.ac === ac) live.current = null;
      throw e;
    }
  }, [id]);

  // Open the task: its summary, then the stream (with history); the first message of a new task.
  useEffect(() => {
    let gone = false;
    getTask(id).then((r) => { if (!gone) setMeta(r.task); }).catch((e: unknown) => { if (!gone) setFailed(coworkNotice(e)); });
    const first = (location.state as { firstMessage?: string } | null)?.firstMessage;
    connect().then(async () => {
      if (gone || !first) return;
      navigate(location.pathname, { replace: true, state: null });
      dispatch({ type: 'local', text: first });
      await sendMessage(id, first);
    }).catch((e: unknown) => { if (!gone) setFailed(coworkNotice(e)); });
    void refreshOutputs(false);
    return () => {
      gone = true;
      live.current?.ac.abort();
      live.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per task (the view is keyed by id)
  }, [id]);

  // Done: close the stream, read the files, refresh the list's spend.
  const active = isActive(state);
  useEffect(() => {
    if (!loaded || active) return;
    live.current?.ac.abort();
    live.current = null;
    void refreshOutputs();
    void qc.invalidateQueries({ queryKey: COWORK_KEY });
    getTask(id).then((r) => setMeta(r.task)).catch(() => undefined);
  }, [loaded, active, id, qc, refreshOutputs]);

  // Keep the newest step in view while it works.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 240) el.scrollTop = el.scrollHeight;
  }, [state.items]);

  /** Stream first, then the event: nothing the event causes can be missed. */
  const withStream = async (send: () => Promise<unknown>): Promise<boolean> => {
    try {
      await connect();
      await send();
      return true;
    } catch (e) {
      toast(coworkNotice(e));
      return false;
    }
  };

  const approvals = pendingApprovals(state);
  const waiting = state.status === 'idle' && state.stopReason === 'requires_action';
  const capped = state.status === 'idle' && state.stopReason === 'budget_reached';
  const ended = state.status === 'terminated';
  const budgetCents = state.budgetCents ?? meta?.budgetCents ?? null;
  const costCents = state.costCents ?? meta?.costCents ?? null;

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || sending || waiting || capped || ended) return;
    setSending(true);
    dispatch({ type: 'local', text });
    setDraft('');
    const ok = await withStream(() => sendMessage(id, text));
    if (!ok) setDraft(text);
    setSending(false);
  };

  const decide = async (toolId: string, allow: boolean) => {
    dispatch({ type: 'decided', id: toolId, allow });
    await withStream(() => confirmTool(id, toolId, allow, allow ? undefined : 'The person declined this step. Find another way or ask them.'));
  };

  const raiseCap = async () => {
    const cents = Math.round(Number(raise) * 100);
    if (!Number.isFinite(cents) || cents <= (costCents ?? 0) || cents > info.maxBudgetCents) {
      toast(`Set a cap above ${dollars(costCents)} and at most ${dollars(info.maxBudgetCents)}.`);
      return;
    }
    const ok = await withStream(async () => {
      const r = await setBudget(id, cents);
      if (r.task) setMeta(r.task);
    });
    if (ok) {
      setRaise('');
      toast(`Spend cap is now ${dollars(cents)}`);
    }
  };

  const attach = async (list: FileList | null) => {
    const picked = Array.from(list ?? []).slice(0, 10);
    if (!picked.length) return;
    try {
      const up = await uploadAll(picked, info.maxUploadBytes);
      const paths: string[] = [];
      for (const f of up) paths.push((await addTaskFile(id, f.id, f.name)).path);
      setDraft((d) => `${d}${d ? '\n\n' : ''}I attached: ${paths.join(', ')}`);
      toast(up.length === 1 ? 'File added to the task' : `${up.length} files added to the task`);
    } catch (e) {
      toast(coworkNotice(e));
    }
  };

  const items = state.items;
  const outputNames = useMemo(() => new Set(outputs.map((f) => f.name)), [outputs]);

  if (failed && !loaded) return <Calm title="Couldn’t open this task" text={failed} action={<Link className="vx-ai-chip" to="/vinaxai/cowork">All tasks</Link>} />;

  return (
    <div className="vx-cw-task-view">
      <div className="vx-ai-scroll" ref={scroller}>
        <div className="vx-ai-column vx-cw-timeline">
          <div className="vx-cw-head">
            <h2 className="vx-cw-title">{meta?.title ?? 'Task'}</h2>
            <p className="vx-cw-dim" aria-live="polite">
              <span className={`vx-cw-dot is-${state.status}`} aria-hidden /> {loaded ? statusText(state) : 'Connecting…'}
              {' · '}{dollars(costCents)}{budgetCents != null ? ` of ${dollars(budgetCents)} cap` : ''}
              {meta?.model ? ` · ${info.models.find((m) => m.id === meta.model)?.name ?? meta.model}` : ''}
            </p>
          </div>
          {!loaded && <p className="vx-cw-note" aria-busy="true">Loading the task…</p>}
          <ol className="vx-cw-steps" aria-label="What Claude did">
            {items.map((it) => <Step key={it.id} item={it} onDecide={decide} outputNames={outputNames} />)}
          </ol>
          {state.working && <p className="vx-cw-working" role="status"><span className="vx-cw-pulse" aria-hidden /> Claude is working…</p>}
          {capped && (
            <div className="vx-cw-banner" role="alert">
              <p>The task paused at its spend cap ({dollars(costCents)} spent). Raise the cap to let it carry on.</p>
              <div className="vx-cw-row">
                <label className="vx-cw-field vx-cw-budget">
                  <span>New cap (USD)</span>
                  <input type="number" inputMode="decimal" step="0.5" value={raise} placeholder={(((budgetCents ?? 0) + 500) / 100).toFixed(2)} onChange={(e) => setRaise(e.target.value)} />
                </label>
                <button type="button" className="vx-ai-chip is-primary" onClick={() => void raiseCap()}>Raise cap</button>
              </div>
            </div>
          )}
          {waiting && approvals.length > 0 && <p className="vx-cw-note" role="status">Claude is waiting for you to allow or deny the step{approvals.length > 1 ? 's' : ''} above.</p>}
          {outputs.length > 0 && (
            <section className="vx-cw-outputs" aria-label="Files Claude made">
              <h3 className="vx-cw-h3">Files</h3>
              <ul>
                {outputs.map((f) => (
                  <li key={f.id} className="vx-cw-file">
                    <FileIcon className="w-4 h-4" />
                    <span>{f.name}</span>
                    <span className="vx-cw-dim">{kb(f.size)}</span>
                    <button type="button" className="vx-ai-chip" onClick={() => void downloadOutput(f).catch((e: unknown) => toast(coworkNotice(e)))}>Download</button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
      <div className="vx-ai-dock">
        <form className="vx-ai-column vx-cw-composer" onSubmit={(e) => void send(e)}>
          <input ref={picker} type="file" multiple hidden onChange={(e) => { void attach(e.target.files); e.target.value = ''; }} />
          <label className="sr-only" htmlFor="vx-cw-reply">Message Claude</label>
          <textarea
            id="vx-cw-reply"
            className="vx-cw-input"
            rows={2}
            placeholder={ended ? 'This task has ended.' : waiting ? 'Answer the step above first.' : capped ? 'Raise the spend cap to carry on.' : state.status === 'running' ? 'Add to the task (Claude reads it next)…' : 'Ask for changes or a follow-up…'}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }}
            disabled={ended || waiting || capped}
          />
          <div className="vx-cw-actions">
            <button type="button" className="vx-ai-chip" onClick={() => picker.current?.click()} disabled={ended}>Attach</button>
            {state.status === 'running' && (
              <button type="button" className="vx-ai-chip" onClick={() => void withStream(() => interruptTask(id))}>
                <StopIcon className="w-4 h-4" /> Stop
              </button>
            )}
            <button type="submit" className="vx-ai-chip is-primary" aria-label="Send" disabled={!draft.trim() || sending || ended || waiting || capped}>
              <ArrowUpIcon className="w-4 h-4" /> Send
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Step({ item, onDecide, outputNames }: { item: Item; onDecide(id: string, allow: boolean): void; outputNames: ReadonlySet<string> }): ReactNode {
  if (item.kind === 'user') {
    return (
      <li className="vx-cw-step is-user">
        <div className="vx-cw-bubble">{item.text}</div>
        {item.queued && <span className="vx-cw-dim">Queued</span>}
      </li>
    );
  }
  if (item.kind === 'text') {
    if (!item.text.trim()) return null;
    return (
      <li className={`vx-cw-step is-text${item.live ? ' is-live' : ''}`}>
        <Markdown text={item.text} />
      </li>
    );
  }
  if (item.kind === 'note') {
    return <li className={`vx-cw-step is-note${item.tone === 'error' ? ' is-error' : ''}`} role={item.tone === 'error' ? 'alert' : undefined}>{item.text}</li>;
  }
  const asking = item.permission === 'ask' && !item.decided && !item.result;
  const line = toolLine(item.name, item.input);
  const saved = item.name === 'write' && typeof item.input.file_path === 'string' && item.input.file_path.startsWith('/mnt/session/outputs/');
  const savedName = saved ? String(item.input.file_path).split('/').pop() ?? '' : '';
  return (
    <li className={`vx-cw-step is-tool${item.result?.isError || item.permission === 'deny' ? ' is-error' : ''}${asking ? ' is-asking' : ''}`}>
      <details>
        <summary>
          <span className="vx-cw-tool-line">{line}</span>
          {item.permission === 'deny' && <span className="vx-ai-badge">Blocked</span>}
          {item.decided === 'deny' && <span className="vx-ai-badge">You denied</span>}
          {item.result?.isError && item.permission !== 'deny' && <span className="vx-ai-badge">Failed</span>}
          {saved && outputNames.has(savedName) && <span className="vx-ai-badge">Saved file</span>}
          {!item.result && !asking && item.permission !== 'deny' && <span className="vx-cw-pulse" aria-label="Running" />}
        </summary>
        <pre className="vx-cw-pre" aria-label="Input">{JSON.stringify(item.input, null, 2).slice(0, 8_000)}</pre>
        {item.result && <pre className="vx-cw-pre" aria-label="Result">{item.result.text.slice(0, 12_000) || '(no output)'}</pre>}
      </details>
      {asking && (
        <div className="vx-cw-ask" role="group" aria-label="Allow this step?">
          <span>Claude wants to do this. Allow it?</span>
          <button type="button" className="vx-ai-chip is-primary" onClick={() => onDecide(item.id, true)}>Allow</button>
          <button type="button" className="vx-ai-chip" onClick={() => onDecide(item.id, false)}>Deny</button>
        </div>
      )}
    </li>
  );
}
