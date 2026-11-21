import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import { api, get } from "../api/client";
import { newSecret, type Credential, type CredentialKind, type IntegrationSettings } from "../api/t006";
import { icons, Alert, Badge, Busy, Button, Card, Code, CopyButton, ErrorBox, Heading, Row, SelectField, Stack, Table, TBody, TD, Text, TextField, TH, THead, TR } from "../ui";

interface Shown { credential: Credential; password: string }

function Line({ label, children }: { label: string; children: ReactNode }) {
  return <Row><span className="lt-line-label"><Text as="span" size="sm">{label}</Text></span>{children}</Row>;
}

/** The one place the secret exists. It lives only in the page's React state: dismissing, leaving the page or signing out discards it. */
function OneTimeSecret({ shown, onDismiss }: { shown: Shown; onDismiss: () => void }) {
  const origin = window.location.origin;
  const c = shown.credential;
  return (
    <Alert tone="success" title="Credential created. Copy the password now; it will not be shown again." data-testid="one-time-secret">
      <Stack gap="xs">
        <Text size="sm">{c.kind === "opds"
          ? "Enter these in your OPDS reader. Use HTTP Basic authentication."
          : "Set KOReader’s Custom sync server to your Litara server URL followed by /1 (for example, https://books.example.com/1). Then choose Login and enter these credentials. Each device needs its own credential."}</Text>
        <Line label="Catalog address"><Code data-testid="secret-address">{c.kind === "opds" ? `${origin}/opds/v1` : `${origin}/1`}</Code></Line>
        {c.kind === "opds" && <Line label="OPDS 2.0 address"><Code>{origin}/opds/v2</Code></Line>}
        <Line label="Username"><Code data-testid="secret-username">{c.username}</Code></Line>
        <Line label="Password"><Code data-testid="secret-password">{shown.password}</Code><CopyButton value={shown.password} /></Line>
        <Row><Button size="sm" onClick={onDismiss} icon={icons.check}>I have saved it</Button></Row>
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
      <Text size="sm" tone="dim">
        App credentials let a reading app use your library without your account password. Each credential works only for its own purpose,
        can be revoked at any time, and cannot sign in to Litara or change anything here.
      </Text>
      {opdsOff && <Alert tone="warning">OPDS is not enabled by your administrator yet. You can create a credential now; it will work once it is turned on.</Alert>}
      {koOff && <Alert tone="warning">KOReader sync is not enabled by your administrator yet.</Alert>}
      {shown && <OneTimeSecret shown={shown} onDismiss={() => setShown(null)} />}
      <Card framed>
        <form onSubmit={submit}>
          <Stack gap="sm">
            <Heading level={2}>New credential</Heading>
            <Row grow align="end">
              <SelectField label="Used for" value={kind} onValue={(v) => v && setKind(v as CredentialKind)}
                items={[{ value: "opds", label: "OPDS reader (catalog and downloads)" }, { value: "koreader", label: "KOReader device (progress sync)" }]} />
              <TextField label="Name" placeholder={kind === "opds" ? "Phone reader" : "Kobo in the study"} value={label} onValue={setLabel} required maxLength={128} />
            </Row>
            <ErrorBox error={create.error} />
            <Row><Button type="submit" variant="primary" loading={create.isPending} disabled={!label.trim()} icon={icons.plus}>Create credential</Button></Row>
          </Stack>
        </form>
      </Card>
      <ErrorBox error={list.error ?? revoke.error} />
      <Table label="Credentials table" data-testid="credentials-table">
        <THead><TR><TH>Name</TH><TH>Used for</TH><TH>Username</TH><TH>Last used</TH><TH><span className="lt-sr">Actions</span></TH></TR></THead>
        <TBody>
          {list.data?.items.length === 0 && <TR><TD colSpan={5}><Text size="sm" tone="dim">No credentials yet.</Text></TD></TR>}
          {list.data?.items.map((c) => (
            <TR key={c.id}>
              <TD>{c.label}</TD>
              <TD><Badge>{c.kind === "opds" ? "OPDS" : "KOReader"}</Badge></TD>
              <TD><Code>{c.username}</Code></TD>
              <TD>{c.lastUsedAt ? new Date(c.lastUsedAt).toLocaleString() : "Never"}</TD>
              <TD>
                <Row justify="end">
                  {confirm === c.id ? (
                    <>
                      <Button size="sm" variant="danger" solid loading={revoke.isPending} onClick={() => revoke.mutate(c.id)} icon={icons.trash}>Confirm revoke</Button>
                      <Button size="sm" onClick={() => setConfirm(null)} icon={icons.close}>Keep</Button>
                    </>
                  ) : <Button size="sm" aria-label={`Revoke ${c.label}`} onClick={() => setConfirm(c.id)} icon={icons.trash}>Revoke</Button>}
                </Row>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
      <Text size="xs" tone="dim">Revoking is permanent and takes effect on the next request. Create a new credential to replace one.</Text>
    </Stack>
  );
}
