import { Alert, Anchor, Badge, Button, Card, Group, Select, Stack, Text, Title } from "@mantine/core";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link } from "react-router";
import { api, get } from "../api/client";
import { ACTIVE_STATES, codeLabel, stateColor, stateLabel, type Delivery, type IntegrationSettings, type Recipient, type Transports } from "../api/t006";
import { Busy, bytes, ErrorBox } from "../ui/common";

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
    <Card withBorder>
      <Stack gap="xs">
        <Title order={4}>Send by email</Title>
        <Text size="sm" c="dimmed">Sends this file exactly as it is, as one attachment ({bytes(target.sizeBytes)}). It is not converted.</Text>
        {tooBig && <Alert color="red">This file is larger than the {bytes(settings.data.maxAttachmentBytes)} attachment limit.</Alert>}
        {!anyTransport && <Alert color="yellow">No mail transport is available. Set up your own under <Anchor component={Link} to="/settings/email">Settings, Email</Anchor>, or ask an administrator to enable the server one.</Alert>}
        {recipients.data?.items.length === 0 && <Alert color="yellow">You have no saved recipients. Add one under <Anchor component={Link} to="/settings/email">Settings, Email</Anchor>.</Alert>}
        <Group grow align="flex-end">
          <Select label="Recipient" placeholder="Choose a recipient" value={recipientId} onChange={setRecipientId}
            data={(recipients.data?.items ?? []).map((r) => ({ value: r.id, label: `${r.data?.name} <${r.data?.address}>` }))} />
          <Select label="Send through" placeholder="Choose a mail transport" value={transport} onChange={(v) => setTransport(v as "server" | "personal" | null)}
            data={[
              { value: "server", label: "Server mail", disabled: !transports.data?.server.available },
              { value: "personal", label: "My own mail account", disabled: !transports.data?.personal.available },
            ]} />
        </Group>
        <ErrorBox error={send.error} />
        <Group>
          <Button disabled={!ready} loading={send.isPending} onClick={() => send.mutate()}>Send file</Button>
        </Group>
        {sent && status.data && (
          <Alert color={stateColor(status.data.state)} data-testid="send-status" title={<Group gap="xs"><span>Request for {status.data.recipientName}</span><Badge color={stateColor(status.data.state)} variant="light">{stateLabel(status.data.state)}</Badge></Group>}>
            {status.data.code && status.data.state !== "queued" ? codeLabel(status.data.code) : "Waiting for the mail server."}
            {" "}<Anchor component={Link} to="/settings/email">See all deliveries</Anchor>
          </Alert>
        )}
      </Stack>
    </Card>
  );
}
