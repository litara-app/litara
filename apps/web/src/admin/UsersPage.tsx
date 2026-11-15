import { Badge, Button, Card, Checkbox, Group, PasswordInput, Select, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api, get } from "../api/client";
import type { Library, Page, User } from "../api/types";
import { ScrollRegion } from "../ui/ScrollRegion";
import { Busy, ErrorBox } from "../ui/common";

function CreateUser() {
  const qc = useQueryClient();
  const [f, setF] = useState({ username: "", displayName: "", password: "", isAdmin: false });
  const create = useMutation({
    mutationFn: () => api<User>("POST", "/admin/users", f),
    onSuccess: () => { setF({ username: "", displayName: "", password: "", isAdmin: false }); qc.invalidateQueries({ queryKey: ["admin", "users"] }); },
  });
  const submit = (e: FormEvent) => { e.preventDefault(); create.mutate(); };
  return (
    <Card withBorder>
      <form onSubmit={submit}>
        <Stack gap="xs">
          <Title order={4}>New user</Title>
          <Group grow align="flex-end">
            <TextInput label="Username" value={f.username} onChange={(e) => setF({ ...f, username: e.currentTarget.value })} required maxLength={128} />
            <TextInput label="Display name" value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.currentTarget.value })} maxLength={256} />
            <PasswordInput label="Password (12+ characters)" value={f.password} onChange={(e) => setF({ ...f, password: e.currentTarget.value })} required minLength={12} autoComplete="new-password" />
          </Group>
          <Checkbox label="Administrator" checked={f.isAdmin} onChange={(e) => setF({ ...f, isAdmin: e.currentTarget.checked })} />
          <ErrorBox error={create.error} />
          <Group><Button type="submit" loading={create.isPending}>Create user</Button></Group>
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
    <Stack gap={4}>
      <Group gap="xs">
        <Select size="xs" placeholder="Library" value={lib} onChange={(v) => { setLib(v); setDone(""); }} data={libraries.map((l) => ({ value: l.id, label: l.name }))} aria-label={`Library for ${user.username}`} />
        <Button size="compact-xs" disabled={!lib} loading={m.isPending} onClick={() => m.mutate({ grant: true })}>Grant</Button>
        <Button size="compact-xs" variant="default" disabled={!lib} loading={m.isPending} onClick={() => m.mutate({ grant: false })}>Revoke</Button>
      </Group>
      {done && <Text size="xs" c="green">{done}</Text>}
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
      <Text size="sm" c="dimmed">
        Grants are listed here only for libraries you can see. The server does not list another account&apos;s existing grants, so choose a library and grant or revoke.
      </Text>
      <ScrollRegion label="Users table">
        <Table verticalSpacing="xs" data-testid="users-table">
          <Table.Thead><Table.Tr><Table.Th>User</Table.Th><Table.Th>Status</Table.Th><Table.Th>Library access</Table.Th><Table.Th /></Table.Tr></Table.Thead>
          <Table.Tbody>
            {users.data?.items.map((u) => (
              <Table.Tr key={u.id}>
                <Table.Td><Text fw={500}>{u.displayName || u.username}</Text><Text size="xs" c="dimmed">{u.username}</Text></Table.Td>
                <Table.Td><Group gap={4}>{u.isAdmin && <Badge>admin</Badge>}<Badge color={u.active ? "green" : "gray"} variant="light">{u.active ? "active" : "disabled"}</Badge></Group></Table.Td>
                <Table.Td><Grants user={u} libraries={libs.data?.items ?? []} /></Table.Td>
                <Table.Td>
                  <Group gap="xs" justify="flex-end">
                    <Button size="compact-xs" variant="default" onClick={() => patch.mutate({ id: u.id, body: { active: !u.active } })}>{u.active ? "Disable" : "Enable"}</Button>
                    <Button size="compact-xs" variant="default" onClick={() => patch.mutate({ id: u.id, body: { isAdmin: !u.isAdmin } })}>{u.isAdmin ? "Remove admin" : "Make admin"}</Button>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollRegion>
    </Stack>
  );
}
