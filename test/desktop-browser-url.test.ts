import { describe, expect, it } from 'vitest';
import {
  normalizeBrowserInput,
  formatDisplayUrl,
  getFallbackBrowserTitle,
} from '../desktop/src/lib/browser-url';

describe('desktop browser-url utilities', () => {
  it('normalizes localhost and port with http', () => {
    expect(normalizeBrowserInput('localhost:3000')).toBe('http://localhost:3000');
    expect(normalizeBrowserInput('localhost:5173/test')).toBe('http://localhost:5173/test');
    expect(normalizeBrowserInput('127.0.0.1:8080')).toBe('http://127.0.0.1:8080');
  });

  it('normalizes domains without protocol with https', () => {
    expect(normalizeBrowserInput('github.com')).toBe('https://github.com');
    expect(normalizeBrowserInput('vitejs.dev/guide/')).toBe('https://vitejs.dev/guide/');
    expect(normalizeBrowserInput('sub.domain.co.uk')).toBe('https://sub.domain.co.uk');
  });

  it('keeps existing protocols untouched', () => {
    expect(normalizeBrowserInput('https://google.com')).toBe('https://google.com');
    expect(normalizeBrowserInput('http://my-insecure-site.com')).toBe('http://my-insecure-site.com');
    expect(normalizeBrowserInput('about:blank')).toBe('about:blank');
  });

  it('converts multi-word queries or non-domain inputs to Google search', () => {
    expect(normalizeBrowserInput('react hooks tutorial')).toBe(
      'https://www.google.com/search?q=react%20hooks%20tutorial'
    );
    expect(normalizeBrowserInput('electron')).toBe(
      'https://www.google.com/search?q=electron'
    );
  });

  it('formats display URL cleanly', () => {
    expect(formatDisplayUrl('https://github.com/trending')).toBe('github.com/trending');
    expect(formatDisplayUrl('http://localhost:3000')).toBe('http://localhost:3000');
    expect(formatDisplayUrl('about:blank')).toBe('');
  });

  it('extracts fallback titles from URL', () => {
    expect(getFallbackBrowserTitle('http://localhost:3000')).toBe('localhost:3000');
    expect(getFallbackBrowserTitle('https://github.com/trending')).toBe('github.com');
    expect(getFallbackBrowserTitle('')).toBe('Browser');
    expect(getFallbackBrowserTitle('about:blank')).toBe('Browser');
  });
});
