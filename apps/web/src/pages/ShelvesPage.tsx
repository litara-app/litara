import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { api, get, op } from "../api/client";
import type { Page as Paged, Shelf, ShelfFilter } from "../api/types";
import { icons, Badge, Busy, Button, Card, EmptyState, ErrorBox, FormColumn, Page, PageHeader, Row, SelectField, Stack, Tabs, TextField, TextLink } from "../ui";

const fields = ["title", "author", "series", "language", "tag", "format", "mediaKind", "finished", "inProgress"].map((v) => ({ value: v, label: v }));
const operators = ["contains", "equals"].map((v) => ({ value: v, label: v }));

function ShelfList({ scope }: { scope: "mine" | "shared" }) {
  const q = useQuery({ queryKey: ["shelves", scope], queryFn: () => get<Paged<Shelf>>(`/shelves?scope=${scope}&size=200`) });
  if (q.isPending) return <Busy />;
  if (q.error) return <ErrorBox error={q.error} />;
  if (q.data.items.length === 0) return <EmptyState title={scope === "mine" ? "You have no shelves yet" : "Nobody has shared a shelf"}>{scope === "mine" ? "Create one on the New shelf tab." : "Shared shelves appear here."}</EmptyState>;
  return (
    <Stack>
      {q.data.items.map((s) => (
        <Card framed key={s.id} data-testid="shelf-card">
          <Row justify="between">
            <TextLink to={`/shelves/${s.id}`}>{s.data?.name ?? "(deleted)"}</TextLink>
            <Row gap="xs">
              <Badge>{s.data?.kind}</Badge>
              <Badge outline tone="neutral">{s.data?.visibility}</Badge>
              <Badge tone="neutral">{s.visibleTitleCount} {s.visibleTitleCount === 1 ? "title" : "titles"}</Badge>
            </Row>
          </Row>
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
      <FormColumn>
        <TextField label="Shelf name" value={name} onValue={setName} required maxLength={256} />
        <Row grow align="end">
          <SelectField label="Visibility" value={vis} onValue={setVis} items={[{ value: "private", label: "Private" }, { value: "shared", label: "Shared (others can read)" }]} />
          <SelectField label="Kind" value={kind} onValue={setKind} items={[{ value: "manual", label: "Manual" }, { value: "smart", label: "Smart" }]} />
        </Row>
        {kind === "smart" && (
          <Row grow align="end">
            <SelectField label="Field" value={field} onValue={setField} items={fields} />
            <SelectField label="Operator" value={operator} onValue={setOperator} items={operators} />
            <TextField label="Value" value={value} onValue={setValue} required />
          </Row>
        )}
        <ErrorBox error={create.error} />
        <Row><Button type="submit" variant="primary" loading={create.isPending} icon={icons.plus}>Create shelf</Button></Row>
      </FormColumn>
    </form>
  );
}

export function ShelvesPage() {
  return (
    <Page>
      <PageHeader title="Shelves" />
      <Tabs label="Shelves" tabs={[
        { value: "mine", label: "Mine", content: <ShelfList scope="mine" /> },
        { value: "shared", label: "Shared with me", content: <ShelfList scope="shared" /> },
        { value: "new", label: "New shelf", content: <CreateShelf /> },
      ]} />
    </Page>
  );
}
