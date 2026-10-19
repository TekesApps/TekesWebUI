import { useSyncExternalStore } from 'react';
import english from './locales/en.json';

export type Locale = 'zh-CN' | 'en';
const messages: Record<string, string> = english;
const preferenceKey = 'tekes.web.language';
let locale: Locale = 'zh-CN';
const listeners = new Set<() => void>();
export const getLocale = () => locale;
export const intlLocale = () => (locale === 'en' ? 'en-US' : 'zh-CN');
export function detectLocale(
  saved?: string | null,
  browserLanguage?: string,
): Locale {
  if (saved === 'en' || saved === 'zh-CN') return saved;
  return browserLanguage?.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}
export function setLocale(next: Locale) {
  if (next !== 'en' && next !== 'zh-CN') return;
  locale = next;
  try {
    localStorage.setItem(preferenceKey, next);
  } catch {
    /* Optional browser preference. */
  }
  if (typeof document !== 'undefined') document.documentElement.lang = next;
  for (const listener of listeners) listener();
}
export function initializeLocale() {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(preferenceKey);
  } catch {
    /* Private mode. */
  }
  setLocale(
    detectLocale(
      saved,
      typeof navigator === 'undefined' ? 'zh-CN' : navigator.language,
    ),
  );
}
export function useLocale() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getLocale,
    getLocale,
  );
}
function interpolate(template: string, values: readonly unknown[]) {
  return template.replace(/\{(\d+)\}/g, (token, index: string) =>
    Number(index) < values.length ? String(values[Number(index)]) : token,
  );
}
const reverse = new Map(
  Object.entries(messages).map(([source, translation]) => [
    translation,
    source,
  ]),
);
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const templates = Object.entries(messages)
  .filter(([source]) => /\{\d+\}/.test(source))
  .flatMap(([source, translation]) =>
    [source, translation].map((text) => {
      const indices: number[] = [];
      let previous = 0,
        pattern = '^';
      for (const match of text.matchAll(/\{(\d+)\}/g)) {
        pattern += escape(text.slice(previous, match.index)) + '([\\s\\S]*?)';
        indices.push(Number(match[1]));
        previous = match.index! + match[0].length;
      }
      return {
        source,
        indices,
        regex: new RegExp(pattern + escape(text.slice(previous)) + '$'),
      };
    }),
  );
/** Translate interface copy only. Never pass messages, excerpts, tool output, paths or model names. */
export function t(key: string, ...values: unknown[]): string {
  let source = Object.hasOwn(messages, key) ? key : reverse.get(key) || key;
  if (!Object.hasOwn(messages, source) && !values.length) {
    for (const template of templates) {
      const match = template.regex.exec(key);
      if (!match) continue;
      source = template.source;
      template.indices.forEach((index, offset) => {
        values[index] = match[offset + 1];
      });
      break;
    }
  }
  return interpolate(
    locale === 'en' ? messages[source] || source : source,
    values,
  );
}

/** Context changes wording only; action IDs and capability policy stay with AgentKit. */
export function tContext(context: string, key: string): string {
  return locale === 'en' ? messages[`${context}::${key}`] || t(key) : t(key);
}
