import { api } from './client';

export interface SeriesCoverBook {
  id: string;
  coverUpdatedAt: string;
}

export interface SeriesListItem {
  id: string;
  name: string;
  ownedCount: number;
  totalBooks: number | null;
  coverBooks: SeriesCoverBook[];
  authors: string[];
}

export interface SeriesBookItem {
  id: string;
  title: string;
  sequence: number | null;
  hasCover: boolean;
  coverUpdatedAt: string;
  formats: string[];
  publishedDate: string | null;
  pageCount: number | null;
  publisher: string | null;
}

export interface SeriesDetail {
  id: string;
  name: string;
  totalBooks: number | null;
  authors: string[];
  books: SeriesBookItem[];
}

export function getAllSeries(): Promise<SeriesListItem[]> {
  return api.get<SeriesListItem[]>('/series').then((r) => r.data);
}

export function getSeriesDetail(id: string): Promise<SeriesDetail> {
  return api.get<SeriesDetail>(`/series/${id}`).then((r) => r.data);
}
