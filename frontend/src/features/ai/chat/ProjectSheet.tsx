import { useState } from 'react';
import { Sheet, SheetHeader } from '@/components/Sheet';
import {
  MAX_FILES_PER_PROJECT,
  MAX_FILE_CHARS,
  MAX_INSTRUCTIONS,
  addProjectFile,
  createProject,
  deleteProject,
  loadProjects,
  removeProjectFile,
  renameProject,
  setInstructions,
  type Project,
} from '../projects';
import { ChatStyleMark } from './ChatStyleScope';

/**
 * 9.1.0 — managing projects: create one, write its standing instructions, attach
 * reference files, and choose which project the current chat belongs to.
 *
 * Deliberately one sheet rather than a route: a project is a small amount of
 * text, and the listener is in the middle of a conversation when they reach for
 * it. Everything saves as it is typed (on blur), so there is no Save button to
 * forget.
 */
export function ProjectSheet({
  currentChatProjectId,
  onAssign,
  onClose,
}: {
  currentChatProjectId: string | undefined;
  /** Put the current chat in this project, or in none. */
  onAssign: (projectId: string | undefined) => void;
  onClose: () => void;
}) {
  const [projects, setProjects] = useState<Project[]>(loadProjects);
  const [openId, setOpenId] = useState<string | null>(currentChatProjectId ?? null);
  const [newName, setNewName] = useState('');
  const [fileName, setFileName] = useState('');
  const [fileBody, setFileBody] = useState('');
  const [note, setNote] = useState('');
  const refresh = (): void => setProjects(loadProjects());
  const open = projects.find((p) => p.id === openId) ?? null;

  const say = (text: string): void => {
    setNote(text);
    window.setTimeout(() => setNote(''), 5000);
  };

  return (
    // The app's own sheet: focus trap, back-button dismissal, body-scroll lock
    // and the phone/desktop shapes all come with it (components/Sheet.tsx).
    <Sheet onClose={onClose} labelledBy="ai-proj-title" size="lg" className="ai-scope ai-proj">
      <ChatStyleMark />
      <SheetHeader id="ai-proj-title" title="Projects" onClose={onClose} closeLabel="Close projects" />
      <p className="ai-proj-lede">
          A project holds instructions and reference files that every chat inside it starts with, so you do not explain the same context again.
          It stays on this device.
        </p>

        <form
          className="ai-mem-row"
          onSubmit={(e) => {
            e.preventDefault();
            const made = createProject(newName);
            if (!made) return say(newName.trim() ? 'That project could not be saved — the limit is reached or this device\u2019s storage is full.' : 'Give the project a name.');
            setNewName('');
            setOpenId(made.id);
            refresh();
          }}
        >
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New project name"
            aria-label="New project name"
            className="ai-field ai-mem-input"
          />
          <button type="submit" className="ai-mem-add" disabled={!newName.trim()}>
            Create
          </button>
        </form>

        <ul className="ai-proj-list" aria-label="Your projects">
          <li>
            <button
              type="button"
              className={!currentChatProjectId ? 'ai-artifacts-item is-on' : 'ai-artifacts-item'}
              onClick={() => onAssign(undefined)}
            >
              <span className="ai-artifacts-item-name">No project</span>
              <span className="ai-t3">This chat stands alone</span>
            </button>
          </li>
          {projects.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className={p.id === openId ? 'ai-artifacts-item is-on' : 'ai-artifacts-item'}
                aria-current={p.id === currentChatProjectId ? 'true' : undefined}
                onClick={() => setOpenId(p.id)}
              >
                <span className="ai-artifacts-item-name">
                  {p.name}
                  {p.id === currentChatProjectId && <span className="ai-proj-badge">this chat</span>}
                </span>
                <span className="ai-t3">
                  {p.instructions ? 'has instructions' : 'no instructions'} · {p.files.length} file{p.files.length === 1 ? '' : 's'}
                </span>
              </button>
            </li>
          ))}
        </ul>

        {open && (
          <div className="ai-proj-detail">
            <div className="ai-mem-row">
              <input
                defaultValue={open.name}
                aria-label="Project name"
                className="ai-field ai-mem-input"
                onBlur={(e) => {
                  renameProject(open.id, e.target.value);
                  refresh();
                }}
              />
              {open.id !== currentChatProjectId && (
                <button type="button" className="ai-mem-add" onClick={() => onAssign(open.id)}>
                  Use for this chat
                </button>
              )}
            </div>

            <label className="ai-proj-label" htmlFor={`proj-${open.id}-ins`}>
              Instructions for every chat in this project
            </label>
            <textarea
              id={`proj-${open.id}-ins`}
              defaultValue={open.instructions}
              rows={4}
              maxLength={MAX_INSTRUCTIONS}
              placeholder="e.g. You are helping me write liner notes. Keep each one under 120 words and never invent a release date."
              className="ai-field ai-proj-textarea"
              onBlur={(e) => {
                setInstructions(open.id, e.target.value);
                refresh();
              }}
            />

            <p className="ai-proj-label">
              Reference files ({open.files.length} of {MAX_FILES_PER_PROJECT})
            </p>
            <ul className="ai-mem-list" aria-label="Reference files">
              {open.files.length === 0 && <li className="ai-mem-empty">None yet.</li>}
              {open.files.map((f) => (
                <li key={f.id} className="ai-mem-row">
                  <span className="ai-proj-file">{f.name} <span className="ai-t3">· {f.text.length} chars</span></span>
                  <button
                    type="button"
                    className="ai-mem-remove"
                    aria-label={`Remove ${f.name}`}
                    onClick={() => {
                      removeProjectFile(open.id, f.id);
                      refresh();
                    }}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>

            {open.files.length < MAX_FILES_PER_PROJECT && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!addProjectFile(open.id, fileName || 'reference.txt', fileBody))
                    return say(fileBody.trim() ? 'That file could not be saved — this device\u2019s storage is full. Remove a file or a project and try again.' : 'Paste some text for the file first.');
                  setFileName('');
                  setFileBody('');
                  refresh();
                }}
              >
                <div className="ai-mem-row">
                  <input
                    value={fileName}
                    onChange={(e) => setFileName(e.target.value)}
                    placeholder="File name (e.g. tracks.txt)"
                    aria-label="Reference file name"
                    className="ai-field ai-mem-input"
                  />
                  <label className="ai-mem-add" style={{ cursor: 'pointer' }}>
                    Choose file
                    <input
                      type="file"
                      accept=".txt,.md,.csv,.json,text/plain"
                      className="sr-only"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        if (file.size > MAX_FILE_CHARS * 4) return say('That file is too large for a project reference.');
                        setFileName(file.name);
                        setFileBody((await file.text()).slice(0, MAX_FILE_CHARS));
                        e.target.value = '';
                      }}
                    />
                  </label>
                </div>
                <textarea
                  value={fileBody}
                  onChange={(e) => setFileBody(e.target.value.slice(0, MAX_FILE_CHARS))}
                  rows={3}
                  placeholder="…or paste the text here"
                  aria-label="Reference file text"
                  className="ai-field ai-proj-textarea"
                />
                <div className="ai-mem-row">
                  <button type="submit" className="ai-mem-add" disabled={!fileBody.trim()}>
                    Add file
                  </button>
                  <button
                    type="button"
                    className="ai-mem-remove"
                    onClick={() => {
                      if (open.id === currentChatProjectId) onAssign(undefined);
                      deleteProject(open.id);
                      setOpenId(null);
                      refresh();
                    }}
                  >
                    Delete project
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      {note && <p className="ai-proj-note" role="status">{note}</p>}
    </Sheet>
  );
}
