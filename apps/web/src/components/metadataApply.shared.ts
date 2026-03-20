import type { BookDetail, MetadataResult } from './BookDetailModal.types';
import type { ComparisonRow } from './MetadataComparisonTable';
import { isValidIsbn13, isValidIsbn10 } from './BookDetailModal.utils';

export function buildRows(
  detail: BookDetail,
  result: MetadataResult,
  includeCover: boolean,
): ComparisonRow[] {
  const rows: ComparisonRow[] = [];

  if (includeCover) {
    rows.push({
      label: 'Cover',
      field: 'coverUrl',
      isImage: true,
      current: detail.hasCover ? `/api/v1/books/${detail.id}/cover` : null,
      proposed: result.coverUrl,
    });
  }

  rows.push(
    {
      label: 'Title',
      field: 'title',
      current: detail.title,
      proposed: result.title,
    },
    {
      label: 'Subtitle',
      field: 'subtitle',
      current: detail.subtitle,
      proposed: result.subtitle,
    },
    {
      label: 'Authors',
      field: 'authors',
      current: detail.authors.join(', '),
      proposed: result.authors?.join(', '),
    },
    {
      label: 'Description',
      field: 'description',
      current: detail.description,
      proposed: result.description,
    },
    {
      label: 'Publisher',
      field: 'publisher',
      current: detail.publisher,
      proposed: result.publisher,
    },
    {
      label: 'Published',
      field: 'publishedDate',
      current: detail.publishedDate
        ? String(new Date(detail.publishedDate).getFullYear())
        : null,
      proposed: result.publishedDate
        ? String(
            new Date(result.publishedDate as unknown as string).getFullYear(),
          )
        : undefined,
    },
    {
      label: 'Language',
      field: 'language',
      current: detail.language,
      proposed: result.language,
    },
    {
      label: 'Pages',
      field: 'pageCount',
      current: detail.pageCount != null ? String(detail.pageCount) : null,
      proposed: result.pageCount != null ? String(result.pageCount) : undefined,
    },
    {
      label: 'ISBN-13',
      field: 'isbn13',
      current: detail.isbn13,
      proposed: isValidIsbn13(result.isbn13) ? result.isbn13 : undefined,
    },
    {
      label: 'ISBN-10',
      field: 'isbn10',
      current: detail.isbn10,
      proposed: isValidIsbn10(result.isbn10) ? result.isbn10 : undefined,
    },
    {
      label: 'Tags',
      field: 'tags',
      current: detail.tags.join(', '),
      proposed: result.categories?.join(', '),
    },
    {
      label: 'Genres',
      field: 'genres',
      current: detail.genres.join(', '),
      proposed: result.genres?.join(', '),
    },
    {
      label: 'Moods',
      field: 'moods',
      current: detail.moods.join(', '),
      proposed: result.moods?.join(', '),
    },
    {
      label: 'Goodreads Rating',
      field: 'goodreadsRating',
      current:
        detail.goodreadsRating != null ? String(detail.goodreadsRating) : null,
      proposed:
        result.goodreadsRating != null
          ? String(result.goodreadsRating)
          : undefined,
    },
    {
      label: 'Series Name',
      field: 'seriesName',
      current: detail.series?.name ?? null,
      proposed: result.seriesName,
    },
    {
      label: 'Series #',
      field: 'seriesSequence',
      current:
        detail.series?.sequence != null ? String(detail.series.sequence) : null,
      proposed:
        result.seriesPosition != null
          ? String(result.seriesPosition)
          : undefined,
    },
    {
      label: 'Total Books',
      field: 'seriesTotalBooks',
      current:
        detail.series?.totalBooks != null
          ? String(detail.series.totalBooks)
          : null,
      proposed:
        result.seriesTotalBooks != null
          ? String(result.seriesTotalBooks)
          : undefined,
    },
  );

  return rows;
}

export function buildApplyPayload(
  result: MetadataResult,
  detail: BookDetail,
  locked: Set<string>,
  includeCover: boolean,
  selected?: Set<string>,
): Record<string, unknown> {
  const should = (field: string) =>
    !locked.has(field) && (selected == null || selected.has(field));
  const p: Record<string, unknown> = {};

  if (includeCover && should('coverUrl') && result.coverUrl)
    p.coverUrl = result.coverUrl;
  if (should('title') && result.title) p.title = result.title;
  if (should('subtitle') && result.subtitle) p.subtitle = result.subtitle;
  if (should('authors') && result.authors?.length) p.authors = result.authors;
  if (should('description') && result.description)
    p.description = result.description;
  if (should('publisher') && result.publisher) p.publisher = result.publisher;
  if (should('publishedDate') && result.publishedDate) {
    const d = new Date(result.publishedDate as unknown as string);
    if (!isNaN(d.getTime())) p.publishedDate = d.toISOString().slice(0, 10);
  }
  if (should('language') && result.language) p.language = result.language;
  if (should('pageCount') && result.pageCount) p.pageCount = result.pageCount;
  if (should('isbn13') && isValidIsbn13(result.isbn13))
    p.isbn13 = result.isbn13;
  if (should('isbn10') && isValidIsbn10(result.isbn10))
    p.isbn10 = result.isbn10;
  if (should('tags') && result.categories?.length) p.tags = result.categories;
  if (should('genres') && result.genres?.length) p.genres = result.genres;
  if (should('moods') && result.moods?.length) p.moods = result.moods;
  if (should('goodreadsRating') && result.goodreadsRating != null)
    p.goodreadsRating = result.goodreadsRating;

  // Series — bundle with current name as anchor when only sequence/totalBooks is selected
  const shouldName = should('seriesName');
  const shouldSeq = should('seriesSequence');
  const shouldTotal = should('seriesTotalBooks');
  if (shouldName || shouldSeq || shouldTotal) {
    const name = shouldName
      ? (result.seriesName ?? null)
      : (detail.series?.name ?? null);
    p.seriesName = name;
    if (name) {
      if (shouldSeq) p.seriesSequence = result.seriesPosition ?? null;
      if (shouldTotal) p.seriesTotalBooks = result.seriesTotalBooks ?? null;
    }
  }

  return p;
}
