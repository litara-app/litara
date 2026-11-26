// The web app's names for the server's wire types. The shapes come from schema.gen.ts, which is generated from the
// server's OpenAPI document (npm run gen:api); do not write a wire shape here by hand.
import type { WireFilter } from "../pages/filter/filterTree";
import type * as S from "./schema.gen";

/**
 * The document marks every list as nullable because that is how the server's OpenAPI library describes a Go slice.
 * The server sends empty lists, and the web app has always relied on that, so this is the one place it is assumed.
 */
export type Wire<T> =
  T extends readonly (infer E)[] ? Wire<E>[] :
  T extends object ? { [K in keyof T]: [Extract<NonNullable<T[K]>, readonly unknown[]>] extends [never] ? Wire<T[K]> : Wire<NonNullable<T[K]>> } :
  T;

export type User = Wire<S.User>;
export type BrowserSession = Wire<Pick<S.BrowserSession, "user" | "csrfToken">>;
/** The envelope every paginated list uses. */
export interface Page<T> { items: T[]; total: number; page: number; size: number }
export type Library = Wire<S.Library>;

export type Title = Wire<S.Title>;
export type TitleDetail = Wire<S.TitleDetail>;
export type RecordingLink = Wire<S.RecordingLink>;

export type Capability = Wire<S.Capability>;
export type Edition = Wire<S.Edition>;

/** A smart shelf's filter is the library search filter tree (ADR-0107), which filterTree types more closely. */
export type ShelfData = Omit<Wire<S.ShelfData>, "filter"> & { filter: WireFilter | null };
export type Shelf = Omit<Wire<S.Shelf>, "data"> & { data: ShelfData | null };

export type ProblemBody = Partial<Wire<S.Problem>> & Record<string, unknown>;

export type Locator = Wire<S.Locator>;
export type Anchor = Wire<S.EditionAnchor>;
export type PositionState = Wire<S.ReadingPositionState>;
export type ReaderSnapshot = Wire<S.ReaderSnapshot>;
export type Selection = Wire<S.Selection>;
export type AnnotationData = Wire<S.AnnotationData>;
export type Annotation = Wire<S.Annotation>;

/** An edition's or a recording's metadata field. The lock (ADR-0097) is separate from the source. */
export type MetadataField = Omit<Wire<S.MetadataField>, "field" | "source" | "conflicts"> & {
  field: string; source: string; conflicts?: { source: string; value: unknown }[];
};
/** An edition's or a recording's metadata. A save sends revision back as its base revision. */
export interface MetadataReport { editionId?: string; revision: string; fields: MetadataField[] }

export type RecordingFile = Pick<AudioFile, "id" | "contentVersion" | "sequence" | "filename">;
export type RecordingSnapshot = Pick<AudioRecording, "id" | "titleId" | "libraryId" | "title" | "layoutRevision"> & { files: RecordingFile[] };

export type RepairOutput = Wire<S.RepairOutput>;
export type RepairPlan = Wire<S.RepairPlan>;

export type ScanRun = Wire<S.ScanRun>;
export type Review = Wire<S.Review>;
export type LibraryDetail = Wire<S.LibraryDetail>;

export type AudioFile = Wire<S.File>;
export type AudioChapter = Wire<S.Chapter>;
export type AudioRecording = Wire<S.Recording>;
export type AudioPosition = Wire<S.Position>;
export type AudioPositionState = Wire<S.PositionState>;

/** One stretch of reading by this account (ADR-0092). */
export type ReadingSession = Wire<S.ReadingSession>;
/** An ebook completion event (GET /titles/{id}/reading-history). */
export type ReadingEvent = Wire<S.ReadingHistoryEntry>;
/** An audiobook completion event (GET /titles/{id}/history). */
export type ListeningEvent = Wire<S.HistoryEntry>;

/** Effective descriptive metadata of one edition (ADR-0081). */
export type EditionDetails = Wire<S.EditionDetails>;
/** The caller's private rating, review and reading dates for a title (ADR-0081). Dates in `data` are overrides. */
export type PersonalData = Wire<S.TitlePersonalData>;
export type TitlePersonal = Wire<S.TitlePersonal>;
export type RecordingDetails = Wire<S.RecordingDetails>;

/** One row of the library table (GET /titles). */
export type TitleRow = Wire<S.TitleRow>;

/** Where a cover came from (ADR-0086). "none" means the files hold no cover, so the generated placeholder shows. */
export type CoverSlot = Wire<S.CoverSlot>;
export type TitleCovers = Wire<S.TitleCovers>;
export type CoverSearchResult = Wire<S.CoverSearchResult>;

export type ProviderCandidate = Wire<S.ProviderCandidate>;
export type ProviderResult = Wire<S.ProviderResult>;
export type AutoFillResult = Wire<S.AutoFillResult>;
export type ProviderSearchResults = Wire<S.ProviderSearchResults>;

/** One place this account is signed in (GET /sessions). current marks the session making the request. */
export type DeviceSession = Wire<S.Session>;

/** GET /stats/reading (ADR-0098): the caller's own ebook reading by local day, with totals and streaks. */
export type ReadingStats = Wire<S.ReadingStats>;

/** One live annotation with its book, from the annotations hub (ADR-0099). */
export type AnnotationHubItem = Wire<S.AnnotationHubItem>;
/** A book with live annotations, for the hub's book filter. */
export type AnnotationHubTitle = Wire<S.AnnotationHubTitle>;
