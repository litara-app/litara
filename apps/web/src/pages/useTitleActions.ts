import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { get } from "../api/client";
import type { Edition, Page as Paged, RecordingLink } from "../api/types";

export const READABLE = ["epub", "kepub", "fb2", "pdf", "cbz", "cbr", "cb7", "mobi", "azw", "azw3"];
export const isReadable = (e: Edition) => READABLE.includes(e.file.format) && e.capabilities.read.state !== "unsupported" && e.file.availability === "available";

/** Actions on a title that need its editions or recordings, fetched when the action is used (and cached for the title page). */
export function useTitleActions() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const editions = (id: string) => qc.fetchQuery({ queryKey: ["title", id, "editions"], queryFn: () => get<Paged<Edition>>(`/editions?titleId=${id}&size=200`) });
  const recordings = (id: string) => qc.fetchQuery({ queryKey: ["title", id, "recordings"], queryFn: () => get<Paged<RecordingLink>>(`/titles/${id}/recordings?size=200`) });
  return {
    async read(id: string) {
      const e = (await editions(id)).items.find(isReadable);
      nav(e ? `/read/${e.id}` : `/titles/${id}?tab=files`);
    },
    async listen(id: string) {
      const r = (await recordings(id)).items[0];
      nav(r ? `/listen/${r.id}` : `/titles/${id}?tab=files`);
    },
    async download(id: string) {
      const items = (await editions(id)).items.filter((e) => e.file.contentPath && e.capabilities.download.state === "supported");
      if (items.length === 1) {
        const a = document.createElement("a");
        a.href = items[0]!.file.contentPath!;
        a.download = "";
        a.click();
      } else nav(`/titles/${id}?tab=files`);
    },
  };
}
