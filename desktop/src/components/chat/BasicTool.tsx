import React, { useId, useState } from 'react';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import { TextShimmer } from './TextShimmer';

export type BasicToolTrigger = {
  title: string;
  titleClass?: string;
  subtitle?: string;
  subtitleClass?: string;
  args?: string[];
  argsClass?: string;
  action?: React.ReactNode;
};

export interface BasicToolProps {
  icon?: LucideIcon;
  trigger: BasicToolTrigger | React.ReactNode;
  children?: React.ReactNode;
  status?: string;
  hideDetails?: boolean;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  allowOpenWhilePending?: boolean;
  className?: string;
}

function isTriggerTitle(value: unknown): value is BasicToolTrigger {
  return typeof value === 'object' && value !== null && 'title' in value;
}

/** React port of OpenCode `BasicTool` (MIT) — collapsible tool/reasoning trigger. */
export function BasicTool({
  icon: Icon,
  trigger,
  children,
  status,
  hideDetails = false,
  defaultOpen = false,
  open: openProp,
  onOpenChange,
  allowOpenWhilePending = false,
  className,
}: BasicToolProps) {
  const contentId = useId();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const open = openProp ?? uncontrolledOpen;
  const pending = status === 'pending' || status === 'running';
  const hasChildren = children != null && children !== false;
  const showArrow = hasChildren && !hideDetails && (!pending || allowOpenWhilePending);

  const setOpen = (value: boolean) => {
    if (openProp === undefined) setUncontrolledOpen(value);
    onOpenChange?.(value);
  };

  const handleOpenChange = (value: boolean) => {
    if (pending && !allowOpenWhilePending) return;
    setOpen(value);
  };

  const titleTrigger = isTriggerTitle(trigger) ? trigger : null;

  return (
    <div className={`tool-collapsible ${className || ''}`.trim()} data-component="basic-tool" data-open={open ? 'true' : 'false'}>
      <button
        type="button"
        className="tool-collapsible-trigger"
        aria-expanded={open}
        aria-controls={hasChildren && !hideDetails ? contentId : undefined}
        data-hide-details={hideDetails ? 'true' : undefined}
        onClick={() => handleOpenChange(!open)}
      >
        <div
          data-component="tool-trigger"
          data-clickable="true"
          data-hide-details={hideDetails ? 'true' : undefined}
        >
          <div data-slot="basic-tool-tool-trigger-content">
            {Icon && (
              <span data-slot="basic-tool-tool-indicator" aria-hidden="true">
                <Icon size={14} strokeWidth={1.7} />
              </span>
            )}
            <div data-slot="basic-tool-tool-info">
              {titleTrigger ? (
                <div data-slot="basic-tool-tool-info-structured">
                  <div data-slot="basic-tool-tool-info-main">
                    <span data-slot="basic-tool-tool-title" className={titleTrigger.titleClass}>
                      <TextShimmer text={titleTrigger.title} active={pending} />
                    </span>
                    {(!pending || titleTrigger.subtitle || titleTrigger.args?.length) && (
                      <>
                        {titleTrigger.subtitle && (
                          <span
                            data-slot="basic-tool-tool-subtitle"
                            className={titleTrigger.subtitleClass}
                          >
                            {titleTrigger.subtitle}
                          </span>
                        )}
                        {titleTrigger.args?.map((arg) => (
                          <span
                            key={arg}
                            data-slot="basic-tool-tool-arg"
                            className={titleTrigger.argsClass}
                          >
                            {arg}
                          </span>
                        ))}
                      </>
                    )}
                  </div>
                  {!pending && titleTrigger.action && (
                    <span data-slot="basic-tool-tool-action">{titleTrigger.action}</span>
                  )}
                </div>
              ) : (
                trigger
              )}
            </div>
          </div>
          {showArrow && (
            <ChevronRight
              aria-hidden="true"
              className={`basic-tool-chevron ${open ? 'open' : ''}`}
              strokeWidth={1.7}
              size={14}
            />
          )}
        </div>
      </button>
      {hasChildren && !hideDetails && (
        <div
          id={contentId}
          className={`basic-tool-content ${open ? 'open' : 'collapsed'}`}
          aria-hidden={!open}
          data-slot="collapsible-content"
        >
          <div className="basic-tool-content-inner min-h-0">{children}</div>
        </div>
      )}
    </div>
  );
}
