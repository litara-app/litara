import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { LibraryDetail } from "../api/types";
import { Card, Heading, Stack, SwitchField, Text } from "../ui";

const PROVIDERS: { value: string; label: string; note: string }[] = [
  { value: "open_library", label: "Open Library", note: "Books by title, author and ISBN. No account needed." },
  { value: "google_books", label: "Google Books", note: "Books by title, author and ISBN. An API key in the server's .env file avoids a shared rate limit." },
  { value: "hardcover", label: "Hardcover", note: "Books with series, editions and ratings. Needs a token in the server's .env file." },
  { value: "goodreads", label: "Goodreads", note: "Books by title and ISBN, with ratings and covers. Unofficial: Goodreads does not offer this to apps, its terms disallow automated collection, and it can stop working at any time." },
  { value: "audnexus", label: "Audnexus", note: "Audiobook details by ASIN." },
];

/** Which online sources this library may use for Edit metadata, and whether Auto-fill may use the best title-and-author match (ADR-0049, ADR-0060, ADR-0090). */
export function ProvidersCard({ libraryId, config }: { libraryId: string; config: LibraryDetail["config"] }) {
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (next: Partial<LibraryDetail["config"]>) => api("PUT", `/admin/libraries/${libraryId}/config`, { ...config, ...next }),
    meta: { success: "Library settings saved" },
    onSettled: () => qc.invalidateQueries({ queryKey: ["admin", "library", libraryId] }),
  });
  const order = config.providerOrder;
  const toggle = (name: string, on: boolean) => save.mutate({ providerOrder: on ? [...order.filter((p) => p !== name), name] : order.filter((p) => p !== name) });
  return (
    <Card framed>
      <Stack gap="sm">
        <Heading level={2}>Online metadata</Heading>
        <Text size="sm" tone="dim">Off until you turn a source on. Litara sends only a book's title, authors and ISBN, and nothing changes until a result is saved. Sources are tried in the order they were turned on.</Text>
        {PROVIDERS.map((p) => (
          <SwitchField key={p.value} label={p.label} description={p.note} checked={order.includes(p.value)} disabled={save.isPending} onChange={(on) => toggle(p.value, on)} />
        ))}
        <SwitchField label="Auto-fill may use the best title-and-author match"
          description="For books with no ISBN. Takes the best-ranked result with exactly the same title and every listed author, skipping partial titles and sources that fail. Every Auto-fill is shown for review before anything is saved."
          checked={!!config.autoFillTitleMatch} disabled={save.isPending || order.length === 0} onChange={(on) => save.mutate({ autoFillTitleMatch: on })} />
      </Stack>
    </Card>
  );
}
