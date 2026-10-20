import { useState } from 'react';
import { Link } from 'react-router-dom';
import { XIcon } from './Icons';
import { SNOOZE_KEY, SNOOZE_MS, type AppOffer } from './GetAppSlot';

/** 13.7.4 — the "Get the app" bar itself; GetAppSlot decides whether it shows. */
export default function GetAppBar({ offer, onHide }: { offer: Exclude<AppOffer, null>; onHide: () => void }) {
  const [howOpen, setHowOpen] = useState(false);

  const notNow = (): void => {
    try {
      localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
    } catch {
      /* storage blocked: hide for this visit only */
    }
    onHide();
  };

  return (
    <div className="vx-getapp" role="region" aria-label="Get the VinaX app" data-offer={offer}>
      <img src="/icons/icon.svg" alt="" width={36} height={36} className="vx-getapp-icon" />
      <span className="vx-getapp-text">
        <span className="vx-getapp-title">{offer === 'android' ? 'VinaX for Android' : 'VinaX on your iPhone'}</span>
        <span className="vx-getapp-sub" aria-live="polite">
          {offer === 'android'
            ? 'Free · plays in the background'
            : howOpen
              ? 'Tap Share, then “Add to Home Screen”'
              : 'Add it to your Home Screen'}
        </span>
      </span>
      {offer === 'android' ? (
        <Link to="/download" className="vx-getapp-btn">
          Get the app
        </Link>
      ) : (
        <button type="button" className="vx-getapp-btn" aria-expanded={howOpen} onClick={() => (howOpen ? notNow() : setHowOpen(true))}>
          {howOpen ? 'Got it' : 'How'}
        </button>
      )}
      <button type="button" className="vx-getapp-close" aria-label="Not now" onClick={notNow}>
        <XIcon className="w-4 h-4" />
      </button>
    </div>
  );
}
