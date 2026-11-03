/**
 * VinaX AI pages (/vinaxai and everything under it, shared chats included)
 * keep the browser's own right-click menu, text selection and dragging, the
 * way a chat app should: people copy replies, links and code. The app's own
 * right-click menu and the cosmetic deterrence skip them.
 */
export const isNativeMenuZone = (path: string = typeof window !== 'undefined' ? window.location.pathname : ''): boolean => /^\/vinaxai(?:\/|$)/i.test(path);
