import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { adminOp, api, ApiError } from "../../api/client";
import type { AutoFillResult, MetadataField } from "../../api/types";
import { Button, ErrorBox, icons, notify, Text } from "../../ui";
import { PROVIDER_NAME, ProviderDialog, type ReviewSubject } from "./ProviderSearch";

export { reviewRows } from "./reviewFields";

export type { ReviewSubject } from "./ProviderSearch";

/** An edition write carries the revision it was based on; a recording write has none. */
type Report = { revision?: string; fields: MetadataField[] };

/** Auto-fill's result waiting for review: the values it would fill, which the person resets or saves (ADR-0090). Never stored until saved. */
export interface Draft { provider: string; rule: string; values: Record<string, unknown> }

export const RULE_TEXT: Record<string, string> = { identifier: "matched by ISBN", title_author: "matched by title and author" };

const AUTO_FILL_TEXT: Record<string, (r: AutoFillResult) => string> = {
  proposed: (r) => `Found ${Object.keys(r.proposed ?? {}).length} ${Object.keys(r.proposed ?? {}).length === 1 ? "field" : "fields"} from ${PROVIDER_NAME[r.provider ?? ""] ?? "a provider"}, ${RULE_TEXT[r.rule ?? ""] ?? "matched"}. Review them, then save.`,
  filled: (r) => `Filled ${r.filled.length} empty ${r.filled.length === 1 ? "field" : "fields"} from ${PROVIDER_NAME[r.provider ?? ""] ?? "a provider"}: ${r.filled.join(", ")}.`,
  nothing_to_fill: () => "A match was found, but every field it offers already has a value.",
  needs_review: () => "No single exact match to fill from. Use Search online to review the candidates. For a book with no ISBN, an administrator can let Auto-fill use the best title-and-author match in the library settings.",
  no_match: () => "Nothing found online for this title.",
  disabled: () => "Online lookups are off for this library. An administrator can turn on a provider in the library settings.",
};

export function ProviderReview({ subject, report, onApplied, onDraft }: { subject: ReviewSubject; report: Report; onApplied: () => void; onDraft: (d: Draft) => void }) {
  const [open, setOpen] = useState(false);
  const edition = subject.kind === "edition";
  const base = `/admin/${edition ? "editions" : "recordings"}/${subject.id}/metadata`;
  const autoFill = useMutation({
    // Auto-fill only proposes: nothing is stored until the person saves what they keep (ADR-0090).
    mutationFn: () => (edition
      ? api<AutoFillResult>("POST", `${base}/auto-fill`, { ...adminOp(report.revision ?? "0"), dryRun: true })
      : api<AutoFillResult>("POST", `${base}/auto-fill?dryRun=true`)),
    onSuccess: (r) => {
      const text = AUTO_FILL_TEXT[r.outcome]?.(r) ?? r.outcome;
      if (r.outcome === "proposed" && r.proposed) {
        onDraft({ provider: r.provider ?? "", rule: r.rule ?? "", values: r.proposed });
        notify.success("Auto-fill found a match", { detail: text });
      } else notify.info("Auto-fill: nothing to fill", { detail: text });
    },
  });
  return (
    <>
      <Button icon={icons.search} onClick={() => setOpen(true)}>Search online</Button>
      <Button icon={icons.bolt} loading={autoFill.isPending} onClick={() => autoFill.mutate()}>Auto-fill</Button>
      {autoFill.error instanceof ApiError && autoFill.error.status === 409
        ? <Text size="sm" tone="warning" role="alert">This item changed elsewhere, so the page was refreshed. Try again.</Text>
        : <ErrorBox error={autoFill.error} />}
      {open && <ProviderDialog subject={subject} report={report} onClose={() => setOpen(false)} onApplied={onApplied} />}
    </>
  );
}
