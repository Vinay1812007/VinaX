/** Where a floating menu goes, in viewport (position: fixed) coordinates. */
export interface MenuPlacement {
  left: number;
  width: number;
  maxHeight: number;
  /** Exactly one of these is set: the menu hangs below or sits above. */
  top?: number;
  bottom?: number;
}

const MARGIN = 12;
const GAP = 8;

/**
 * Place a menu against its trigger so it is always fully on screen: right
 * edges aligned where there is room, clamped to the viewport where there is
 * not (a 22rem menu under a chip near the left edge of a phone), opening
 * toward whichever side has the space — the composer is mid-screen on an
 * empty chat and at the bottom of a conversation. Pure.
 */
export function placeMenu(
  trigger: { top: number; bottom: number; right: number },
  viewport: { width: number; height: number },
  want = { width: 352, height: 480 },
): MenuPlacement {
  const width = Math.max(200, Math.min(want.width, viewport.width - 2 * MARGIN));
  const left = Math.min(Math.max(MARGIN, trigger.right - width), Math.max(MARGIN, viewport.width - MARGIN - width));
  const below = viewport.height - trigger.bottom - GAP - MARGIN;
  const above = trigger.top - GAP - MARGIN;
  const down = below >= Math.min(want.height, 320) || below >= above;
  const maxHeight = Math.max(160, Math.min(want.height, down ? below : above));
  return down
    ? { left, width, maxHeight, top: trigger.bottom + GAP }
    : { left, width, maxHeight, bottom: viewport.height - trigger.top + GAP };
}
