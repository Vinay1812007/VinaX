import { pickSynthVoice } from '@/features/voice/pickSynthVoice';

/**
 * v5.16.0 — read a reply aloud with the device's own voice. No network:
 * markdown is flattened to plain sentences first. One reply at a time.
 */
let speakingId: string | null = null;
const listeners = new Set<(id: string | null) => void>();

export function onSpeakingChange(fn: (id: string | null) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(id: string | null): void {
  speakingId = id;
  listeners.forEach((fn) => fn(id));
}

export function readAloudSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
}

/** Markdown → speakable text. Code blocks become a short note, tables flatten. */
export function speakableText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' (code block) ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/\|/g, ', ')
    .replace(/[*_~]{1,3}/g, '')
    .replace(/\$\$?[^$]+\$\$?/g, ' (formula) ')
    .replace(/^>>>.*$/gm, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    .trim()
    .slice(0, 4000);
}

export function stopReadAloud(): void {
  try {
    window.speechSynthesis.cancel();
  } catch {
    /* no synth */
  }
  emit(null);
}

export function readAloud(id: string, md: string): void {
  if (!readAloudSupported()) return;
  if (speakingId === id) {
    stopReadAloud();
    return;
  }
  stopReadAloud();
  const text = speakableText(md);
  if (!text) return;
  const u = new SpeechSynthesisUtterance(text);
  const v = pickSynthVoice('en-IN');
  if (v) u.voice = v;
  u.rate = 1.02;
  u.onend = () => { if (speakingId === id) emit(null); };
  u.onerror = () => { if (speakingId === id) emit(null); };
  emit(id);
  window.speechSynthesis.speak(u);
}
