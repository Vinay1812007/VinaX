/**
 * Server-side clock for AI prompts. Every conversational engine gets one line
 * of "now" in IST (the audience's timezone) so time questions — today's date,
 * "this week's releases", how far away a festival is — are answered from the
 * real clock instead of stale training memory. Computed per request; the edge
 * runtime ships full ICU, so Intl with Asia/Kolkata is exact (IST has no DST).
 */

/** One prompt line, e.g. `Current date & time: Saturday 18 July 2026, 7:42 pm IST.` */
export function istNowLine(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(now);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  // Normalize the day period across ICU spellings ("pm", "PM", "p.m.").
  const ampm = get('dayPeriod').replace(/\./g, '').toLowerCase();
  return `Current date & time: ${get('weekday')} ${get('day')} ${get('month')} ${get('year')}, ${get('hour')}:${get('minute')} ${ampm} IST.`;
}
