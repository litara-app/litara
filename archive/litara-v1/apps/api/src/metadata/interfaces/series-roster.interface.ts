export interface SeriesBookSlotData {
  title: string;
  sequence: number | null;
  authors: string[];
  coverUrl: string | null;
}

export interface SeriesRosterResult {
  booksCount: number | null;
  books: SeriesBookSlotData[];
}
