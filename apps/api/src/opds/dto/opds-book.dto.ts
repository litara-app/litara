export interface OpdsBookEntry {
  id: string;
  title: string;
  subtitle?: string;
  description?: string;
  publishedDate?: Date;
  language?: string;
  publisher?: string;
  authors: string[];
  files: { id: string; format: string; sizeBytes: bigint }[];
  hasCover: boolean;
  seriesName?: string;
  seriesSequence?: number;
  genres: string[];
  updatedAt: Date;
}
