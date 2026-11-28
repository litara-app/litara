import { Command, CommandEmpty, CommandGroup, CommandGroupLabel, CommandInput, CommandItem, CommandItemIcon, CommandItemText, CommandList } from "@ui-sdk/react/command";
import { Dialog, DialogBackdrop, DialogContent, DialogTitle, DialogTrigger } from "@ui-sdk/react/dialog";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { get, qs } from "../api/client";
import type { Library, Page, Shelf, Title as TitleT, User } from "../api/types";
import { useAuth } from "../auth/session";
import { icons } from "./icons";
import { Kbd } from "./text";
import { THEMES, useTheme } from "./ThemeProvider";
import { useDebounced } from "./useDebounced";

interface Entry { value: string; group: string; label: string; secondary?: string; hint?: string; icon: ReactNode; keywords?: string[]; run: () => void }

const tokens = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean);
const matches = (e: Pick<Entry, "label" | "secondary" | "keywords">, q: string) => {
  const hay = `${e.label} ${e.secondary ?? ""} ${(e.keywords ?? []).join(" ")}`.toLowerCase();
  return tokens(q).every((t) => hay.includes(t));
};

/**
 * The search for everything: books and audiobooks (searched on the server), libraries, shelves, pages and settings,
 * administration and actions. Opens with Ctrl+K or Cmd+K, or from the top bar.
 */
export function Spotlight() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const nav = useNavigate();
  const { user, logout } = useAuth();
  const { theme, setTheme, mode, toggleMode } = useTheme();
  const query = q.trim();
  const dq = useDebounced(query, 200);

  const libs = useQuery({ queryKey: ["libraries"], queryFn: () => get<Page<Library>>("/libraries?size=200"), enabled: open });
  const mine = useQuery({ queryKey: ["shelves", "mine"], queryFn: () => get<Page<Shelf>>("/shelves?scope=mine&size=200"), enabled: open });
  const shared = useQuery({ queryKey: ["shelves", "shared"], queryFn: () => get<Page<Shelf>>("/shelves?scope=shared&size=200"), enabled: open });
  const users = useQuery({ queryKey: ["admin", "users"], queryFn: () => get<Page<User>>("/admin/users?size=200"), enabled: open && !!user?.isAdmin });
  const titles = useQuery({
    queryKey: ["spotlight", "titles", dq], enabled: open && dq.length >= 2,
    queryFn: () => get<Page<TitleT>>(`/titles${qs({ q: dq, size: 8 })}`), placeholderData: (p) => p,
  });

  const go = (to: string) => () => nav(to);
  const pages: Entry[] = useMemo(() => {
    const p = (value: string, label: string, to: string, icon: ReactNode, keywords: string[] = [], secondary?: string): Entry =>
      ({ value, group: "Pages and settings", label, secondary, icon, keywords, run: go(to) });
    const list: Entry[] = [
      p("page:library", "Library", "/", icons.library, ["books", "titles", "all"]),
      p("page:shelves", "Shelves", "/shelves", icons.shelves, ["collections", "new shelf", "smart"]),
      p("page:pending", "Pending changes", "/pending", icons.sync, ["sync", "offline", "conflicts", "queue"]),
      p("page:appearance", "Appearance", "/settings", icons.settings, ["theme", "dark", "light", "background", "sign-in", "look", "lamp"], "Settings"),
      p("page:credentials", "App credentials", "/settings/credentials", icons.settings, ["opds", "koreader", "password", "device", "reader app"], "Settings"),
      p("page:email", "Email", "/settings/email", icons.settings, ["smtp", "recipients", "send", "kindle", "delivery", "mail"], "Settings"),
      p("page:koreader", "KOReader", "/settings/koreader", icons.settings, ["sync", "progress", "conflicts", "bindings", "device"], "Settings"),
    ];
    if (user?.isAdmin) {
      list.push(
        p("page:admin-users", "Users", "/admin", icons.admin, ["accounts", "people", "grants", "access", "admin"], "Administration"),
        p("page:admin-libraries", "Libraries", "/admin/libraries", icons.admin, ["scan", "import", "folders", "reviews", "admin"], "Administration"),
        p("page:admin-repair", "Recording repair", "/admin/repairs", icons.admin, ["merge", "split", "audiobook", "recordings", "admin"], "Administration"),
        p("page:admin-integrations", "Integrations", "/admin/integrations", icons.admin, ["opds", "email", "smtp", "koreader", "services", "admin"], "Administration"),
      );
    }
    return list;
  }, [user?.isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  const actions: Entry[] = [
    { value: "action:mode", group: "Actions", label: mode === "dark" ? "Switch to light mode" : "Switch to dark mode", icon: icons.bolt, keywords: ["theme", "dark", "light", "lamp"], run: toggleMode },
    ...THEMES.filter((t) => t.value !== theme).map((t): Entry => ({
      value: `action:theme:${t.value}`, group: "Actions", label: `Use the ${t.label} theme`, icon: icons.bolt, keywords: ["appearance", "look", "style"], run: () => setTheme(t.value),
    })),
    { value: "action:signout", group: "Actions", label: "Sign out", icon: icons.bolt, keywords: ["log out", "logout", "leave"], run: () => { void logout().then(() => nav("/login")); } },
  ];

  const libraries: Entry[] = (libs.data?.items ?? []).map((l) => ({ value: `library:${l.id}`, group: "Libraries", label: l.name, icon: icons.libraries, keywords: ["library"], run: go(`/?libraryId=${l.id}`) }));
  const shelves: Entry[] = [...(mine.data?.items ?? []), ...(shared.data?.items ?? [])]
    .filter((s) => !s.deleted && s.data)
    .map((s) => ({ value: `shelf:${s.id}`, group: "Shelves", label: s.data!.name, secondary: `${s.visibleTitleCount} titles`, hint: s.data!.kind, icon: icons.shelves, keywords: ["shelf"], run: go(`/shelves/${s.id}`) }));
  const people: Entry[] = (users.data?.items ?? []).map((u) => ({
    value: `user:${u.id}`, group: "Users", label: u.displayName || u.username, secondary: u.username, hint: u.isAdmin ? "admin" : u.active ? "" : "disabled", icon: icons.user, keywords: ["person", "account"], run: go("/admin"),
  }));
  const books: Entry[] = (query.length >= 2 ? titles.data?.items ?? [] : []).map((t) => ({
    value: `title:${t.id}`, group: "Books and audiobooks", label: t.title || "(untitled)",
    secondary: [t.authors.join(", "), t.series.join(", ")].filter(Boolean).join(" · "),
    hint: [t.editionCount > 0 ? "ebook" : "", t.recordingCount > 0 ? "audio" : "", t.physicalCopyCount > 0 ? "paper" : ""].filter(Boolean).join(" + "),
    icon: icons.book, run: go(`/titles/${t.id}`),
  }));

  const sections: { label: string; items: Entry[] }[] = [];
  if (!query) {
    sections.push({ label: "Go to", items: pages.slice(0, 4) });
    sections.push({ label: "Libraries", items: libraries });
    sections.push({ label: "Shelves", items: shelves.slice(0, 6) });
    sections.push({ label: "Actions", items: actions });
  } else {
    sections.push({ label: "Search", items: [{ value: "search:library", group: "Search", label: `Search the library for “${query}”`, icon: icons.search, run: go(`/?q=${encodeURIComponent(query)}`) }] });
    sections.push({ label: "Books and audiobooks", items: books });
    sections.push({ label: "Libraries", items: libraries.filter((e) => matches(e, query)) });
    sections.push({ label: "Shelves", items: shelves.filter((e) => matches(e, query)) });
    sections.push({ label: "Users", items: people.filter((e) => matches(e, query)) });
    sections.push({ label: "Pages and settings", items: pages.filter((e) => matches(e, query)) });
    sections.push({ label: "Actions", items: actions.filter((e) => matches(e, query)) });
  }
  const all = sections.flatMap((s) => s.items);
  const searching = titles.isFetching && query.length >= 2;

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQ(""); }}>
      <DialogTrigger shortcut="mod+k" className="lt-search-trigger" data-testid="search-trigger">
        <span className="lt-search-icon">{icons.search}</span>
        <span className="lt-search-text">Search everything…</span>
        <Kbd shortcut="mod+k" />
      </DialogTrigger>
      <DialogBackdrop />
      <DialogContent className="lt-spotlight">
        <DialogTitle className="lt-sr">Search everything</DialogTitle>
        <Command filter={false} query={q} onQueryChange={setQ} autoHighlight
          onAction={(v) => { const hit = all.find((e) => e.value === v); setOpen(false); setQ(""); hit?.run(); }}>
          <div className="lt-spot-input">
            <span className="lt-search-icon">{icons.search}</span>
            <CommandInput aria-label="Search everything" placeholder="Search books, shelves, settings…" />
          </div>
          {all.length === 0 && <CommandEmpty>{query ? `Nothing matches “${query}”.` : "Loading…"}</CommandEmpty>}
          <CommandList className="lt-spot-list">
            {sections.filter((s) => s.items.length > 0).map((s) => (
              <CommandGroup key={s.label}>
                <CommandGroupLabel>{s.label}</CommandGroupLabel>
                {s.items.map((e) => (
                  <CommandItem key={e.value} value={e.value} label={e.label}>
                    <CommandItemIcon>{e.icon}</CommandItemIcon>
                    <span className="lt-spot-main">
                      <CommandItemText>{e.label}</CommandItemText>
                      {e.secondary && <span className="lt-spot-sub">{e.secondary}</span>}
                    </span>
                    {e.hint && <span className="lt-spot-hint">{e.hint}</span>}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
          <div className="lt-spot-foot">
            <span><Kbd>↑</Kbd> <Kbd>↓</Kbd> move</span>
            <span><Kbd>↵</Kbd> open</span>
            <span><Kbd>esc</Kbd> close</span>
            <span className="lt-grow" />
            <span role="status">{searching ? "Searching books…" : ""}</span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
