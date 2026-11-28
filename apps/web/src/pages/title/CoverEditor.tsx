import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { API, api, ApiError, get, uploadFile } from "../../api/client";
import type { CoverSearchResult, CoverSlot, Edition, RecordingLink, Title, TitleCovers } from "../../api/types";
import { CoverEmbed } from "./CoverEmbed";
import { bumpCovers, Busy, Button, CoverChoice, ErrorBox, icons, Drawer, ImageDrop, SegmentedField, Stack, SwitchField, Text, TextField } from "../../ui";

const SOURCE_TEXT: Record<CoverSlot["source"], string> = {
  upload: "an image you uploaded", url: "an image from an address you entered", search: "a result from the online search",
  extracted: "the cover inside the file", none: "nothing: the files hold no cover, so a generated cover is shown",
};

export type Medium = "ebook" | "audio";

/** The cover kinds a title has. */
export const coverMediums = (title: Title): Medium[] => [...(title.editionCount > 0 ? (["ebook"] as const) : []), ...(title.recordingCount > 0 ? (["audio"] as const) : [])];

/**
 * Replace a title's cover (ADR-0086): upload, enter an address, search online, or regenerate from the file. It has no
 * picture of its own: it sits under the title page's cover, which updates as soon as a new cover is stored.
 */
export function CoverTools({ title, editions, recordings, medium, onMedium }: {
  title: Title; editions: Edition[]; recordings: RecordingLink[]; medium: Medium; onMedium: (m: Medium) => void;
}) {
  const qc = useQueryClient();
  const mediums = coverMediums(title);
  const [address, setAddress] = useState("");
  const [searching, setSearching] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const key = ["cover-info", title.id];
  const info = useQuery({ queryKey: key, queryFn: () => get<TitleCovers>(`/titles/${title.id}/covers`) });
  const slot = info.data?.[medium];

  const done = () => { setNotice(null); bumpCovers(); void qc.invalidateQueries({ queryKey: key }); };
  const upload = useMutation({ mutationFn: (f: File) => uploadFile<CoverSlot>("PUT", `/titles/${title.id}/cover?medium=${medium}`, f), meta: { success: "Cover replaced" }, onSuccess: done });
  const fromUrl = useMutation({
    mutationFn: (v: { url: string; source: "url" | "search" }) => api<CoverSlot>("POST", `/titles/${title.id}/cover/from-url`, { medium, url: v.url, source: v.source }),
    meta: { success: "Cover replaced" },
    onSuccess: () => { setAddress(""); setSearching(false); done(); },
  });
  const regenerate = useMutation({ mutationFn: () => api<CoverSlot>("POST", `/titles/${title.id}/cover/regenerate`, { medium }), meta: { success: "Cover regenerated from the file" }, onSuccess: done });
  const busy = upload.isPending || fromUrl.isPending || regenerate.isPending;

  return (
    <div className="lt-cover-tools" data-testid="cover-editor">
      <Stack gap="sm">
        {mediums.length > 1 && (
          <SegmentedField label="Which cover" value={medium} onValue={(v) => onMedium(v === "audio" ? "audio" : "ebook")}
            items={[{ value: "ebook", label: "Ebook", icon: icons.book }, { value: "audio", label: "Audiobook", icon: icons.headphones }]} />
        )}
        {info.isPending ? <Busy /> : <Text size="sm" tone="dim">Currently: {slot ? SOURCE_TEXT[slot.source] : "unknown"}.</Text>}
        <ImageDrop label="Choose an image" disabled={busy} onFile={(f) => upload.mutate(f)} onReject={setNotice} />
        <TextField label="Or use an image address" placeholder="https://example.com/cover.jpg" value={address} onValue={setAddress} type="url" />
        <Button icon={icons.download} block disabled={busy || address.trim().length < 8} loading={fromUrl.isPending && !searching}
          onClick={() => fromUrl.mutate({ url: address.trim(), source: "url" })}>Use this address</Button>
        <Button icon={icons.search} block disabled={busy} onClick={() => setSearching(true)}>Search online</Button>
        <Button icon={icons.reset} block loading={regenerate.isPending} disabled={busy} onClick={() => regenerate.mutate()}>Regenerate from the file</Button>
        {notice && <Text size="sm" tone="danger" role="alert">{notice}</Text>}
        <ErrorBox error={upload.error ?? fromUrl.error ?? regenerate.error ?? info.error} />
        <Text size="xs" tone="dim">A cover you choose is stored by Litara and never changes your book files.</Text>
        <CoverEmbed medium={medium} editions={editions} recordings={recordings} />
      </Stack>
      <SearchDialog open={searching} onClose={() => setSearching(false)} title={title} medium={medium} enabled={info.data?.searchEnabled ?? false}
        busy={fromUrl.isPending} onChoose={(url) => fromUrl.mutate({ url, source: "search" })} onEnabled={() => qc.invalidateQueries({ queryKey: key })} />
    </div>
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
    <Drawer open={open} onClose={onClose} title="Search online for a cover" size="lg"
      description="Litara sends only the title and author to Open Library and iTunes, and the title to Goodreads if this library uses it. The server makes these requests, not your browser."
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
    </Drawer>
  );
}
