import { useEffect, useRef } from "react";
import { type ReaderKind, ReaderHost, fileSource, loadReaderOrigin } from "./host";

declare global {
  interface Window {
    __proofEvents?: unknown[];
    __proofHost?: ReaderHost;
  }
}

// Isolation proof harness. Compiled only into builds made with
// VITE_READER_PROOF=1; production builds omit it (see App.tsx).
export function ProofPage() {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => () => window.__proofHost?.dispose(), []);

  async function pick(file: File | undefined, kind: ReaderKind, limits?: Record<string, number>) {
    if (!file || !box.current) return;
    window.__proofHost?.dispose();
    window.__proofEvents = [];
    const origin = await loadReaderOrigin();
    const host = new ReaderHost(box.current, fileSource(file), (e) => window.__proofEvents!.push(e), origin);
    window.__proofHost = host;
    await host.open({ kind, name: file.name, limits });
  }
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__proofOpen = pick;
  });

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <input
        id="file"
        type="file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          const kind = (f?.name.split(".").pop() ?? "epub") as ReaderKind;
          void pick(f, kind);
        }}
      />
      <div ref={box} style={{ flex: 1 }} />
    </div>
  );
}
