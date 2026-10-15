import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Copy, Check, Terminal } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  copied: boolean;
}

function resolveSafeCopy(key: string, defaultZh: string, defaultEn: string): string {
  try {
    const isZh = (typeof navigator !== 'undefined' && /^zh/i.test(navigator.language))
      || (typeof document !== 'undefined' && document.documentElement.lang?.startsWith('zh'));
    const catalogs = (typeof window !== 'undefined' ? (window as any).metisDesktopI18nCatalogs : null);
    if (catalogs) {
      const locale = isZh ? 'zh-CN' : 'en';
      if (catalogs[locale]?.[key]) {
        return catalogs[locale][key];
      }
    }
    return isZh ? defaultZh : defaultEn;
  } catch {
    return defaultZh;
  }
}

export class GlobalErrorBoundary extends Component<Props, State> {
  private copyTimeout: any = null;

  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      copied: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });
    console.error('[metis:global-error-boundary] React render crash:', error, errorInfo);
  }

  componentWillUnmount(): void {
    if (this.copyTimeout) {
      clearTimeout(this.copyTimeout);
    }
  }

  private handleReload = (): void => {
    try {
      const desktop = (window as any).metisDesktop;
      if (desktop?.reload) {
        desktop.reload();
        return;
      }
    } catch {}
    window.location.reload();
  };

  private handleReset = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      copied: false,
    });
  };

  private handleCopy = (): void => {
    const errorDetails = [
      `Error: ${this.state.error?.name || 'Error'}: ${this.state.error?.message || ''}`,
      '',
      'Stack:',
      this.state.error?.stack || '(no stack trace)',
      '',
      'Component Stack:',
      this.state.errorInfo?.componentStack || '(no component stack)',
      '',
      `User Agent: ${typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown'}`,
      `Time: ${new Date().toISOString()}`,
    ].join('\n');

    try {
      if ((window as any).metisDesktop?.clipboard?.writeText) {
        (window as any).metisDesktop.clipboard.writeText(errorDetails);
      } else if (navigator?.clipboard?.writeText) {
        navigator.clipboard.writeText(errorDetails);
      }
      this.setState({ copied: true });
      if (this.copyTimeout) clearTimeout(this.copyTimeout);
      this.copyTimeout = setTimeout(() => this.setState({ copied: false }), 2000);
    } catch (err) {
      console.warn('[metis:error-boundary] Failed to copy error details:', err);
    }
  };

  private handleOpenDevTools = (): void => {
    try {
      (window as any).metisDesktop?.openDevTools?.();
    } catch {}
  };

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    if (this.props.fallback) {
      return this.props.fallback;
    }

    const title = resolveSafeCopy('errorBoundaryTitle', '界面渲染异常', 'Application Error');
    const subtitle = resolveSafeCopy(
      'errorBoundarySubtitle',
      'Metis 遇到未预期的渲染异常。您的对话和项目文件均已安全保存在本地。',
      'Metis encountered an unexpected error. Your conversation and project files are safe.'
    );
    const reloadLabel = resolveSafeCopy('errorBoundaryReload', '重新加载界面', 'Reload Application');
    const recoverLabel = resolveSafeCopy('errorBoundaryRecover', '尝试就地恢复', 'Try Recovering');
    const copyLabel = resolveSafeCopy('errorBoundaryCopy', '复制错误详情', 'Copy Error Details');
    const copiedLabel = resolveSafeCopy('errorBoundaryCopied', '已复制', 'Copied');
    const detailsLabel = resolveSafeCopy('errorBoundaryDetails', '错误详情', 'Error details');

    return (
      <div
        className="flex h-full w-full min-h-screen flex-col items-center justify-center p-6 bg-page text-ink select-text overflow-y-auto"
        data-metis-error-boundary="global"
      >
        <div className="flex w-full max-w-[560px] flex-col gap-5 rounded-2xl border border-line bg-surface p-7 shadow-2xl transition-all">
          <div className="flex items-start gap-3.5">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500 dark:bg-amber-400/15 dark:text-amber-400">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div className="flex flex-col gap-1 min-w-0">
              <h2 className="text-[17px] font-semibold text-ink leading-tight">
                {title}
              </h2>
              <p className="text-[13px] text-ink-2 leading-relaxed">
                {subtitle}
              </p>
            </div>
          </div>

          {this.state.error?.message && (
            <div className="max-h-[120px] overflow-x-auto rounded-lg border border-line-weak bg-field p-3 font-mono text-[12px] text-ink-2 break-all">
              <span className="font-semibold text-ink">{this.state.error.name}: </span>
              {this.state.error.message}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            <button
              type="button"
              onClick={this.handleReload}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-accent px-4 text-[13px] font-medium text-accent-fg shadow-sm hover:opacity-90 active:scale-[0.98] transition cursor-pointer select-none"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span>{reloadLabel}</span>
            </button>
            <button
              type="button"
              onClick={this.handleReset}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-line bg-surface px-3.5 text-[13px] font-medium text-ink hover:bg-hover active:scale-[0.98] transition cursor-pointer select-none"
            >
              <span>{recoverLabel}</span>
            </button>
            <button
              type="button"
              onClick={this.handleCopy}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-line bg-surface px-3.5 text-[13px] font-medium text-ink hover:bg-hover active:scale-[0.98] transition cursor-pointer select-none"
            >
              {this.state.copied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-500" />
                  <span>{copiedLabel}</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5 text-ink-2" />
                  <span>{copyLabel}</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={this.handleOpenDevTools}
              title="Toggle Developer Tools"
              aria-label="Toggle Developer Tools"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-surface text-ink-2 hover:text-ink hover:bg-hover transition cursor-pointer select-none ml-auto"
            >
              <Terminal className="h-4 w-4" />
            </button>
          </div>

          <details className="mt-1 text-[12px] text-ink-3">
            <summary className="cursor-pointer select-none font-medium hover:text-ink transition py-1">
              {detailsLabel}
            </summary>
            <pre className="mt-2 max-h-[200px] overflow-x-auto rounded-lg bg-field p-3 font-mono text-[11px] leading-relaxed text-ink-2 whitespace-pre-wrap select-text border border-line-weak">
              {this.state.error?.stack || this.state.error?.message || ''}
              {this.state.errorInfo?.componentStack ? `\n\nComponent Stack:${this.state.errorInfo.componentStack}` : ''}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}
