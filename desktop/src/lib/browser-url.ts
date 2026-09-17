/**
 * Utilities for normalizing and resolving user input in the embedded browser address bar.
 */

const LOCALHOST_PATTERN = /^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/.*)?$/i;
const PROTOCOL_PREFIX_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;
const DOMAIN_PATTERN = /^([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(:\d+)?(\/.*)?$/;
const IP_PATTERN = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?(\/.*)?$/;

/**
 * Normalizes user input into a valid URL:
 * - Already has protocol (http://, https://, file://, about:blank, etc.): keep as is.
 * - Localhost / local IP: prepends http://.
 * - Domain or public IP: prepends https://.
 * - Otherwise: treats input as search query using Google.
 */
export function normalizeBrowserInput(input: string): string {
  const trimmed = input.trim();
  if (!trimmed || trimmed === 'about:blank') {
    return 'about:blank';
  }

  // Check if it already has a protocol scheme
  if (PROTOCOL_PREFIX_PATTERN.test(trimmed)) {
    return trimmed;
  }

  // Handle localhost or loopback IP
  if (LOCALHOST_PATTERN.test(trimmed)) {
    return `http://${trimmed}`;
  }

  // Handle standard IP address
  if (IP_PATTERN.test(trimmed)) {
    return `http://${trimmed}`;
  }

  // If it contains spaces, it's definitely a search query
  if (/\s/.test(trimmed)) {
    return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
  }

  // Check if it looks like a domain name (e.g. github.com, news.ycombinator.com/path)
  if (DOMAIN_PATTERN.test(trimmed)) {
    return `https://${trimmed}`;
  }

  // Fallback to Google search
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

/**
 * Formats a raw URL for clean display in the address bar when not editing.
 * e.g. "https://github.com/trending" -> "github.com/trending"
 * Keeps protocol for http:// to alert user of non-secure connections, and for special schemes.
 */
export function formatDisplayUrl(rawUrl: string): string {
  if (!rawUrl || rawUrl === 'about:blank') {
    return '';
  }
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === 'https:') {
      return rawUrl.replace(/^https:\/\//, '');
    }
    return rawUrl;
  } catch {
    return rawUrl;
  }
}

/**
 * Extracts a friendly title or hostname from a URL when page title is not yet available.
 */
export function getFallbackBrowserTitle(url?: string | null): string {
  if (!url || url === 'about:blank') return 'Browser';
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
      return parsed.port ? `localhost:${parsed.port}` : 'localhost';
    }
    return parsed.hostname || url;
  } catch {
    return url || 'Browser';
  }
}
