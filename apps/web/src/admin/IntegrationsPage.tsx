import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api, get } from "../api/client";
import type { IntegrationSettings } from "../api/t006";
import { SmtpForm } from "../settings/SmtpForm";
import { icons, Busy, Button, Card, ErrorBox, Heading, NumberField, Row, Stack, SwitchField, Text } from "../ui";

const MIB = 1048576;

function SettingsForm({ s }: { s: IntegrationSettings }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    opdsEnabled: s.opdsEnabled, emailEnabled: s.emailEnabled, koreaderEnabled: s.koreaderEnabled,
    mib: Math.round((s.maxAttachmentBytes / MIB) * 100) / 100, perHour: s.maxDeliveriesPerUserPerHour,
  });
  const save = useMutation({
    mutationFn: () => api<IntegrationSettings>("PUT", "/admin/integrations/settings", {
      operationId: crypto.randomUUID(), baseRevision: s.revision, opdsEnabled: f.opdsEnabled, emailEnabled: f.emailEnabled, koreaderEnabled: f.koreaderEnabled,
      maxAttachmentBytes: Math.min(100 * MIB, Math.max(1, Math.round(f.mib * MIB))), maxDeliveriesPerUserPerHour: f.perHour,
    }),
    // A stale revision (409) is shown; reloading resets the form to the current settings.
    onSettled: () => { qc.invalidateQueries({ queryKey: ["integrations"] }); qc.invalidateQueries({ queryKey: ["transports"] }); },
  });
  const submit = (e: FormEvent) => { e.preventDefault(); save.mutate(); };
  return (
    <Card>
      <form onSubmit={submit} aria-label="Integration settings">
        <Stack gap="sm">
          <Heading level={2}>Services</Heading>
          <Text size="sm" tone="dim">All three start turned off. A turned-off service refuses every request, even with a valid credential.</Text>
          <SwitchField label="OPDS catalog and downloads" checked={f.opdsEnabled} onChange={(v) => setF({ ...f, opdsEnabled: v })} />
          <SwitchField label="Email delivery" checked={f.emailEnabled} onChange={(v) => setF({ ...f, emailEnabled: v })} />
          <SwitchField label="KOReader progress sync" checked={f.koreaderEnabled} onChange={(v) => setF({ ...f, koreaderEnabled: v })} />
          <Row grow align="start">
            <NumberField label="Largest file that can be emailed (MiB)" description="1 to 100" min={1} max={100} step={0.01} value={f.mib}
              onValue={(v) => typeof v === "number" && setF({ ...f, mib: v })} />
            <NumberField label="Emails per person per hour" description="1 to 100" min={1} max={100} step={1} value={f.perHour}
              onValue={(v) => typeof v === "number" && setF({ ...f, perHour: v })} />
          </Row>
          <ErrorBox error={save.error} />
          <Row><Button type="submit" variant="primary" loading={save.isPending} icon={icons.save}>Save</Button></Row>
        </Stack>
      </form>
    </Card>
  );
}

export function IntegrationsPage() {
  const q = useQuery({ queryKey: ["integrations"], queryFn: () => get<IntegrationSettings>("/integrations/settings") });
  if (q.isPending) return <Busy />;
  if (q.error) return <ErrorBox error={q.error} />;
  return (
    <Stack>
      <SettingsForm key={q.data.revision} s={q.data} />
      <SmtpForm scope="server" />
    </Stack>
  );
}
