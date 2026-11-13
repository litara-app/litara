import type { OpdsBookEntry } from '../dto/opds-book.dto';

const MIME_MAP: Record<string, string> = {
  EPUB: 'application/epub+zip',
  MOBI: 'application/x-mobipocket-ebook',
  AZW: 'application/vnd.amazon.ebook',
  AZW3: 'application/vnd.amazon.ebook',
  PDF: 'application/pdf',
  CBZ: 'application/vnd.comicbook+zip',
};

function getMime(format: string): string {
  return MIME_MAP[format.toUpperCase()] ?? 'application/octet-stream';
}

interface OpdsV2Link {
  rel: string;
  href: string;
  type: string;
  title?: string;
  properties?: Record<string, unknown>;
}

interface OpdsV2Publication {
  metadata: Record<string, unknown>;
  links: OpdsV2Link[];
  images: OpdsV2Link[];
}

interface OpdsV2Feed {
  metadata: Record<string, unknown>;
  links: OpdsV2Link[];
  publications?: OpdsV2Publication[];
  navigation?: { href: string; title: string; type: string; rel: string }[];
}

export function buildV2Feed(
  meta: {
    title: string;
    id: string;
    baseUrl: string;
    self: string;
    next?: string;
    previous?: string;
    totalItems?: number;
    numberOfItems?: number;
  },
  books: OpdsBookEntry[],
): OpdsV2Feed {
  const links: OpdsV2Link[] = [
    { rel: 'self', href: meta.self, type: 'application/opds+json' },
    {
      rel: 'start',
      href: `${meta.baseUrl}/opds/v2`,
      type: 'application/opds+json',
      title: 'Litara Library',
    },
    {
      rel: 'search',
      href: `${meta.baseUrl}/opds/v2/search{?q}`,
      type: 'application/opds+json',
    },
  ];

  if (meta.next) {
    links.push({ rel: 'next', href: meta.next, type: 'application/opds+json' });
  }
  if (meta.previous) {
    links.push({
      rel: 'previous',
      href: meta.previous,
      type: 'application/opds+json',
    });
  }

  const feedMeta: Record<string, unknown> = { title: meta.title };
  if (meta.numberOfItems !== undefined)
    feedMeta.numberOfItems = meta.numberOfItems;
  if (meta.totalItems !== undefined) feedMeta.totalItems = meta.totalItems;

  const publications: OpdsV2Publication[] = books.map((book) => {
    const pubMeta: Record<string, unknown> = {
      '@type': 'http://schema.org/Book',
      title: book.title,
      identifier: `urn:litara:book:${book.id}`,
      modified: book.updatedAt.toISOString(),
    };

    if (book.authors.length > 0)
      pubMeta.author = book.authors.map((a) => ({ name: a }));
    if (book.description) pubMeta.description = book.description;
    if (book.language) pubMeta.language = book.language;
    if (book.publisher) pubMeta.publisher = book.publisher;
    if (book.publishedDate)
      pubMeta.published = book.publishedDate.toISOString().split('T')[0];
    if (book.genres.length > 0) pubMeta.subject = book.genres;
    if (book.seriesName) {
      pubMeta.belongsToCollection = {
        name: book.seriesName,
        position: book.seriesPosition,
        '@type': 'http://schema.org/Collection',
      };
    }

    const pubLinks: OpdsV2Link[] = book.files.map((f) => ({
      rel: 'http://opds-spec.org/acquisition',
      href: `${meta.baseUrl}/opds/v1/download/${book.id}/${f.id}`,
      type: getMime(f.format),
      properties: {
        'http://www.idpf.org/epub/vocab/package/meta/#file-as': f.format,
      },
    }));

    const images: OpdsV2Link[] = book.hasCover
      ? [
          {
            rel: 'http://opds-spec.org/image',
            href: `${meta.baseUrl}/api/v1/books/${book.id}/cover`,
            type: 'image/jpeg',
          },
          {
            rel: 'http://opds-spec.org/image/thumbnail',
            href: `${meta.baseUrl}/api/v1/books/${book.id}/cover`,
            type: 'image/jpeg',
          },
        ]
      : [];

    return { metadata: pubMeta, links: pubLinks, images };
  });

  return { metadata: feedMeta, links, publications };
}

export function buildV2NavigationFeed(
  meta: { title: string; baseUrl: string; self: string },
  navItems: { href: string; title: string; type: string; rel: string }[],
): OpdsV2Feed {
  const links: OpdsV2Link[] = [
    { rel: 'self', href: meta.self, type: 'application/opds+json' },
    {
      rel: 'search',
      href: `${meta.baseUrl}/opds/v2/search{?q}`,
      type: 'application/opds+json',
    },
  ];

  return {
    metadata: { title: meta.title },
    links,
    navigation: navItems,
  };
}
