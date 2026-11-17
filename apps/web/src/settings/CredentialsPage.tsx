import { Alert, Badge, Button, Card, Code, CopyButton, Group, Select, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api, get } from "../api/client";
import { newSecret, type Credential, type CredentialKind, type IntegrationSettings } from "../api/t006";
import { ScrollRegion } from "../ui/ScrollRegion";
import { Busy, ErrorBox } from "../ui/common";

interface Shown { credential: Credential; password: string }

/** The one place the secret exists. It lives only in the page's React state: dismissing, leaving the page or signing out discards it. */
function OneTimeSecret({ shown, onDismiss }: { shown: Shown; onDismiss: () => void }) {
  const origin = window.location.origin;
  const c = shown.credential;
  return (
    <Alert color="green" title="Credential created. Copy the password now; it will not be shown again." data-testid="one-time-secret">
      <Stack gap="xs">
        <Text size="sm">{c.kind === "opds"
          ? "Enter these in your OPDS reader. Use HTTP Basic authentication."
          : "Enter these in KOReader's progress-sync settings. Each device needs its own credential."}</Text>
        <Group gap="xs"><Text size="sm" w={110}>Catalog address</Text>
          <Code data-testid="secret-address">{c.kind === "opds" ? `${origin}/opds/v1` : `${origin}/1`}</Code></Group>
        {c.kind === "opds" && <Group gap="xs"><Text size="sm" w={110}>OPDS 2.0 address</Text><Code>{origin}/opds/v2</Code></Group>}
        <Group gap="xs"><Text size="sm" w={110}>Username</Text><Code data-testid="secret-username">{c.username}</Code></Group>
        <Group gap="xs"><Text size="sm" w={110}>Password</Text><Code data-testid="secret-password">{shown.password}</Code>
          <CopyButton value={shown.password}>{({ copied, copy }) => <Button size="compact-xs" variant="default" onClick={copy}>{copied ? "Copied" : "Copy"}</Button>}</CopyButton></Group>
        <Group><Button size="xs" onClick={onDismiss}>I have saved it</Button></Group>
      </Stack>
    </Alert>
  );
}

export function CredentialsPage() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["integrations"], queryFn: () => get<IntegrationSettings>("/integrations/settings") });
  const list = useQuery({ queryKey: ["credentials"], queryFn: () => get<{ items: Credential[] }>("/integration-credentials") });
  const [kind, setKind] = useState<CredentialKind>("opds");
  const [label, setLabel] = useState("");
  const [shown, setShown] = useState<Shown | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: async () => {
      const password = newSecret(); // generated here, sent once, never stored in script-readable storage
      const credential = await api<Credential>("POST", "/integration-credentials", { operationId: crypto.randomUUID(), kind, label: label.trim(), password });
      return { credential, password };
    },
    onSuccess: (s) => { setShown(s); setLabel(""); qc.invalidateQueries({ queryKey: ["credentials"] }); },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api<Credential>("POST", `/integration-credentials/${id}/revoke`, { operationId: crypto.randomUUID() }),
    onSettled: () => { setConfirm(null); qc.invalidateQueries({ queryKey: ["credentials"] }); },
  });
  const submit = (e: FormEvent) => { e.preventDefault(); if (label.trim()) create.mutate(); };

  if (list.isPending || settings.isPending) return <Busy />;
  const s = settings.data;
  const opdsOff = s && !s.opdsEnabled, koOff = s && !s.koreaderEnabled;
  return (
    <Stack>
      <Text size="sm" c="dimmed">
        App credentials let a reading app use your library without your account password. Each credential works only for its own purpose,
        can be revoked at any time, and cannot sign in to Litara or change anything here.
      </Text>
      {opdsOff && <Alert color="yellow">OPDS is not enabled by your administrator yet. You can create a credential now; it will work once it is turned on.</Alert>}
      {koOff && <Alert color="yellow">KOReader sync is not enabled by your administrator yet.</Alert>}
      {shown && <OneTimeSecret shown={shown} onDismiss={() => setShown(null)} />}
      <Card withBorder>
        <form onSubmit={submit}>
          <Stack gap="xs">
            <Title order={4}>New credential</Title>
            <Group grow align="flex-end">
              <Select label="Used for" value={kind} onChange={(v) => v && setKind(v as CredentialKind)} allowDeselect={false}
                data={[{ value: "opds", label: "OPDS reader (catalog and downloads)" }, { value: "koreader", label: "KOReader device (progress sync)" }]} />
              <TextInput label="Name" placeholder={kind === "opds" ? "Phone reader" : "Kobo in the study"} value={label} onChange={(e) => setLabel(e.currentTarget.value)} required maxLength={128} />
            </Group>
            <ErrorBox error={create.error} />
            <Group><Button type="submit" loading={create.isPending} disabled={!label.trim()}>Create credential</Button></Group>
          </Stack>
        </form>
      </Card>
      <ErrorBox error={list.error ?? revoke.error} />
      <ScrollRegion label="Credentials table">
        <Table verticalSpacing="xs" data-testid="credentials-table">
          <Table.Thead><Table.Tr><Table.Th>Name</Table.Th><Table.Th>Used for</Table.Th><Table.Th>Username</Table.Th><Table.Th>Last used</Table.Th><Table.Th /></Table.Tr></Table.Thead>
          <Table.Tbody>
            {list.data?.items.length === 0 && <Table.Tr><Table.Td colSpan={5}><Text size="sm" c="dimmed">No credentials yet.</Text></Table.Td></Table.Tr>}
            {list.data?.items.map((c) => (
              <Table.Tr key={c.id}>
                <Table.Td>{c.label}</Table.Td>
                <Table.Td><Badge variant="light">{c.kind === "opds" ? "OPDS" : "KOReader"}</Badge></Table.Td>
                <Table.Td><Code>{c.username}</Code></Table.Td>
                <Table.Td>{c.lastUsedAt ? new Date(c.lastUsedAt).toLocaleString() : "Never"}</Table.Td>
                <Table.Td>
                  <Group justify="flex-end" gap="xs">
                    {confirm === c.id ? (
                      <>
                        <Button size="compact-xs" color="red" loading={revoke.isPending} onClick={() => revoke.mutate(c.id)}>Confirm revoke</Button>
                        <Button size="compact-xs" variant="default" onClick={() => setConfirm(null)}>Keep</Button>
                      </>
                    ) : <Button size="compact-xs" variant="default" aria-label={`Revoke ${c.label}`} onClick={() => setConfirm(c.id)}>Revoke</Button>}
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollRegion>
      <Text size="xs" c="dimmed">Revoking is permanent and takes effect on the next request. Create a new credential to replace one.</Text>
    </Stack>
  );
}
