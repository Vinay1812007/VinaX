/**
 * VinaX logo cursor (desktop mouse only).
 *
 * The mouse pointer becomes a see-through VinaX "V". A white light stripe
 * flashes across it every couple of seconds, it glows over anything you can
 * click, and a quick flash bursts out on each click. Styles live in
 * styles/index.css (.vx-cursor).
 *
 * The native cursor comes back wherever it carries meaning: text fields
 * (I-beam), drag grips and resize handles, iframes (embeds draw their own),
 * touch and pen input. Automated browsers are skipped so tests see the
 * normal page.
 */
import { reducedMotion } from './motion';

// Hotspot: the top-left tip of the V (30,26 in the 128-unit logo).
const SIZE = 30;
const HOT_X = Math.round((30 / 128) * SIZE);
const HOT_Y = Math.round((26 / 128) * SIZE);

const NON_TEXT_INPUTS = 'button,submit,reset,checkbox,radio,range,color,file,image,hidden';
const TEXT_FIELD = [
  'textarea',
  `input:not(${NON_TEXT_INPUTS.split(',').map((t) => `[type="${t}"]`).join(',')})`,
  '[contenteditable]:not([contenteditable="false"])',
].join(',');
// Keep in sync with the native-cursor rules in index.css.
const NATIVE = `${TEXT_FIELD},iframe,.vx-queue-grip,.vx-ai-artifact-resize`;
const CLICKABLE = [
  'a[href]',
  'button:not(:disabled)',
  'summary',
  'label',
  'select',
  'input[type="checkbox"]',
  'input[type="radio"]',
  'input[type="range"]',
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[role="slider"]',
  '.cursor-pointer',
].join(',');

export function installLogoCursor(): void {
  if (typeof window === 'undefined' || navigator.webdriver) return;
  const fine = window.matchMedia?.('(hover: hover) and (pointer: fine)');
  if (!fine) return;

  const root = document.documentElement;
  const el = document.createElement('div');
  el.className = 'vx-cursor';
  el.setAttribute('aria-hidden', 'true');
  el.dataset.hidden = 'true';
  el.innerHTML = '<i class="vx-cursor-burst"></i><i class="vx-cursor-logo"><i class="vx-cursor-shine"></i></i>';
  const logo = el.querySelector<HTMLElement>('.vx-cursor-logo')!;
  const burst = el.querySelector<HTMLElement>('.vx-cursor-burst')!;
  let mounted = false;
  let inspected: EventTarget | null = null; // last element the pointer was checked over

  let x = -100;
  let y = -100;
  let raf = 0;
  const paint = () => {
    raf = 0;
    el.style.transform = `translate3d(${x - HOT_X}px, ${y - HOT_Y}px, 0)`;
  };
  const moveTo = (cx: number, cy: number) => {
    x = cx;
    y = cy;
    if (!raf) raf = requestAnimationFrame(paint);
  };

  const setActive = (on: boolean) => {
    root.classList.toggle('vx-cursor-on', on);
    if (on) return;
    el.dataset.hidden = 'true';
    inspected = null;
  };

  // Hide the logo (native cursor shows) or mark it as hovering something clickable.
  const inspect = (target: EventTarget | null) => {
    inspected = target;
    const node = target instanceof Element ? target : null;
    el.dataset.hidden = node?.closest(NATIVE) ? 'true' : 'false';
    el.dataset.hover = node?.closest(CLICKABLE) ? 'true' : 'false';
  };

  const onMove = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse' || !fine.matches) {
      setActive(false);
      return;
    }
    if (!mounted) {
      document.body.appendChild(el);
      mounted = true;
    }
    if (!root.classList.contains('vx-cursor-on')) setActive(true);
    if (e.target !== inspected) inspect(e.target);
    moveTo(e.clientX, e.clientY);
  };

  const flash = () => {
    if (reducedMotion() || typeof burst.animate !== 'function') return;
    burst.animate(
      [
        { opacity: 0.95, transform: 'scale(0.2)' },
        { opacity: 0, transform: 'scale(1.7)' },
      ],
      { duration: 450, easing: 'cubic-bezier(.2,.7,.3,1)' },
    );
    logo.animate(
      [{ filter: 'brightness(2.2)' }, { filter: 'brightness(1)' }],
      { duration: 320, easing: 'ease-out' },
    );
  };

  document.addEventListener('pointermove', onMove, { passive: true });
  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse') return setActive(false);
    el.dataset.down = 'true';
    if (el.dataset.hidden !== 'true') flash();
  }, { passive: true });
  document.addEventListener('pointerup', () => { el.dataset.down = 'false'; }, { passive: true });
  // HTML drag-and-drop pauses pointer events; keep following with drag events.
  document.addEventListener('dragover', (e) => moveTo(e.clientX, e.clientY), { passive: true });
  // Leaving the window: hide until the next move back in re-checks the target.
  root.addEventListener('mouseleave', () => {
    el.dataset.hidden = 'true';
    inspected = null;
  });
  // Element fullscreen draws above the page, so the cursor moves in with it.
  document.addEventListener('fullscreenchange', () => {
    if (!mounted) return;
    const fs = document.fullscreenElement;
    const host = fs && fs !== root && !fs.matches('iframe,video,img,canvas') ? fs : document.body;
    host.appendChild(el);
  });
  fine.addEventListener?.('change', () => { if (!fine.matches) setActive(false); });
}
