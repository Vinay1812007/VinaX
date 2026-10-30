import { useState } from 'react';
import { DEFAULT_HOME, HOME_SECTIONS, type HomeDesign, type HomeSection } from '@/services/recommendation/homeDesign';
import { ChevronDownIcon, SettingsIcon } from '@/components/Icons';

/**
 * `locked` — shelves the owner turned off for everyone. They show greyed and
 * unchecked, cannot be re-enabled here, and Apply never un-hides them (the
 * composed layout enforces the union of owner + listener hides anyway).
 */
export function HomeStudio({ design, onApply, onReset, locked = [] }: { design: HomeDesign; onApply: (value: HomeDesign) => void; onReset: () => void; locked?: HomeSection[] }) {
  const [draft, setDraft] = useState(design);
  const [notice, setNotice] = useState('Arrange the shelves, then apply.');
  function move(index: number, direction: number) {
    setDraft(current => { const order = [...current.order]; [order[index], order[index + direction]] = [order[index + direction], order[index]]; return { ...current, order }; });
  }
  return <details className="home-studio vxh-studio" onToggle={e => { if (e.currentTarget.open) setDraft(design); }}>
    <summary>
      <span className="vxh-studio-icon" aria-hidden><SettingsIcon /></span>
      <span className="vxh-studio-text"><strong>Customise Home</strong><small>Reorder or hide shelves</small></span>
      <span className="vxh-studio-chevron" aria-hidden><ChevronDownIcon /></span>
    </summary>
    <div className="home-studio-body">
      <div className="home-studio-editor">
        <p className="home-studio-lead">Home Studio: order and hide your shelves. Nothing changes until you apply.</p>
        <div className="home-studio-actions"><button className="btn-secondary" onClick={() => { setDraft(DEFAULT_HOME); setNotice('Balanced layout ready to preview.'); }}>Balanced layout</button></div>
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
        <div className="home-studio-actions"><button className="btn-primary" disabled={draft.order.every(k => draft.hidden.includes(k) || locked.includes(k))} onClick={() => { onApply(draft); setNotice('Your layout is applied.'); }}>Apply to my Home</button><button className="btn-secondary" onClick={() => { onReset(); setNotice('Default Home restored.'); }}>Restore default</button></div>
      </div>
    </div>
  </details>;
}
