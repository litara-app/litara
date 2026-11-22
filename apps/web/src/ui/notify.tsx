import { Popover, PopoverContent, PopoverTrigger } from "@ui-sdk/react/popover";
import { Toast, ToastClose, ToastDescription, ToastRegion, ToastTitle, createToaster } from "@ui-sdk/react/toast";
import { useEffect, useState, useSyncExternalStore } from "react";
import { api, ApiError, get } from "../api/client";
import { useAuth } from "../auth/session";
import { icons } from "./icons";
import { Button } from "./controls";

/*
 * Notifications (ADR-0089). Every response to an action goes through notify(): it shows a toast and is recorded in the
 * account's notification history on the server, so it follows the person to other devices. Entries that background work
 * adds on the server arrive when the history is refreshed (at sign-in, about every minute and when the window regains focus).
 */

export type NoticeTone = "success" | "info" | "warning" | "error";
export interface Notice { id: string; tone: NoticeTone; title: string; detail?: string; at: number; read: boolean; source: "user" | "system"; pending?: boolean }
interface WireNotice { id: string; tone: NoticeTone; title: string; detail?: string; source: "user" | "system"; read: boolean; createdAt: string }
interface WireNotices { items: WireNotice[]; unread: number }

const SHOWN_FOR_MS = 5000;
const REFRESH_MS = 60_000;
const BELL_LIST = 5;
const toaster = createToaster({ duration: SHOWN_FOR_MS });

let signedIn = false;
let notices: Notice[] = [];
let known = new Set<string>(); // ids the server has already told us about, so a later arrival can be announced
let baseline = false; // false until the first load after sign-in, which never pops toasts for old entries
const listeners = new Set<() => void>();

function emit() { for (const l of listeners) l(); }
const fromWire = (n: WireNotice): Notice => ({ id: n.id, tone: n.tone, title: n.title, detail: n.detail || undefined, at: Date.parse(n.createdAt), read: n.read, source: n.source });
function toast(tone: NoticeTone, title: string, detail?: string) {
  const show = tone === "error" ? toaster.error : tone === "success" ? toaster.success : tone === "warning" ? toaster.warning : toaster.info;
  show(title, { description: detail });
}

/** Reloads the history from the server. Entries added by background work since the last load are announced as toasts. */
export async function refreshNotifications(): Promise<void> {
  if (!signedIn) return;
  try {
    const r = await get<WireNotices>("/notifications?limit=100");
    if (!signedIn) return;
    const incoming = r.items.map(fromWire);
    if (baseline) for (const n of incoming) if (!known.has(n.id) && n.source === "system" && !n.read) toast(n.tone, n.title, n.detail);
    known = new Set(incoming.map((n) => n.id));
    baseline = true;
    notices = [...notices.filter((n) => n.pending), ...incoming];
    emit();
  } catch { /* the bell keeps what it has; the next refresh tries again */ }
}

let counter = 0;
interface Options { detail?: string }

function send(tone: NoticeTone, title: string, opts: Options = {}): string {
  const local: Notice = { id: `local-${Date.now().toString(36)}-${(counter++).toString(36)}`, tone, title, detail: opts.detail, at: Date.now(), read: true, source: "user", pending: true };
  notices = [local, ...notices];
  emit();
  toast(tone, title, opts.detail);
  if (signedIn) {
    api<WireNotice>("POST", "/notifications", { tone, title: title.slice(0, 300), ...(opts.detail ? { detail: opts.detail.slice(0, 2000) } : {}) })
      .then((saved) => {
        known.add(saved.id);
        notices = notices.map((n) => (n.id === local.id ? fromWire(saved) : n));
        emit();
      })
      .catch(() => { notices = notices.map((n) => (n.id === local.id ? { ...n, pending: false } : n)); emit(); }); // kept for this visit only
  }
  return local.id;
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
  emit();
  if (signedIn) void api("POST", "/notifications/read").catch(() => void refreshNotifications());
}
function clearAll() {
  notices = [];
  known = new Set();
  emit();
  if (signedIn) void api("DELETE", "/notifications").catch(() => void refreshNotifications());
}

/** The current history, newest first, for code that is not a component (and for tests). */
export const currentNotices = (): readonly Notice[] => notices;

export function useNotices() {
  const items = useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => notices);
  return { items, unread: items.filter((n) => !n.read).length, markAllRead, clear: clearAll };
}

/** Loads the signed-in account's history, keeps it fresh and shows toasts at the bottom right. Mount once, inside the auth provider. */
export function NotificationHost() {
  const { user } = useAuth();
  const id = user?.id ?? "";
  useEffect(() => {
    signedIn = !!id;
    notices = [];
    known = new Set();
    baseline = false;
    emit();
    if (!id) return;
    void refreshNotifications();
    const timer = setInterval(() => void refreshNotifications(), REFRESH_MS);
    const onShow = () => { if (document.visibilityState === "visible") void refreshNotifications(); };
    window.addEventListener("focus", onShow);
    document.addEventListener("visibilitychange", onShow);
    return () => { clearInterval(timer); window.removeEventListener("focus", onShow); document.removeEventListener("visibilitychange", onShow); };
  }, [id]);
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
