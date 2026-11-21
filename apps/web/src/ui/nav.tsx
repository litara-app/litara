import { Pagination, PaginationEllipsis, PaginationItem, PaginationLink, PaginationList, PaginationNext, PaginationPrevious } from "@ui-sdk/react/pagination";
import { Tabs as SdkTabs, TabsList, TabsPanel, TabsTab } from "@ui-sdk/react/tabs";
import type { ReactNode } from "react";
import { NavLink } from "react-router";

/** Peers of one object. Panels render only for the selected tab. */
export function Tabs({ label, tabs, defaultValue, value, onValueChange }: {
  label: string; tabs: { value: string; label: ReactNode; content: ReactNode; disabled?: boolean }[];
  defaultValue?: string; value?: string; onValueChange?: (v: string) => void;
}) {
  return (
    <SdkTabs defaultValue={defaultValue ?? (value === undefined ? tabs[0]?.value : undefined)} value={value} onValueChange={(v) => v && onValueChange?.(v)}>
      <TabsList className="lt-tabs-list" aria-label={label}>
        {tabs.map((t) => (<TabsTab key={t.value} className="lt-tab" value={t.value} disabled={t.disabled}>{t.label}</TabsTab>))}
      </TabsList>
      {tabs.map((t) => (<TabsPanel key={t.value} className="lt-tab-panel" value={t.value}>{t.content}</TabsPanel>))}
    </SdkTabs>
  );
}

/** One set of tabs whose bar and panels sit in different parts of a page. Wrap both in TabFrame. */
export function TabFrame({ value, onValueChange, children }: { value: string; onValueChange: (v: string) => void; children: ReactNode }) {
  return <SdkTabs value={value} onValueChange={(v) => v && onValueChange(v)}>{children}</SdkTabs>;
}
export function TabBar({ label, tabs }: { label: string; tabs: { value: string; label: ReactNode; icon?: ReactNode }[] }) {
  return (
    <TabsList className="lt-tabs-list lt-tabbar" aria-label={label}>
      {tabs.map((t) => (<TabsTab key={t.value} className="lt-tab" value={t.value}>{t.icon && <span className="lt-btn-icon" aria-hidden="true">{t.icon}</span>}{t.label}</TabsTab>))}
    </TabsList>
  );
}
export function TabPane({ value, children }: { value: string; children: ReactNode }) {
  return <TabsPanel className="lt-tab-panel" value={value}>{children}</TabsPanel>;
}

/** Links that look like tabs, for pages that are routes. */
export function NavTabs({ label, items }: { label: string; items: { to: string; label: string; end?: boolean }[] }) {
  return (
    <nav aria-label={label}>
      <div className="lt-tabs-list">
        {items.map((i) => (<NavLink key={i.to} className="lt-tab" to={i.to} end={i.end}>{i.label}</NavLink>))}
      </div>
    </nav>
  );
}

/** Pages are 1-based here; callers convert if their API is 0-based. */
export function Pager({ label = "Pagination", page, pageCount, onPage }: { label?: string; page: number; pageCount: number; onPage: (p: number) => void }) {
  return (
    <Pagination className="lt-pager" aria-label={label} page={page} pageCount={pageCount} onPageChange={(p) => onPage(p)}>
      <PaginationList>
        {({ items }: { items: (number | string)[] }) => (
          <>
            <PaginationItem><PaginationPrevious aria-label="Previous page">Previous</PaginationPrevious></PaginationItem>
            {items.map((it) => (
              <PaginationItem key={it}>
                {typeof it === "number" ? <PaginationLink page={it} aria-label={`Page ${it}`} /> : <PaginationEllipsis />}
              </PaginationItem>
            ))}
            <PaginationItem><PaginationNext aria-label="Next page">Next</PaginationNext></PaginationItem>
          </>
        )}
      </PaginationList>
    </Pagination>
  );
}
