"use client";
/** Port of Creezio original packages/shell-ui/ui/workspace/workspace-tab-bar.tsx (6bd6507).
 * Browser host supplies explicit panel commands; Electron chrome is unavailable here. */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  LayoutDashboard,
  Lock,
  LockOpen,
  Pin,
  Plus,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "./utils";
import { PageChrome, type PageChromeProps } from "./page-chrome";

/* Géométrie type Chrome : onglets posés en bas du bandeau, largeur adaptative. */
const TAB_MAX = 240;
const TAB_MIN = 64;
const TAB_ABS_MIN = 46;
const TAB_GAP = 0;
const NEW_BTN = 28;
const NEW_BTN_GAP = 6;
const DRAG_THRESHOLD = 5;
/** Marge gauche du strip : laisse la place à la courbe inversée du 1er onglet. */
const PAD_L = 8;

/**
 * Icônes onglets = plateforme neutre uniquement.
 * Routes métier (panier, fournisseurs, relevés…) → injecter via
 * `configureWorkspaceTabIcons` depuis la marque (pas dans le kit).
 */
export type ShellWorkspaceTab = {
  id: string; title: string; locked: boolean; pinned: boolean;
  location: {url: string; viewId: string};
  subtitle?: string; fullscreen?: boolean;
};
export interface WorkspaceTabBarProps {
  tabs: readonly ShellWorkspaceTab[];
  activeTabId: string | null;
  canGoBack: boolean; canGoForward: boolean;
  onActivate(id: string): void;
  onClose(id: string): void;
  onLock(id: string, locked: boolean): void;
  onMove(id: string, index: number): void;
  onBack(): void; onForward(): void;
  onOpenDestinationSearch(newTab: boolean): void;
  tabBadges?: Readonly<Record<string, number>>;
  iconForView?: (viewId: string) => LucideIcon | null | undefined;
  pageChrome?: Omit<PageChromeProps, 'onOpenDestinationSearch'>;
}

type DragState = {
  id: string;
  pointerId: number;
  startX: number;
  originLeft: number;
  moved: boolean;
  dx: number;
};

type TabMenuState = {
  tabId: string;
  x: number;
  y: number;
} | null;

export function WorkspaceTabBar({tabs,activeTabId,canGoBack,canGoForward,
  onActivate:activateTab,onClose:closeTab,onLock:setTabLocked,onMove:moveTab,
  onBack:goBack,onForward:goForward,onOpenDestinationSearch,tabBadges={},
  iconForView,pageChrome}: WorkspaceTabBarProps) {
  const pinnedTabId = tabs.find(tab => tab.pinned)?.id ?? null;
  const activeTab = tabs.find(tab => tab.id === activeTabId);

  const stripRef = useRef<HTMLDivElement>(null);
  const [stripW, setStripW] = useState(0);
  const [animate, setAnimate] = useState(false);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [menu, setMenu] = useState<TabMenuState>(null);
  const dragRef = useRef<DragState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  // Ids déjà vus → les nouveaux onglets ont une animation d'entrée
  const seenIdsRef = useRef<Set<string>>(new Set());

  useLayoutEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const measure = () => setStripW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Active les transitions seulement après la première mesure (pas d'anim au chargement)
  useEffect(() => {
    if (!stripW || animate) return;
    const raf = requestAnimationFrame(() =>
      requestAnimationFrame(() => setAnimate(true)),
    );
    return () => cancelAnimationFrame(raf);
  }, [stripW, animate]);

  useEffect(() => {
    if (!menu) return;
    function close() {
      setMenu(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    function onPointer(e: MouseEvent) {
      if (menuRef.current?.contains(e.target as Node)) return;
      close();
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("scroll", close, true);
    const focusTimer = window.setTimeout(() => {
      menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    }, 0);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("scroll", close, true);
      window.clearTimeout(focusTimer);
    };
  }, [menu]);

  const count = tabs.length || 1;
  const avail = Math.max(0, stripW - PAD_L - NEW_BTN - NEW_BTN_GAP);
  const tabW = stripW
    ? Math.max(
        TAB_ABS_MIN,
        Math.min(TAB_MAX, Math.max(TAB_MIN, Math.floor(avail / count))),
      )
    : 200;
  const slotW = tabW + TAB_GAP;
  const compact = tabW < 90;

  const orderIndex = useMemo(() => {
    const m = new Map<string, number>();
    tabs.forEach((t: ShellWorkspaceTab, i: number) => m.set(t.id, i));
    return m;
  }, [tabs]);

  const clampDragLeft = useCallback(
    (left: number) => {
      const max = PAD_L + Math.max(0, (tabsRef.current.length - 1) * slotW);
      return Math.min(Math.max(PAD_L, left), max);
    },
    [slotW],
  );

  const onTabPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>, tabId: string) => {
      if (e.button !== 0) return;
      // Chrome active l'onglet dès le mousedown
      activateTab(tabId);
      const idx = tabsRef.current.findIndex((t: ShellWorkspaceTab) => t.id === tabId);
      if (idx < 0) return;
      const state: DragState = {
        id: tabId,
        pointerId: e.pointerId,
        startX: e.clientX,
        originLeft: PAD_L + idx * slotW,
        moved: false,
        dx: 0,
      };
      dragRef.current = state;
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* pointerId synthétique (tests) — le drag suit quand même les pointermove */
      }
    },
    [activateTab, slotW],
  );

  const onTabPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const st = dragRef.current;
      if (!st || e.pointerId !== st.pointerId) return;
      const dx = e.clientX - st.startX;
      if (!st.moved && Math.abs(dx) < DRAG_THRESHOLD) return;
      const next = { ...st, moved: true, dx };
      dragRef.current = next;
      setDrag(next);

      // Slot cible = centre de l'onglet déplacé
      const left = clampDragLeft(st.originLeft + dx);
      const target = Math.min(
        tabsRef.current.length - 1,
        Math.max(0, Math.round((left - PAD_L) / slotW)),
      );
      const current = tabsRef.current.findIndex((t: ShellWorkspaceTab) => t.id === st.id);
      if (target !== current) moveTab(st.id, target);
    },
    [clampDragLeft, moveTab, slotW],
  );

  const endDrag = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const st = dragRef.current;
    if (!st || e.pointerId !== st.pointerId) return;
    dragRef.current = null;
    setDrag(null);
  }, []);

  const onTabContextMenu = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>, tabId: string) => {
      e.preventDefault();
      e.stopPropagation();
      dragRef.current = null;
      setDrag(null);
      const rect = e.currentTarget.getBoundingClientRect();
      const menuWidth = 190;
      const menuHeight = tabId === pinnedTabId ? 48 : 92;
      const pad = 8;
      const anchorX = e.clientX || rect.left + Math.min(rect.width / 2, 48);
      const anchorY = e.clientY || rect.bottom;
      setMenu({
        tabId,
        x: Math.max(pad, Math.min(anchorX, window.innerWidth - menuWidth - pad)),
        y: Math.max(pad, Math.min(anchorY, window.innerHeight - menuHeight - pad)),
      });
    },
    [pinnedTabId],
  );

  const menuTab = menu ? tabs.find((tab: ShellWorkspaceTab) => tab.id === menu.tabId) : null;

  return (
    <div className="flex min-w-0 flex-col">
      {/* Bandeau navigateur original, sans commande Electron dans cet hôte. */}
      <div
        className="flex h-10 min-w-0 items-stretch"
      >
        {/* Toolbar ← → */}
        <div className="creezio-titlebar-no-drag flex shrink-0 items-center gap-0.5 self-center pr-1">
          <button
            type="button"
            disabled={!canGoBack}
            onClick={goBack}
            aria-label="Page précédente"
            title="Précédent"
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-full text-slate-600 transition-colors",
              canGoBack
                ? "hover:bg-slate-400/25 hover:text-slate-900 active:bg-slate-400/40"
                : "cursor-default opacity-35",
            )}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled={!canGoForward}
            onClick={goForward}
            aria-label="Page suivante"
            title="Suivant"
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-full text-slate-600 transition-colors",
              canGoForward
                ? "hover:bg-slate-400/25 hover:text-slate-900 active:bg-slate-400/40"
                : "cursor-default opacity-35",
            )}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {/* Rangée d'onglets — layout mesuré, positions animées par transform */}
        <div
          ref={stripRef}
          className="relative min-w-0 flex-1 overflow-hidden"
          role="tablist"
          aria-label="Onglets workspace"
        >
          {tabs.map((tab: ShellWorkspaceTab) => {
            const idx = orderIndex.get(tab.id) ?? 0;
            const active = tab.id === activeTabId;
            const pinned = tab.id === pinnedTabId;
            const locked = pinned || tab.locked === true;
            const badge = tabBadges[tab.id] || 0;
            const dragging = drag?.moved && drag.id === tab.id;
            const left = dragging
              ? clampDragLeft(drag!.originLeft + drag!.dx)
              : PAD_L + idx * slotW;
            const isNew = !seenIdsRef.current.has(tab.id);
            if (stripW) seenIdsRef.current.add(tab.id);
            const Icon = iconForView?.(tab.location.viewId) ?? (pinned ? LayoutDashboard : FileText);
            const showClose = !locked && (!compact || active);

            return (
              <div
                key={tab.id}
                role="tab"
                id={`creezio-tab-${tab.id}`}
                aria-controls={`creezio-panel-${tab.id}`}
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                data-state={active ? "active" : "inactive"}
                data-tab-locked={locked ? "true" : "false"}
                onPointerDown={(e) => onTabPointerDown(e, tab.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault(); activateTab(tab.id); return;
                  }
                  const targetIndex = e.key === "ArrowRight" ? (idx + 1) % tabs.length
                    : e.key === "ArrowLeft" ? (idx - 1 + tabs.length) % tabs.length
                      : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : -1;
                  if (targetIndex < 0) return;
                  e.preventDefault();
                  const target = tabs[targetIndex];
                  if (target) {
                    activateTab(target.id);
                    document.getElementById(`creezio-tab-${target.id}`)?.focus();
                  }
                }}
                onPointerMove={onTabPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onContextMenu={(e) => onTabContextMenu(e, tab.id)}
                onAuxClick={(e) => {
                  if (e.button === 1) {
                    e.preventDefault();
                    if (!locked) closeTab(tab.id);
                  }
                }}
                title={
                  `${tab.subtitle ? `${tab.title} — ${tab.subtitle}` : tab.title}${
                    locked ? " — Verrouillé" : ""
                  }`
                }
                className={cn(
                  "creezio-titlebar-no-drag tf-tab group absolute bottom-0 h-[34px] cursor-default select-none [touch-action:none]",
                  animate &&
                    !dragging &&
                    "transition-[transform,width] duration-200 ease-out",
                  dragging && "z-20",
                  active && !dragging && "z-10",
                  active && "is-active",
                )}
                style={{
                  width: tabW,
                  transform: `translateX(${left}px)`,
                }}
              >
                {/* Séparateur gauche (masqué près de l'actif / au hover) */}
                <span
                  aria-hidden
                  className="tf-sep pointer-events-none absolute left-0 top-[9px] h-4 w-px bg-slate-500/40 transition-opacity duration-100"
                />

                {/* Fond de l'onglet actif : blanc + courbes inversées, fusion avec la page */}
                {active ? (
                  <span
                    aria-hidden
                    className="tf-tab-bg pointer-events-none absolute inset-0 rounded-t-lg bg-white shadow-[0_1px_3px_rgba(0,0,0,0.08)]"
                  />
                ) : (
                  <span
                    aria-hidden
                    className={cn(
                      "pointer-events-none absolute inset-x-0 bottom-[2px] top-0 rounded-lg transition-colors duration-100",
                      dragging
                        ? "bg-white/70 shadow-[0_2px_8px_rgba(0,0,0,0.18)]"
                        : "group-hover:bg-[rgba(255,255,255,0.55)]",
                    )}
                  />
                )}

                {/* Contenu */}
                <div
                  className={cn(
                    "relative flex h-full min-w-0 items-center pl-2.5",
                    showClose ? "pr-1" : "pr-2",
                    isNew && animate && "tf-tab-enter",
                  )}
                >
                  {pinned ? (
                    <Pin
                      className={cn(
                        "h-[13px] w-[13px] shrink-0 fill-current",
                        active ? "text-sky-600" : "text-slate-500",
                      )}
                      aria-label="Onglet épinglé"
                    />
                  ) : locked ? (
                    <Lock
                      className={cn(
                        "h-[13px] w-[13px] shrink-0",
                        active ? "text-sky-600" : "text-slate-500",
                      )}
                      aria-label="Onglet verrouillé"
                    />
                  ) : (
                    <Icon
                      className={cn(
                        "h-[15px] w-[15px] shrink-0",
                        active ? "text-slate-700" : "text-slate-500",
                      )}
                    />
                  )}
                  {tabW >= 72 ? (
                    <span
                      className={cn(
                        "tf-tab-title ml-2 min-w-0 flex-1 truncate text-[12px] leading-none tracking-tight",
                        active
                          ? "font-medium text-slate-900"
                          : "text-slate-700",
                      )}
                    >
                      {tab.title}
                    </span>
                  ) : (
                    <span className="min-w-0 flex-1" />
                  )}
                  {badge > 0 ? (
                    <span
                      aria-label={`${badge} nouveauté${badge > 1 ? "s" : ""}`}
                      className={cn(
                        "pointer-events-none absolute -top-0.5 z-30 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white shadow-sm ring-2 ring-[#ebe7df]",
                        showClose ? "right-1" : "right-1.5",
                      )}
                    >
                      {badge > 9 ? "9+" : badge}
                    </span>
                  ) : null}
                  {showClose ? (
                    <button
                      type="button"
                      tabIndex={-1}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        closeTab(tab.id);
                      }}
                      className={cn(
                        "ml-0.5 mr-1 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full transition-colors",
                        active
                          ? "text-slate-500 hover:bg-slate-200 hover:text-slate-800 active:bg-slate-300"
                          : "text-slate-500 opacity-0 hover:bg-slate-400/30 hover:text-slate-800 focus:opacity-100 group-hover:opacity-100",
                      )}
                      aria-label={`Fermer ${tab.title}`}
                      title="Fermer"
                    >
                      <X className="h-3 w-3" strokeWidth={2.25} />
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}

          {/* Bouton nouvel onglet — ouvre la recherche, le résultat choisi
              s'ouvrira dans un nouvel onglet (façon Notion) */}
          <button
            type="button"
            onClick={() => onOpenDestinationSearch(true)}
            aria-label="Nouvel onglet"
            title="Nouvel onglet (recherche)"
            className={cn(
              "creezio-titlebar-no-drag absolute bottom-[6px] flex h-7 w-7 items-center justify-center rounded-full text-slate-600 hover:bg-slate-400/25 hover:text-slate-900 active:bg-slate-400/40",
              animate && "transition-transform duration-200 ease-out",
            )}
            style={{
              transform: `translateX(${Math.min(
                PAD_L + count * slotW + NEW_BTN_GAP,
                Math.max(0, stripW - NEW_BTN),
              )}px)`,
            }}
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

      </div>

      {menu && menuTab ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label={`Actions pour l’onglet ${menuTab.title}`}
          className="creezio-titlebar-no-drag fixed z-[100] min-w-[11.875rem] rounded-md border border-slate-200 bg-white p-1 text-slate-900 shadow-lg"
          style={{ left: menu.x, top: menu.y }}
        >
          {menuTab.id === pinnedTabId ? (
            <button
              type="button"
              role="menuitem"
              disabled
              className="flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-slate-500 opacity-70"
            >
              <Lock className="h-3.5 w-3.5" />
              Verrouillé par défaut
            </button>
          ) : (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setTabLocked(menuTab.id, !menuTab.locked);
                  setMenu(null);
                }}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-slate-100 focus:bg-slate-100"
              >
                {menuTab.locked ? (
                  <LockOpen className="h-3.5 w-3.5" />
                ) : (
                  <Lock className="h-3.5 w-3.5" />
                )}
                {menuTab.locked ? "Déverrouiller" : "Verrouiller"}
              </button>
              {!menuTab.locked ? (
                <>
                  <div className="my-1 h-px bg-slate-100" role="separator" />
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      closeTab(menuTab.id);
                      setMenu(null);
                    }}
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-slate-100 focus:bg-slate-100"
                  >
                    <X className="h-3.5 w-3.5" />
                    Fermer
                  </button>
                </>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {/* Bandeau sticky sous les onglets — recherche + trail (entity) + actions */}
      {activeTab && pageChrome && !activeTab.fullscreen ? (
        <PageChrome {...pageChrome} onOpenDestinationSearch={() => onOpenDestinationSearch(false)} />
      ) : null}
    </div>
  );
}
