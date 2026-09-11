import React, { useEffect, useRef, useState } from 'react';
import { createPacedTextController } from '../../lib/paced-text';
import { MarkdownContent } from './MarkdownContent';

interface PacedMarkdownProps {
  text: string;
  streaming?: boolean;
  className?: string;
}

/** React port of OpenCode `PacedMarkdown` (MIT). */
export function PacedMarkdown({ text, streaming = false, className }: PacedMarkdownProps) {
  const [shown, setShown] = useState(text);
  const controllerRef = useRef<ReturnType<typeof createPacedTextController> | null>(null);

  useEffect(() => {
    const controller = createPacedTextController(setShown);
    controllerRef.current = controller;
    controller.sync(text, streaming);
    return () => {
      controller.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
    // Mount once; sync effect below drives updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    controllerRef.current?.sync(text, streaming);
  }, [text, streaming]);

  if (!shown) return null;
  return <MarkdownContent markdown={shown} className={className} />;
}
