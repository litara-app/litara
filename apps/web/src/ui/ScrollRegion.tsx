import type { ReactNode } from "react";

/** A horizontally scrollable region that keyboard users can focus and scroll (WCAG 2.1.1). */
export function ScrollRegion({ label, children }: { label: string; children: ReactNode }) {
  return <div role="region" aria-label={label} tabIndex={0} style={{ overflowX: "auto", maxWidth: "100%" }}>{children}</div>;
}
