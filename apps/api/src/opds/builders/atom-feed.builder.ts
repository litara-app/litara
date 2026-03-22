import { create } from 'xmlbuilder2';
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

interface PaginationLinks {
  self: string;
  next?: string;
  previous?: string;
}

interface FeedMeta {
  id: string;
  title: string;
  updated: Date;
  baseUrl: string;
  links: PaginationLinks;
  totalResults?: number;
  itemsPerPage?: number;
}

export function buildAtomFeed(
  meta: FeedMeta,
  entries: OpdsBookEntry[],
): string {
  const doc = create({ version: '1.0', encoding: 'UTF-8' }).ele('feed', {
    xmlns: 'http://www.w3.org/2005/Atom',
    'xmlns:opds': 'http://opds-spec.org/2010/catalog',
    'xmlns:dcterms': 'http://purl.org/dc/terms/',
    'xmlns:opensearch': 'http://a9.com/-/spec/opensearch/1.1/',
  });

  doc.ele('id').txt(meta.id);
  doc.ele('title').txt(meta.title);
  doc.ele('updated').txt(meta.updated.toISOString());

  // Self link
  doc.ele('link', {
    rel: 'self',
    type: 'application/atom+xml;profile=opds-catalog;kind=navigation',
    href: meta.links.self,
  });

  // Start link (root)
  doc.ele('link', {
    rel: 'start',
    type: 'application/atom+xml;profile=opds-catalog;kind=navigation',
    href: `${meta.baseUrl}/opds/v1`,
  });

  // Search link
  doc.ele('link', {
    rel: 'search',
    type: 'application/opensearchdescription+xml',
    href: `${meta.baseUrl}/opds/v1/search`,
  });

  if (meta.links.next) {
    doc.ele('link', {
      rel: 'next',
      type: 'application/atom+xml;profile=opds-catalog;kind=acquisition',
      href: meta.links.next,
    });
  }

  if (meta.links.previous) {
    doc.ele('link', {
      rel: 'previous',
      type: 'application/atom+xml;profile=opds-catalog;kind=acquisition',
      href: meta.links.previous,
    });
  }

  if (meta.totalResults !== undefined) {
    doc.ele('opensearch:totalResults').txt(String(meta.totalResults));
  }
  if (meta.itemsPerPage !== undefined) {
    doc.ele('opensearch:itemsPerPage').txt(String(meta.itemsPerPage));
  }

  for (const book of entries) {
    const entry = doc.ele('entry');
    entry.ele('id').txt(`urn:litara:book:${book.id}`);
    entry.ele('title').txt(book.title);
    entry.ele('updated').txt(book.updatedAt.toISOString());

    for (const author of book.authors) {
      entry.ele('author').ele('name').txt(author);
    }

    if (book.description) {
      entry.ele('summary', { type: 'html' }).txt(book.description);
    }

    if (book.language) {
      entry.ele('dcterms:language').txt(book.language);
    }

    if (book.publisher) {
      entry.ele('dcterms:publisher').txt(book.publisher);
    }

    if (book.publishedDate) {
      entry
        .ele('dcterms:issued')
        .txt(book.publishedDate.toISOString().split('T')[0]);
    }

    for (const genre of book.genres) {
      entry.ele('category', { term: genre, label: genre });
    }

    if (book.hasCover) {
      entry.ele('link', {
        rel: 'http://opds-spec.org/image',
        type: 'image/jpeg',
        href: `${meta.baseUrl}/api/v1/books/${book.id}/cover`,
      });
      entry.ele('link', {
        rel: 'http://opds-spec.org/image/thumbnail',
        type: 'image/jpeg',
        href: `${meta.baseUrl}/api/v1/books/${book.id}/cover`,
      });
    }

    for (const file of book.files) {
      entry.ele('link', {
        rel: 'http://opds-spec.org/acquisition',
        type: getMime(file.format),
        href: `${meta.baseUrl}/opds/v1/download/${book.id}/${file.id}`,
        length: file.sizeBytes.toString(),
      });
    }
  }

  return doc.end({ prettyPrint: true });
}

export function buildNavigationFeed(
  meta: FeedMeta,
  navEntries: {
    id: string;
    title: string;
    href: string;
    type?: string;
    content?: string;
  }[],
): string {
  const doc = create({ version: '1.0', encoding: 'UTF-8' }).ele('feed', {
    xmlns: 'http://www.w3.org/2005/Atom',
    'xmlns:opds': 'http://opds-spec.org/2010/catalog',
  });

  doc.ele('id').txt(meta.id);
  doc.ele('title').txt(meta.title);
  doc.ele('updated').txt(meta.updated.toISOString());

  doc.ele('link', {
    rel: 'self',
    type: 'application/atom+xml;profile=opds-catalog;kind=navigation',
    href: meta.links.self,
  });

  doc.ele('link', {
    rel: 'start',
    type: 'application/atom+xml;profile=opds-catalog;kind=navigation',
    href: `${meta.baseUrl}/opds/v1`,
  });

  doc.ele('link', {
    rel: 'search',
    type: 'application/opensearchdescription+xml',
    href: `${meta.baseUrl}/opds/v1/search`,
  });

  for (const nav of navEntries) {
    const entry = doc.ele('entry');
    entry.ele('id').txt(nav.id);
    entry.ele('title').txt(nav.title);
    entry.ele('updated').txt(meta.updated.toISOString());
    entry.ele('link', {
      rel: 'subsection',
      type:
        nav.type ??
        'application/atom+xml;profile=opds-catalog;kind=acquisition',
      href: nav.href,
    });
    if (nav.content) {
      entry.ele('content', { type: 'text' }).txt(nav.content);
    }
  }

  return doc.end({ prettyPrint: true });
}

export function buildOpenSearchDescription(baseUrl: string): string {
  const doc = create({ version: '1.0', encoding: 'UTF-8' }).ele(
    'OpenSearchDescription',
    {
      xmlns: 'http://a9.com/-/spec/opensearch/1.1/',
    },
  );

  doc.ele('ShortName').txt('Litara');
  doc.ele('Description').txt('Search your Litara ebook library');
  doc.ele('InputEncoding').txt('UTF-8');
  doc.ele('Url', {
    type: 'application/atom+xml;profile=opds-catalog;kind=acquisition',
    template: `${baseUrl}/opds/v1/search/results?q={searchTerms}&page={startPage?}`,
  });

  return doc.end({ prettyPrint: true });
}
