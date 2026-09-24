/**
 * Fit oversized Inspector browser content into the visible viewport.
 *
 * Chromium often serves file:// SVG with <svg> as documentElement (no html/body),
 * so selector-based CSS alone is not enough — we style the root node directly and
 * return a zoom factor from real layout overflow for the host/webview to apply.
 *
 * Keep in sync with `desktop/browser-fit.cjs` (contract-tested).
 */

export const BROWSER_FIT_STYLE_ID = "metis-browser-fit-viewport";

/** Pure scale helper — keeps host/renderer math identical. */
export function computeFitZoomScale(
  contentWidth: number,
  contentHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): number {
  if (
    !(contentWidth > 0) ||
    !(contentHeight > 0) ||
    !(viewportWidth > 0) ||
    !(viewportHeight > 0)
  ) {
    return 1;
  }
  const scale = Math.min(1, viewportWidth / contentWidth, viewportHeight / contentHeight);
  if (!Number.isFinite(scale) || scale <= 0) return 1;
  if (scale >= 0.995) return 1;
  return Math.max(0.05, scale);
}

/**
 * Guest-page script (async).
 * Returns { fitted, zoomFactor, contentWidth, contentHeight, viewportWidth, viewportHeight, tag? }.
 */
export const BROWSER_FIT_VIEWPORT_SCRIPT = `(() => {
  const STYLE_ID = "metis-browser-fit-viewport";
  const mediaTags = new Set(["svg", "img", "video", "canvas", "object"]);

  const meaningfulChildren = (parent) => {
    if (!parent) return [];
    return Array.from(parent.children).filter((el) => {
      if (!(el instanceof Element)) return false;
      const tag = el.tagName.toLowerCase();
      if (tag === "script" || tag === "style" || tag === "link" || tag === "meta" || tag === "noscript") return false;
      if (el.id === STYLE_ID) return false;
      return true;
    });
  };

  const isSvgUrl = () => {
    try {
      const href = String(location.href || "");
      const path = String(location.pathname || "");
      return /\\.svg(?:$|\\?|#)/i.test(path) || /\\.svg(?:$|\\?|#)/i.test(href);
    } catch {
      return false;
    }
  };

  const isFileUrl = () => {
    try {
      return location.protocol === "file:";
    } catch {
      return false;
    }
  };

  const findPrimaryMedia = () => {
    const root = document.documentElement;
    const rootTag = root?.tagName?.toLowerCase();
    if (rootTag === "svg") return root;
    const bodyKids = meaningfulChildren(document.body);
    if (bodyKids.length === 1) {
      const only = bodyKids[0];
      const tag = only.tagName.toLowerCase();
      if (mediaTags.has(tag)) return only;
      const nested = meaningfulChildren(only);
      if (nested.length === 1 && mediaTags.has(nested[0].tagName.toLowerCase())) {
        return nested[0];
      }
    }
    if (isSvgUrl()) return document.querySelector("svg");
    return null;
  };

  const parseLength = (value) => {
    if (value == null || value === "") return NaN;
    const raw = String(value).trim();
    if (!raw || raw.endsWith("%")) return NaN;
    const num = parseFloat(raw);
    return Number.isFinite(num) && num > 0 ? num : NaN;
  };

  const ensureSvgViewBox = (svg) => {
    if (svg.getAttribute("viewBox")) return;
    const base = svg.viewBox && svg.viewBox.baseVal;
    if (base && base.width > 0 && base.height > 0) {
      svg.setAttribute("viewBox", "0 0 " + base.width + " " + base.height);
      return;
    }
    const w = parseLength(svg.getAttribute("width"));
    const h = parseLength(svg.getAttribute("height"));
    if (w > 0 && h > 0) {
      svg.setAttribute("viewBox", "0 0 " + w + " " + h);
      return;
    }
    try {
      const bbox = svg.getBBox();
      if (bbox && bbox.width > 0 && bbox.height > 0) {
        svg.setAttribute("viewBox", "0 0 " + bbox.width + " " + bbox.height);
      }
    } catch (_) {}
  };

  const prepareSvg = (svg) => {
    ensureSvgViewBox(svg);
    if (!svg.getAttribute("preserveAspectRatio")) {
      svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    }
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.style.setProperty("width", "100%", "important");
    svg.style.setProperty("height", "100%", "important");
    svg.style.setProperty("max-width", "100%", "important");
    svg.style.setProperty("max-height", "100%", "important");
    svg.style.setProperty("display", "block", "important");
  };

  const injectCss = () => {
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(style);
    }
    style.textContent = [
      "html, body, :root {",
      "  margin: 0 !important;",
      "  padding: 0 !important;",
      "  width: 100% !important;",
      "  height: 100% !important;",
      "  overflow: hidden !important;",
      "  background: transparent !important;",
      "}",
      "svg:root {",
      "  width: 100% !important;",
      "  height: 100% !important;",
      "  max-width: 100vw !important;",
      "  max-height: 100vh !important;",
      "  display: block !important;",
      "  position: fixed !important;",
      "  inset: 0 !important;",
      "  margin: 0 !important;",
      "}",
      "html, body {",
      "  display: flex !important;",
      "  align-items: center !important;",
      "  justify-content: center !important;",
      "}",
      "body > svg, html > svg, body svg:only-of-type {",
      "  width: 100% !important;",
      "  height: 100% !important;",
      "  max-width: 100vw !important;",
      "  max-height: 100vh !important;",
      "  display: block !important;",
      "  flex: 0 0 auto !important;",
      "}",
      "body > img:first-of-type,",
      "body > video:first-of-type,",
      "body > canvas:first-of-type,",
      "body > object:first-of-type,",
      "body img:only-of-type,",
      "body video:only-of-type,",
      "body canvas:only-of-type {",
      "  max-width: 100vw !important;",
      "  max-height: 100vh !important;",
      "  width: auto !important;",
      "  height: auto !important;",
      "  object-fit: contain !important;",
      "}",
    ].join("\\n");
  };

  const measureLayout = () => {
    const doc = document.documentElement;
    const body = document.body;
    const width = Math.max(
      Number(doc?.scrollWidth) || 0,
      Number(body?.scrollWidth) || 0,
      Number(window.innerWidth) || 0,
    );
    const height = Math.max(
      Number(doc?.scrollHeight) || 0,
      Number(body?.scrollHeight) || 0,
      Number(window.innerHeight) || 0,
    );
    return { width, height };
  };

  const computeScale = (contentWidth, contentHeight, viewportWidth, viewportHeight) => {
    if (!(contentWidth > 0) || !(contentHeight > 0) || !(viewportWidth > 0) || !(viewportHeight > 0)) {
      return 1;
    }
    const scale = Math.min(1, viewportWidth / contentWidth, viewportHeight / contentHeight);
    if (!Number.isFinite(scale) || scale <= 0) return 1;
    if (scale >= 0.995) return 1;
    return Math.max(0.05, scale);
  };

  const waitFrames = () => new Promise((resolve) => {
    const raf = (typeof requestAnimationFrame === "function"
      ? requestAnimationFrame
      : (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function"
        ? window.requestAnimationFrame.bind(window)
        : (cb) => setTimeout(cb, 16)));
    raf(() => raf(() => resolve(true)));
  });

  return (async () => {
    const media = findPrimaryMedia();
    const existing = document.getElementById(STYLE_ID);
    const viewportWidth = Math.max(1, Number(window.innerWidth) || 1);
    const viewportHeight = Math.max(1, Number(window.innerHeight) || 1);
    const shouldFit = Boolean(media) || isFileUrl() || isSvgUrl();

    if (!shouldFit) {
      existing?.remove();
      return {
        fitted: false,
        zoomFactor: 1,
        contentWidth: viewportWidth,
        contentHeight: viewportHeight,
        viewportWidth,
        viewportHeight,
        reason: "not-media-document",
      };
    }

    if (media && media.tagName.toLowerCase() === "svg") {
      prepareSvg(media);
    } else if (media && mediaTags.has(media.tagName.toLowerCase())) {
      media.style.setProperty("max-width", "100vw", "important");
      media.style.setProperty("max-height", "100vh", "important");
      media.style.setProperty("width", "auto", "important");
      media.style.setProperty("height", "auto", "important");
      media.style.setProperty("object-fit", "contain", "important");
    }

    injectCss();
    await waitFrames();

    // Zoom from post-CSS layout only. If percentage sizing already fits, scale stays 1.
    // If CSS could not shrink a fixed-px root, scrollWidth/Height stay large and zoom corrects it.
    const layout = measureLayout();
    const contentWidth = layout.width;
    const contentHeight = layout.height;
    const zoomFactor = computeScale(contentWidth, contentHeight, viewportWidth, viewportHeight);

    return {
      fitted: true,
      zoomFactor,
      contentWidth,
      contentHeight,
      viewportWidth,
      viewportHeight,
      tag: media ? media.tagName.toLowerCase() : undefined,
      hasViewBox: media && media.tagName.toLowerCase() === "svg"
        ? Boolean(media.getAttribute("viewBox"))
        : undefined,
    };
  })();
})()`;
