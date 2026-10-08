/**
 * 11.2 — inline citations in a rendered reply. A reply's text may carry
 * citation marks (two private-use characters around a number) placed by the
 * chat before it renders; RichContent turns each one into whatever the
 * nearest CiteContext draws for that number (a source chip). With no
 * provider, or no mark, nothing changes.
 */
import { createContext, type ReactNode } from 'react';

export const CITE_OPEN = '';
export const CITE_CLOSE = '';
/** One mark: the open character, the citation's number, the close character. */
export const CITE_MARK = /(\d{1,3})/g;
export const citeMark = (n: number): string => `${CITE_OPEN}${n}${CITE_CLOSE}`;
/** Draws citation `n`; null draws nothing. */
export const CiteContext = createContext<((n: number) => ReactNode) | null>(null);
