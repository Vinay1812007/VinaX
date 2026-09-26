import { KEYS } from '@/constants/storage-keys';
import { getLocal, setLocal } from '@/services/storage/local';
import { useEffect, useState } from 'react';
import { DISPLAY_VERSION } from '@/constants/version';
// NOTE: do NOT statically import from '@/constants/changelog' here —
// the changelog module is ~10 KB gz of historical release notes; pulling it
// into first-load undoes the bundle budget. We hop it in via dynamic import
// on the effect that actually needs it (audit finding: undid the P2-shape
// win from the "Living Glass" consolidation).
import type { VersionInfo, ChangeEntry } from '@/constants/changelog';
import { Sheet, SheetHeader } from './Sheet';

const TYPE_LABEL: Record<ChangeEntry['type'], string> = { new: 'New', improved: 'Improved', fixed: 'Fixed' };

/** Group ChangeEntry[] by type, preserving order within each group. */
function groupByType(changes: ChangeEntry[]): Record<ChangeEntry['type'], ChangeEntry[]> {
  const groups: Record<ChangeEntry['type'], ChangeEntry[]> = { new: [], improved: [], fixed: [] };
  for (const c of changes) groups[c.type].push(c);
  return groups;
}

/**
 * Shown exactly once on the first launch after an update: what changed in
 * the version you just received. Fresh installs never see it (onboarding
 * stamps the current fingerprint instead).
 *
 * v3.8.2: swap version-string comparison for a content-fingerprint check.
 * The old mechanism compared stored `lastSeenVersion` against
 * `LATEST_VERSION` from version.ts. In practice `LATEST_VERSION` sat at
 * "3.8.0" across a dozen shipped builds — so every listener's stored
 * value already matched, and nobody saw a "What's New" for any of them.
 *
 * The new fingerprint is a hash of the top changelog entry (title +
 * first three change lines). Whenever a maintainer prepends a new entry
 * to CHANGELOG_V2 the fingerprint changes → sheet fires on next launch
 * — no version-bump ceremony required.
 *
 * Migration: any pre-existing `lastSeenVersion` value is treated as a
 * legacy sentinel and replaced with the current fingerprint on first
 * successful read, so early adopters see this update ONCE, then normally.
 */
export function WhatsNewSheet() {
  // `open` starts as undefined ("not yet determined") — we can't compare
  // stored value against the fingerprint until the changelog dynamic
  // import lands. That keeps the changelog out of the first-load bundle.
  const [open, setOpen] = useState<boolean>(false);
  const [notes, setNotes] = useState<VersionInfo | null>(null);
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  // EVERY dismissal path stamps the fingerprint — Escape and Android-back
  // used to close without stamping, so the sheet re-armed on every launch
  // until the user happened to tap the button.
  const dismiss = () => {
    if (fingerprint) setLocal(KEYS.lastSeenVersion, fingerprint);
    setOpen(false);
  };

  useEffect(() => {
    const onboarded = getLocal<boolean>(KEYS.onboarded, false);
    if (!onboarded) return;
    // One dynamic import serves both the open-decision AND the render:
    // pull the changelog once, get its fingerprint, decide open, keep the
    // notes ready to render if we do open.
    let alive = true;
    void import('@/constants/changelog').then((m) => {
      if (!alive) return;
      const fp = m.latestNotesFingerprint();
      const last = getLocal<string | null>(KEYS.lastSeenVersion, null);
      setFingerprint(fp);
      if (last !== fp) {
        setNotes(m.latestNotes());
        setOpen(true);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!open || !notes) return null;

  // The release title usually opens with the version already ("VinaX 8.0 — …").
  const subtitle = !notes.title
    ? DISPLAY_VERSION
    : notes.title.startsWith(DISPLAY_VERSION)
      ? notes.title
      : `${DISPLAY_VERSION} · ${notes.title}`;

  return (
    // Backdrop taps do not dismiss this one (as before): it closes through
    // its button, Escape or back — all of which stamp the fingerprint.
    <Sheet onClose={dismiss} labelledBy="whats-new-title" z={60} padding="lg" layout="column" maxHeight="medium" closeOnBackdrop={false} backdropClassName="bg-black/60">
      <SheetHeader id="whats-new-title" title="What’s new" subtitle={subtitle} className="shrink-0" />

      <div className="overflow-y-auto overscroll-contain flex-1 min-h-0 -mx-1 px-1">
        <StructuredNotes changes={notes.changes} />
      </div>

      <button type="button" onClick={dismiss} className="mt-6 w-full sm:w-auto sm:self-end sm:px-8 min-h-[48px] rounded-full btn-primary shrink-0">
        Let&rsquo;s go
      </button>
    </Sheet>
  );
}

/** The release notes, grouped New / Improved / Fixed: a small label, then a hairline list. */
function StructuredNotes({ changes }: { changes: ChangeEntry[] }) {
  const groups = groupByType(changes);
  const order: ChangeEntry['type'][] = ['new', 'improved', 'fixed'];

  return (
    <div className="space-y-5">
      {order.map((type) => {
        const items = groups[type];
        if (items.length === 0) return null;
        return (
          <section key={type} aria-label={TYPE_LABEL[type]}>
            <h3 className="mb-1 text-[13px] font-bold text-ink-400">{TYPE_LABEL[type]}</h3>
            <ul className="divide-y divide-[color:var(--vx-border)]">
              {items.map((item) => (
                <li key={item.text} className="py-2.5 text-[14px] leading-relaxed text-ink-200">
                  {item.text}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
