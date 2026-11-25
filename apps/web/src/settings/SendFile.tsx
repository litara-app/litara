import { useMutation, useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { api, get } from "../api/client";
import { ACTIVE_STATES, codeLabel, stateLabel, stateTone, type Delivery, type IntegrationSettings, type Recipient, type Transports } from "../api/t006";
import { icons, Alert, Badge, Busy, bytes, Button, Card, ErrorBox, Heading, Row, SelectField, Stack, Text, TextLink } from "../ui";

export interface SendTarget { fileId: string; contentVersion: string; sizeBytes: number | null; label: string }

/**
 * Sends one exact original file (never a bundle or a conversion) to one saved recipient
 * through one explicitly chosen transport. Nothing is preselected and nothing falls back.
 */
export function SendFile({ target }: { target: SendTarget }) {
  const settings = useQuery({ queryKey: ["integrations"], queryFn: () => get<IntegrationSettings>("/integrations/settings") });
  const recipients = useQuery({ queryKey: ["recipients"], queryFn: () => get<{ items: Recipient[] }>("/delivery/recipients") });
  const transports = useQuery({ queryKey: ["transports"], queryFn: () => get<Transports>("/delivery/transports") });
  const [recipientId, setRecipientId] = useState<string | null>(null);
  const [transport, setTransport] = useState<"server" | "personal" | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  // An identical retry (for example after a lost response) reuses its operation ID so the server returns the same delivery.
  const opRef = useRef<{ key: string; id: string } | null>(null);

  const recipient = recipients.data?.items.find((r) => r.id === recipientId);
  const tr = transport ? transports.data?.[transport] : undefined;
  const tooBig = target.sizeBytes !== null && settings.data ? target.sizeBytes > settings.data.maxAttachmentBytes : false;

  const send = useMutation({
    mutationFn: () => {
      const body = { fileId: target.fileId, contentVersion: target.contentVersion, recipientId: recipient!.id, recipientRevision: recipient!.revision,
        transport: transport!, transportRevision: tr!.revision, resendOf: null, acknowledgePossibleDuplicate: false };
      const key = JSON.stringify(body);
      if (opRef.current?.key !== key) opRef.current = { key, id: crypto.randomUUID() };
      return api<Delivery>("POST", "/deliveries", { operationId: opRef.current.id, ...body });
    },
    meta: { success: "Sending to the device has started" },
    onSuccess: (d) => { opRef.current = null; setSent(d.id); },
  });
  const status = useQuery({
    queryKey: ["delivery", sent], enabled: !!sent, queryFn: () => get<Delivery>(`/deliveries/${sent}`),
    refetchInterval: (q) => (q.state.data && !ACTIVE_STATES.includes(q.state.data.state) ? false : 2000),
  });

  if (settings.isPending || recipients.isPending || transports.isPending) return <Busy />;
  if (!settings.data?.emailEnabled) return null;
  const anyTransport = transports.data?.server.available || transports.data?.personal.available;
  const ready = !!recipient && !!tr?.available && !tooBig;
  return (
    <Card framed>
      <Stack gap="sm">
        <Heading level={2}>Send by email</Heading>
        <Text size="sm" tone="dim">Sends this file exactly as it is, as one attachment ({bytes(target.sizeBytes)}). It is not converted.</Text>
        {tooBig && <Alert tone="danger">This file is larger than the {bytes(settings.data.maxAttachmentBytes)} attachment limit.</Alert>}
        {!anyTransport && <Alert tone="warning">No mail transport is available. Set up your own under <TextLink to="/settings/email">Settings, Email</TextLink>, or ask an administrator to enable the server one.</Alert>}
        {recipients.data?.items.length === 0 && <Alert tone="warning">You have no saved recipients. Add one under <TextLink to="/settings/email">Settings, Email</TextLink>.</Alert>}
        <Row grow align="end">
          <SelectField label="Recipient" placeholder="Choose a recipient" value={recipientId} onValue={setRecipientId}
            items={(recipients.data?.items ?? []).map((r) => ({ value: r.id, label: `${r.data?.name} <${r.data?.address}>` }))} />
          <SelectField label="Send through" placeholder="Choose a mail transport" value={transport} onValue={(v) => setTransport(v as "server" | "personal" | null)}
            items={[
              { value: "server", label: "Server mail", disabled: !transports.data?.server.available },
              { value: "personal", label: "My own mail account", disabled: !transports.data?.personal.available },
            ]} />
        </Row>
        <ErrorBox error={send.error} />
        <Row>
          <Button variant="primary" disabled={!ready} loading={send.isPending} onClick={() => send.mutate()} icon={icons.send}>Send file</Button>
        </Row>
        {sent && status.data && (
          <Alert tone={stateTone(status.data.state)} data-testid="send-status"
            title={<Row><span>Request for {status.data.recipientName}</span><Badge tone={stateTone(status.data.state)}>{stateLabel(status.data.state)}</Badge></Row>}>
            {status.data.code && status.data.state !== "queued" ? codeLabel(status.data.code) : "Waiting for the mail server."}
            {" "}<TextLink to="/settings/email">See all deliveries</TextLink>
          </Alert>
        )}
      </Stack>
    </Card>
  );
}
