import React, { Component, Suspense, useEffect, useState, type ReactNode } from 'react';
import { MarkdownContent, handleMarkdownLinkClick } from './MarkdownContent';

interface PacedMarkdownProps {
  text: string;
  streaming?: boolean;
  className?: string;
}

/** Vercel Streamdown defaults for fast token batches — not a custom drip timer. */
const STREAMDOWN_ANIMATED = {
  animation: 'blurIn' as const,
  duration: 220,
  easing: 'ease-out',
  sep: 'word' as const,
  stagger: 24,
  maxBacklogMs: 280,
};

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
          isAnimating
          animated={STREAMDOWN_ANIMATED}
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

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => (
    typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ));

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  return reduced;
}

export const PacedMarkdown = React.memo(function PacedMarkdown({
  text,
  streaming = false,
  className,
}: PacedMarkdownProps) {
  const reduceMotion = usePrefersReducedMotion();
  if (!text) return null;

  const live = streaming && !reduceMotion;
  if (!live) {
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
