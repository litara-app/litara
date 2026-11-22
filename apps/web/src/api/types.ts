// Hand-written wire types for the subset of contracts/t003 and contracts/t005
// that the web client uses. The server's generated OpenAPI is checked against
// the contracts by scripts/contracts/compare.py; these types are not generated.

export interface User { id: string; username: string; displayName: string; isAdmin: boolean; active: boolean }
export interface BrowserSession { user: User; csrfToken: string }
export interface Page<T> { items: T[]; total: number; page: number; size: number }
export interface Library { id: string; name: string; icon: string | null }

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

export interface MetadataField {
  field: string; source: string; cleared: boolean; value: unknown;
  conflicts?: { source: string; value: unknown }[];
}
export interface MetadataReport { editionId: string; revision: string; fields: MetadataField[] }

export interface RecordingFile { id: string; contentVersion: string; sequence: number; filename: string }
export interface RecordingSnapshot { id: string; titleId: string; libraryId: string; title: string; layoutRevision: string; files: RecordingFile[] }

export interface RepairOutput { key: string; label: string; files: { fileId: string; contentVersion: string }[] }
export interface RepairPlan {
  id: string; revision: string; libraryId: string; titleId: string; kind: "merge" | "split";
  state: "planned" | "approved" | "applied" | "cancelled" | "stale";
  sources: { recordingId: string; layoutRevision: string }[]; outputs: RepairOutput[];
  result: { key: string; recordingId: string }[]; warnings: { code: string; detail: string }[];
}

export interface ScanRun { id: string; trigger: string; state: string; health?: string; filesSeen: number; createdAt: string; completedAt?: string; failure?: string }
export interface Review { id: string; kind: string; subjectKey: string; candidates: Record<string, unknown>; createdAt: string }
export interface LibraryDetail {
  library: Library;
  config: { mode: string; rootPath: string; followSymlinks: boolean; scanIntervalSecs?: number; writebackBackups: boolean; providerOrder: string[] };
  health: { state: string; detail?: string; checkedAt?: string };
}

export interface AudioFile { id: string; contentVersion: string; sequence: number; filename: string; mimeType: string; sizeBytes: number | null; durationMs: number | null; available: boolean; contentPath: string }
export interface AudioChapter { id: string; label: string; start: { fileId: string; contentVersion: string; offsetMs: number }; recordingStartMs: number | null; source: string; generated: boolean }
export interface AudioRecording {
  id: string; titleId: string; libraryId: string; title: string; authors: string[]; narrators: string[];
  readiness: "ready" | "incomplete"; durationMs: number | null; artwork: { thumbnailPath: string | null; coverPath: string | null };
  completion: { revision: string; finished: boolean; changedAt: string | null };
  schemaVersion: 1; layoutRevision: string; files: AudioFile[]; chapters: AudioChapter[];
  capabilities: { play: boolean; download: boolean; wholeRecordingSeek: boolean };
  issues: { code: string; message: string }[];
}
export interface AudioPosition { fileId: string; contentVersion: string; offsetMs: number; layoutRevision: string; capturedAt: string; receivedAt: string; deviceName: string }
export interface AudioPositionState {
  revision: string; position: AudioPosition | null;
  unresolvedConflicts: { id: string; reason: string; candidate: AudioPosition | null; baseRevision: string }[];
}

export interface ReadingEvent {
  id: string; titleId: string; editionId?: string; recordingId?: string; fileId: string; contentVersion: string;
  event: string; capturedAt: string; receivedAt: string;
}

/** Effective descriptive metadata of one edition (ADR-0081). */
export interface EditionDetails {
  editionId: string; addedAt: string;
  publisher: string | null; published: string | null; pageCount: number | null; isbn: string | null; description: string | null;
}
/** The caller's private rating, review and reading dates for a title (ADR-0081). Dates in `data` are overrides. */
export interface PersonalData { ratingHalves: number | null; review: string; startedAt: string | null; finishedAt: string | null }
export interface TitlePersonal {
  titleId: string; revision: string; data: PersonalData;
  derivedStartedAt: string | null; derivedFinishedAt: string | null; updatedAt: string | null;
}

export interface RecordingDetails {
  recordingId: string; addedAt: string;
  publisher: string | null; published: string | null; isbn: string | null; description: string | null;
}

/** One row of the library table (GET /titles). */
export interface TitleRow extends Title {
  libraryIds: string[]; formats: string[]; addedAt: string; seriesIndex: number | null;
  publisher: string | null; published: string | null; pageCount: number | null; ratingHalves: number | null;
  status: "unread" | "reading" | "finished";
}

/** Where a cover came from (ADR-0086). "none" means the files hold no cover, so the generated placeholder shows. */
export interface CoverSlot { source: "upload" | "url" | "search" | "extracted" | "none"; version?: string }
export interface TitleCovers { ebook: CoverSlot; audio: CoverSlot; searchEnabled: boolean }
export interface CoverSearchResult { provider: string; title: string; author: string; imageUrl: string; thumbUrl: string }

export interface ProviderCandidate { id: string; byIdentifier: boolean; consistent: boolean; fields: Record<string, unknown> }
export interface ProviderResult { provider: "open_library" | "google_books" | "audnexus" | "hardcover"; status: "ok" | "no_match" | "unavailable" | "unconfigured"; cached?: boolean; candidates: ProviderCandidate[] }
export interface AutoFillResult { outcome: "filled" | "nothing_to_fill" | "needs_review" | "no_match" | "disabled"; provider?: string; filled: string[]; revision?: string }
export interface ProviderSearchResults { editionId: string; enabled: boolean; query: { title?: string; authors?: string[]; isbn?: string; asin?: string }; results: ProviderResult[] }
