/**
 * Home-builder mutations (4.16.0) — deliberately OUTSIDE settingsStore.
 * The store ships in the first-load bundle (budget-gated); Home only READS
 * hiddenHome/homeOrder, so all mutation logic lives here in the lazy
 * Settings chunk and writes via setState.
 */
import { useSettingsStore } from '@/store/settingsStore';

export function toggleHomeBlock(key: string): void {
  const { hiddenHome } = useSettingsStore.getState();
  useSettingsStore.setState({
    hiddenHome: hiddenHome.includes(key) ? hiddenHome.filter((k) => k !== key) : [...hiddenHome, key],
  });
}

/** Move a block up (-1) or down (+1) within the given canonical order.
 *  Effective order = saved keys first (stale ones dropped), missing canonical
 *  keys appended — so the first nudge matches the list the user sees. */
export function moveHomeBlock(key: string, delta: -1 | 1, order: readonly string[]): void {
  const effective = [...new Set([...useSettingsStore.getState().homeOrder, ...order])].filter((k) =>
    order.includes(k),
  );
  const i = effective.indexOf(key);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= effective.length) return;
  [effective[i], effective[j]] = [effective[j], effective[i]];
  useSettingsStore.setState({ homeOrder: effective });
}

export function resetHomeLayout(): void {
  useSettingsStore.setState({ hiddenHome: [], homeOrder: [] });
}
