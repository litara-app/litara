import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api, get } from "../api/client";
import type { Credential, IntegrationSettings, KoPosition } from "../api/t006";
import { icons, Badge, Busy, Button, Card, Code, ErrorBox, Heading, Row, SelectField, Stack, Text, TextField } from "../ui";

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
    <Card data-testid="ko-card">
      <Stack gap="sm">
        <Row justify="between"><Heading level={2}>KOReader</Heading><Badge>KOReader position</Badge></Row>
        {p ? (
          <Stack gap="xs" data-testid="ko-position">
            <Row><Text as="span" size="sm">Saved by {p.device}:</Text><Code>{p.progress}</Code><Badge>{(p.percentage * 100).toFixed(1)}%</Badge></Row>
            <Text size="xs" tone="dim">Saved {new Date(p.timestamp * 1000).toLocaleString()}. This is kept separate from your place in the Litara reader and does not mark the book finished.</Text>
          </Stack>
        ) : <Text size="sm" tone="dim" data-testid="ko-empty">No KOReader position is saved for this file.</Text>}
        <Text size="sm" strong>Bind a KOReader document to this file</Text>
        <Text size="xs" tone="dim">Only needed when KOReader cannot tell which of several identical-looking files it opened. Choose the device and enter the 32-character document fingerprint it uses.</Text>
        <form onSubmit={submit} aria-label="Bind KOReader document">
          <Row grow align="end">
            <SelectField label="Device" placeholder={kor.length ? "Choose a device" : "No KOReader credentials"} value={credentialId} onValue={setCredentialId}
              items={kor.map((c) => ({ value: c.id, label: c.label }))} disabled={kor.length === 0} />
            <TextField label="Document fingerprint" value={document} onValue={setDocument} maxLength={32} error={document && !valid ? "32 hexadecimal characters" : undefined} autoComplete="off" />
            <Button type="submit" variant="primary" loading={bind.isPending} disabled={!credentialId || !valid} icon={icons.plus}>Bind</Button>
          </Row>
        </form>
        <ErrorBox error={bind.error} />
        {bind.isSuccess && <Text size="sm" tone="success" role="status">Bound.</Text>}
      </Stack>
    </Card>
  );
}
