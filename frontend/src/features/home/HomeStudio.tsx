import { useEffect, useRef, useState } from 'react';
import { DEFAULT_HOME, HOME_SECTIONS, generateHomeDesign, type HomeDesign, type HomeSection } from '@/services/recommendation/homeDesign';
import { SparkleIcon } from '@/components/Icons';

/**
 * `locked` — shelves the owner turned off for everyone. They show greyed and
 * unchecked, cannot be re-enabled here, and Apply never un-hides them (the
 * composed layout enforces the union of owner + listener hides anyway).
 */
export function HomeStudio({ design, onApply, onReset, locked = [] }: { design: HomeDesign; onApply: (value: HomeDesign) => void; onReset: () => void; locked?: HomeSection[] }) {
  const [draft, setDraft] = useState(design);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('Describe your listening mood or arrange the shelves yourself.');
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  function move(index: number, direction: number) {
    setDraft(current => { const order = [...current.order]; [order[index], order[index + direction]] = [order[index + direction], order[index]]; return { ...current, order }; });
  }
  async function generate() {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setNotice('Arranging your listening space…');
    const result = await generateHomeDesign(prompt || 'Build a balanced Home for my listening taste', controller.signal);
    if (controller.signal.aborted) return;
    setBusy(false);
    if (result) { setDraft(result); setNotice('Your preview is ready. Review the shelves, then apply.'); }
    else setNotice('AI is unavailable right now. You can still arrange and apply your shelves below.');
  }
  return <details className="home-studio" onToggle={e => { if (e.currentTarget.open) setDraft(design); }}>
    <summary><span><SparkleIcon className="w-4 h-4" /><strong>Home Studio</strong></span><span>Make this space yours <span aria-hidden>+</span></span></summary>
    <div className="home-studio-body">
      <div className="home-studio-intro"><p className="vx-eyebrow">YOUR HOME, YOUR WAY</p><h2>Set the mood.<br />Shape your Home.</h2><p>VinaX AI arranges your shelves around your listening. Preview every change before applying it.</p></div>
      <div className="home-studio-editor">
        <label htmlFor="home-direction">What do you want to hear?</label>
        <textarea id="home-direction" value={prompt} maxLength={500} onChange={e => setPrompt(e.target.value)} placeholder="A calm evening with Telugu melodies and a few new discoveries…" rows={2} />
        <div className="home-studio-actions"><button className="btn-primary" disabled={busy} onClick={() => void generate()}>{busy ? 'Building preview…' : 'Build with VinaX AI'}</button><button className="btn-secondary" onClick={() => { request.current?.abort(); setBusy(false); setDraft(DEFAULT_HOME); setNotice('Balanced layout ready to preview.'); }}>Balanced layout</button></div>
        <p className="home-studio-notice" role="status">{notice}</p>
        <label htmlFor="home-headline">Featured headline</label><input id="home-headline" value={draft.title} maxLength={60} onChange={e => setDraft({ ...draft, title: e.target.value })} />
        <ol className="home-studio-shelves" aria-label="Shelf order preview">{draft.order.map((key, index) => <li key={key}>
          <span className="home-studio-number">{String(index + 1).padStart(2, '0')}</span>
          <label className={locked.includes(key) ? 'home-studio-locked' : undefined}>
            <input type="checkbox" checked={!draft.hidden.includes(key) && !locked.includes(key)} disabled={locked.includes(key)} aria-describedby={locked.includes(key) ? `home-locked-${key}` : undefined} onChange={e => setDraft({ ...draft, hidden: e.target.checked ? draft.hidden.filter(k => k !== key) : [...draft.hidden, key] })} />
            {HOME_SECTIONS[key]}
            {locked.includes(key) && <span id={`home-locked-${key}`} className="home-studio-lock-note"> · turned off by VinaX</span>}
          </label>
          <button aria-label={`Move ${HOME_SECTIONS[key]} up`} disabled={index === 0} onClick={() => move(index, -1)}>↑</button><button aria-label={`Move ${HOME_SECTIONS[key]} down`} disabled={index === draft.order.length - 1} onClick={() => move(index, 1)}>↓</button>
        </li>)}</ol>
        <div className="home-studio-actions"><button className="btn-primary" disabled={busy || draft.order.every(k => draft.hidden.includes(k) || locked.includes(k))} onClick={() => { onApply(draft); setNotice('Your layout is applied.'); }}>Apply to my Home</button><button className="btn-secondary" onClick={() => { request.current?.abort(); setBusy(false); onReset(); setNotice('Default Home restored.'); }}>Restore default</button></div>
      </div>
    </div>
  </details>;
}
