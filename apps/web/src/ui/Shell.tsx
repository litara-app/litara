import { HoverCard, HoverCardContent, HoverCardTrigger } from "@ui-sdk/react/hover-card";
import { Avatar, AvatarFallback } from "@ui-sdk/react/avatar";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@ui-sdk/react/collapsible";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@ui-sdk/react/menu";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { Link, Outlet, useLocation, useNavigate, useSearchParams } from "react-router";
import { get } from "../api/client";
import type { Library, Page, Shelf } from "../api/types";
import { useAuth } from "../auth/session";
import { useTheme } from "./ThemeProvider";
import { usePlayer } from "../audio/PlayerProvider";
import { usePendingState } from "../pending/PendingProvider";
import { ErrorBoundary } from "./ErrorBoundary";
import { Spotlight } from "./Spotlight";
import { Badge } from "./feedback";
import { IconButton } from "./controls";
import { icons, libraryIcon, LogoMark } from "./icons";
import { Text } from "./text";
import { Tip } from "./overlays";

type Leaf = { to: string; label: string; active: boolean; count?: number | string; icon?: ReactNode };
type Group = { key: string; label: string; icon: ReactNode; to: string; active: boolean; badge?: string; items: Leaf[] };
type Entry = ({ kind: "leaf"; icon: ReactNode } & Leaf) | ({ kind: "group" } & Group);

const KEY = "litara.sidebar";
function readCollapsed(): boolean {
  try { return localStorage.getItem(KEY) === "collapsed"; } catch { return false; }
}
function writeCollapsed(v: boolean) {
  try { localStorage.setItem(KEY, v ? "collapsed" : "expanded"); } catch { /* storage unavailable: the choice just is not remembered */ }
}

function useNavModel(): { main: Entry[]; foot: Entry[] } {
  const loc = useLocation();
  const [params] = useSearchParams();
  const { user } = useAuth();
  const pend = usePendingState();
  const libs = useQuery({ queryKey: ["libraries"], queryFn: () => get<Page<Library>>("/libraries?size=200") });
  const shelves = useQuery({ queryKey: ["shelves", "mine"], queryFn: () => get<Page<Shelf>>("/shelves?scope=mine&size=200") });
  const p = loc.pathname;
  const libId = params.get("libraryId");
  const onLibrary = p === "/" || p.startsWith("/titles") || p.startsWith("/editions");
  const attention = pend.items.filter((o) => o.status !== "pending").length;
  const shelfItems = (shelves.data?.items ?? []).filter((s) => !s.deleted && s.data);
  const main: Entry[] = [
    { kind: "leaf", icon: icons.library, to: "/", label: "Library", active: onLibrary && !libId },
    { kind: "group", key: "libraries", label: "Libraries", icon: icons.libraries, to: "/", active: p === "/" && !!libId,
      items: (libs.data?.items ?? []).map((l) => ({ to: `/?libraryId=${l.id}`, label: l.name, icon: libraryIcon(l.icon), active: p === "/" && libId === l.id })) },
    { kind: "group", key: "shelves", label: "Shelves", icon: icons.shelves, to: "/shelves", active: p.startsWith("/shelves"),
      items: [{ to: "/shelves", label: "All shelves", active: p === "/shelves" },
        ...shelfItems.map((s) => ({ to: `/shelves/${s.id}`, label: s.data!.name, count: s.visibleTitleCount, active: p === `/shelves/${s.id}` }))] },
    { kind: "group", key: "sync", label: "Sync", icon: icons.sync, to: "/pending", active: p.startsWith("/pending"), badge: attention ? String(attention) : undefined,
      items: [{ to: "/pending", label: "Pending changes", count: pend.items.length || undefined, active: p.startsWith("/pending") }] },
  ];
  const foot: Entry[] = [
    ...(user?.isAdmin ? [{ kind: "leaf" as const, icon: icons.admin, to: "/admin", label: "Administration", active: p.startsWith("/admin") }] : []),
  ];
  return { main, foot };
}

function ItemLink({ leaf, onNavigate }: { leaf: Leaf; onNavigate?: () => void }) {
  return (
    <Link className="lt-nav-item" to={leaf.to} aria-current={leaf.active ? "page" : undefined} onClick={onNavigate}>
      <span className="lt-nav-label">{leaf.icon && <span className="lt-nav-icon">{leaf.icon}</span>}{leaf.label}</span>
      {leaf.count !== undefined && <span className="lt-nav-count">{leaf.count}</span>}
    </Link>
  );
}

function Expanded({ entries, onNavigate }: { entries: Entry[]; onNavigate: () => void }) {
  return (
    <>
      {entries.map((e) =>
        e.kind === "leaf" ? (
          <Link key={e.to} className="lt-nav-item" to={e.to} aria-current={e.active ? "page" : undefined} onClick={onNavigate}>
            <span className="lt-nav-label"><span className="lt-nav-icon">{e.icon}</span>{e.label}</span>
          </Link>
        ) : (
          <Collapsible key={e.key} className="lt-nav-group" defaultOpen={e.key !== "sync"}>
            <CollapsibleTrigger className="lt-nav-item">
              <span className="lt-nav-label"><span className="lt-nav-icon">{e.icon}</span>{e.label}</span>
              {e.badge && <Badge tone="warning">{e.badge}</Badge>}
            </CollapsibleTrigger>
            <CollapsiblePanel>
              <div className="lt-nav-sub">
                {e.items.length === 0 ? <Text size="xs" tone="dim">None yet</Text> : e.items.map((l) => <ItemLink key={l.to} leaf={l} onNavigate={onNavigate} />)}
              </div>
            </CollapsiblePanel>
          </Collapsible>
        ),
      )}
    </>
  );
}

function Rail({ entries }: { entries: Entry[] }) {
  return (
    <>
      {entries.map((e) =>
        e.kind === "leaf" ? (
          <Tip key={e.to} label={e.label}>
            <Link className="lt-rail-btn" to={e.to} aria-label={e.label} aria-current={e.active ? "page" : undefined}>{e.icon}</Link>
          </Tip>
        ) : (
          <HoverCard key={e.key}>
            <HoverCardTrigger className="lt-rail-btn" href={e.to} aria-label={e.label} aria-current={e.active ? "page" : undefined}>
              {e.icon}{e.badge && <span className="lt-rail-badge">{e.badge}</span>}
            </HoverCardTrigger>
            <HoverCardContent side="right" align="start" className="lt-flyout">
              <div className="lt-flyout-title">{e.label}</div>
              {e.items.length === 0 ? <Text size="xs" tone="dim">None yet</Text> : e.items.map((l) => <ItemLink key={l.to} leaf={l} />)}
            </HoverCardContent>
          </HoverCard>
        ),
      )}
    </>
  );
}

/** Light or dark. A sun and moon in the Clean theme, a reading lamp in the Reading Room. */
function ModeToggle() {
  const { theme, mode, toggleMode } = useTheme();
  const dark = mode === "dark";
  const lamp = theme === "reading-room";
  const label = dark ? "Switch to light mode" : "Switch to dark mode";
  const icon = lamp ? (dark ? icons.lampOn : icons.lampOff) : dark ? icons.moon : icons.sun;
  return (
    <Tip label={label}>
      <IconButton variant="subtle" aria-label={label} data-testid="mode-toggle" onClick={toggleMode}>{icon}</IconButton>
    </Tip>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : name.trim().slice(0, 2);
  return letters.toUpperCase() || "?";
}

/** The signed-in person: an avatar at the foot of the sidebar that opens their account menu. */
function AccountMenu({ name, isAdmin, collapsed, onSettings, onSignOut }: {
  name: string; isAdmin: boolean; collapsed: boolean; onSettings: () => void; onSignOut: () => void;
}) {
  return (
    <Menu onAction={(v) => { if (v === "settings") onSettings(); if (v === "signout") onSignOut(); }}>
      <MenuTrigger className="lt-account" data-testid="account-menu" aria-label={collapsed ? `Account menu for ${name}` : undefined}>
        <Avatar className="lt-avatar"><AvatarFallback>{initials(name)}</AvatarFallback></Avatar>
        {!collapsed && (
          <>
            <span className="lt-account-text">
              <span className="lt-account-name" data-testid="whoami">{name}</span>
              <span className="lt-account-role">{isAdmin ? "Administrator" : "Member"}</span>
            </span>
            <span className="lt-account-caret">{icons.caret}</span>
          </>
        )}
      </MenuTrigger>
      <MenuContent side={collapsed ? "right" : "top"} align="start" className="lt-account-menu">
        <MenuItem value="settings">Settings</MenuItem>
        <MenuItem value="signout">Sign out</MenuItem>
      </MenuContent>
    </Menu>
  );
}

export function Shell() {
  const { user, logout } = useAuth();
  const pend = usePendingState();
  const nav = useNavigate();
  const loc = useLocation();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [open, setOpen] = useState(false);
  const { setSlot } = usePlayer();
  const { main, foot } = useNavModel();
  const attention = pend.items.filter((o) => o.status !== "pending").length;

  const toggle = () => setCollapsed((c) => { writeCollapsed(!c); return !c; });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "[" || e.ctrlKey || e.metaKey || e.altKey) return;
      if (/input|textarea|select/i.test((e.target as HTMLElement).tagName) || (e.target as HTMLElement).isContentEditable) return;
      toggle();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => setOpen(false), [loc.pathname]);

  const account = (c: boolean) => (
    <AccountMenu name={user?.displayName || user?.username || ""} isAdmin={!!user?.isAdmin} collapsed={c}
      onSettings={() => nav("/settings")} onSignOut={async () => { await logout(); nav("/login"); }} />
  );

  return (
    <div className="lt-app" data-collapsed={collapsed || undefined} data-open={open || undefined}>
      <a className="lt-skip" href="#main">Skip to content</a>
      <header className="lt-topbar">
        <IconButton data-mobile variant="subtle" aria-label="Toggle navigation" onClick={() => setOpen((o) => !o)}>{icons.menu}</IconButton>
        <Link className="lt-brand" to="/"><LogoMark />Litara</Link>
        <div className="lt-topsearch"><Spotlight /></div>
        <div className="lt-topright">
          {pend.items.length > 0 && (
            <Link className="lt-link" to="/pending" data-testid="pending-badge">
              <Badge tone={attention ? "warning" : "neutral"}>
                {attention ? `${attention} need attention` : pend.offline ? `${pend.items.length} waiting (offline)` : `${pend.items.length} sending`}
              </Badge>
            </Link>
          )}
          <ModeToggle />
        </div>
      </header>
      <nav className="lt-side" aria-label="Main">
        {collapsed ? (
          <div className="lt-rail">
            <Tip label="Expand sidebar ( [ )"><IconButton variant="subtle" aria-label="Expand sidebar" onClick={toggle}>{icons.expand}</IconButton></Tip>
            <Rail entries={main} />
            <span className="lt-grow" />
            <Rail entries={foot} />
            {account(true)}
          </div>
        ) : (
          <>
            <div className="lt-side-scroll">
              <div className="lt-side-hd"><span>Navigate</span><IconButton variant="subtle" aria-label="Collapse sidebar" onClick={toggle}>{icons.collapse}</IconButton></div>
              <Expanded entries={main} onNavigate={() => setOpen(false)} />
            </div>
            <div className="lt-side-foot"><Expanded entries={foot} onNavigate={() => setOpen(false)} />{account(false)}</div>
          </>
        )}
      </nav>
      <main id="main" className="lt-main"><ErrorBoundary resetKey={loc.pathname}><Outlet /></ErrorBoundary></main>
      <div className="lt-player-slot" ref={setSlot} />
    </div>
  );
}
