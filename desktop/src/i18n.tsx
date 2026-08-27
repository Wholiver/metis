import { PropsWithChildren, useEffect, useState } from 'react';
import './i18n-catalogs.js';
import { resolveLocalizedSource, splitSurroundingWhitespace, type LocalizedValueState } from './lib/i18n-state';

type Catalog = Record<string, string>;
type Catalogs = Record<string, Catalog>;

declare global {
  interface Window {
    metisDesktopI18nCatalogs?: Catalogs;
  }
}

const localizedText = new WeakMap<Text, LocalizedValueState>();
const localizedAttributes = new WeakMap<Element, Map<string, LocalizedValueState>>();
const localizableAttributes = ['aria-label', 'placeholder', 'title'];

function catalogs(): Catalogs {
  return window.metisDesktopI18nCatalogs || { en: {} };
}

export function resolveLanguage(preference: string): string {
  const available = catalogs();
  if (preference !== 'auto' && available[preference]) return preference;
  const browserLanguage = navigator.language || 'en';
  if (/^zh-(HK|MO|TW)$/i.test(browserLanguage) && available['zh-TW']) return 'zh-TW';
  if (/^zh-(CN|SG)$/i.test(browserLanguage) && available['zh-CN']) return 'zh-CN';
  return available[browserLanguage] ? browserLanguage : available[browserLanguage.split('-')[0]] ? browserLanguage.split('-')[0] : 'en';
}

function reverseEnglishCatalog(): Map<string, string> {
  return new Map(Object.entries(catalogs().en || {}).map(([key, value]) => [value, key]));
}

function matchTemplate(value: string): { key: string; variables: Record<string, string> } | undefined {
  for (const [key, template] of Object.entries(catalogs().en || {})) {
    if (!template.includes('{')) continue;
    const names: string[] = [];
    const expression = `^${template.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{([a-zA-Z0-9_]+)\\\}/g, (_match, name) => {
      names.push(name);
      return '(.+?)';
    })}$`;
    const match = value.match(new RegExp(expression));
    if (match) return { key, variables: Object.fromEntries(names.map((name, index) => [name, match[index + 1]])) };
  }
  return undefined;
}

export function translateExact(value: string, preference: string): string {
  const whitespace = splitSurroundingWhitespace(value);
  if (whitespace.text && whitespace.text !== value) {
    return `${whitespace.leading}${translateExact(whitespace.text, preference)}${whitespace.trailing}`;
  }
  if (value.includes(' · ')) return value.split(' · ').map((item) => translateExact(item, preference)).join(' · ');
  const key = reverseEnglishCatalog().get(value);
  const target = catalogs()[resolveLanguage(preference)];
  if (key) return target?.[key] || value;
  const match = matchTemplate(value);
  if (!match) return value;
  return (target?.[match.key] || value).replace(/\{([a-zA-Z0-9_]+)\}/g, (_token, name) => translateExact(match.variables[name] || `{${name}}`, preference));
}

function nextLocalizedValue(current: string, previous: LocalizedValueState | undefined, preference: string): LocalizedValueState {
  const source = resolveLocalizedSource(current, previous);
  return { source, rendered: translateExact(source, preference) };
}

function translateNode(node: Text, preference: string) {
  if (node.parentElement?.closest('[data-i18n-skip], .markdown-content, pre, code')) return;
  const current = node.nodeValue || '';
  const next = nextLocalizedValue(current, localizedText.get(node), preference);
  localizedText.set(node, next);
  if (next.rendered !== current) node.nodeValue = next.rendered;
}

function translateAttributes(element: Element, preference: string) {
  const values = localizedAttributes.get(element) || new Map<string, LocalizedValueState>();
  localizedAttributes.set(element, values);
  for (const attribute of localizableAttributes) {
    const current = element.getAttribute(attribute);
    if (!current) continue;
    const next = nextLocalizedValue(current, values.get(attribute), preference);
    values.set(attribute, next);
    if (next.rendered !== current) element.setAttribute(attribute, next.rendered);
  }
}

function translateDocument(preference: string) {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) translateNode(node as Text, preference);
  document.querySelectorAll<HTMLElement>('[aria-label], [placeholder], [title]').forEach((element) => translateAttributes(element, preference));
}

export function useI18n() {
  const [preference, setPreference] = useState('auto');

  useEffect(() => {
    const desktop = (window as any).metisDesktop;
    desktop?.appInfo?.().then((info: { language?: string }) => setPreference(info?.language || 'auto')).catch(() => undefined);
    const onChange = (event: Event) => setPreference((event as CustomEvent<string>).detail || 'auto');
    window.addEventListener('metis:language-changed', onChange);
    return () => window.removeEventListener('metis:language-changed', onChange);
  }, []);

  const language = resolveLanguage(preference);
  const target = catalogs()[language] || catalogs().en || {};

  const t = (keyOrText: string, variables?: Record<string, string | number>): string => {
    let value = target[keyOrText] || catalogs().en?.[keyOrText] || translateExact(keyOrText, preference);
    if (variables) {
      for (const [k, v] of Object.entries(variables)) {
        value = value.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
      }
    }
    return value;
  };

  return { language, preference, t };
}

export function DesktopI18nProvider({ children }: PropsWithChildren) {
  const [preference, setPreference] = useState('auto');

  useEffect(() => {
    const desktop = (window as any).metisDesktop;
    desktop?.appInfo?.().then((info: { language?: string }) => setPreference(info?.language || 'auto')).catch(() => undefined);
    const onChange = (event: Event) => setPreference((event as CustomEvent<string>).detail || 'auto');
    window.addEventListener('metis:language-changed', onChange);
    return () => window.removeEventListener('metis:language-changed', onChange);
  }, []);

  useEffect(() => {
    translateDocument(preference);
    const observer = new MutationObserver(() => translateDocument(preference));
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: localizableAttributes });
    return () => observer.disconnect();
  }, [preference]);

  return <>{children}</>;
}
