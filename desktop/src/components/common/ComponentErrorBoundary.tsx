import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode);
  compact?: boolean;
  title?: string;
  description?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ComponentErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });
    console.error('[metis:component-error-boundary]', error, errorInfo);
  }

  private handleReset = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    this.props.onReset?.();
  };

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    if (this.props.fallback) {
      if (typeof this.props.fallback === 'function') {
        return this.props.fallback(this.state.error || new Error('Unknown error'), this.handleReset);
      }
      return this.props.fallback;
    }

    const { compact, title, description } = this.props;

    if (compact) {
      return (
        <div
          className="my-2 flex w-full items-center justify-between gap-3 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[12.5px] text-ink"
          data-metis-error-boundary="compact"
        >
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 text-amber-500" />
            <span className="truncate text-ink-2">
              {title || this.state.error?.message || ''}
            </span>
          </div>
          <button
            type="button"
            onClick={this.handleReset}
            className="flex flex-shrink-0 items-center gap-1 rounded px-2 py-1 text-[11.5px] font-medium text-ink bg-surface border border-line hover:bg-hover transition cursor-pointer select-none"
          >
            <RefreshCw className="h-3 w-3" />
            <span>重试</span>
          </button>
        </div>
      );
    }

    return (
      <div
        className="flex h-full w-full min-h-[160px] flex-col items-center justify-center p-6 text-center"
        data-metis-error-boundary="panel"
      >
        <div className="flex max-w-[400px] flex-col items-center gap-3 rounded-xl border border-line bg-surface p-6 shadow-sm">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500">
            <AlertTriangle className="h-4 w-4" />
          </div>
          <div className="flex flex-col gap-1">
            <h3 className="text-[14px] font-semibold text-ink">
              {title || '面板渲染异常'}
            </h3>
            <p className="text-[12.5px] text-ink-2 leading-relaxed">
              {description || this.state.error?.message || '此区域遇到意外错误，已保护其他模块正常运行。'}
            </p>
          </div>
          <button
            type="button"
            onClick={this.handleReset}
            className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-1.5 text-[12.5px] font-medium text-accent-fg hover:opacity-90 transition cursor-pointer select-none"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>重试恢复</span>
          </button>
        </div>
      </div>
    );
  }
}
