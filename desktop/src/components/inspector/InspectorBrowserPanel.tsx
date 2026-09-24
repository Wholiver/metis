import React, {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  ArrowLeft,
  ArrowRight,
  RotateCw,
  X,
  ExternalLink,
  Copy,
  Check,
  Globe,
} from 'lucide-react';
import { InspectorTab } from '../../lib/inspector-tabs';
import {
  normalizeBrowserInput,
  formatDisplayUrl,
  getFallbackBrowserTitle,
} from '../../lib/browser-url';
import { BROWSER_FIT_VIEWPORT_SCRIPT, computeFitZoomScale } from '../../lib/browser-fit';
import { useI18n } from '../../i18n';
import { BROWSER_SHINE_COLORS, ShineBorder } from '../ui/shine-border';

interface WebviewElement extends HTMLElement {
  src: string;
  loadURL: (url: string) => Promise<void>;
  goBack: () => void;
  goForward: () => void;
  reload: () => void;
  stop: () => void;
  canGoBack: () => boolean;
  canGoForward: () => boolean;
  isLoading: () => boolean;
  getURL: () => string;
  getTitle: () => string;
  getWebContentsId?: () => number;
  executeJavaScript?: (code: string, userGesture?: boolean) => Promise<unknown>;
  insertCSS?: (css: string) => Promise<string>;
  getZoomFactor?: () => number;
  setZoomFactor?: (factor: number) => void;
  setZoomLevel?: (level: number) => void;
  setVisualZoomLevelLimits?: (minimumLevel: number, maximumLevel: number) => void;
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string;
        partition?: string;
        allowpopups?: boolean | string;
        webpreferences?: string;
      };
    }
  }
}

interface InspectorBrowserPanelProps {
  tab: InspectorTab;
  modelControlled?: boolean;
  onUpdateTab: (
    tabId: string,
    patch: Partial<Pick<InspectorTab, 'browserUrl' | 'browserTitle' | 'browserFavicon' | 'browserCanGoBack' | 'browserCanGoForward' | 'browserIsLoading'>>,
  ) => void;
}

function urlsMatch(a: string | undefined, b: string | undefined): boolean {
  return formatDisplayUrl(a || '') === formatDisplayUrl(b || '');
}

function InspectorBrowserPanelInner({
  tab,
  modelControlled = false,
  onUpdateTab,
}: InspectorBrowserPanelProps) {
  const { t } = useI18n();
  const webviewRef = useRef<WebviewElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const onUpdateTabRef = useRef(onUpdateTab);
  const tabMetaRef = useRef({ id: tab.id, browserTitle: tab.browserTitle, browserUrl: tab.browserUrl });
  const lastReportedUrlRef = useRef<string>(tab.browserUrl || 'about:blank');
  const appliedZoomRef = useRef<number>(1);
  const lastViewportSizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });

  onUpdateTabRef.current = onUpdateTab;
  tabMetaRef.current = { id: tab.id, browserTitle: tab.browserTitle, browserUrl: tab.browserUrl };

  const currentUrl = tab.browserUrl || '';
  // Mount-once src — never rebind React `src` when the address bar / host updates URL.
  const [initialSrc] = useState(() => currentUrl || 'about:blank');
  const [addressInput, setAddressInput] = useState<string>(formatDisplayUrl(currentUrl));
  const [isInputFocused, setIsInputFocused] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const canGoBack = Boolean(tab.browserCanGoBack);
  const canGoForward = Boolean(tab.browserCanGoForward);
  const isLoading = Boolean(tab.browserIsLoading);
  const isBlankUrl = !currentUrl || currentUrl === 'about:blank';

  useEffect(() => {
    if (!isInputFocused) {
      setAddressInput(formatDisplayUrl(currentUrl));
    }
  }, [currentUrl, isInputFocused]);

  // Parent-driven navigation (markdown open-browser / ensure-tab UI). Host may also
  // loadURL; skip when the guest is already on the display-normalized target.
  useEffect(() => {
    const target = currentUrl || 'about:blank';
    if (urlsMatch(lastReportedUrlRef.current, target)) return;
    const webview = webviewRef.current;
    if (!webview) return;
    try {
      const live = webview.getURL?.() || '';
      if (urlsMatch(live, target)) {
        lastReportedUrlRef.current = target;
        return;
      }
      if (typeof webview.isLoading === 'function' && webview.isLoading()) {
        return;
      }
    } catch {
      // Guest not ready yet.
    }
    setLoadError(null);
    try {
      void webview.loadURL(target);
    } catch {
      webview.src = target;
    }
  }, [currentUrl]);

  const navigateTo = useCallback((rawTarget: string) => {
    const url = normalizeBrowserInput(rawTarget);
    if (!url || url === 'about:blank') {
      onUpdateTabRef.current(tab.id, {
        browserUrl: 'about:blank',
        browserTitle: t('browser') || 'Browser',
        browserCanGoBack: false,
        browserCanGoForward: false,
        browserIsLoading: true,
      });
      lastReportedUrlRef.current = 'about:blank';
      setLoadError(null);
      if (webviewRef.current) {
        try {
          void webviewRef.current.loadURL('about:blank');
        } catch {
          webviewRef.current.src = 'about:blank';
        }
      }
      return;
    }

    setLoadError(null);
    lastReportedUrlRef.current = url;
    onUpdateTabRef.current(tab.id, {
      browserUrl: url,
      browserTitle: getFallbackBrowserTitle(url),
      browserIsLoading: true,
    });

    if (webviewRef.current) {
      try {
        void webviewRef.current.loadURL(url);
      } catch {
        webviewRef.current.src = url;
      }
    }
  }, [tab.id, t]);

  const handleBack = useCallback(() => {
    if (webviewRef.current && webviewRef.current.canGoBack()) {
      webviewRef.current.goBack();
    }
  }, []);

  const handleForward = useCallback(() => {
    if (webviewRef.current && webviewRef.current.canGoForward()) {
      webviewRef.current.goForward();
    }
  }, []);

  const handleReloadOrStop = useCallback(() => {
    if (!webviewRef.current) return;
    if (isLoading) {
      webviewRef.current.stop();
      onUpdateTabRef.current(tab.id, { browserIsLoading: false });
    } else {
      setLoadError(null);
      webviewRef.current.reload();
    }
  }, [isLoading, tab.id]);

  const handleOpenExternal = useCallback(() => {
    if (isBlankUrl) return;
    const desktop = (window as unknown as { metisDesktop?: { openExternal?: (url: string) => Promise<void> } }).metisDesktop;
    if (desktop?.openExternal) {
      void desktop.openExternal(currentUrl);
    } else {
      window.open(currentUrl, '_blank');
    }
  }, [currentUrl, isBlankUrl]);

  const handleCopy = useCallback(async () => {
    if (isBlankUrl) return;
    try {
      await navigator.clipboard.writeText(currentUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }, [currentUrl, isBlankUrl]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      inputRef.current?.blur();
      navigateTo(addressInput);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setAddressInput(formatDisplayUrl(currentUrl));
      inputRef.current?.blur();
    }
  };

  const handleFocus = () => {
    setIsInputFocused(true);
    setAddressInput(currentUrl);
    setTimeout(() => {
      inputRef.current?.select();
    }, 10);
  };

  const handleBlur = () => {
    setIsInputFocused(false);
    setAddressInput(formatDisplayUrl(currentUrl));
  };

  // Listeners + fit — only re-bind when the tab identity changes.
  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;

    const desktopBrowser = (
      window as unknown as {
        metisDesktop?: {
          browser?: {
            bindTab?: (payload: {
              tabId: string;
              webContentsId: number;
              url?: string;
              title?: string;
            }) => Promise<unknown>;
            updateTabMeta?: (payload: {
              tabId: string;
              url?: string;
              title?: string;
            }) => Promise<unknown>;
          };
        };
      }
    ).metisDesktop?.browser;

    const bindToHost = () => {
      try {
        const webContentsId = webview.getWebContentsId?.();
        if (typeof webContentsId !== 'number') return;
        const meta = tabMetaRef.current;
        void desktopBrowser?.bindTab?.({
          tabId: meta.id,
          webContentsId,
          url: (() => {
            try {
              return webview.getURL() || meta.browserUrl || '';
            } catch {
              return meta.browserUrl || '';
            }
          })(),
          title: (() => {
            try {
              return webview.getTitle() || meta.browserTitle || 'Browser';
            } catch {
              return meta.browserTitle || 'Browser';
            }
          })(),
        });
      } catch {
        // webview may not be ready yet
      }
    };

    const syncHostMeta = (url?: string, title?: string) => {
      void desktopBrowser?.updateTabMeta?.({
        tabId: tabMetaRef.current.id,
        url,
        title,
      });
    };

    const onStartLoading = () => {
      onUpdateTabRef.current(tabMetaRef.current.id, {
        browserIsLoading: true,
      });
    };

    const onStopLoading = () => {
      try {
        const canBack = webview.canGoBack();
        const canFwd = webview.canGoForward();
        const url = webview.getURL();
        const title = webview.getTitle();
        if (url) lastReportedUrlRef.current = url;
        onUpdateTabRef.current(tabMetaRef.current.id, {
          browserIsLoading: false,
          browserCanGoBack: canBack,
          browserCanGoForward: canFwd,
          ...(url && url !== 'about:blank' ? { browserUrl: url } : {}),
          ...(title ? { browserTitle: title } : {}),
        });
        syncHostMeta(url, title);
        bindToHost();
      } catch {
        onUpdateTabRef.current(tabMetaRef.current.id, { browserIsLoading: false });
      }
    };

    const onTitleUpdated = (event: Event) => {
      const customEvent = event as Event & { title?: string };
      if (customEvent.title) {
        onUpdateTabRef.current(tabMetaRef.current.id, { browserTitle: customEvent.title });
        syncHostMeta(undefined, customEvent.title);
      }
    };

    const onFaviconUpdated = (event: Event) => {
      const customEvent = event as Event & { favicons?: string[] };
      if (customEvent.favicons && customEvent.favicons.length > 0) {
        onUpdateTabRef.current(tabMetaRef.current.id, { browserFavicon: customEvent.favicons[0] });
      }
    };

    const onDidNavigate = (event: Event) => {
      const customEvent = event as Event & { url?: string };
      if (customEvent.url && customEvent.url !== 'about:blank') {
        lastReportedUrlRef.current = customEvent.url;
        try {
          onUpdateTabRef.current(tabMetaRef.current.id, {
            browserUrl: customEvent.url,
            browserCanGoBack: webview.canGoBack(),
            browserCanGoForward: webview.canGoForward(),
          });
        } catch {
          onUpdateTabRef.current(tabMetaRef.current.id, { browserUrl: customEvent.url });
        }
        syncHostMeta(customEvent.url);
      }
    };

    const onFailLoad = (event: Event) => {
      const customEvent = event as Event & {
        errorCode?: number;
        errorDescription?: string;
        isMainFrame?: boolean;
      };
      if (customEvent.isMainFrame && customEvent.errorCode !== -3) { // -3 is ERR_ABORTED
        setLoadError(customEvent.errorDescription || 'Failed to load webpage');
        onUpdateTabRef.current(tabMetaRef.current.id, { browserIsLoading: false });
      }
    };

    const lockUserZoomGestures = () => {
      try {
        webview.setVisualZoomLevelLimits?.(1, 1);
      } catch {
        // webview may not expose zoom APIs yet
      }
    };

    const applyZoomIfNeeded = (zoomFactor: number) => {
      const next = Math.max(0.05, Math.min(1, zoomFactor));
      let current = appliedZoomRef.current;
      try {
        if (typeof webview.getZoomFactor === 'function') {
          current = webview.getZoomFactor();
        }
      } catch {
        // keep appliedZoomRef
      }
      if (Math.abs(current - next) < 0.01) {
        appliedZoomRef.current = current;
        return;
      }
      try {
        webview.setZoomFactor?.(next);
        appliedZoomRef.current = next;
      } catch {
        // Zoom APIs may be unavailable.
      }
    };

    const fitViewportContent = async () => {
      try {
        const viewportEl = viewportRef.current;
        if (viewportEl) {
          const panel = viewportEl.closest('[hidden]');
          if (panel) return;
          const rect = viewportEl.getBoundingClientRect();
          if (rect.width < 2 || rect.height < 2) return;
        }
        lockUserZoomGestures();
        const result = (await webview.executeJavaScript?.(BROWSER_FIT_VIEWPORT_SCRIPT, false)) as
          | {
              fitted?: boolean;
              zoomFactor?: number;
              contentWidth?: number;
              contentHeight?: number;
              viewportWidth?: number;
              viewportHeight?: number;
            }
          | null
          | undefined;
        const fromResult =
          typeof result?.zoomFactor === 'number' && Number.isFinite(result.zoomFactor)
            ? Math.max(0.05, Math.min(1, result.zoomFactor))
            : null;
        const computed = computeFitZoomScale(
          Number(result?.contentWidth) || 0,
          Number(result?.contentHeight) || 0,
          Number(result?.viewportWidth) || 0,
          Number(result?.viewportHeight) || 0,
        );
        applyZoomIfNeeded(fromResult ?? computed);
      } catch {
        // Guest may not be ready yet; dom-ready / stop-loading / resize retry.
      }
    };

    const onDomReady = () => {
      void fitViewportContent();
      bindToHost();
    };

    const onStopLoadingWithFit = () => {
      onStopLoading();
      void fitViewportContent();
    };

    webview.addEventListener('did-start-loading', onStartLoading);
    webview.addEventListener('did-stop-loading', onStopLoadingWithFit);
    webview.addEventListener('page-title-updated', onTitleUpdated);
    webview.addEventListener('page-favicon-updated', onFaviconUpdated);
    webview.addEventListener('did-navigate', onDidNavigate);
    webview.addEventListener('did-navigate-in-page', onDidNavigate);
    webview.addEventListener('did-fail-load', onFailLoad);
    webview.addEventListener('dom-ready', onDomReady);
    void fitViewportContent();
    bindToHost();

    const viewportEl = viewportRef.current;
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const resizeObserver =
      viewportEl && typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver((entries) => {
            const entry = entries[0];
            const width = entry?.contentRect?.width ?? 0;
            const height = entry?.contentRect?.height ?? 0;
            if (width < 2 || height < 2) return;
            if (viewportEl.closest('[hidden]')) return;
            const prev = lastViewportSizeRef.current;
            if (Math.abs(prev.width - width) < 2 && Math.abs(prev.height - height) < 2) return;
            lastViewportSizeRef.current = { width, height };
            if (resizeTimer) clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
              void fitViewportContent();
            }, 50);
          })
        : null;
    resizeObserver?.observe(viewportEl);

    return () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeObserver?.disconnect();
      webview.removeEventListener('did-start-loading', onStartLoading);
      webview.removeEventListener('did-stop-loading', onStopLoadingWithFit);
      webview.removeEventListener('page-title-updated', onTitleUpdated);
      webview.removeEventListener('page-favicon-updated', onFaviconUpdated);
      webview.removeEventListener('did-navigate', onDidNavigate);
      webview.removeEventListener('did-navigate-in-page', onDidNavigate);
      webview.removeEventListener('did-fail-load', onFailLoad);
      webview.removeEventListener('dom-ready', onDomReady);
    };
  }, [tab.id]);

  return (
    <div
      className="relative flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden bg-page select-text"
      style={{ contain: 'layout paint' }}
      data-browser-panel=""
      data-browser-model-controlled={modelControlled ? 'true' : undefined}
      aria-busy={modelControlled ? true : undefined}
    >
      {modelControlled ? (
        <ShineBorder
          borderWidth={2}
          duration={10}
          shineColor={[...BROWSER_SHINE_COLORS]}
        />
      ) : null}
      {/* Opaque inner frame above shine — padding stays transparent so only the 2px ring shows. */}
      <div
        className={`relative z-10 flex min-h-0 flex-1 flex-col ${modelControlled ? 'p-[2px]' : ''}`}
        data-browser-content-frame=""
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-page">
      {/* Browser Toolbar — BeautifulUI & OpenCode styling */}
      <div className="flex items-center gap-1.5 px-2.5 h-[42px] border-b border-line bg-page shrink-0">
        {/* Navigation Buttons */}
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            disabled={!canGoBack}
            onClick={handleBack}
            className="flex h-7 w-7 items-center justify-center rounded-[7px] text-ink-3 hover:bg-hover-2 hover:text-ink active:scale-[0.96] disabled:opacity-25 disabled:pointer-events-none transition-all duration-150"
            title={t('back') || 'Back'}
            aria-label={t('back') || 'Back'}
          >
            <ArrowLeft className="w-3.5 h-3.5 stroke-[1.8]" />
          </button>
          <button
            type="button"
            disabled={!canGoForward}
            onClick={handleForward}
            className="flex h-7 w-7 items-center justify-center rounded-[7px] text-ink-3 hover:bg-hover-2 hover:text-ink active:scale-[0.96] disabled:opacity-25 disabled:pointer-events-none transition-all duration-150"
            title={t('forward') || 'Forward'}
            aria-label={t('forward') || 'Forward'}
          >
            <ArrowRight className="w-3.5 h-3.5 stroke-[1.8]" />
          </button>
          <button
            type="button"
            onClick={handleReloadOrStop}
            className="flex h-7 w-7 items-center justify-center rounded-[7px] text-ink-3 hover:bg-hover-2 hover:text-ink active:scale-[0.96] transition-all duration-150"
            title={isLoading ? (t('stopLoading') || 'Stop') : (t('refresh') || 'Refresh')}
            aria-label={isLoading ? (t('stopLoading') || 'Stop') : (t('refresh') || 'Refresh')}
          >
            {isLoading ? (
              <X className="w-3.5 h-3.5 stroke-[1.8]" />
            ) : (
              <RotateCw className="w-3.5 h-3.5 stroke-[1.8]" />
            )}
          </button>
        </div>

        {/* Address Input Bar */}
        <div className="flex-1 min-w-0 flex items-center relative rounded-[8px] border border-line bg-field/70 px-2.5 h-7 shadow-hairline transition-all duration-150 focus-within:bg-surface focus-within:border-line-strong focus-within:ring-2 focus-within:ring-[color:var(--focus)]/25 focus-within:shadow-btn">
          <Globe className="w-3.5 h-3.5 text-ink-3 shrink-0 mr-1.5 opacity-70 stroke-[1.8]" />
          <input
            ref={inputRef}
            type="text"
            value={addressInput}
            onChange={(e) => setAddressInput(e.target.value)}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            placeholder={t('browserPlaceholder') || 'Search or enter web address'}
            className="w-full bg-transparent text-[12.5px] font-normal text-ink outline-none placeholder:text-ink-3 leading-normal truncate"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />
          {addressInput && isInputFocused && (
            <button
              type="button"
              tabIndex={-1}
              onMouseDown={(e) => {
                e.preventDefault();
                setAddressInput('');
              }}
              className="p-0.5 rounded-[4px] text-ink-3 hover:text-ink hover:bg-hover active:scale-[0.96] transition-all"
            >
              <X className="w-3 h-3 stroke-[1.8]" />
            </button>
          )}
        </div>

        {/* Utility Actions */}
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            disabled={isBlankUrl}
            onClick={handleCopy}
            className="flex h-7 w-7 items-center justify-center rounded-[7px] text-ink-3 hover:bg-hover-2 hover:text-ink active:scale-[0.96] disabled:opacity-25 disabled:pointer-events-none transition-all duration-150"
            title={copied ? (t('pageUrlCopied') || 'Link copied') : (t('copyPageUrl') || 'Copy link')}
            aria-label={t('copyPageUrl') || 'Copy link'}
          >
            {copied ? <Check className="w-3.5 h-3.5 text-green stroke-[2.2]" /> : <Copy className="w-3.5 h-3.5 stroke-[1.8]" />}
          </button>
          <button
            type="button"
            disabled={isBlankUrl}
            onClick={handleOpenExternal}
            className="flex h-7 w-7 items-center justify-center rounded-[7px] text-ink-3 hover:bg-hover-2 hover:text-ink active:scale-[0.96] disabled:opacity-25 disabled:pointer-events-none transition-all duration-150"
            title={t('openInExternalBrowser') || 'Open in system browser'}
            aria-label={t('openInExternalBrowser') || 'Open in system browser'}
          >
            <ExternalLink className="w-3.5 h-3.5 stroke-[1.8]" />
          </button>
        </div>
      </div>

      {/* Loading Progress Bar */}
      {isLoading && (
        <div className="h-[2px] w-full bg-transparent overflow-hidden shrink-0">
          <div className="h-full bg-accent animate-pulse w-2/3 transition-all duration-300" />
        </div>
      )}

      {/* Main Viewport — media/local docs auto-fit via CSS + zoomFactor */}
      <div
        ref={viewportRef}
        className="relative flex-1 min-h-0 min-w-0 w-full bg-page overflow-hidden overscroll-none"
        data-browser-viewport=""
        data-browser-fit-viewport=""
        style={{ touchAction: 'pan-x pan-y' }}
      >
        {/* Load Error View */}
        {loadError && !isBlankUrl && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center p-6 text-center bg-page/95 backdrop-blur-sm">
            <div className="p-6 rounded-[14px] border border-line bg-surface shadow-card max-w-sm flex flex-col items-center">
              <div className="text-red font-medium text-[13.5px] mb-1.5">
                {loadError}
              </div>
              <p className="text-[12px] text-ink-3 mb-4 font-mono truncate max-w-[280px]">
                {currentUrl}
              </p>
              <button
                type="button"
                onClick={handleReloadOrStop}
                className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-[8px] border border-line bg-surface text-ink text-[12.5px] font-medium hover:bg-hover hover:border-line-strong active:scale-[0.96] transition-all shadow-btn cursor-pointer"
              >
                <RotateCw className="w-3.5 h-3.5 stroke-[1.8]" />
                <span>{t('reloadPage') || 'Reload'}</span>
              </button>
            </div>
          </div>
        )}

        {/* Electron Webview — mount-once src; navigation via loadURL only */}
        <webview
          ref={webviewRef as unknown as React.RefObject<HTMLElement>}
          partition="persist:metis-browser"
          src={initialSrc}
          className="w-full h-full border-0 bg-transparent"
          style={{ width: '100%', height: '100%', touchAction: 'pan-x pan-y' }}
          data-browser-webview=""
        />
      </div>
        </div>
      </div>
    </div>
  );
}

function browserPanelPropsEqual(
  prev: InspectorBrowserPanelProps,
  next: InspectorBrowserPanelProps,
): boolean {
  if (prev.modelControlled !== next.modelControlled) return false;
  if (prev.onUpdateTab !== next.onUpdateTab) return false;
  const a = prev.tab;
  const b = next.tab;
  return (
    a.id === b.id
    && a.browserUrl === b.browserUrl
    && a.browserTitle === b.browserTitle
    && a.browserFavicon === b.browserFavicon
    && a.browserCanGoBack === b.browserCanGoBack
    && a.browserCanGoForward === b.browserCanGoForward
    && a.browserIsLoading === b.browserIsLoading
  );
}

export const InspectorBrowserPanel = memo(InspectorBrowserPanelInner, browserPanelPropsEqual);
