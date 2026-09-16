import { DEFAULT_HOME, validateHomeDesign, type HomeDesign, type HomeSection } from '@/services/recommendation/homeDesign';

/**
 * Home layout precedence — one place, one rule:
 *
 *   order / headline : the listener's Home Studio layout if they saved one,
 *                      else the owner-published layout, else the default
 *                      (which may come from the shelf-order experiment).
 *   hidden           : the UNION of what the owner disabled and what the
 *                      listener hid. A listener can reorder and hide shelves
 *                      freely, but can never re-enable a shelf the owner
 *                      turned off — and a newly published owner change is
 *                      enforced on the next config refresh even when a local
 *                      layout exists (the old code replaced the owner layout
 *                      wholesale with the local one).
 */
export interface ComposedHomeLayout {
  design: HomeDesign;
  /** Shelves the owner turned off — locked in Home Studio. */
  ownerHidden: HomeSection[];
  /** Shelves that render, in display order. */
  visible: HomeSection[];
  source: 'listener' | 'owner' | 'default';
}

const isSection = (v: unknown): v is HomeSection => typeof v === 'string' && (DEFAULT_HOME.order as string[]).includes(v);

/** The owner's published layout, or null when nothing usable was published. */
export function ownerLayout(raw: unknown): { design: HomeDesign; hasOrder: boolean } | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { order?: unknown; hidden?: unknown };
  const orderGiven = Array.isArray(r.order) && r.order.some(isSection);
  const hiddenGiven = Array.isArray(r.hidden) && r.hidden.some(isSection);
  const hasText = typeof (raw as { title?: unknown }).title === 'string' && (raw as { title: string }).title.trim() !== '';
  if (!orderGiven && !hiddenGiven && !hasText) return null;
  return { design: validateHomeDesign(raw), hasOrder: orderGiven };
}

export function composeHomeLayout(local: HomeDesign | null, owner: unknown, defaultOrder: readonly HomeSection[] = DEFAULT_HOME.order): ComposedHomeLayout {
  const own = ownerLayout(owner);
  const ownerHidden = own ? own.design.hidden : [];
  const base = validateHomeDesign({ ...DEFAULT_HOME, order: [...defaultOrder] });

  let design: HomeDesign;
  let source: ComposedHomeLayout['source'];
  if (local) {
    design = validateHomeDesign(local);
    source = 'listener';
  } else if (own) {
    design = {
      ...own.design,
      order: own.hasOrder ? own.design.order : base.order,
      title: own.design.title,
      description: own.design.description,
    };
    source = 'owner';
  } else {
    design = base;
    source = 'default';
  }

  const hidden = [...new Set([...ownerHidden, ...design.hidden])];
  let visible = design.order.filter((k) => !hidden.includes(k));
  // A layout with nothing left is useless: fall back to the owner's rules
  // alone (the listener's hides are ignored, the owner's still hold).
  if (!visible.length) visible = design.order.filter((k) => !ownerHidden.includes(k));
  return { design: { ...design, hidden }, ownerHidden, visible, source };
}
