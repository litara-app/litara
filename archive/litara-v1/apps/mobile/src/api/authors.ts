import { api } from './client';

export interface AuthorListItem {
  id: string;
  name: string;
  hasCover: boolean;
  bookCount: number;
}

export interface AuthorBook {
  id: string;
  title: string;
  hasCover: boolean;
  coverUpdatedAt: string;
  formats: string[];
}

export interface AuthorDetail {
  id: string;
  name: string;
  hasCover: boolean;
  biography: string | null;
  goodreadsId: string | null;
  books: AuthorBook[];
}

export async function getAllAuthors(): Promise<AuthorListItem[]> {
  const res = await api.get<AuthorListItem[]>('/authors');
  return res.data;
}

export async function getAuthorDetail(id: string): Promise<AuthorDetail> {
  const res = await api.get<AuthorDetail>(`/authors/${id}`);
  return res.data;
}
