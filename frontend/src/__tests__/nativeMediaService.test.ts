/**
 * The Java under native-android/ is copied into the Android project at build
 * time and is never compiled by this toolchain, so its contracts are pinned
 * at the string level: a refactor that drops one of these fails here instead
 * of shipping a notification that outlives the app.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (name: string): string => readFileSync(resolve(__dirname, '../../native-android', name), 'utf8');

/** Body of the `case <label>:` block up to the next case label. */
function caseBody(src: string, label: string): string {
  const start = src.indexOf(`case ${label}:`);
  if (start === -1) return '';
  const rest = src.slice(start + label.length + 6);
  const next = rest.search(/\n\s*case\s/);
  return next === -1 ? rest : rest.slice(0, next);
}

describe('VinaxMediaService', () => {
  const service = read('VinaxMediaService.java');

  it('tears the foreground service down when the task is swiped away', () => {
    const m = service.match(/public void onTaskRemoved\(Intent rootIntent\)\s*\{([\s\S]*?)\n {4}\}/);
    expect(m).not.toBeNull();
    const body = m?.[1] ?? '';
    expect(body).toContain('playing = false;');
    expect(body).toContain('stopForegroundCompat();');
    expect(body).toContain('VinaxPlayerWidget.clear(this);');
    expect(body).toContain('stopSelf();');
    expect(body).toContain('super.onTaskRemoved(rootIntent);');
  });

  it('a position tick updates only the playback state and returns early', () => {
    const body = caseBody(service, 'ACTION_POSITION');
    expect(body).toContain('updatePlaybackState();');
    expect(body).toContain('if (duration != previousDuration) updateMetadata();');
    expect(body).toContain('if (!foreground) promote();');
    expect(body).toMatch(/return;\s*$/);
    expect(body).not.toContain('VinaxPlayerWidget.push');
  });

  it('keeps balanced braces (cannot be compiled here)', () => {
    const count = (ch: string): number => service.split(ch).length - 1;
    expect(count('{')).toBe(count('}'));
    expect(count('(')).toBe(count(')'));
  });
});

describe('VinaxMediaPlugin', () => {
  const plugin = read('VinaxMediaPlugin.java');

  it('drops the static service reference when this instance is destroyed', () => {
    expect(plugin).toContain('protected void handleOnDestroy()');
    expect(plugin).toContain('if (VinaxMediaService.plugin == this) VinaxMediaService.plugin = null;');
  });
});
