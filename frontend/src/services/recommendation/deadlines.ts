/**
 * 7.2.0 — end-to-end budgets for building the on-device next-song order
 * (candidates → validation). Its own tiny module so the first-load player
 * store can read them without pulling the recommendation engine into the
 * first load (the engine is loaded when a queue is first extended).
 */
/** Budget when the queue still has songs ahead. */
export const NEXT_DEADLINE_MS = 8_000;
/** Budget when the listener is waiting at the end of the queue. */
export const NEXT_URGENT_DEADLINE_MS = 3_500;
