import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { API, api, ApiError, get, uploadFile } from "../../api/client";
import type { CoverSearchResult, CoverSlot, Edition, RecordingLink, Title, TitleCovers } from "../../api/types";
import { CoverEmbed } from "./CoverEmbed";
import { bumpCovers, Busy, Button, Card, Cover, CoverChoice, ErrorBox, Heading, icons, ImageDrop, Modal, Row, SegmentedField, Stack, SwitchField, Text, TextField } from "../../ui";

const SOURCE_TEXT: Record<CoverSlot["source"], string> = {
  upload: "an image you uploaded", url: "an image from an address you entered", search: "a result from the online search",
  extracted: "the cover inside the file", none: "nothing: the files hold no cover, so a generated cover is shown",
};

type Medium = "ebook" | "audio";

/** Replace a title's cover (ADR-0086): upload, enter an address, search online, or regenerate from the file. */
export function CoverEditor({ title, editions, recordings }: { title: Title; editions: Edition[]; recordings: RecordingLink[] }) {
  const qc = useQueryClient();
  const mediums: Medium[] = [...(title.editionCount > 0 ? (["ebook"] as const) : []), ...(title.recordingCount > 0 ? (["audio"] as const) : [])];
  const [medium, setMedium] = useState<Medium>(mediums[0] ?? "ebook");
  const [address, setAddress] = useState("");
  const [searching, setSearching] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const key = ["cover-info", title.id];
  const info = useQuery({ queryKey: key, queryFn: () => get<TitleCovers>(`/titles/${title.id}/covers`) });
  const slot = info.data?.[medium];

  const done = () => { setNotice(null); bumpCovers(); void qc.invalidateQueries({ queryKey: key }); };
  const upload = useMutation({ mutationFn: (f: File) => uploadFile<CoverSlot>("PUT", `/titles/${title.id}/cover?medium=${medium}`, f), onSuccess: done });
  const fromUrl = useMutation({
    mutationFn: (v: { url: string; source: "url" | "search" }) => api<CoverSlot>("POST", `/titles/${title.id}/cover/from-url`, { medium, url: v.url, source: v.source }),
    onSuccess: () => { setAddress(""); setSearching(false); done(); },
  });
  const regenerate = useMutation({ mutationFn: () => api<CoverSlot>("POST", `/titles/${title.id}/cover/regenerate`, { medium }), onSuccess: done });
  const busy = upload.isPending || fromUrl.isPending || regenerate.isPending;

  return (
    <Card framed data-testid="cover-editor">
      <Stack gap="sm">
        <Heading level={3}>Cover</Heading>
        <div className="lt-cover-editor">
          <div><Cover title={title.title || "(untitled)"} author={title.authors[0]} titleId={title.id} medium={medium} /></div>
          <Stack gap="sm">
            {mediums.length > 1 && (
              <SegmentedField label="Which cover" value={medium} onValue={(v) => setMedium(v === "audio" ? "audio" : "ebook")}
                items={[{ value: "ebook", label: "Ebook cover", icon: icons.book }, { value: "audio", label: "Audiobook cover", icon: icons.headphones }]} />
            )}
            {info.isPending ? <Busy /> : <Text size="sm" tone="dim">Currently: {slot ? SOURCE_TEXT[slot.source] : "unknown"}.</Text>}
            <ImageDrop label="Choose an image" disabled={busy} onFile={(f) => upload.mutate(f)} onReject={setNotice} />
            <Row gap="sm" align="end" wrap>
              <TextField label="Or use an image address" placeholder="https://example.com/cover.jpg" value={address} onValue={setAddress} type="url" />
              <Button icon={icons.download} disabled={busy || address.trim().length < 8} loading={fromUrl.isPending && !searching}
                onClick={() => fromUrl.mutate({ url: address.trim(), source: "url" })}>Use this address</Button>
            </Row>
            <Row gap="sm" wrap>
              <Button icon={icons.search} disabled={busy} onClick={() => setSearching(true)}>Search online</Button>
              <Button icon={icons.reset} loading={regenerate.isPending} disabled={busy} onClick={() => regenerate.mutate()}>Regenerate from the file</Button>
            </Row>
            {notice && <Text size="sm" tone="danger" role="alert">{notice}</Text>}
            <ErrorBox error={upload.error ?? fromUrl.error ?? regenerate.error ?? info.error} />
            <Text size="xs" tone="dim">Choosing a cover is stored by Litara and never changes your book files.</Text>
            <CoverEmbed medium={medium} editions={editions} recordings={recordings} />
          </Stack>
        </div>
      </Stack>
      <SearchDialog open={searching} onClose={() => setSearching(false)} title={title} medium={medium} enabled={info.data?.searchEnabled ?? false}
        busy={fromUrl.isPending} onChoose={(url) => fromUrl.mutate({ url, source: "search" })} onEnabled={() => qc.invalidateQueries({ queryKey: key })} />
    </Card>
  );
}

function SearchDialog({ open, onClose, title, medium, enabled, busy, onChoose, onEnabled }: {
  open: boolean; onClose: () => void; title: Title; medium: Medium; enabled: boolean; busy: boolean; onChoose: (url: string) => void; onEnabled: () => void;
}) {
  const turnOn = useMutation({ mutationFn: () => api("PUT", "/admin/cover-settings", { searchEnabled: true }), onSuccess: onEnabled });
  const results = useQuery({
    queryKey: ["cover-search", title.id, medium], enabled: open && enabled, retry: false, staleTime: 5 * 60_000,
    queryFn: () => get<{ items: CoverSearchResult[] }>(`/titles/${title.id}/cover-search?medium=${medium}`),
  });
  return (
    <Modal open={open} onClose={onClose} title="Search online for a cover"
      description="Litara sends only the title and author to Open Library and iTunes. Your browser never contacts those sites."
      actions={<Button icon={icons.close} onClick={onClose}>Close</Button>}>
      {!enabled ? (
        <Stack gap="sm">
          <Text>Online cover search is turned off for this server.</Text>
          <SwitchField label="Allow the server to search Open Library and iTunes for covers" checked={turnOn.isSuccess} onChange={(on) => on && turnOn.mutate()} />
          <ErrorBox error={turnOn.error} />
        </Stack>
      ) : results.isPending ? <Busy /> : results.error ? (
        <Text tone="danger">{results.error instanceof ApiError ? results.error.message : "The cover sites could not be reached."}</Text>
      ) : (results.data?.items.length ?? 0) === 0 ? <Text tone="dim">No covers found for this title.</Text> : (
        <div className="lt-cover-results">
          {results.data!.items.map((r) => (
            <CoverChoice key={r.imageUrl} src={`${API}/titles/${title.id}/cover-preview?url=${encodeURIComponent(r.thumbUrl)}`} title={r.title || "(untitled)"}
              caption={`${r.provider}${r.author ? ` · ${r.author}` : ""}`} disabled={busy} onChoose={() => onChoose(r.imageUrl)} />
          ))}
        </div>
      )}
    </Modal>
  );
}
