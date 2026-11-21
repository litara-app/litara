import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api, get } from "../api/client";
import { ACTIVE_STATES, codeLabel, stateLabel, stateTone, type Delivery, type Recipient, type Transports } from "../api/t006";
import type { Page } from "../api/types";
import { icons, Alert, Badge, Busy, Button, Card, CheckboxField, ErrorBox, Heading, Modal, Row, Stack, Table, TBody, TD, Text, TextField, TH, THead, TR } from "../ui";
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
    <Card framed>
      <Stack gap="sm">
        <Heading level={2}>Saved recipients</Heading>
        <Text size="sm" tone="dim">Only you can see these. A file is only ever sent to a recipient you pick for that send. Use addresses you are allowed to send to.</Text>
        <form onSubmit={submit} aria-label={editing ? "Edit recipient" : "Add recipient"}>
          <Row grow align="end">
            <TextField label="Name" value={form.name} onValue={(v) => setForm({ ...form, name: v })} required maxLength={128} />
            <TextField label="Email address" type="email" value={form.address} onValue={(v) => setForm({ ...form, address: v })} required maxLength={320} />
            <Row>
              <Button type="submit" variant="primary" loading={save.isPending} icon={icons.save}>{editing ? "Save recipient" : "Add recipient"}</Button>
              {editing && <Button onClick={() => { setEditing(null); setForm({ name: "", address: "" }); }} icon={icons.close}>Cancel</Button>}
            </Row>
          </Row>
        </form>
        <ErrorBox error={save.error ?? del.error ?? list.error} />
        {list.isPending ? <Busy /> : (
          <Table label="Recipients table" data-testid="recipients-table">
            <THead><TR><TH>Name</TH><TH>Address</TH><TH><span className="lt-sr">Actions</span></TH></TR></THead>
            <TBody>
              {list.data?.items.length === 0 && <TR><TD colSpan={3}><Text size="sm" tone="dim">No saved recipients.</Text></TD></TR>}
              {list.data?.items.map((r) => (
                <TR key={r.id}>
                  <TD>{r.data?.name}</TD><TD>{r.data?.address}</TD>
                  <TD>
                    <Row justify="end">
                      <Button size="sm" aria-label={`Edit ${r.data?.name}`} onClick={() => { setEditing(r); setForm({ name: r.data?.name ?? "", address: r.data?.address ?? "" }); }} icon={icons.pencil}>Edit</Button>
                      {confirm === r.id
                        ? <><Button size="sm" variant="danger" solid loading={del.isPending} onClick={() => del.mutate(r)} icon={icons.trash}>Confirm delete</Button><Button size="sm" onClick={() => setConfirm(null)} icon={icons.close}>Keep</Button></>
                        : <Button size="sm" aria-label={`Delete ${r.data?.name}`} onClick={() => setConfirm(r.id)} icon={icons.trash}>Delete</Button>}
                    </Row>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
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
    <Modal open onClose={onClose} title="Send this file again?"
      actions={<><Button onClick={onClose} icon={icons.close}>Cancel</Button><Button variant="primary" disabled={!ack || !ready} loading={send.isPending} onClick={() => send.mutate()} icon={icons.send}>Send again</Button></>}>
      <Stack>
        <Alert tone={risky ? "warning" : "info"}>
          {delivery.state === "outcome_unknown" && "The first attempt may already have reached the recipient. "}
          {delivery.state === "accepted" && "The mail server already accepted the first message. "}
          Sending again creates a new request and may deliver a duplicate. The earlier record is kept unchanged.
        </Alert>
        <Text size="sm">To {delivery.recipientName} ({delivery.recipientAddress}) using the {delivery.transport} mail transport, with the current settings.</Text>
        {!ready && !recipients.isPending && !transports.isPending && <Alert tone="danger">That recipient or mail transport is no longer available, so this cannot be resent as it was.</Alert>}
        <CheckboxField label="I understand this may deliver a duplicate" checked={ack} onChange={setAck} />
        <ErrorBox error={send.error} />
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
    <Card framed>
      <Stack gap="sm">
        <Heading level={2}>Delivery history</Heading>
        <Text size="sm" tone="dim">&ldquo;Accepted&rdquo; means the next mail server took responsibility for the message. It does not mean the message reached an inbox.</Text>
        <ErrorBox error={q.error ?? cancel.error} />
        {q.isPending ? <Busy /> : (
          <Table label="Deliveries table" data-testid="deliveries-table">
            <THead><TR><TH>Requested</TH><TH>To</TH><TH>Status</TH><TH><span className="lt-sr">Actions</span></TH></TR></THead>
            <TBody>
              {q.data?.items.length === 0 && <TR><TD colSpan={4}><Text size="sm" tone="dim">Nothing has been sent yet. Use &ldquo;Send by email&rdquo; on a book&rsquo;s page.</Text></TD></TR>}
              {q.data?.items.map((d) => (
                <TR key={d.id} data-testid="delivery-row">
                  <TD>{new Date(d.createdAt).toLocaleString()}{d.resendOf && <Text size="xs" tone="dim">Resend</Text>}</TD>
                  <TD>{d.recipientName}<Text size="xs" tone="dim">{d.recipientAddress} · {d.transport} transport</Text></TD>
                  <TD>
                    <Badge tone={stateTone(d.state)}>{stateLabel(d.state)}</Badge>
                    {d.attempts > 1 && <Text size="xs" tone="dim">{d.attempts} attempts</Text>}
                    {d.code && d.state !== "queued" && <Text size="xs" tone="dim">{codeLabel(d.code)}</Text>}
                  </TD>
                  <TD>
                    <Row justify="end">
                      {(d.state === "queued" || d.state === "retry_wait") && <Button size="sm" loading={cancel.isPending} onClick={() => cancel.mutate(d)} icon={icons.close}>Cancel</Button>}
                      {(d.state === "failed" || d.state === "outcome_unknown" || d.state === "accepted") && <Button size="sm" onClick={() => setResend(d)} icon={icons.send}>Send again…</Button>}
                    </Row>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
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
