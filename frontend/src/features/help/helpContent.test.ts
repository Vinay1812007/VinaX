import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FAQ, GUIDES } from './helpContent';

/**
 * helpContent says "every claim here must be true today", and the build bakes
 * it into /help/index.html for crawlers. These checks keep the Help text in
 * step with Settings: every "Settings → A → B" path it gives must name a
 * section, group or row SettingsPage still renders, and settings that were
 * removed must not come back in the instructions.
 */
const SRC = join(__dirname, '..', '..');
const read = (p: string): string => readFileSync(p, 'utf8');
const SETTINGS_PAGE = join(SRC, 'pages', 'SettingsPage.tsx');
const SETTINGS_CONTROLS = join(SRC, 'features', 'settings', 'SettingsControls.tsx');

/** SettingsPage plus the '@/…' modules it imports (its rows live in a few of them). */
function settingsSources(): string {
  const page = read(SETTINGS_PAGE);
  const parts = [page];
  for (const m of page.matchAll(/from '@\/([^']+)'/g)) {
    for (const ext of ['.tsx', '.ts', '/index.tsx', '/index.ts']) {
      const p = join(SRC, `${m[1]}${ext}`);
      if (existsSync(p)) {
        parts.push(read(p));
        break;
      }
    }
  }
  return parts.join('\n');
}

/** Every visible name a settings section, group, row or option has in the source. */
function settingsNames(src: string): Set<string> {
  const names = new Set<string>();
  const patterns = [/\b(?:title|label)="([^"]+)"/g, /\b(?:title|label): '([^']+)'/g, /\b(?:title|label)=\{'([^']+)'\}/g, />([A-Z][^<>{}\n]{1,40})</g];
  for (const re of patterns) for (const m of src.matchAll(re)) names.add(m[1].trim());
  return names;
}

const helpTexts = (): string[] => [...GUIDES.flatMap((g) => [g.title, ...g.steps]), ...FAQ.flatMap((f) => [f.q, f.a])];

/** "Settings → Appearance → Theme picks System." → ['Appearance', 'Theme picks System'] (a path ends with its sentence). */
function settingsPaths(text: string): string[][] {
  const out: string[][] = [];
  for (const m of text.matchAll(/Settings((?: → [^→.]*[^→.\s])+)/g)) {
    out.push(m[1].split(' → ').slice(1).map((seg) => seg.replace(/^[“"]/, '').trim()));
  }
  return out;
}

describe('Help text matches the app', () => {
  const names = settingsNames(settingsSources());

  it('reads the Settings page and finds its sections', () => {
    for (const n of ['Appearance', 'Theme', 'Your data', 'Profile']) expect(names.has(n), n).toBe(true);
  });

  it('every Settings → … path names a section, group or row Settings still renders', () => {
    const missing: string[] = [];
    let paths = 0;
    for (const text of helpTexts()) {
      for (const path of settingsPaths(text)) {
        paths += 1;
        for (const seg of path) {
          // A step's last segment runs on into prose ("Wake-up alarm starts music…"): the name is its start.
          const known = [...names].some((n) => seg.startsWith(n) && !/^[\p{L}\d]/u.test(seg.slice(n.length)));
          if (!known) missing.push(`Settings → ${path.join(' → ')}  (no "${seg.split(' ').slice(0, 4).join(' ')}…")`);
        }
      }
    }
    expect(paths).toBeGreaterThan(5);
    expect(missing).toEqual([]);
  });

  it('the theme choices are the ones Settings offers', () => {
    // 1.18.2 — the choices live on the theme picker (ThemePicker, SettingsControls.tsx).
    const controls = read(SETTINGS_CONTROLS);
    const block = /THEME_OPTIONS[^=]*=\s*\[([\s\S]*?)\];/.exec(controls)?.[1] ?? '';
    const options = [...block.matchAll(/label: '([^']+)'/g)].map((m) => m[1]);
    expect(options.length).toBeGreaterThan(0);
    const guide = GUIDES.find((g) => g.steps.some((s) => s.includes('Settings → Appearance → Theme')));
    const step = guide?.steps.find((s) => s.includes('Settings → Appearance → Theme')) ?? '';
    for (const o of options) expect(step, o).toContain(o);
  });

  it('never names settings or features that were removed', () => {
    const all = helpTexts().join('\n');
    // 1.15: one black-and-green look (no Black/Auto theme, accents or Dynamic theme);
    // Move to a new device (the QR handoff) gave way to account sync.
    // Round 5: Pin a mood folded into Tune this queue (no 45-minute hold, no unpin).
    for (const gone of [/\bBlack\b/, /\bAuto\b/, /accent/i, /dynamic theme/i, /plum|amber/i, /move to a new device|move from old device|handoff/i, /pin holds|unpin|pinned a mood/i]) {
      expect(all, String(gone)).not.toMatch(gone);
    }
  });

  it('describes email and password sign-in next to Google', () => {
    const account = FAQ.find((f) => f.q === 'Do I need an account?')?.a ?? '';
    expect(account).toMatch(/Google/);
    expect(account).toMatch(/email and a password/);
    expect(account).toMatch(/without one/);
  });
});
