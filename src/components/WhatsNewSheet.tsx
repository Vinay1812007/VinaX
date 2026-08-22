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

const TYPE_META: Record<ChangeEntry['type'], { label: string; dot: string; bg: string; text: string }> = {
  new:      { label: 'New',      dot: 'bg-emerald-400', bg: 'bg-emerald-400/10', text: 'text-emerald-400' },
  improved: { label: 'Improved', dot: 'bg-sky-400',     bg: 'bg-sky-400/10',     text: 'text-sky-400' },
  fixed:    { label: 'Fixed',    dot: 'bg-amber-400',   bg: 'bg-amber-400/10',   text: 'text-amber-400' },
};

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

  const dismiss = () => {
    if (fingerprint) setLocal(KEYS.lastSeenVersion, fingerprint);
    setOpen(false);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-ink-950/80 backdrop-blur-sm p-0 sm:p-6">
      <div className="w-full sm:max-w-md glass-modal rounded-t-3xl sm:rounded-3xl p-6 animate-fade-up max-h-[85vh] flex flex-col">
        <div className="flex items-center gap-3 mb-4">
          <img src="/icons/icon.svg" alt="" className="w-10 h-10 rounded-xl" />
          <div>
            <h2 className="text-xl font-bold">What&apos;s new</h2>
            <p className="text-xs text-ink-400">
              {DISPLAY_VERSION}
              {notes.title && (
                <span className="ml-1.5 text-ink-300 font-medium">— {notes.title}</span>
              )}
            </p>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 -mx-1 px-1 mb-6">
          <StructuredNotes changes={notes.changes} />
        </div>

        <button onClick={dismiss} className="w-full py-3 rounded-full btn-primary shrink-0">
          Nice — let&apos;s go
        </button>
      </div>
    </div>
  );
}

/** Renders v2-style categorized changelog with colored badges and section headers. */
function StructuredNotes({ changes }: { changes: ChangeEntry[] }) {
  const groups = groupByType(changes);
  const order: ChangeEntry['type'][] = ['new', 'improved', 'fixed'];

  return (
    <div className="space-y-4">
      {order.map((type) => {
        const items = groups[type];
        if (items.length === 0) return null;
        const meta = TYPE_META[type];
        return (
          <div key={type}>
            <div className="flex items-center gap-2 mb-2">
              <span className={`inline-block w-2 h-2 rounded-full ${meta.dot}`} />
              <span className={`text-xs font-semibold uppercase tracking-wider ${meta.text}`}>
                {meta.label}
              </span>
              <span className="text-xs text-ink-500">{items.length}</span>
            </div>
            <ul className="space-y-1.5 pl-4">
              {items.map((item) => (
                <li key={item.text} className="text-sm text-ink-200 leading-relaxed flex items-start gap-2">
                  <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${meta.dot} opacity-50`} />
                  <span>{item.text}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
