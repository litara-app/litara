import { Alert, Badge, Button, Card, Checkbox, Group, Modal, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api, get } from "../api/client";
import { ACTIVE_STATES, codeLabel, stateColor, stateLabel, type Delivery, type Recipient, type Transports } from "../api/t006";
import type { Page } from "../api/types";
import { ScrollRegion } from "../ui/ScrollRegion";
import { Busy, ErrorBox } from "../ui/common";
import { SmtpForm } from "./SmtpForm";

function Recipients() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["recipients"], queryFn: () => get<{ items: Recipient[] }>("/delivery/recipients") });
  const [form, setForm] = useState({ name: "", address: "" });
  const [editing, setEditing] = useState<Recipient | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const done = () => qc.invalidateQueries({ queryKey: ["recipients"] });
  const save = useMutation({
    mutationFn: () => {
      const id = editing?.id ?? crypto.randomUUID();
      return api<Recipient>("PUT", `/delivery/recipients/${id}`, {
        operationId: crypto.randomUUID(), baseRevision: editing?.revision ?? "0", data: { name: form.name.trim(), address: form.address.trim() },
      });
    },
    onSuccess: () => { setForm({ name: "", address: "" }); setEditing(null); },
    onSettled: done,
  });
  const del = useMutation({
    mutationFn: (r: Recipient) => api<Recipient>("DELETE", `/delivery/recipients/${r.id}`, { operationId: crypto.randomUUID(), baseRevision: r.revision }),
    onSettled: () => { setConfirm(null); done(); },
  });
  const submit = (e: FormEvent) => { e.preventDefault(); save.mutate(); };
  return (
    <Card withBorder>
      <Stack gap="xs">
        <Title order={4}>Saved recipients</Title>
        <Text size="sm" c="dimmed">Only you can see these. A file is only ever sent to a recipient you pick for that send. Use addresses you are allowed to send to.</Text>
        <form onSubmit={submit} aria-label={editing ? "Edit recipient" : "Add recipient"}>
          <Group grow align="flex-end">
            <TextInput label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.currentTarget.value })} required maxLength={128} />
            <TextInput label="Email address" type="email" value={form.address} onChange={(e) => setForm({ ...form, address: e.currentTarget.value })} required maxLength={320} />
            <Group gap="xs" wrap="nowrap">
              <Button type="submit" loading={save.isPending}>{editing ? "Save recipient" : "Add recipient"}</Button>
              {editing && <Button variant="default" onClick={() => { setEditing(null); setForm({ name: "", address: "" }); }}>Cancel</Button>}
            </Group>
          </Group>
        </form>
        <ErrorBox error={save.error ?? del.error ?? list.error} />
        {list.isPending ? <Busy /> : (
          <ScrollRegion label="Recipients table">
            <Table verticalSpacing="xs" data-testid="recipients-table">
              <Table.Thead><Table.Tr><Table.Th>Name</Table.Th><Table.Th>Address</Table.Th><Table.Th /></Table.Tr></Table.Thead>
              <Table.Tbody>
                {list.data?.items.length === 0 && <Table.Tr><Table.Td colSpan={3}><Text size="sm" c="dimmed">No saved recipients.</Text></Table.Td></Table.Tr>}
                {list.data?.items.map((r) => (
                  <Table.Tr key={r.id}>
                    <Table.Td>{r.data?.name}</Table.Td><Table.Td>{r.data?.address}</Table.Td>
                    <Table.Td>
                      <Group gap="xs" justify="flex-end">
                        <Button size="compact-xs" variant="default" aria-label={`Edit ${r.data?.name}`} onClick={() => { setEditing(r); setForm({ name: r.data?.name ?? "", address: r.data?.address ?? "" }); }}>Edit</Button>
                        {confirm === r.id
                          ? <><Button size="compact-xs" color="red" loading={del.isPending} onClick={() => del.mutate(r)}>Confirm delete</Button><Button size="compact-xs" variant="default" onClick={() => setConfirm(null)}>Keep</Button></>
                          : <Button size="compact-xs" variant="default" aria-label={`Delete ${r.data?.name}`} onClick={() => setConfirm(r.id)}>Delete</Button>}
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollRegion>
        )}
      </Stack>
    </Card>
  );
}

function ResendDialog({ delivery, onClose }: { delivery: Delivery; onClose: () => void }) {
  const qc = useQueryClient();
  const recipients = useQuery({ queryKey: ["recipients"], queryFn: () => get<{ items: Recipient[] }>("/delivery/recipients") });
  const transports = useQuery({ queryKey: ["transports"], queryFn: () => get<Transports>("/delivery/transports") });
  const [ack, setAck] = useState(false);
  const recipient = recipients.data?.items.find((r) => r.id === delivery.recipientId);
  const tr = transports.data?.[delivery.transport];
  const ready = !!recipient && !!tr?.available;
  const send = useMutation({
    mutationFn: () => api<Delivery>("POST", "/deliveries", {
      operationId: crypto.randomUUID(), fileId: delivery.fileId, contentVersion: delivery.contentVersion, recipientId: delivery.recipientId,
      recipientRevision: recipient!.revision, transport: delivery.transport, transportRevision: tr!.revision, resendOf: delivery.id, acknowledgePossibleDuplicate: true,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["deliveries"] }); onClose(); },
  });
  const risky = delivery.state === "accepted" || delivery.state === "outcome_unknown";
  return (
    <Modal opened onClose={onClose} title="Send this file again?">
      <Stack>
        <Alert color={risky ? "orange" : "blue"}>
          {delivery.state === "outcome_unknown" && "The first attempt may already have reached the recipient. "}
          {delivery.state === "accepted" && "The mail server already accepted the first message. "}
          Sending again creates a new request and may deliver a duplicate. The earlier record is kept unchanged.
        </Alert>
        <Text size="sm">To {delivery.recipientName} ({delivery.recipientAddress}) using the {delivery.transport} mail transport, with the current settings.</Text>
        {!ready && !recipients.isPending && !transports.isPending && <Alert color="red">That recipient or mail transport is no longer available, so this cannot be resent as it was.</Alert>}
        <Checkbox label="I understand this may deliver a duplicate" checked={ack} onChange={(e) => setAck(e.currentTarget.checked)} />
        <ErrorBox error={send.error} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Cancel</Button>
          <Button disabled={!ack || !ready} loading={send.isPending} onClick={() => send.mutate()}>Send again</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

export function DeliveryHistory() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["deliveries"], queryFn: () => get<Page<Delivery>>("/deliveries?size=50"),
    // Poll only while something can still change on its own.
    refetchInterval: (query) => (query.state.data?.items.some((d) => ACTIVE_STATES.includes(d.state)) ? 3000 : false),
  });
  const [resend, setResend] = useState<Delivery | null>(null);
  const cancel = useMutation({
    mutationFn: (d: Delivery) => api<Delivery>("POST", `/deliveries/${d.id}/cancel`, { operationId: crypto.randomUUID(), baseRevision: d.revision }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["deliveries"] }),
  });
  return (
    <Card withBorder>
      <Stack gap="xs">
        <Title order={4}>Delivery history</Title>
        <Text size="sm" c="dimmed">&ldquo;Accepted&rdquo; means the next mail server took responsibility for the message. It does not mean the message reached an inbox.</Text>
        <ErrorBox error={q.error ?? cancel.error} />
        {q.isPending ? <Busy /> : (
          <ScrollRegion label="Deliveries table">
            <Table verticalSpacing="xs" data-testid="deliveries-table">
              <Table.Thead><Table.Tr><Table.Th>Requested</Table.Th><Table.Th>To</Table.Th><Table.Th>Status</Table.Th><Table.Th /></Table.Tr></Table.Thead>
              <Table.Tbody>
                {q.data?.items.length === 0 && <Table.Tr><Table.Td colSpan={4}><Text size="sm" c="dimmed">Nothing has been sent yet. Use &ldquo;Send by email&rdquo; on a book&rsquo;s page.</Text></Table.Td></Table.Tr>}
                {q.data?.items.map((d) => (
                  <Table.Tr key={d.id} data-testid="delivery-row">
                    <Table.Td>{new Date(d.createdAt).toLocaleString()}{d.resendOf && <Text size="xs" c="dimmed">Resend</Text>}</Table.Td>
                    <Table.Td>{d.recipientName}<Text size="xs" c="dimmed">{d.recipientAddress} · {d.transport} transport</Text></Table.Td>
                    <Table.Td>
                      <Badge color={stateColor(d.state)} variant="light">{stateLabel(d.state)}</Badge>
                      {d.attempts > 1 && <Text size="xs" c="dimmed">{d.attempts} attempts</Text>}
                      {d.code && d.state !== "queued" && <Text size="xs" c="dimmed">{codeLabel(d.code)}</Text>}
                    </Table.Td>
                    <Table.Td>
                      <Group gap="xs" justify="flex-end">
                        {(d.state === "queued" || d.state === "retry_wait") && <Button size="compact-xs" variant="default" loading={cancel.isPending} onClick={() => cancel.mutate(d)}>Cancel</Button>}
                        {(d.state === "failed" || d.state === "outcome_unknown" || d.state === "accepted") && <Button size="compact-xs" variant="default" onClick={() => setResend(d)}>Send again…</Button>}
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollRegion>
        )}
        {resend && <ResendDialog delivery={resend} onClose={() => setResend(null)} />}
      </Stack>
    </Card>
  );
}

export function EmailPage() {
  return (
    <Stack>
      <SmtpForm scope="personal" />
      <Recipients />
      <DeliveryHistory />
    </Stack>
  );
}
