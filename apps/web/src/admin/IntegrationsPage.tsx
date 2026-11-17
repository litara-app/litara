import { Button, Card, Group, NumberInput, Stack, Switch, Text, Title } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api, get } from "../api/client";
import type { IntegrationSettings } from "../api/t006";
import { SmtpForm } from "../settings/SmtpForm";
import { Busy, ErrorBox } from "../ui/common";

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
    <Card withBorder>
      <form onSubmit={submit} aria-label="Integration settings">
        <Stack gap="xs">
          <Title order={4}>Services</Title>
          <Text size="sm" c="dimmed">All three start turned off. A turned-off service refuses every request, even with a valid credential.</Text>
          <Switch label="OPDS catalog and downloads" checked={f.opdsEnabled} onChange={(e) => setF({ ...f, opdsEnabled: e.currentTarget.checked })} />
          <Switch label="Email delivery" checked={f.emailEnabled} onChange={(e) => setF({ ...f, emailEnabled: e.currentTarget.checked })} />
          <Switch label="KOReader progress sync" checked={f.koreaderEnabled} onChange={(e) => setF({ ...f, koreaderEnabled: e.currentTarget.checked })} />
          <Group grow align="flex-start">
            <NumberInput label="Largest file that can be emailed (MiB)" description="1 to 100" min={1} max={100} decimalScale={2} value={f.mib}
              onChange={(v) => typeof v === "number" && setF({ ...f, mib: v })} />
            <NumberInput label="Emails per person per hour" description="1 to 100" min={1} max={100} allowDecimal={false} value={f.perHour}
              onChange={(v) => typeof v === "number" && setF({ ...f, perHour: v })} />
          </Group>
          <ErrorBox error={save.error} />
          <Group><Button type="submit" loading={save.isPending}>Save</Button></Group>
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
