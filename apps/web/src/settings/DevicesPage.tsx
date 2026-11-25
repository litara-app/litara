import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";
import { api, get } from "../api/client";
import type { DeviceSession } from "../api/types";
import { useAuth } from "../auth/session";
import { icons, Badge, Busy, Button, ErrorBox, Row, Stack, Table, TBody, TD, Text, TH, THead, TR } from "../ui";

const when = (iso: string) => new Date(iso).toLocaleString();

/**
 * The places this account is signed in, each of which can be signed out on its own (ADR-0033). Signing out another
 * device takes effect on its next request; the session you are using is ended with Sign out instead.
 */
export function DevicesPage() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const { logout } = useAuth();
  const list = useQuery({ queryKey: ["sessions"], queryFn: () => get<{ items: DeviceSession[] }>("/sessions") });
  const [confirm, setConfirm] = useState<string | null>(null);
  const revoke = useMutation({
    mutationFn: (id: string) => api<void>("DELETE", `/sessions/${id}`),
    meta: { success: () => "Device signed out" },
    onSettled: () => { setConfirm(null); void qc.invalidateQueries({ queryKey: ["sessions"] }); },
  });

  if (list.isPending) return <Busy />;
  const items = [...(list.data?.items ?? [])].sort((a, b) => Number(b.current) - Number(a.current) || b.lastUsedAt.localeCompare(a.lastUsedAt));
  return (
    <Stack>
      <Text size="sm" tone="dim">
        These are the browsers and apps signed in to your account. Sign out any you do not recognise or no longer use; it stops
        working on its next request. App credentials for OPDS and KOReader are managed separately.
      </Text>
      <ErrorBox error={list.error ?? revoke.error} />
      <Table label="Signed-in devices" data-testid="devices-table">
        <THead><TR><TH>Device</TH><TH>Kind</TH><TH>Signed in</TH><TH>Last used</TH><TH>Expires</TH><TH><span className="lt-sr">Actions</span></TH></TR></THead>
        <TBody>
          {items.length === 0 && <TR><TD colSpan={6}><Text size="sm" tone="dim">No signed-in devices.</Text></TD></TR>}
          {items.map((s) => (
            <TR key={s.id} data-testid={`device-${s.id}`}>
              <TD><Row gap="xs">{s.deviceName || "Unnamed device"}{s.current && <Badge tone="info">This browser</Badge>}</Row></TD>
              <TD>{s.client === "web" ? "Browser" : "App"}</TD>
              <TD>{when(s.createdAt)}</TD>
              <TD>{when(s.lastUsedAt)}</TD>
              <TD>{when(s.idleExpiresAt < s.absoluteExpiresAt ? s.idleExpiresAt : s.absoluteExpiresAt)}</TD>
              <TD>
                <Row justify="end">
                  {s.current ? (
                    <Button size="sm" onClick={async () => { await logout(); nav("/login"); }} icon={icons.close}>Sign out</Button>
                  ) : confirm === s.id ? (
                    <>
                      <Button size="sm" variant="danger" solid loading={revoke.isPending} onClick={() => revoke.mutate(s.id)} icon={icons.trash}>Confirm sign out</Button>
                      <Button size="sm" onClick={() => setConfirm(null)} icon={icons.close}>Keep</Button>
                    </>
                  ) : <Button size="sm" aria-label={`Sign out ${s.deviceName || "unnamed device"}`} onClick={() => setConfirm(s.id)} icon={icons.trash}>Sign out</Button>}
                </Row>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
      <Text size="xs" tone="dim">A device that is not used for a while is signed out by itself when it expires.</Text>
    </Stack>
  );
}
