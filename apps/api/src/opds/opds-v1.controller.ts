import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  Res,
  UseFilters,
  UseGuards,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { createReadStream } from 'fs';
import { basename } from 'path';
import type { Request, Response } from 'express';
import { BasicAuthGuard } from './auth/basic-auth.guard';
import { OpdsUnauthorizedFilter } from './auth/opds-unauthorized.filter';
import { OpdsEnabledGuard } from './opds-enabled.guard';
import { OpdsService } from './opds.service';
import {
  buildAtomFeed,
  buildNavigationFeed,
  buildOpenSearchDescription,
} from './builders/atom-feed.builder';

const PAGE_SIZE = 20;
const ATOM_NAV =
  'application/atom+xml;profile=opds-catalog;kind=navigation;charset=utf-8';
const ATOM_ACQ =
  'application/atom+xml;profile=opds-catalog;kind=acquisition;charset=utf-8';

function getBaseUrl(req: Request): string {
  return `${req.protocol}://${req.get('host')}`;
}

function pageUrl(base: string, page: number): string {
  const url = new URL(base);
  url.searchParams.set('page', String(page));
  return url.toString();
}

@UseFilters(OpdsUnauthorizedFilter)
@UseGuards(OpdsEnabledGuard)
@Controller({ path: 'opds/v1', version: VERSION_NEUTRAL })
export class OpdsV1Controller {
  constructor(private readonly opdsService: OpdsService) {}

  @Get()
  @UseGuards(BasicAuthGuard)
  root(@Req() req: Request, @Res() res: Response) {
    const baseUrl = getBaseUrl(req);
    const now = new Date();

    const xml = buildNavigationFeed(
      {
        id: 'urn:litara:opds:root',
        title: 'Litara Library',
        updated: now,
        baseUrl,
        links: { self: `${baseUrl}/opds/v1` },
      },
      [
        {
          id: 'urn:litara:opds:all',
          title: 'All Books',
          href: `${baseUrl}/opds/v1/catalog`,
          content: 'Browse all books in the library',
        },
        {
          id: 'urn:litara:opds:new',
          title: 'New Arrivals',
          href: `${baseUrl}/opds/v1/new`,
          content: 'Recently added books',
        },
        {
          id: 'urn:litara:opds:authors',
          title: 'By Author',
          href: `${baseUrl}/opds/v1/authors`,
          content: 'Browse books by author',
        },
        {
          id: 'urn:litara:opds:series',
          title: 'By Series',
          href: `${baseUrl}/opds/v1/series`,
          content: 'Browse books by series',
        },
        {
          id: 'urn:litara:opds:genres',
          title: 'By Genre',
          href: `${baseUrl}/opds/v1/genres`,
          content: 'Browse books by genre',
        },
      ],
    );

    res.setHeader('Content-Type', ATOM_NAV);
    res.end(xml);
  }

  @Get('search')
  openSearch(@Req() req: Request, @Res() res: Response) {
    // No auth — OPDS clients fetch this before showing the login prompt
    const baseUrl = getBaseUrl(req);
    const xml = buildOpenSearchDescription(baseUrl);
    res.setHeader('Content-Type', 'application/opensearchdescription+xml');
    res.send(xml);
  }

  @Get('search/results')
  @UseGuards(BasicAuthGuard)
  async searchResults(
    @Query('q') q: string = '',
    @Query('page') pageStr: string = '1',
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const page = Math.max(1, parseInt(pageStr, 10) || 1);
    const baseUrl = getBaseUrl(req);
    const [books, total] = await Promise.all([
      this.opdsService.searchBooks(q, page),
      this.opdsService.countSearch(q),
    ]);
    const selfUrl = `${baseUrl}/opds/v1/search/results?q=${encodeURIComponent(q)}`;

    const xml = buildAtomFeed(
      {
        id: `urn:litara:opds:search:${q}`,
        title: `Search: ${q}`,
        updated: new Date(),
        baseUrl,
        links: {
          self: pageUrl(selfUrl, page),
          next:
            page * PAGE_SIZE < total ? pageUrl(selfUrl, page + 1) : undefined,
          previous: page > 1 ? pageUrl(selfUrl, page - 1) : undefined,
        },
        totalResults: total,
        itemsPerPage: PAGE_SIZE,
      },
      books,
    );

    res.setHeader('Content-Type', ATOM_ACQ);
    res.end(xml);
  }

  @Get('catalog')
  @UseGuards(BasicAuthGuard)
  async catalog(
    @Query('page') pageStr: string = '1',
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const page = Math.max(1, parseInt(pageStr, 10) || 1);
    const baseUrl = getBaseUrl(req);
    const selfBase = `${baseUrl}/opds/v1/catalog`;
    const [books, total] = await Promise.all([
      this.opdsService.getBooks(page),
      this.opdsService.countBooks(),
    ]);

    const xml = buildAtomFeed(
      {
        id: 'urn:litara:opds:catalog',
        title: 'All Books',
        updated: new Date(),
        baseUrl,
        links: {
          self: pageUrl(selfBase, page),
          next:
            page * PAGE_SIZE < total ? pageUrl(selfBase, page + 1) : undefined,
          previous: page > 1 ? pageUrl(selfBase, page - 1) : undefined,
        },
        totalResults: total,
        itemsPerPage: PAGE_SIZE,
      },
      books,
    );

    res.setHeader('Content-Type', ATOM_ACQ);
    res.end(xml);
  }

  @Get('new')
  @UseGuards(BasicAuthGuard)
  async newArrivals(
    @Query('page') pageStr: string = '1',
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const page = Math.max(1, parseInt(pageStr, 10) || 1);
    const baseUrl = getBaseUrl(req);
    const selfBase = `${baseUrl}/opds/v1/new`;
    const [books, total] = await Promise.all([
      this.opdsService.getNewBooks(page),
      this.opdsService.countNewBooks(),
    ]);

    const xml = buildAtomFeed(
      {
        id: 'urn:litara:opds:new',
        title: 'New Arrivals',
        updated: new Date(),
        baseUrl,
        links: {
          self: pageUrl(selfBase, page),
          next:
            page * PAGE_SIZE < total ? pageUrl(selfBase, page + 1) : undefined,
          previous: page > 1 ? pageUrl(selfBase, page - 1) : undefined,
        },
        totalResults: total,
        itemsPerPage: PAGE_SIZE,
      },
      books,
    );

    res.setHeader('Content-Type', ATOM_ACQ);
    res.end(xml);
  }

  @Get('authors')
  @UseGuards(BasicAuthGuard)
  async authors(
    @Query('page') pageStr: string = '1',
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const page = Math.max(1, parseInt(pageStr, 10) || 1);
    const baseUrl = getBaseUrl(req);
    const [authors, total] = await Promise.all([
      this.opdsService.getAuthors(page),
      this.opdsService.countAuthors(),
    ]);
    const selfBase = `${baseUrl}/opds/v1/authors`;
    const now = new Date();

    const xml = buildNavigationFeed(
      {
        id: 'urn:litara:opds:authors',
        title: 'Authors',
        updated: now,
        baseUrl,
        links: {
          self: pageUrl(selfBase, page),
          next:
            page * PAGE_SIZE < total ? pageUrl(selfBase, page + 1) : undefined,
          previous: page > 1 ? pageUrl(selfBase, page - 1) : undefined,
        },
      },
      authors.map((a) => ({
        id: `urn:litara:author:${a.id}`,
        title: a.name,
        href: `${baseUrl}/opds/v1/authors/${a.id}`,
      })),
    );

    res.setHeader('Content-Type', ATOM_NAV);
    res.end(xml);
  }

  @Get('authors/:authorId')
  @UseGuards(BasicAuthGuard)
  async authorBooks(
    @Param('authorId') authorId: string,
    @Query('page') pageStr: string = '1',
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const page = Math.max(1, parseInt(pageStr, 10) || 1);
    const baseUrl = getBaseUrl(req);
    const selfBase = `${baseUrl}/opds/v1/authors/${authorId}`;
    const [books, total] = await Promise.all([
      this.opdsService.getBooksByAuthor(authorId, page),
      this.opdsService.countBooksByAuthor(authorId),
    ]);

    const xml = buildAtomFeed(
      {
        id: `urn:litara:opds:author:${authorId}`,
        title: 'Books by Author',
        updated: new Date(),
        baseUrl,
        links: {
          self: pageUrl(selfBase, page),
          next:
            page * PAGE_SIZE < total ? pageUrl(selfBase, page + 1) : undefined,
          previous: page > 1 ? pageUrl(selfBase, page - 1) : undefined,
        },
        totalResults: total,
        itemsPerPage: PAGE_SIZE,
      },
      books,
    );

    res.setHeader('Content-Type', ATOM_ACQ);
    res.end(xml);
  }

  @Get('series')
  @UseGuards(BasicAuthGuard)
  async series(
    @Query('page') pageStr: string = '1',
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const page = Math.max(1, parseInt(pageStr, 10) || 1);
    const baseUrl = getBaseUrl(req);
    const [seriesList, total] = await Promise.all([
      this.opdsService.getSeries(page),
      this.opdsService.countSeries(),
    ]);
    const selfBase = `${baseUrl}/opds/v1/series`;
    const now = new Date();

    const xml = buildNavigationFeed(
      {
        id: 'urn:litara:opds:series',
        title: 'Series',
        updated: now,
        baseUrl,
        links: {
          self: pageUrl(selfBase, page),
          next:
            page * PAGE_SIZE < total ? pageUrl(selfBase, page + 1) : undefined,
          previous: page > 1 ? pageUrl(selfBase, page - 1) : undefined,
        },
      },
      seriesList.map((s) => ({
        id: `urn:litara:series:${s.id}`,
        title: s.name,
        href: `${baseUrl}/opds/v1/series/${s.id}`,
      })),
    );

    res.setHeader('Content-Type', ATOM_NAV);
    res.end(xml);
  }

  @Get('series/:seriesId')
  @UseGuards(BasicAuthGuard)
  async seriesBooks(
    @Param('seriesId') seriesId: string,
    @Query('page') pageStr: string = '1',
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const page = Math.max(1, parseInt(pageStr, 10) || 1);
    const baseUrl = getBaseUrl(req);
    const selfBase = `${baseUrl}/opds/v1/series/${seriesId}`;
    const [books, total] = await Promise.all([
      this.opdsService.getBooksBySeries(seriesId, page),
      this.opdsService.countBooksBySeries(seriesId),
    ]);

    const xml = buildAtomFeed(
      {
        id: `urn:litara:opds:series:${seriesId}`,
        title: 'Books in Series',
        updated: new Date(),
        baseUrl,
        links: {
          self: pageUrl(selfBase, page),
          next:
            page * PAGE_SIZE < total ? pageUrl(selfBase, page + 1) : undefined,
          previous: page > 1 ? pageUrl(selfBase, page - 1) : undefined,
        },
        totalResults: total,
        itemsPerPage: PAGE_SIZE,
      },
      books,
    );

    res.setHeader('Content-Type', ATOM_ACQ);
    res.end(xml);
  }

  @Get('genres')
  @UseGuards(BasicAuthGuard)
  async genres(@Req() req: Request, @Res() res: Response) {
    const baseUrl = getBaseUrl(req);
    const genres = await this.opdsService.getGenres();
    const now = new Date();

    const xml = buildNavigationFeed(
      {
        id: 'urn:litara:opds:genres',
        title: 'Genres',
        updated: now,
        baseUrl,
        links: { self: `${baseUrl}/opds/v1/genres` },
      },
      genres.map((g) => ({
        id: `urn:litara:genre:${g.id}`,
        title: g.name,
        href: `${baseUrl}/opds/v1/genres/${encodeURIComponent(g.name)}`,
      })),
    );

    res.setHeader('Content-Type', ATOM_NAV);
    res.end(xml);
  }

  @Get('genres/:genreName')
  @UseGuards(BasicAuthGuard)
  async genreBooks(
    @Param('genreName') genreName: string,
    @Query('page') pageStr: string = '1',
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const page = Math.max(1, parseInt(pageStr, 10) || 1);
    const baseUrl = getBaseUrl(req);
    const selfBase = `${baseUrl}/opds/v1/genres/${encodeURIComponent(genreName)}`;
    const [books, total] = await Promise.all([
      this.opdsService.getBooksByGenre(genreName, page),
      this.opdsService.countBooksByGenre(genreName),
    ]);

    const xml = buildAtomFeed(
      {
        id: `urn:litara:opds:genre:${genreName}`,
        title: `Genre: ${genreName}`,
        updated: new Date(),
        baseUrl,
        links: {
          self: pageUrl(selfBase, page),
          next:
            page * PAGE_SIZE < total ? pageUrl(selfBase, page + 1) : undefined,
          previous: page > 1 ? pageUrl(selfBase, page - 1) : undefined,
        },
        totalResults: total,
        itemsPerPage: PAGE_SIZE,
      },
      books,
    );

    res.setHeader('Content-Type', ATOM_ACQ);
    res.end(xml);
  }

  @Get('download/:bookId/:fileId')
  @UseGuards(BasicAuthGuard)
  async download(
    @Param('bookId') bookId: string,
    @Param('fileId') fileId: string,
    @Res() res: Response,
  ) {
    const filePath = await this.opdsService.streamFile(bookId, fileId);
    const filename = encodeURIComponent(basename(filePath));
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    createReadStream(filePath).pipe(res);
  }
}
