export function currentHour(): number {
  return new Date().getHours();
}

export function dayPartLabel(hour = currentHour()): string {
  if (hour >= 5 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'late-night';
}
