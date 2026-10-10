import type { Request } from 'express';

export type Lang = 'EN' | 'AM';

export function getLanguage(req: Request): Lang {
  const first = req.headers['accept-language']?.split(',')[0]?.trim().toLowerCase() ?? '';
  return first.startsWith('am') ? 'AM' : 'EN';
}

export function pick(lang: Lang, en: string, am: string | null): string {
  return lang === 'AM' && am ? am : en;
}

export function pickOptional(lang: Lang, en: string | null, am: string | null): string | null {
  return lang === 'AM' && am ? am : en;
}