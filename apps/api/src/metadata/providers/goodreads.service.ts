import { Injectable, Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import type { MetadataResult } from '../interfaces/metadata-result.interface';

const SEARCH_URL = 'https://www.goodreads.com/search?q=';
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

interface GoodreadsJsonLd {
  name?: string;
  isbn?: string;
  inLanguage?: string;
  numberOfPages?: number;
  author?: Array<{ name: string }> | { name: string };
  aggregateRating?: { ratingValue?: number };
  awards?: string;
}

@Injectable()
export class GoodreadsService {
  private readonly logger = new Logger(GoodreadsService.name);

  async searchByIsbn(isbn: string): Promise<MetadataResult | null> {
    this.logger.debug(`Searching Goodreads for ISBN: ${isbn}`);
    return this.fetchBook(SEARCH_URL + encodeURIComponent(isbn));
  }

  async searchByTitleAuthor(
    title: string,
    author?: string,
  ): Promise<MetadataResult | null> {
    const q = author ? `${title} ${author}` : title;
    this.logger.debug(`Searching Goodreads for: ${q}`);
    return this.fetchBook(SEARCH_URL + encodeURIComponent(q), {
      title,
      author,
    });
  }

  // ─── Core fetch ──────────────────────────────────────────────────────────────

  private async fetchBook(
    url: string,
    context?: { title?: string; author?: string },
  ): Promise<MetadataResult | null> {
    try {
      const { html, responseUrl } = await this.get(url);
      const $ = cheerio.load(html);

      // If the search redirected to a book page, parse it directly.
      // Otherwise find the best-matching result and fetch that page.
      if (responseUrl.includes('/book/show/')) {
        return this.parsePage($, responseUrl);
      }

      const bookPath = context?.title
        ? this.extractBestSearchResult($, context.title, context.author)
        : this.extractFirstSearchResult($);

      if (!bookPath) {
        this.logger.debug(`No Goodreads results for URL: ${url}`);
        return null;
      }

      const bookUrl = `https://www.goodreads.com${bookPath}`;
      const { html: bookHtml, responseUrl: bookResponseUrl } =
        await this.get(bookUrl);
      return this.parsePage(cheerio.load(bookHtml), bookResponseUrl);
    } catch (err) {
      this.logger.warn(`Goodreads request failed: ${(err as Error).message}`);
      return null;
    }
  }

  // ─── Page parser ─────────────────────────────────────────────────────────────

  private parsePage($: CheerioAPI, responseUrl: string): MetadataResult | null {
    const goodreadsId = responseUrl
      .split('/show/')[1]
      ?.split('-')[0]
      ?.split('?')[0];
    if (!goodreadsId) return null;

    const result: MetadataResult = { goodreadsId };

    result.title =
      this.text($, 'h1[data-testid="bookTitle"]') ||
      this.text($, '.Text__title1') ||
      undefined;
    if (!result.title) return null;

    result.subtitle = this.text($, '.Text__title2.Text__italic') || undefined;

    // JSON-LD structured data — most reliable source for several fields
    const jsonLd = this.parseJsonLd($);

    // Authors — scope to contributor section to avoid grabbing reviewer names
    if (jsonLd?.author) {
      const raw = Array.isArray(jsonLd.author)
        ? jsonLd.author
        : [jsonLd.author];
      result.authors = raw.map((a) => a.name).filter(Boolean);
    } else {
      const authors: string[] = [];
      $('.BookPageMetadataSection__contributor .ContributorLink__name').each(
        (_, el) => {
          const name = $(el).text().trim();
          if (name && !authors.includes(name)) authors.push(name);
        },
      );
      if (authors.length) result.authors = authors;
    }

    result.description =
      this.text($, '.DetailsLayoutRightParagraph__widthConstrained') ||
      this.text($, '[data-testid="description"] .Formatted') ||
      undefined;

    // Cover — prefer the large version derived from the small thumbnail URL
    const coverSrc =
      $('[data-testid="coverImage"]').first().attr('src') ||
      $('.BookCover__image img').first().attr('src');
    if (coverSrc) result.coverUrl = this.enlargeCoverUrl(coverSrc);

    // ISBN — JSON-LD has isbn13; details box may have both
    if (jsonLd?.isbn) {
      const isbn = String(jsonLd.isbn).replace(/-/g, '');
      if (isbn.length === 13) result.isbn13 = isbn;
      else if (isbn.length === 10) result.isbn10 = isbn;
    }
    // Supplement/override with detail box values which may carry both
    const detailIsbn = this.dataBoxValue($, 'isbn');
    if (detailIsbn) {
      const isbn10Match = detailIsbn.match(/^(\d{10})/);
      if (isbn10Match) result.isbn10 = isbn10Match[1];
      if (!result.isbn13) {
        const isbn13Match = detailIsbn.match(/ISBN13:\s*([\d-]+)/);
        if (isbn13Match) result.isbn13 = isbn13Match[1].replace(/-/g, '');
      }
    }

    // Pages — JSON-LD numberOfPages is reliable; fall back to HTML
    if (jsonLd?.numberOfPages) {
      result.pageCount = jsonLd.numberOfPages;
    } else {
      const pagesText =
        this.text($, '[data-testid="pagesFormat"]') ||
        this.text($, '.pagesFormat');
      const pagesMatch = pagesText.match(/(\d+)/);
      if (pagesMatch) result.pageCount = parseInt(pagesMatch[1]);
    }

    // Rating — JSON-LD aggregateRating or visible rating element
    const jsonRating = jsonLd?.aggregateRating?.ratingValue;
    if (jsonRating != null) {
      result.goodreadsRating = jsonRating;
    } else {
      const ratingText = this.text($, '.RatingStatistics__rating');
      const rating = parseFloat(ratingText);
      if (!isNaN(rating)) result.goodreadsRating = rating;
    }

    // Language — JSON-LD inLanguage or microdata attribute
    result.language =
      (jsonLd?.inLanguage ? String(jsonLd.inLanguage) : '') ||
      this.text($, '[itemprop="inLanguage"]') ||
      undefined;

    // Genres — genre shelf links in the genres section
    const genres: string[] = [];
    $(
      '[data-testid="genresList"] .Button__labelItem, [data-testid="genres"] a',
    ).each((_, el) => {
      const name = $(el).text().trim();
      if (name && !genres.includes(name)) genres.push(name);
    });
    if (genres.length)
      result.genres = genres.filter((g) => !g.startsWith('...'));

    // Publisher — detail box
    result.publisher = this.dataBoxValue($, 'publisher') || undefined;

    // Published date — <p data-testid="publicationInfo"> is the modern selector;
    // fall back to <dt>/<dd> detail box used on older pages
    const pubInfoText =
      this.text($, '[data-testid="publicationInfo"]') ||
      this.dataBoxValue($, 'published') ||
      this.dataBoxValue($, 'first published');
    if (pubInfoText) {
      const cleaned = pubInfoText.replace(/First published/i, '').trim();
      const d = new Date(cleaned);
      if (!isNaN(d.getTime())) result.publishedDate = d;
      else {
        const yearMatch = cleaned.match(/\d{4}/);
        if (yearMatch) result.publishedDate = new Date(`${yearMatch[0]}-01-01`);
      }
    }

    // Series — h3 with aria-label "Book N in the X series"
    // The h3 has classes Text__title3 Text__italic; aria-label is the most reliable parse target
    const seriesEl = $('h3[aria-label*=" series"]').first();
    if (seriesEl.length) {
      const ariaLabel = seriesEl.attr('aria-label') ?? '';
      // e.g. "Book 1 in the Children of Time series"
      const ariaMatch = ariaLabel.match(
        /Book\s+([\d.]+)\s+in\s+(?:the\s+)?(.+?)\s+series/i,
      );
      if (ariaMatch) {
        result.seriesPosition = parseFloat(ariaMatch[1]);
        result.seriesName = ariaMatch[2].trim();
      } else {
        // fallback: link text is "Series Name #1"
        const linkText = seriesEl.find('a').first().text().trim();
        const posMatch = linkText.match(/#([\d.]+)/);
        if (posMatch) result.seriesPosition = parseFloat(posMatch[1]);
        result.seriesName = linkText.replace(/#[\d.]+/, '').trim() || undefined;
      }

      const totalMatch = ariaLabel.match(/of\s+(\d+)/i);
      if (totalMatch) result.seriesTotalBooks = parseInt(totalMatch[1]);
    }

    return result;
  }

  // ─── JSON-LD parser ───────────────────────────────────────────────────────────

  private parseJsonLd($: CheerioAPI): GoodreadsJsonLd | null {
    try {
      const raw = $('script[type="application/ld+json"]').first().html();
      if (!raw) return null;
      return JSON.parse(raw) as GoodreadsJsonLd;
    } catch {
      return null;
    }
  }

  // ─── Search result extraction ─────────────────────────────────────────────

  /**
   * Score every result row and return the href of the best match.
   * Falls back to extractFirstSearchResult if nothing scores positively.
   */
  private extractBestSearchResult(
    $: CheerioAPI,
    title: string,
    author?: string,
  ): string | null {
    interface Candidate {
      href: string;
      score: number;
    }

    // Strip trailing series annotation, e.g. "(Children of Time, #1)"
    const normalize = (s: string) =>
      s
        .toLowerCase()
        .replace(/\s*\([^)]*\)\s*$/, '')
        .trim();

    const normTitle = normalize(title);
    const normAuthor = author?.toLowerCase().trim() ?? null;

    const candidates: Candidate[] = [];

    $('tr[itemtype="http://schema.org/Book"]').each((_, row) => {
      const anchor = $(row).find('a.bookTitle');
      const href = anchor.attr('href');
      if (!href) return;

      const rawTitle = anchor.find('span[itemprop="name"]').text().trim();
      if (!rawTitle) return;
      const normResultTitle = normalize(rawTitle);

      const authors: string[] = [];
      $(row)
        .find('a.authorName span[itemprop="name"]')
        .each((_, el) => {
          authors.push($(el).text().trim().toLowerCase());
        });

      let score = 0;

      // Title scoring — normalised to strip series suffix before comparing
      if (normResultTitle === normTitle) score += 100;
      else if (normResultTitle.startsWith(normTitle)) score += 60;
      else if (normResultTitle.includes(normTitle)) score += 30;

      // Author scoring
      if (normAuthor) {
        if (authors.some((a) => a === normAuthor)) score += 50;
        else if (
          authors.some((a) => a.includes(normAuthor) || normAuthor.includes(a))
        )
          score += 20;
      }

      // Penalise study guides, summaries, reading guides, checklists, etc.
      if (
        /^(study guide|reading guide|summary|analysis|a guide to|cliff|checklist)/i.test(
          rawTitle,
        )
      ) {
        score -= 60;
      }

      candidates.push({ href, score });
    });

    if (!candidates.length) return this.extractFirstSearchResult($);

    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    this.logger.debug(
      `Best Goodreads result score=${best.score} href=${best.href}`,
    );
    return best.score > 0 ? best.href : this.extractFirstSearchResult($);
  }

  private extractFirstSearchResult($: CheerioAPI): string | null {
    // Classic table layout
    const tableLink = $('a.bookTitle').first().attr('href');
    if (tableLink) return tableLink;

    // React-era layout
    const reactLink = $('[data-testid="bookTitle"]')
      .first()
      .closest('a')
      .attr('href');
    if (reactLink) return reactLink;

    // Any /book/show/ link
    let found: string | null = null;
    $('a[href*="/book/show/"]').each((_, el) => {
      const href = $(el).attr('href') ?? '';
      if (!found && href.includes('/book/show/')) found = href;
    });
    return found;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  /** Fetch a URL and return html + the final response URL (after redirects). */
  private async get(
    url: string,
  ): Promise<{ html: string; responseUrl: string }> {
    const response = await fetch(url, {
      headers: HEADERS,
      redirect: 'follow',
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }
    return { html: await response.text(), responseUrl: response.url };
  }

  private text($: CheerioAPI, selector: string): string {
    return $(selector).first().text().trim();
  }

  /** Look up a key-value pair in <dt>/<dd> pairs anywhere on the page. */
  private dataBoxValue($: CheerioAPI, label: string): string {
    let value = '';
    $('dt').each((_, el) => {
      if ($(el).text().toLowerCase().trim() === label.toLowerCase()) {
        value = $(el).next('dd').text().trim();
        return false; // break
      }
    });
    return value;
  }

  /**
   * Goodreads thumbnail URLs look like:
   *   https://i.gr-assets.com/images/S/..._SX98_.jpg
   * Replace the size token to get a larger image.
   */
  private enlargeCoverUrl(url: string): string {
    return url.replace(/_(S[XY]\d+_|SX\d+_|SY\d+_)/g, '_SX475_');
  }
}
