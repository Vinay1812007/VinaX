import { requestCurator } from '@/services/ai/recommendations';
import { buildTasteSnapshot } from '@/services/ai/taste';

export const HOME_SECTIONS = { quick: 'Quick picks', personal: 'Made for you', aihome: 'Designed for you', discovery: 'Fresh discoveries', charts: 'Charts', seasonal: 'Seasonal listening', moods: 'Moods', genres: 'Genres', artists: 'Artists', albums: 'Albums', daypicks: 'For your day', loved: 'Favorites', feed: 'More to explore' };
export type HomeSection = keyof typeof HOME_SECTIONS;
export interface HomeDesign { title: string; description: string; order: HomeSection[]; hidden: HomeSection[] }
export const DEFAULT_HOME: HomeDesign = { title: 'Your next favorite starts here.', description: 'Familiar voices, fresh discoveries. A mix that grows with you.', order: Object.keys(HOME_SECTIONS) as HomeSection[], hidden: [] };
export const HOME_DESIGN_KEY = 'vinax.home.design.v1';
const safeText = (v: unknown, fallback: string, max: number) => typeof v === 'string' && v.trim() && !/chatgpt|spotify|astro|astra|<|>/i.test(v) ? v.trim().slice(0, max) : fallback;
export function validateHomeDesign(raw: unknown): HomeDesign {
  const p = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const valid = (v: unknown): v is HomeSection => typeof v === 'string' && Object.prototype.hasOwnProperty.call(HOME_SECTIONS, v);
  const order = Array.isArray(p.order) ? p.order.filter(valid) : [];
  const hidden = Array.isArray(p.hidden) ? p.hidden.filter(valid) : [];
  return { title: safeText(p.title, DEFAULT_HOME.title, 60), description: safeText(p.description, DEFAULT_HOME.description, 160),
    order: [...new Set([...order, ...DEFAULT_HOME.order])], hidden: [...new Set(hidden)].slice(0, DEFAULT_HOME.order.length - 1) };
}
export function loadHomeDesign(): HomeDesign | null {
  try { const raw = localStorage.getItem(HOME_DESIGN_KEY); return raw ? validateHomeDesign(JSON.parse(raw)) : null; } catch { return null; }
}
export async function generateHomeDesign(prompt: string, signal?: AbortSignal): Promise<HomeDesign | null> {
  const raw = await requestCurator('home', { request: prompt.slice(0, 500), taste: buildTasteSnapshot(), sections: HOME_SECTIONS }, signal);
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { order?: unknown }).order)) return null;
  return validateHomeDesign(raw);
}
