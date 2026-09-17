import React, {
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
import { useI18n } from '../../i18n';

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
  onUpdateTab: (
    tabId: string,
    patch: Partial<Pick<InspectorTab, 'browserUrl' | 'browserTitle' | 'browserFavicon' | 'browserCanGoBack' | 'browserCanGoForward' | 'browserIsLoading'>>,
  ) => void;
}

export const InspectorBrowserPanel: React.FC<InspectorBrowserPanelProps> = ({
  tab,
  onUpdateTab,
}) => {
  const { t } = useI18n();
  const webviewRef = useRef<WebviewElement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const currentUrl = tab.browserUrl || '';
  const [addressInput, setAddressInput] = useState<string>(formatDisplayUrl(currentUrl));
  const [isInputFocused, setIsInputFocused] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const canGoBack = Boolean(tab.browserCanGoBack);
  const canGoForward = Boolean(tab.browserCanGoForward);
  const isLoading = Boolean(tab.browserIsLoading);
  const isBlankUrl = !currentUrl || currentUrl === 'about:blank';

  // Sync input value when currentUrl changes and user is not actively typing
  useEffect(() => {
    if (!isInputFocused) {
      setAddressInput(formatDisplayUrl(currentUrl));
    }
  }, [currentUrl, isInputFocused]);

  const navigateTo = useCallback((rawTarget: string) => {
    const url = normalizeBrowserInput(rawTarget);
    if (!url || url === 'about:blank') {
      onUpdateTab(tab.id, {
        browserUrl: '',
        browserTitle: t('browser') || 'Browser',
        browserCanGoBack: false,
        browserCanGoForward: false,
        browserIsLoading: false,
      });
      setLoadError(null);
      if (webviewRef.current) {
        webviewRef.current.src = 'about:blank';
      }
      return;
    }

    setLoadError(null);
    onUpdateTab(tab.id, {
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
  }, [onUpdateTab, tab.id, t]);

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
      onUpdateTab(tab.id, { browserIsLoading: false });
    } else {
      setLoadError(null);
      webviewRef.current.reload();
    }
  }, [isLoading, onUpdateTab, tab.id]);

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

  // Attach webview event listeners
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
        void desktopBrowser?.bindTab?.({
          tabId: tab.id,
          webContentsId,
          url: (() => {
            try {
              return webview.getURL() || currentUrl;
            } catch {
              return currentUrl;
            }
          })(),
          title: (() => {
            try {
              return webview.getTitle() || tab.browserTitle || 'Browser';
            } catch {
              return tab.browserTitle || 'Browser';
            }
          })(),
        });
      } catch {
        // webview may not be ready yet
      }
    };

    const syncHostMeta = (url?: string, title?: string) => {
      void desktopBrowser?.updateTabMeta?.({
        tabId: tab.id,
        url,
        title,
      });
    };

    const onStartLoading = () => {
      onUpdateTab(tab.id, {
        browserIsLoading: true,
      });
    };

    const onStopLoading = () => {
      try {
        const canBack = webview.canGoBack();
        const canFwd = webview.canGoForward();
        const url = webview.getURL();
        const title = webview.getTitle();
        onUpdateTab(tab.id, {
          browserIsLoading: false,
          browserCanGoBack: canBack,
          browserCanGoForward: canFwd,
          ...(url && url !== 'about:blank' ? { browserUrl: url } : {}),
          ...(title ? { browserTitle: title } : {}),
        });
        syncHostMeta(url, title);
        bindToHost();
      } catch {
        onUpdateTab(tab.id, { browserIsLoading: false });
      }
    };

    const onTitleUpdated = (event: Event) => {
      const customEvent = event as Event & { title?: string };
      if (customEvent.title) {
        onUpdateTab(tab.id, { browserTitle: customEvent.title });
        syncHostMeta(undefined, customEvent.title);
      }
    };

    const onFaviconUpdated = (event: Event) => {
      const customEvent = event as Event & { favicons?: string[] };
      if (customEvent.favicons && customEvent.favicons.length > 0) {
        onUpdateTab(tab.id, { browserFavicon: customEvent.favicons[0] });
      }
    };

    const onDidNavigate = (event: Event) => {
      const customEvent = event as Event & { url?: string };
      if (customEvent.url && customEvent.url !== 'about:blank') {
        try {
          onUpdateTab(tab.id, {
            browserUrl: customEvent.url,
            browserCanGoBack: webview.canGoBack(),
            browserCanGoForward: webview.canGoForward(),
          });
        } catch {
          onUpdateTab(tab.id, { browserUrl: customEvent.url });
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
        onUpdateTab(tab.id, { browserIsLoading: false });
      }
    };

    const onDomReady = () => {
      bindToHost();
    };

    webview.addEventListener('did-start-loading', onStartLoading);
    webview.addEventListener('did-stop-loading', onStopLoading);
    webview.addEventListener('page-title-updated', onTitleUpdated);
    webview.addEventListener('page-favicon-updated', onFaviconUpdated);
    webview.addEventListener('did-navigate', onDidNavigate);
    webview.addEventListener('did-navigate-in-page', onDidNavigate);
    webview.addEventListener('did-fail-load', onFailLoad);
    webview.addEventListener('dom-ready', onDomReady);
    bindToHost();

    return () => {
      webview.removeEventListener('did-start-loading', onStartLoading);
      webview.removeEventListener('did-stop-loading', onStopLoading);
      webview.removeEventListener('page-title-updated', onTitleUpdated);
      webview.removeEventListener('page-favicon-updated', onFaviconUpdated);
      webview.removeEventListener('did-navigate', onDidNavigate);
      webview.removeEventListener('did-navigate-in-page', onDidNavigate);
      webview.removeEventListener('did-fail-load', onFailLoad);
      webview.removeEventListener('dom-ready', onDomReady);
    };
  }, [currentUrl, onUpdateTab, tab.browserTitle, tab.id]);

  return (
    <div className="flex flex-col h-full w-full min-h-0 min-w-0 bg-page select-text" data-browser-panel="">
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

      {/* Main Viewport */}
      <div className="relative flex-1 min-h-0 min-w-0 w-full bg-page overflow-hidden">
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

        {/* Electron Webview — clean and always active */}
        <webview
          ref={webviewRef as unknown as React.RefObject<HTMLElement>}
          partition="persist:metis-browser"
          src={currentUrl || 'about:blank'}
          className="w-full h-full border-0 bg-transparent"
          style={{ width: '100%', height: '100%' }}
        />
      </div>
    </div>
  );
};
