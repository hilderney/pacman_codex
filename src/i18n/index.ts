import { loadLocale } from '../services/storage';
import { en } from './en';
import { ptBR } from './pt-BR';

export type LocaleStrings = typeof en;

function browserLanguage(): string {
  if (typeof navigator === 'undefined') return 'en';
  return navigator.language || 'en';
}

function fromBrowser(): { t: LocaleStrings; numberLocale: string } {
  if (browserLanguage().toLowerCase().startsWith('pt')) {
    return { t: ptBR, numberLocale: 'pt-BR' };
  }
  return { t: en, numberLocale: 'en-US' };
}

/** Product copy for the active locale (stored preference or browser language when set to auto). */
export function resolveLocale(): { t: LocaleStrings; numberLocale: string } {
  const pref = loadLocale();
  if (pref === 'en') return { t: en, numberLocale: 'en-US' };
  if (pref === 'pt-BR') return { t: ptBR, numberLocale: 'pt-BR' };
  return fromBrowser();
}

export const { t, numberLocale } = resolveLocale();
