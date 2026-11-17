import { Badge, Button, Card, Code, Group, Select, Stack, Text, TextInput, Title } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api, get } from "../api/client";
import type { Credential, IntegrationSettings, KoPosition } from "../api/t006";
import { Busy, ErrorBox } from "../ui/common";

/**
 * Shows the KOReader position for an edition's current file. It is a separate
 * source: it is never merged into the Litara reader position or completion, and the
 * saved progress string is untrusted text that is only ever rendered as text.
 */
export function KoEditionCard({ editionId, fileId, contentVersion }: { editionId: string; fileId: string; contentVersion: string }) {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["integrations"], queryFn: () => get<IntegrationSettings>("/integrations/settings") });
  const pos = useQuery({ queryKey: ["ko-position", editionId], queryFn: () => get<KoPosition>(`/editions/${editionId}/koreader-position`) });
  const creds = useQuery({ queryKey: ["credentials"], queryFn: () => get<{ items: Credential[] }>("/integration-credentials") });
  const [credentialId, setCredentialId] = useState<string | null>(null);
  const [document, setDocument] = useState("");
  const valid = /^[0-9a-f]{32}$/.test(document.trim().toLowerCase());
  const bind = useMutation({
    mutationFn: () => api("PUT", `/koreader/bindings/${crypto.randomUUID()}`, {
      operationId: crypto.randomUUID(), baseRevision: "0", credentialId, document: document.trim().toLowerCase(), fileId, contentVersion,
    }),
    onSuccess: () => { setDocument(""); setCredentialId(null); },
    onSettled: () => qc.invalidateQueries({ queryKey: ["ko-bindings"] }),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); bind.mutate(); };

  if (settings.isPending || pos.isPending) return <Busy />;
  if (!settings.data?.koreaderEnabled) return null;
  const p = pos.data?.position;
  const kor = (creds.data?.items ?? []).filter((c) => c.kind === "koreader");
  return (
    <Card withBorder data-testid="ko-card">
      <Stack gap="xs">
        <Group justify="space-between"><Title order={4}>KOReader</Title><Badge variant="light">KOReader position</Badge></Group>
        {p ? (
          <Stack gap={2} data-testid="ko-position">
            <Group gap="xs"><Text size="sm">Saved by {p.device}:</Text><Code>{p.progress}</Code><Badge variant="light">{(p.percentage * 100).toFixed(1)}%</Badge></Group>
            <Text size="xs" c="dimmed">Saved {new Date(p.timestamp * 1000).toLocaleString()}. This is kept separate from your place in the Litara reader and does not mark the book finished.</Text>
          </Stack>
        ) : <Text size="sm" c="dimmed" data-testid="ko-empty">No KOReader position is saved for this file.</Text>}
        <Text size="sm" fw={500}>Bind a KOReader document to this file</Text>
        <Text size="xs" c="dimmed">Only needed when KOReader cannot tell which of several identical-looking files it opened. Choose the device and enter the 32-character document fingerprint it uses.</Text>
        <form onSubmit={submit} aria-label="Bind KOReader document">
          <Group grow align="flex-end">
            <Select label="Device" placeholder={kor.length ? "Choose a device" : "No KOReader credentials"} value={credentialId} onChange={setCredentialId}
              data={kor.map((c) => ({ value: c.id, label: c.label }))} disabled={kor.length === 0} />
            <TextInput label="Document fingerprint" value={document} onChange={(e) => setDocument(e.currentTarget.value)} maxLength={32} error={document && !valid ? "32 hexadecimal characters" : undefined} autoComplete="off" />
            <Button type="submit" loading={bind.isPending} disabled={!credentialId || !valid}>Bind</Button>
          </Group>
        </form>
        <ErrorBox error={bind.error} />
        {bind.isSuccess && <Text size="sm" c="green" role="status">Bound.</Text>}
      </Stack>
    </Card>
  );
}
