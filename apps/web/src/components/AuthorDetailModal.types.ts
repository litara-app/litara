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
