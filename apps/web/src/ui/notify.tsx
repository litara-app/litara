import { Popover, PopoverContent, PopoverTrigger } from "@ui-sdk/react/popover";
import { Toast, ToastClose, ToastDescription, ToastRegion, ToastTitle, createToaster } from "@ui-sdk/react/toast";
import { useEffect, useState, useSyncExternalStore } from "react";
import { ApiError } from "../api/client";
import { useAuth } from "../auth/session";
import { icons } from "./icons";
import { Button } from "./controls";

/*
 * Notifications (ADR-0089, proposed). Every response to an action goes through notify(): it is recorded for the
 * notification history and shown as a toast. History is kept in this browser, per account, until the server stores it.
 */

export type NoticeTone = "success" | "info" | "warning" | "error";
export interface Notice { id: string; tone: NoticeTone; title: string; detail?: string; at: number; read: boolean; source: "user" | "system" }

const SHOWN_FOR_MS = 5000;
const KEEP = 100;
const BELL_LIST = 5;
const toaster = createToaster({ duration: SHOWN_FOR_MS });

let owner = "";
let notices: Notice[] = [];
const listeners = new Set<() => void>();
const storeKey = (o: string) => `litara.notifications.${o}`;

function emit() { for (const l of listeners) l(); }
function persist() {
  try { if (owner) localStorage.setItem(storeKey(owner), JSON.stringify(notices)); } catch { /* storage unavailable: history lasts until the page closes */ }
}
function load(o: string) {
  owner = o;
  notices = [];
  try {
    const raw = o ? localStorage.getItem(storeKey(o)) : null;
    if (raw) notices = (JSON.parse(raw) as Notice[]).filter((n) => n && typeof n.title === "string").slice(0, KEEP);
  } catch { /* an unreadable history starts empty */ }
  emit();
}

let counter = 0;
interface Options { detail?: string; /** "system" is for background work the user did not start; it stays unread until the bell is opened. */ source?: "user" | "system" }

function send(tone: NoticeTone, title: string, opts: Options = {}): string {
  const source = opts.source ?? "user";
  const n: Notice = { id: `${Date.now().toString(36)}-${(counter++).toString(36)}`, tone, title, detail: opts.detail, at: Date.now(), read: source === "user", source };
  notices = [n, ...notices].slice(0, KEEP);
  persist();
  emit();
  const show = tone === "error" ? toaster.error : tone === "success" ? toaster.success : tone === "warning" ? toaster.warning : toaster.info;
  show(title, { description: opts.detail });
  return n.id;
}

export const notify = {
  success: (title: string, opts?: Options) => send("success", title, opts),
  info: (title: string, opts?: Options) => send("info", title, opts),
  warning: (title: string, opts?: Options) => send("warning", title, opts),
  error: (title: string, opts?: Options) => send("error", title, opts),
};

/** Errors already shown as a notification. ErrorBox skips them, so one failure is reported once. */
const reported = new WeakSet<object>();
export const wasReported = (e: unknown) => typeof e === "object" && e !== null && reported.has(e);

export function notifyError(error: unknown, title = "Something went wrong") {
  const e = error as Error;
  const code = error instanceof ApiError && error.code ? ` (${error.code})` : "";
  if (typeof error === "object" && error !== null) reported.add(error);
  return notify.error(title, { detail: `${e?.message ?? String(error)}${code}` });
}

function markAllRead() {
  if (!notices.some((n) => !n.read)) return;
  notices = notices.map((n) => (n.read ? n : { ...n, read: true }));
  persist();
  emit();
}
function clearAll() { notices = []; persist(); emit(); }

/** The current history, newest first, for code that is not a component (and for tests). */
export const currentNotices = (): readonly Notice[] => notices;

export function useNotices() {
  const items = useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => notices);
  return { items, unread: items.filter((n) => !n.read).length, markAllRead, clear: clearAll };
}

/** Loads the signed-in account's history and shows toasts at the bottom right. Mount once, inside the auth provider. */
export function NotificationHost() {
  const { user } = useAuth();
  const id = user?.id ?? "";
  useEffect(() => { load(id); }, [id]);
  return (
    <ToastRegion toaster={toaster} side="bottom" align="end" className="lt-toasts">
      {() => (
        <Toast className="lt-toast">
          <div className="lt-toast-body"><ToastTitle /><ToastDescription /></div>
          <ToastClose aria-label="Dismiss notification" />
        </Toast>
      )}
    </ToastRegion>
  );
}

export function ago(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(at).toLocaleDateString();
}

const toneIcon = { success: icons.check, info: icons.info, warning: icons.info, error: icons.close } as const;

export function NoticeRow({ n }: { n: Notice }) {
  return (
    <li className="lt-notice" data-tone={n.tone} data-unread={!n.read || undefined}>
      <span className="lt-notice-icon" aria-hidden="true">{toneIcon[n.tone]}</span>
      <div className="lt-notice-text">
        <span className="lt-notice-title">{n.title}</span>
        {n.detail && <span className="lt-notice-detail">{n.detail}</span>}
        <span className="lt-notice-time">{ago(n.at)}{n.source === "system" ? " · background" : ""}</span>
      </div>
    </li>
  );
}

/** The bell at the far right of the top bar: an unread count and the last few notifications. */
export function NotificationBell() {
  const { items, unread, markAllRead } = useNotices();
  const [open, setOpen] = useState(false);
  const label = unread > 0 ? `Notifications, ${unread} unread` : "Notifications";
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) markAllRead(); }}>
      <PopoverTrigger className="lt-btn lt-icon-btn lt-bell" data-variant="subtle" aria-label={label} data-testid="notification-bell">
        {icons.bell}
        {unread > 0 && <span className="lt-bell-count" data-testid="bell-unread">{unread > 9 ? "9+" : unread}</span>}
      </PopoverTrigger>
      <PopoverContent className="lt-bell-pop" align="end">
        <div className="lt-bell-head">Notifications</div>
        {items.length === 0
          ? <p className="lt-bell-empty">Nothing yet. Results of your actions appear here.</p>
          : <ul className="lt-notice-list" aria-label="Latest notifications">{items.slice(0, BELL_LIST).map((n) => <NoticeRow key={n.id} n={n} />)}</ul>}
        <div className="lt-bell-foot"><Button size="sm" to="/settings/notifications" icon={icons.list} onClick={() => setOpen(false)}>All notifications</Button></div>
      </PopoverContent>
    </Popover>
  );
}
