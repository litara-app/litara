import { DateInput } from "@ui-sdk/react/date-input";
import { Field, FieldDescription, FieldLabel } from "@ui-sdk/react/field";
import type { ReactNode } from "react";

/** A labelled date (`YYYY-MM-DD`, or null until every part is filled). */
export function DateField({ label, description, value, onValue }: { label: ReactNode; description?: ReactNode; value: string | null; onValue: (v: string | null) => void }) {
  return (
    <Field className="lt-field">
      <FieldLabel>{label}</FieldLabel>
      <DateInput value={value} onValueChange={(v: string | null) => onValue(v)} />
      {description && <FieldDescription>{description}</FieldDescription>}
    </Field>
  );
}

/** The local calendar date of an ISO time, as YYYY-MM-DD. */
export function isoToDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** A calendar date as an ISO time at local noon, so it shows as the same day wherever it is read. */
export function dateToIso(date: string | null): string | null {
  if (!date) return null;
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y!, m! - 1, d!, 12).toISOString();
}
