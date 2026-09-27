"use client";
/** Port of Creezio original packages/shell-ui/ui/global-search.tsx (6bd6507).
 * The current host searches authorized destinations only. */

import { Search } from "lucide-react";
import { cn } from "./utils";

export function GlobalSearchTrigger({
  className,
  iconOnly = false,
  variant = "sidebar",
  onOpen,
}: {
  className?: string;
  iconOnly?: boolean;
  /** sidebar = fond sombre (nav) ; toolbar = bandeau blanc sous les onglets. */
  variant?: "sidebar" | "toolbar";
  onOpen: () => void;
}) {
  const isToolbar = variant === "toolbar";

  const baseClass = isToolbar
    ? "border-slate-200/90 bg-slate-50/80 text-slate-500 hover:border-slate-300 hover:bg-white hover:text-slate-700"
    : "border-slate-700/80 bg-slate-800/80 text-slate-400 hover:border-slate-600 hover:bg-slate-800 hover:text-slate-300";

  if (iconOnly) {
    return (
      <button
        type="button"
        onClick={onOpen}
        title="Rechercher une vue (⌘K)"
        aria-label="Rechercher une vue"
        className={cn(
          "flex h-9 w-full items-center justify-center rounded-lg border transition-colors",
          baseClass,
          className,
        )}
      >
        <Search className="h-4 w-4 shrink-0" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg border px-3 py-1.5 text-left text-sm transition-colors",
        baseClass,
        className,
      )}
    >
      <Search className="h-4 w-4 shrink-0" />
      <span className="flex-1 truncate">Rechercher une vue…</span>
      <kbd
        className={cn(
          "hidden shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium sm:inline",
          isToolbar
            ? "border-slate-200 bg-white text-slate-400"
            : "border-slate-600 bg-slate-900/60 text-slate-500",
        )}
      >
        ⌘K
      </kbd>
    </button>
  );
}
