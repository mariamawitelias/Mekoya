export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

const ADDIS_OFFSET_MS = 3 * HOUR_MS; 
export function slotToUtc(date: string, time: string): Date {
  return new Date(`${date}T${time}:00+03:00`);
}

export function toAddisDate(instant: Date): string {
  return new Date(instant.getTime() + ADDIS_OFFSET_MS).toISOString().slice(0, 10);
}

export function toAddisTime(instant: Date): string {
  return new Date(instant.getTime() + ADDIS_OFFSET_MS).toISOString().slice(11, 16);
}

export function addisDayRange(date: string): { start: Date; end: Date } {
  const start = slotToUtc(date, '00:00');
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

export function isRealDate(date: string): boolean {
  const start = slotToUtc(date, '00:00');
  return !Number.isNaN(start.getTime()) && toAddisDate(start) === date;
}

export function isWorkingDay(date: string): boolean {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  return weekday >= 1 && weekday <= 5;
}

export function formatLabel(slotStart: Date): string {
  return `${toAddisDate(slotStart)} ${toAddisTime(slotStart)}`;
}