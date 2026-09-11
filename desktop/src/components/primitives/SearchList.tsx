/**
 * Source: https://www.beautifului.dev/r/search.json
 * Copyright (c) Beautiful UI contributors. MIT License.
 * Metis: controlled search list — no demo flavor data.
 */
"use client";

import { useState } from "react";
import GlideMenu from "@/components/primitives/GlideMenu";

/* ─────────────────────────────────────────────────────────
 * SEARCH — command search with live filtering.
 * The field, clear action, and results are directly usable.
 * ───────────────────────────────────────────────────────── */

export type SearchItem = string;

export type SearchListLabels = {
  placeholder: string;
  ariaLabel: string;
  emptyTitle: string;
  emptyHint: string;
  clearSearch?: string;
};

const DEFAULT_LABELS: SearchListLabels = {
  placeholder: "",
  ariaLabel: "",
  emptyTitle: "",
  emptyHint: "",
  clearSearch: "",
};

export default function SearchList({
  items = [],
  labels,
}: {
  items?: SearchItem[];
  labels?: Partial<SearchListLabels>;
  variant?: string;
} = {}) {
  const text = { ...DEFAULT_LABELS, ...labels };
  const [query, setQuery] = useState("");
  const results = query
    ? items.filter((i) => i.toLowerCase().includes(query.toLowerCase()))
    : items.slice(0, 5);
  const empty = query.length > 2 && results.length === 0;

  return (
    <div className="flex min-h-[248px] w-full max-w-72 flex-col items-stretch" data-search-list="">
      <div className="w-full self-start overflow-hidden rounded-card bg-surface shadow-raised">
        <div className="flex h-10 items-center gap-2 border-b border-line px-3 transition-colors duration-100 hover:bg-hover">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth="2" strokeLinecap="round" className="shrink-0">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={text.placeholder}
            aria-label={text.ariaLabel}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3"
          />
          {query && (
            <button
              aria-label={text.clearSearch || text.ariaLabel}
              type="button"
              onClick={() => setQuery("")}
              className="flex size-6 items-center justify-center rounded-full text-ink-3
                transition-colors duration-100 hover:bg-line/70 hover:text-ink"
              style={{ animation: "fade-in 150ms ease-out both" }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        <GlideMenu className="max-h-56 overflow-y-auto p-1" highlightClassName="inset-x-0 rounded-control bg-hover">
          {empty ? (
            <div className="px-3 py-6 text-center">
              <div className="text-[13px] font-medium text-ink">{text.emptyTitle}</div>
              <div className="mt-1 text-[12px] text-ink-3">{text.emptyHint}</div>
            </div>
          ) : (
            results.map((item) => (
              <button
                key={item}
                type="button"
                data-menu-row
                className="relative z-10 flex w-full items-center rounded-control px-2.5 py-2 text-left text-[13px] text-ink transition-colors duration-100"
              >
                {item}
              </button>
            ))
          )}
        </GlideMenu>
      </div>
    </div>
  );
}
