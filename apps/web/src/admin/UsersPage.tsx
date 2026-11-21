import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api, get } from "../api/client";
import type { Library, Page, User } from "../api/types";
import { icons, Badge, Busy, Button, Card, CheckboxField, CompactSelect, ErrorBox, Heading, PasswordField, Row, Stack, Table, TBody, TD, Text, TextField, TH, THead, TR } from "../ui";

function CreateUser() {
  const qc = useQueryClient();
  const [f, setF] = useState({ username: "", displayName: "", password: "", isAdmin: false });
  const create = useMutation({
    mutationFn: () => api<User>("POST", "/admin/users", f),
    onSuccess: () => { setF({ username: "", displayName: "", password: "", isAdmin: false }); qc.invalidateQueries({ queryKey: ["admin", "users"] }); },
  });
  const submit = (e: FormEvent) => { e.preventDefault(); create.mutate(); };
  return (
    <Card>
      <form onSubmit={submit}>
        <Stack gap="sm">
          <Heading level={2}>New user</Heading>
          <Row grow align="end">
            <TextField label="Username" value={f.username} onValue={(v) => setF({ ...f, username: v })} required maxLength={128} />
            <TextField label="Display name" value={f.displayName} onValue={(v) => setF({ ...f, displayName: v })} maxLength={256} />
            <PasswordField label="Password (12+ characters)" value={f.password} onValue={(v) => setF({ ...f, password: v })} required minLength={12} autoComplete="new-password" />
          </Row>
          <CheckboxField label="Administrator" checked={f.isAdmin} onChange={(v) => setF({ ...f, isAdmin: v })} />
          <ErrorBox error={create.error} />
          <Row><Button type="submit" variant="primary" loading={create.isPending} icon={icons.plus}>Create user</Button></Row>
        </Stack>
      </form>
    </Card>
  );
}

function Grants({ user, libraries }: { user: User; libraries: Library[] }) {
  const [lib, setLib] = useState<string | null>(null);
  const [done, setDone] = useState("");
  const m = useMutation({
    mutationFn: ({ grant }: { grant: boolean }) => api<void>(grant ? "PUT" : "DELETE", `/admin/users/${user.id}/libraries/${lib}`),
    onSuccess: (_d, v) => setDone(v.grant ? "Access granted." : "Access removed."),
  });
  return (
    <Stack gap="xs">
      <Row>
        <CompactSelect label={`Library for ${user.username}`} placeholder="Library" value={lib} onValue={(v) => { setLib(v); setDone(""); }} items={libraries.map((l) => ({ value: l.id, label: l.name }))} />
        <Button size="sm" variant="primary" disabled={!lib} loading={m.isPending} onClick={() => m.mutate({ grant: true })} icon={icons.plus}>Grant</Button>
        <Button size="sm" disabled={!lib} loading={m.isPending} onClick={() => m.mutate({ grant: false })} icon={icons.trash}>Revoke</Button>
      </Row>
      {done && <Text size="xs" tone="success">{done}</Text>}
      <ErrorBox error={m.error} />
    </Stack>
  );
}

export function UsersPage() {
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ["admin", "users"], queryFn: () => get<Page<User>>("/admin/users?size=200") });
  const libs = useQuery({ queryKey: ["libraries"], queryFn: () => get<Page<Library>>("/libraries?size=200") });
  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<Pick<User, "isAdmin" | "active" | "displayName">> }) => api<User>("PATCH", `/admin/users/${id}`, body),
    onSettled: () => qc.invalidateQueries({ queryKey: ["admin", "users"] }),
  });
  if (users.isPending) return <Busy />;
  return (
    <Stack>
      <CreateUser />
      <ErrorBox error={users.error ?? patch.error} />
      <Text size="sm" tone="dim">
        Grants are listed here only for libraries you can see. The server does not list another account&apos;s existing grants, so choose a library and grant or revoke.
      </Text>
      <Table label="Users table" data-testid="users-table">
        <THead><TR><TH>User</TH><TH>Status</TH><TH>Library access</TH><TH><span className="lt-sr">Actions</span></TH></TR></THead>
        <TBody>
          {users.data?.items.map((u) => (
            <TR key={u.id}>
              <TD><Text strong>{u.displayName || u.username}</Text><Text size="xs" tone="dim">{u.username}</Text></TD>
              <TD><Row gap="xs">{u.isAdmin && <Badge>admin</Badge>}<Badge tone={u.active ? "success" : "neutral"}>{u.active ? "active" : "disabled"}</Badge></Row></TD>
              <TD><Grants user={u} libraries={libs.data?.items ?? []} /></TD>
              <TD>
                <Row justify="end">
                  <Button size="sm" onClick={() => patch.mutate({ id: u.id, body: { active: !u.active } })} icon={icons.close}>{u.active ? "Disable" : "Enable"}</Button>
                  <Button size="sm" onClick={() => patch.mutate({ id: u.id, body: { isAdmin: !u.isAdmin } })} icon={icons.admin}>{u.isAdmin ? "Remove admin" : "Make admin"}</Button>
                </Row>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </Stack>
  );
}
