import {
  Controller,
  Get,
  Query,
  Req,
  Res,
  UseFilters,
  UseGuards,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { BasicAuthGuard } from './auth/basic-auth.guard';
import { OpdsUnauthorizedFilter } from './auth/opds-unauthorized.filter';
import { OpdsEnabledGuard } from './opds-enabled.guard';
import { OpdsService } from './opds.service';
import {
  buildV2Feed,
  buildV2NavigationFeed,
} from './builders/opds-v2-feed.builder';

const PAGE_SIZE = 20;
const OPDS_JSON = 'application/opds+json;charset=utf-8';

function getBaseUrl(req: Request): string {
  return `${req.protocol}://${req.get('host')}`;
}

function pageUrl(base: string, page: number): string {
  const url = new URL(base);
  url.searchParams.set('page', String(page));
  return url.toString();
}

// NOTE: OPDS v2.0 support is highly experimental. Client compatibility varies
// widely and the spec is still evolving. Please report issues on GitHub.
@UseFilters(OpdsUnauthorizedFilter)
@UseGuards(OpdsEnabledGuard)
@Controller({ path: 'opds/v2', version: VERSION_NEUTRAL })
export class OpdsV2Controller {
  constructor(private readonly opdsService: OpdsService) {}

  @Get()
  @UseGuards(BasicAuthGuard)
  root(@Req() req: Request, @Res() res: Response) {
    const baseUrl = getBaseUrl(req);

    const feed = buildV2NavigationFeed(
      {
        title: 'Litara Library',
        baseUrl,
        self: `${baseUrl}/opds/v2`,
      },
      [
        {
          href: `${baseUrl}/opds/v2/publications`,
          title: 'All Books',
          type: 'application/opds+json',
          rel: 'http://opds-spec.org/sort/new',
        },
        {
          href: `${baseUrl}/opds/v2/new`,
          title: 'New Arrivals',
          type: 'application/opds+json',
          rel: 'http://opds-spec.org/sort/new',
        },
      ],
    );

    res.setHeader('Content-Type', OPDS_JSON);
    res.json(feed);
  }

  @Get('publications')
  @UseGuards(BasicAuthGuard)
  async publications(
    @Query('page') pageStr: string = '1',
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const page = Math.max(1, parseInt(pageStr, 10) || 1);
    const baseUrl = getBaseUrl(req);
    const selfBase = `${baseUrl}/opds/v2/publications`;
    const [books, total] = await Promise.all([
      this.opdsService.getBooks(page),
      this.opdsService.countBooks(),
    ]);

    const feed = buildV2Feed(
      {
        title: 'All Books',
        id: 'urn:litara:opds:v2:publications',
        baseUrl,
        self: pageUrl(selfBase, page),
        next:
          page * PAGE_SIZE < total ? pageUrl(selfBase, page + 1) : undefined,
        previous: page > 1 ? pageUrl(selfBase, page - 1) : undefined,
        totalItems: total,
        numberOfItems: books.length,
      },
      books,
    );

    res.setHeader('Content-Type', OPDS_JSON);
    res.json(feed);
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
    const selfBase = `${baseUrl}/opds/v2/new`;
    const [books, total] = await Promise.all([
      this.opdsService.getNewBooks(page),
      this.opdsService.countNewBooks(),
    ]);

    const feed = buildV2Feed(
      {
        title: 'New Arrivals',
        id: 'urn:litara:opds:v2:new',
        baseUrl,
        self: pageUrl(selfBase, page),
        next:
          page * PAGE_SIZE < total ? pageUrl(selfBase, page + 1) : undefined,
        previous: page > 1 ? pageUrl(selfBase, page - 1) : undefined,
        totalItems: total,
        numberOfItems: books.length,
      },
      books,
    );

    res.setHeader('Content-Type', OPDS_JSON);
    res.json(feed);
  }

  @Get('search')
  @UseGuards(BasicAuthGuard)
  async search(
    @Query('q') q: string = '',
    @Query('page') pageStr: string = '1',
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const page = Math.max(1, parseInt(pageStr, 10) || 1);
    const baseUrl = getBaseUrl(req);
    const selfBase = `${baseUrl}/opds/v2/search?q=${encodeURIComponent(q)}`;
    const [books, total] = await Promise.all([
      this.opdsService.searchBooks(q, page),
      this.opdsService.countSearch(q),
    ]);

    const feed = buildV2Feed(
      {
        title: `Search: ${q}`,
        id: `urn:litara:opds:v2:search:${q}`,
        baseUrl,
        self: pageUrl(selfBase, page),
        next:
          page * PAGE_SIZE < total ? pageUrl(selfBase, page + 1) : undefined,
        previous: page > 1 ? pageUrl(selfBase, page - 1) : undefined,
        totalItems: total,
        numberOfItems: books.length,
      },
      books,
    );

    res.setHeader('Content-Type', OPDS_JSON);
    res.json(feed);
  }
}
