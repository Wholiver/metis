import { useCallback, useEffect, useRef } from 'react';

export interface UseAutoScrollOptions {
  working: boolean;
  bottomThreshold?: number;
  overflowAnchor?: 'none' | 'auto' | 'dynamic';
  onUserInteracted?: () => void;
}

/**
 * React port of OpenCode `createAutoScroll` (MIT).
 * Keeps the chat viewport pinned while content streams, pauses on intentional
 * upward wheel / leave-bottom, and ignores nested `[data-scrollable]` regions.
 */
export function useAutoScroll(options: UseAutoScrollOptions) {
  const scrollRef = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLElement | null>(null);
  const userScrolledRef = useRef(false);
  const settlingRef = useRef(false);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const autoTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const autoRef = useRef<{ top: number; time: number } | undefined>(undefined);
  const workingRef = useRef(options.working);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  workingRef.current = options.working;

  const threshold = () => optionsRef.current.bottomThreshold ?? 10;
  const active = () => workingRef.current || settlingRef.current;

  const distanceFromBottom = (el: HTMLElement) => el.scrollHeight - el.clientHeight - el.scrollTop;
  const canScroll = (el: HTMLElement) => el.scrollHeight - el.clientHeight > 1;

  const markAuto = (el: HTMLElement) => {
    autoRef.current = {
      top: Math.max(0, el.scrollHeight - el.clientHeight),
      time: Date.now(),
    };
    if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
    autoTimerRef.current = setTimeout(() => {
      autoRef.current = undefined;
      autoTimerRef.current = undefined;
    }, 1500);
  };

  const isAuto = (el: HTMLElement) => {
    const a = autoRef.current;
    if (!a) return false;
    if (Date.now() - a.time > 1500) {
      autoRef.current = undefined;
      return false;
    }
    return Math.abs(el.scrollTop - a.top) < 2;
  };

  const updateOverflowAnchor = useCallback((el: HTMLElement) => {
    const mode = optionsRef.current.overflowAnchor ?? 'dynamic';
    if (mode === 'none') {
      el.style.overflowAnchor = 'none';
      return;
    }
    if (mode === 'auto') {
      el.style.overflowAnchor = 'auto';
      return;
    }
    el.style.overflowAnchor = userScrolledRef.current ? 'auto' : 'none';
  }, []);

  const scrollToBottomNow = useCallback((behavior: ScrollBehavior) => {
    const el = scrollRef.current;
    if (!el) return;
    markAuto(el);
    if (behavior === 'smooth') {
      el.scrollTo({ top: el.scrollHeight, behavior });
      return;
    }
    el.scrollTop = el.scrollHeight;
  }, []);

  const scrollToBottom = useCallback((force: boolean) => {
    if (!force && !active()) return;
    if (force && userScrolledRef.current) userScrolledRef.current = false;
    const el = scrollRef.current;
    if (!el) return;
    if (!force && userScrolledRef.current) return;
    if (distanceFromBottom(el) < 2) {
      markAuto(el);
      return;
    }
    scrollToBottomNow('auto');
  }, [scrollToBottomNow]);

  const stop = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (!canScroll(el)) {
      userScrolledRef.current = false;
      return;
    }
    if (userScrolledRef.current) return;
    userScrolledRef.current = true;
    optionsRef.current.onUserInteracted?.();
    updateOverflowAnchor(el);
  }, [updateOverflowAnchor]);

  const handleWheel = useCallback((e: WheelEvent) => {
    if (e.deltaY >= 0) return;
    const el = scrollRef.current;
    const target = e.target instanceof Element ? e.target : undefined;
    const nested = target?.closest('[data-scrollable]');
    if (el && nested && nested !== el) return;
    stop();
  }, [stop]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (!canScroll(el)) {
      userScrolledRef.current = false;
      return;
    }
    if (distanceFromBottom(el) < threshold()) {
      if (userScrolledRef.current) {
        userScrolledRef.current = false;
        updateOverflowAnchor(el);
      }
      return;
    }
    if (!userScrolledRef.current && isAuto(el)) {
      scrollToBottom(false);
      return;
    }
    stop();
  }, [scrollToBottom, stop, updateOverflowAnchor]);

  const handleInteraction = useCallback(() => {
    if (!active()) return;
    const selection = window.getSelection();
    if (selection && selection.toString().length > 0) stop();
  }, [stop]);

  const setScrollElement = useCallback((el: HTMLElement | null) => {
    const prev = scrollRef.current;
    if (prev) prev.removeEventListener('wheel', handleWheel);
    scrollRef.current = el;
    if (el) {
      updateOverflowAnchor(el);
      el.addEventListener('wheel', handleWheel, { passive: true });
    }
  }, [handleWheel, updateOverflowAnchor]);

  const setContentElement = useCallback((el: HTMLElement | null) => {
    contentRef.current = el;
  }, []);

  useEffect(() => {
    settlingRef.current = false;
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = undefined;
    if (options.working) {
      if (!userScrolledRef.current) scrollToBottom(true);
      return;
    }
    settlingRef.current = true;
    settleTimerRef.current = setTimeout(() => {
      settlingRef.current = false;
    }, 300);
  }, [options.working, scrollToBottom]);

  useEffect(() => {
    const scrollEl = scrollRef.current;
    const target = contentRef.current;
    if (!target && !scrollEl) return;
    const onResize = () => {
      const el = scrollRef.current;
      if (el && !canScroll(el)) {
        userScrolledRef.current = false;
        return;
      }
      if (!active()) return;
      if (userScrolledRef.current) return;
      scrollToBottom(false);
    };
    const observer = new ResizeObserver(onResize);
    if (target) observer.observe(target);
    if (scrollEl) observer.observe(scrollEl);
    const mutationTarget = target ?? scrollEl;
    const mutationObserver = mutationTarget
      ? new MutationObserver(onResize)
      : null;
    if (mutationTarget && mutationObserver) {
      mutationObserver.observe(mutationTarget, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['class', 'aria-expanded', 'data-open', 'style'],
      });
    }
    return () => {
      observer.disconnect();
      mutationObserver?.disconnect();
    };
  }, [scrollToBottom, options.working]);

  useEffect(() => () => {
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
    const el = scrollRef.current;
    if (el) el.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  return {
    setScrollElement,
    setContentElement,
    handleScroll,
    handleInteraction,
    pause: stop,
    resume: () => {
      userScrolledRef.current = false;
      const el = scrollRef.current;
      if (el) updateOverflowAnchor(el);
      scrollToBottom(true);
    },
    scrollToBottom: () => scrollToBottom(false),
    forceScrollToBottom: () => scrollToBottom(true),
    userScrolled: () => userScrolledRef.current,
  };
}
