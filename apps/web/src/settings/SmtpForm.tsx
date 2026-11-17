import { Alert, Badge, Button, Card, Checkbox, Group, NumberInput, PasswordInput, Select, Stack, Switch, Text, TextInput, Title } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api, get } from "../api/client";
import type { ConnectionTest, SmtpReport, TlsMode } from "../api/t006";
import { Busy, ErrorBox } from "../ui/common";

export type SmtpScope = "personal" | "server";
const path = (scope: SmtpScope) => (scope === "server" ? "/admin/delivery/smtp" : "/delivery/smtp");

function Form({ scope, report }: { scope: SmtpScope; report: SmtpReport }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    enabled: report.enabled, host: report.host, port: report.port, tlsMode: report.tlsMode,
    username: report.username, fromAddress: report.fromAddress,
  });
  // The stored password is never sent to the browser: this field only ever holds a new one.
  const [password, setPassword] = useState("");
  const [remove, setRemove] = useState(false);
  const [result, setResult] = useState<ConnectionTest | null>(null);
  const dirty = f.enabled !== report.enabled || f.host !== report.host || f.port !== report.port || f.tlsMode !== report.tlsMode
    || f.username !== report.username || f.fromAddress !== report.fromAddress || password !== "" || remove;
  const action = password !== "" ? "replace" : remove ? "clear" : "keep";
  const needsPassword = f.username.trim() !== "" && action !== "replace" && (action === "clear" || !report.hasPassword);

  const save = useMutation({
    mutationFn: () => api<SmtpReport>("PUT", path(scope), {
      operationId: crypto.randomUUID(), baseRevision: report.revision, enabled: f.enabled, host: f.host.trim(), port: f.port,
      tlsMode: f.tlsMode, username: f.username.trim(), fromAddress: f.fromAddress.trim(), secretAction: action, password: action === "replace" ? password : null,
    }),
    onSuccess: () => { setPassword(""); setRemove(false); setResult(null); },
    // A stale revision (409) shows the server's message; reload so the form shows the current settings.
    onSettled: () => { qc.invalidateQueries({ queryKey: ["smtp", scope] }); qc.invalidateQueries({ queryKey: ["transports"] }); qc.invalidateQueries({ queryKey: ["integrations"] }); },
  });
  const test = useMutation({
    mutationFn: () => api<ConnectionTest>("POST", `${path(scope)}/test`, { operationId: crypto.randomUUID(), baseRevision: report.revision }),
    onSuccess: setResult,
  });
  const submit = (e: FormEvent) => { e.preventDefault(); save.mutate(); };
  const modes: { value: TlsMode; label: string }[] = [
    { value: "starttls", label: "STARTTLS (required, certificate verified)" },
    { value: "implicit", label: "Implicit TLS (certificate verified)" },
    ...(report.tlsMode === "local_test_plain" ? [{ value: "local_test_plain" as TlsMode, label: "Plaintext (local test only)" }] : []),
  ];
  return (
    <Card withBorder>
      <form onSubmit={submit} aria-label={scope === "server" ? "Server mail settings" : "Personal mail settings"}>
        <Stack gap="xs">
          <Group justify="space-between">
            <Title order={4}>{scope === "server" ? "Server mail transport" : "Your own mail transport"}</Title>
            <Badge variant="light" color={report.configured ? (report.enabled ? "green" : "gray") : "gray"}>{!report.configured ? "Not configured" : report.enabled ? "Enabled" : "Disabled"}</Badge>
          </Group>
          <Text size="sm" c="dimmed">
            {scope === "server"
              ? "Used when a person chooses the server to send a file. Only administrators can change it. Its details are never shown to other people."
              : "Optional. Lets you send files through your own mail account. Nothing falls back to the server if this fails."}
          </Text>
          {!report.keyAvailable && <Alert color="orange" title="Password encryption key unavailable" role="alert">The server has no usable encryption key for stored mail passwords. Saved settings are kept, but a stored password cannot be used or replaced until the operator restores the key.</Alert>}
          <Switch label="Enabled" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.currentTarget.checked })} />
          <Group grow align="flex-end">
            <TextInput label="Mail server host" value={f.host} onChange={(e) => setF({ ...f, host: e.currentTarget.value })} required maxLength={253} autoComplete="off" />
            <NumberInput label="Port" value={f.port} min={1} max={65535} allowDecimal={false} onChange={(v) => setF({ ...f, port: typeof v === "number" ? v : f.port })} required />
          </Group>
          <Select label="Connection security" value={f.tlsMode} onChange={(v) => v && setF({ ...f, tlsMode: v as TlsMode })} data={modes} allowDeselect={false} />
          <TextInput label="From address" type="email" value={f.fromAddress} onChange={(e) => setF({ ...f, fromAddress: e.currentTarget.value })} required maxLength={320} />
          <Group grow align="flex-start">
            <TextInput label="Username (leave empty if the server needs none)" value={f.username} onChange={(e) => setF({ ...f, username: e.currentTarget.value })} maxLength={320} autoComplete="off" />
            <PasswordInput label={report.hasPassword ? "New password (leave empty to keep the stored one)" : "Password"} value={password}
              onChange={(e) => { setPassword(e.currentTarget.value); if (e.currentTarget.value) setRemove(false); }} autoComplete="new-password"
              description={report.hasPassword ? "A password is stored. It cannot be shown." : "No password stored."} />
          </Group>
          {report.hasPassword && <Checkbox label="Remove the stored password" checked={remove} disabled={password !== ""} onChange={(e) => setRemove(e.currentTarget.checked)} />}
          {needsPassword && <Text size="sm" c="orange" role="status">A username needs a password. Enter one, or clear the username.</Text>}
          <ErrorBox error={save.error} />
          <Group>
            <Button type="submit" loading={save.isPending} disabled={!dirty || needsPassword}>Save settings</Button>
            <Button variant="default" loading={test.isPending} disabled={!report.configured || dirty} onClick={() => test.mutate()}
              title={dirty ? "Save your changes first; the test uses the saved settings" : "Connects and signs in; sends no message"}>Test saved settings</Button>
          </Group>
          <ErrorBox error={test.error} />
          {result && <Alert color={result.success ? "green" : "red"} title={result.success ? "Connection works" : "Connection failed"} role="status" data-testid="smtp-test-result">{result.detail}</Alert>}
        </Stack>
      </form>
    </Card>
  );
}

export function SmtpForm({ scope }: { scope: SmtpScope }) {
  const q = useQuery({ queryKey: ["smtp", scope], queryFn: () => get<SmtpReport>(path(scope)) });
  if (q.isPending) return <Busy />;
  if (q.error) return <ErrorBox error={q.error} />;
  // Re-key on the revision so the form resets to the server's state after every change.
  return <Form key={q.data.revision} scope={scope} report={q.data} />;
}
