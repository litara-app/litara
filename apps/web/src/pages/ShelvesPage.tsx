import { Badge, Button, Card, Group, Select, Stack, Tabs, Text, TextInput, Title } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { api, get, op } from "../api/client";
import type { Page, Shelf, ShelfFilter } from "../api/types";
import { Busy, ErrorBox } from "../ui/common";

const fields = ["title", "author", "series", "language", "tag", "format", "mediaKind", "finished", "inProgress"];

function ShelfList({ scope }: { scope: "mine" | "shared" }) {
  const q = useQuery({ queryKey: ["shelves", scope], queryFn: () => get<Page<Shelf>>(`/shelves?scope=${scope}&size=200`) });
  if (q.isPending) return <Busy />;
  if (q.error) return <ErrorBox error={q.error} />;
  if (q.data.items.length === 0) return <Text c="dimmed">{scope === "mine" ? "You have no shelves yet." : "Nobody has shared a shelf."}</Text>;
  return (
    <Stack>
      {q.data.items.map((s) => (
        <Card key={s.id} withBorder data-testid="shelf-card">
          <Group justify="space-between">
            <Text fw={600} component={Link} to={`/shelves/${s.id}`}>{s.data?.name ?? "(deleted)"}</Text>
            <Group gap="xs">
              <Badge variant="light">{s.data?.kind}</Badge>
              <Badge variant="outline">{s.data?.visibility}</Badge>
              <Badge color="gray">{s.visibleTitleCount} {s.visibleTitleCount === 1 ? "title" : "titles"}</Badge>
            </Group>
          </Group>
        </Card>
      ))}
    </Stack>
  );
}

function CreateShelf() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [vis, setVis] = useState<string | null>("private");
  const [kind, setKind] = useState<string | null>("manual");
  const [field, setField] = useState<string | null>("title");
  const [operator, setOperator] = useState<string | null>("contains");
  const [value, setValue] = useState("");
  const create = useMutation({
    mutationFn: () => {
      const id = crypto.randomUUID();
      const filter: ShelfFilter | null = kind === "smart" ? { kind: "predicate", field: field!, operator: operator as "equals" | "contains", value } : null;
      return api<Shelf>("PUT", `/shelves/${id}`, { ...op("0"), data: { name, visibility: vis, kind, filter } });
    },
    onSuccess: (s) => { qc.invalidateQueries({ queryKey: ["shelves"] }); nav(`/shelves/${s.id}`); },
  });
  const submit = (e: FormEvent) => { e.preventDefault(); create.mutate(); };
  return (
    <form onSubmit={submit}>
      <Stack maw={480}>
        <TextInput label="Shelf name" value={name} onChange={(e) => setName(e.currentTarget.value)} required maxLength={256} />
        <Group grow>
          <Select label="Visibility" allowDeselect={false} value={vis} onChange={setVis} data={[{ value: "private", label: "Private" }, { value: "shared", label: "Shared (others can read)" }]} />
          <Select label="Kind" allowDeselect={false} value={kind} onChange={setKind} data={[{ value: "manual", label: "Manual" }, { value: "smart", label: "Smart" }]} />
        </Group>
        {kind === "smart" && (
          <Group grow align="flex-end">
            <Select label="Field" allowDeselect={false} value={field} onChange={setField} data={fields} />
            <Select label="Operator" allowDeselect={false} value={operator} onChange={setOperator} data={["contains", "equals"]} />
            <TextInput label="Value" value={value} onChange={(e) => setValue(e.currentTarget.value)} required />
          </Group>
        )}
        <ErrorBox error={create.error} />
        <Button type="submit" loading={create.isPending}>Create shelf</Button>
      </Stack>
    </form>
  );
}

export function ShelvesPage() {
  return (
    <Stack>
      <Title order={2}>Shelves</Title>
      <Tabs defaultValue="mine">
        <Tabs.List>
          <Tabs.Tab value="mine">Mine</Tabs.Tab>
          <Tabs.Tab value="shared">Shared with me</Tabs.Tab>
          <Tabs.Tab value="new">New shelf</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="mine" pt="md"><ShelfList scope="mine" /></Tabs.Panel>
        <Tabs.Panel value="shared" pt="md"><ShelfList scope="shared" /></Tabs.Panel>
        <Tabs.Panel value="new" pt="md"><CreateShelf /></Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
