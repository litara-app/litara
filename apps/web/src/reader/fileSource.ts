import { assertSameSession, sessionEpoch } from "../api/client";
import type { ByteSource } from "./host";

/**
 * Range source over the exact-version original-file endpoint. The parent
 * performs every authorized read with the browser session cookie; the sandboxed
 * frame never sees credentials (ADR-0067).
 */
export function remoteSource(contentPath: string, size: number): ByteSource {
  return {
    size,
    async read(start, end) {
      const since = sessionEpoch();
      const res = await fetch(contentPath, {
        credentials: "same-origin",
        cache: "no-store",
        headers: { Range: `bytes=${start}-${end - 1}` },
      });
      if (res.status !== 206 && !(res.status === 200 && start === 0 && end >= size)) {
        throw new Error(`file read failed (${res.status})`);
      }
      const buf = await res.arrayBuffer();
      assertSameSession(since);
      // A 200 for a full-file request is acceptable; otherwise honor the requested window only.
      return buf.byteLength === end - start ? buf : buf.slice(start, end);
    },
  };
}
