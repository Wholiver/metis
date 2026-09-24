import React, { Component, Suspense, type ReactNode } from 'react';
import { MarkdownContent, handleMarkdownLinkClick } from './MarkdownContent';

interface PacedMarkdownProps {
  text: string;
  streaming?: boolean;
  className?: string;
}

/**
 * Live answers use Streamdown for incremental markdown parsing.
 * Per-word blurIn / stagger animations are disabled — each animated word
 * creates a compositor layer with filter:blur and heats the GPU during stream.
 */
const LiveStreamdown = React.lazy(async () => {
  const [{ Streamdown }, { cjk }] = await Promise.all([
    import('streamdown'),
    import('@streamdown/cjk'),
  ]);

  function Live({ text, className }: { text: string; className?: string }) {
    return (
      <div
        onClick={handleMarkdownLinkClick}
        className={`markdown-content w-full min-w-0 max-w-full break-words [overflow-wrap:anywhere] ${className ?? ''}`}
      >
        <Streamdown
          mode="streaming"
          animated={false}
          plugins={{ cjk }}
          controls={false}
          className="space-y-0 w-full min-w-0 max-w-full"
        >
          {text}
        </Streamdown>
      </div>
    );
  }

  return { default: Live };
});

class StreamdownBoundary extends Component<
  { text: string; className?: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error): void {
    console.error('[PacedMarkdown] Streamdown failed, falling back to static markdown', error);
  }

  componentDidUpdate(prevProps: { text: string }): void {
    if (this.state.failed && prevProps.text !== this.props.text) {
      this.setState({ failed: false });
    }
  }

  render(): ReactNode {
    if (this.state.failed) {
      return <MarkdownContent markdown={this.props.text} streaming className={this.props.className} />;
    }
    return this.props.children;
  }
}

export const PacedMarkdown = React.memo(function PacedMarkdown({
  text,
  streaming = false,
  className,
}: PacedMarkdownProps) {
  if (!text) return null;

  if (!streaming) {
    return <MarkdownContent markdown={text} streaming={streaming} className={className} />;
  }

  return (
    <StreamdownBoundary text={text} className={className}>
      <Suspense fallback={<MarkdownContent markdown={text} streaming className={className} />}>
        <LiveStreamdown text={text} className={className} />
      </Suspense>
    </StreamdownBoundary>
  );
});

PacedMarkdown.displayName = 'PacedMarkdown';
