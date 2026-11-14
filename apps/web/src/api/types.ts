// Hand-written wire types for the subset of contracts/t003 and contracts/t005
// that the web client uses. The server's generated OpenAPI is checked against
// the contracts by scripts/contracts/compare.py; these types are not generated.

export interface User { id: string; username: string; displayName: string; isAdmin: boolean; active: boolean }
export interface BrowserSession { user: User; csrfToken: string }
export interface Page<T> { items: T[]; total: number; page: number; size: number }
export interface Library { id: string; name: string }

export interface Title {
  id: string; title: string; authors: string[]; series: string[]; languages: string[];
  editionCount: number; recordingCount: number;
}
export interface TitleDetail { title: Title; editionsPath: string; recordingsPath: string }
export interface RecordingLink { id: string; libraryId: string; label: string; snapshotPath: string }

export interface Capability { state: "supported" | "incomplete" | "unsupported"; issues: { code: string; detail: string }[] }
export interface Edition {
  id: string; titleId: string; libraryId: string; revision: string; label: string; language: string | null;
  file: { id: string; contentVersion: string; format: string; mimeType: string; sizeBytes: number | null; availability: string; contentPath: string | null };
  readiness: "ready" | "incomplete" | "unsupported";
  issues: { code: string; detail: string }[];
  completion: { revision: string; finished: boolean; changedAt: string | null };
  capabilities: Record<"read" | "download" | "resume" | "textSelection" | "textHighlight" | "pageNote" | "bookmark", Capability>;
}

export type ShelfFilter =
  | { kind: "predicate"; field: string; operator: "equals" | "contains"; value: string }
  | { kind: "all" | "any"; children: ShelfFilter[] }
  | { kind: "not"; child: ShelfFilter };
export interface ShelfData { name: string; visibility: "private" | "shared"; kind: "manual" | "smart"; filter: ShelfFilter | null }
export interface Shelf {
  id: string; revision: string; ownerId: string; canEdit: boolean; deleted: boolean; data: ShelfData | null;
  visibleTitleCount: number; evaluation: "manual" | "viewer-specific"; updatedAt: string;
}

export interface ProblemBody { code?: string; detail?: string; title?: string; status?: number; [k: string]: unknown }

export type Locator =
  | { kind: "foliate-cfi"; version: 1; cfi: string }
  | { kind: "pdf-page"; version: 1; pageIndex: number; x: number; y: number }
  | { kind: "comic-page"; version: 1; pageIndex: number; entryId: string; manifestVersion: string };
export interface Anchor { fileId: string; contentVersion: string; locator: Locator }
export interface PositionState {
  revision: string;
  position: { anchor: Anchor; capturedAt: string; receivedAt: string; deviceName: string } | null;
  unresolvedConflictCount: number;
  conflictsPath: string;
}
export interface ReaderSnapshot {
  schemaVersion: 1; edition: Edition; position: PositionState;
  engine: "foliate" | "pdfjs" | "image-pages" | "none"; engineProfile: string; pageManifestPath: string | null;
}
export type Selection =
  | { kind: "foliate-range"; version: 1; cfi: string }
  | { kind: "pdf-rectangles"; version: 1; pageIndex: number; rectangles: { x: number; y: number; width: number; height: number }[] };
export interface AnnotationData { kind: "highlight" | "note" | "bookmark"; anchor: Anchor; selection: Selection | null; text: string; quote: string }
export interface Annotation { id: string; editionId: string; revision: string; deleted: boolean; data: AnnotationData | null; updatedAt: string }
