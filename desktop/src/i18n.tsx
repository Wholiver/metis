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
const I18N_SKIP_SELECTOR = '[data-i18n-skip], .markdown-content, pre, code, textarea, input';
const MIN_TEMPLATE_LITERAL_CHARS = 12;

let reverseEnglishCache: Map<string, string> | null = null;
let reverseEnglishCatalogRef: Catalog | null = null;
let templateMatchers: Array<{ key: string; names: string[]; regex: RegExp; templateLiteralLength: number }> | null = null;
let templateMatchersCatalogRef: Catalog | null = null;

function templateLiteralLength(template: string): number {
  return template.replace(/\{[a-zA-Z0-9_]+\}/g, '').length;
}

function catalogs(): Catalogs {
  if (typeof window !== 'undefined' && window.metisDesktopI18nCatalogs) {
    return window.metisDesktopI18nCatalogs;
  }
  if (typeof (globalThis as any).metisDesktopI18nCatalogs !== 'undefined') {
    return (globalThis as any).metisDesktopI18nCatalogs;
  }
  return { en: {} };
}

export function resolveLanguage(preference: string): string {
  const available = catalogs();
  if (preference !== 'auto' && available[preference]) return preference;
  const browserLanguage = (typeof navigator !== 'undefined' ? navigator.language : undefined) || 'en';
  if (/^zh-(HK|MO|TW)$/i.test(browserLanguage) && available['zh-TW']) return 'zh-TW';
  if (/^zh-(CN|SG)$/i.test(browserLanguage) && available['zh-CN']) return 'zh-CN';
  return available[browserLanguage] ? browserLanguage : available[browserLanguage.split('-')[0]] ? browserLanguage.split('-')[0] : 'en';
}

function reverseEnglishCatalog(): Map<string, string> {
  const en = catalogs().en || {};
  if (reverseEnglishCache && reverseEnglishCatalogRef === en) return reverseEnglishCache;
  reverseEnglishCatalogRef = en;
  reverseEnglishCache = new Map(Object.entries(en).map(([key, value]) => [value, key]));
  return reverseEnglishCache;
}

function compiledTemplateMatchers(): Array<{ key: string; names: string[]; regex: RegExp; templateLiteralLength: number }> {
  const en = catalogs().en || {};
  if (templateMatchers && templateMatchersCatalogRef === en) return templateMatchers;
  templateMatchersCatalogRef = en;
  templateMatchers = [];
  for (const [key, template] of Object.entries(en)) {
    if (!template.includes('{')) continue;
    const names: string[] = [];
    const expression = `^${template.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{([a-zA-Z0-9_]+)\\\}/g, (_match, name) => {
      names.push(name);
      return '(.+?)';
    })}$`;
    templateMatchers.push({
      key,
      names,
      regex: new RegExp(expression),
      templateLiteralLength: templateLiteralLength(template),
    });
  }
  return templateMatchers;
}

function matchTemplate(value: string): { key: string; variables: Record<string, string> } | undefined {
  for (const matcher of compiledTemplateMatchers()) {
    const match = value.match(matcher.regex);
    if (!match) continue;
    const variables = Object.fromEntries(matcher.names.map((name, index) => [name, match[index + 1]]));
    if (matcher.templateLiteralLength < MIN_TEMPLATE_LITERAL_CHARS) {
      const capturesAreCompact = Object.values(variables).every((capture) => /^[\d.,:%+-]+$/.test(capture));
      if (!capturesAreCompact) continue;
    }
    return { key: matcher.key, variables };
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
  // Already translated for this preference and source — skip catalog work.
  if (
    previous
    && previous.preference === preference
    && previous.source === source
    && previous.rendered === current
  ) {
    return previous;
  }
  return { source, rendered: translateExact(source, preference), preference };
}

function isSkippedElement(element: Element | null | undefined): boolean {
  return Boolean(element?.closest(I18N_SKIP_SELECTOR));
}

function translateNode(node: Text, preference: string) {
  if (isSkippedElement(node.parentElement)) return;
  const current = node.nodeValue || '';
  const previous = localizedText.get(node);
  const next = nextLocalizedValue(current, previous, preference);
  localizedText.set(node, next);
  if (next.rendered !== current) node.nodeValue = next.rendered;
}

function translateAttributes(element: Element, preference: string) {
  if (isSkippedElement(element)) return;
  const values = localizedAttributes.get(element) || new Map<string, LocalizedValueState>();
  localizedAttributes.set(element, values);
  for (const attribute of localizableAttributes) {
    const current = element.getAttribute(attribute);
    if (!current) continue;
    const previous = values.get(attribute);
    const next = nextLocalizedValue(current, previous, preference);
    values.set(attribute, next);
    if (next.rendered !== current) element.setAttribute(attribute, next.rendered);
  }
}

function skipNodeFilter(): NodeFilter {
  return {
    acceptNode(node) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        // REJECT skips the element and all descendants — critical under streaming markdown.
        return (node as Element).matches(I18N_SKIP_SELECTOR)
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_SKIP;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  };
}

/** Full document walk — only on language preference changes. */
function translateDocument(preference: string) {
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    skipNodeFilter(),
  );
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node.nodeType === Node.TEXT_NODE) translateNode(node as Text, preference);
  }
  document.querySelectorAll<HTMLElement>('[aria-label], [placeholder], [title]').forEach((element) => {
    if (isSkippedElement(element)) return;
    translateAttributes(element, preference);
  });
}

/** Incremental translate for newly inserted DOM (sidebar titles, dialogs, etc.). */
function translateSubtree(root: Node, preference: string) {
  if (root.nodeType === Node.TEXT_NODE) {
    translateNode(root as Text, preference);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  const element = root as Element;
  if (element.matches(I18N_SKIP_SELECTOR) || isSkippedElement(element.parentElement)) return;
  translateAttributes(element, preference);
  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    skipNodeFilter(),
  );
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node.nodeType === Node.TEXT_NODE) translateNode(node as Text, preference);
  }
  element.querySelectorAll<HTMLElement>('[aria-label], [placeholder], [title]').forEach((child) => {
    if (isSkippedElement(child)) return;
    translateAttributes(child, preference);
  });
}

function mutationTouchesLocalizableDom(mutations: MutationRecord[]): boolean {
  for (const mutation of mutations) {
    const target = mutation.target;
    const targetElement = target.nodeType === Node.ELEMENT_NODE
      ? target as Element
      : target.parentElement;
    if (isSkippedElement(targetElement)) continue;
    if (mutation.type === 'attributes') return true;
    if (mutation.type === 'childList') {
      if (mutation.addedNodes.length > 0) return true;
    }
  }
  return false;
}

function translateMutations(mutations: MutationRecord[], preference: string) {
  for (const mutation of mutations) {
    if (mutation.type === 'attributes' && mutation.target.nodeType === Node.ELEMENT_NODE) {
      translateAttributes(mutation.target as Element, preference);
      continue;
    }
    if (mutation.type !== 'childList') continue;
    for (const added of mutation.addedNodes) {
      translateSubtree(added, preference);
    }
  }
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
    let raf = 0;
    let pending: MutationRecord[] = [];
    const observer = new MutationObserver((mutations) => {
      if (!mutationTouchesLocalizableDom(mutations)) return;
      pending.push(...mutations);
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        const batch = pending;
        pending = [];
        observer.disconnect();
        translateMutations(batch, preference);
        observer.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: localizableAttributes,
        });
      });
    });
    // Language change (or first mount): full document pass once.
    translateDocument(preference);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: localizableAttributes,
    });
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [preference]);

  return <>{children}</>;
}
