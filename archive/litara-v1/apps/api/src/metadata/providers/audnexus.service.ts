import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { MetadataResult } from '../interfaces/metadata-result.interface';

const DEFAULT_BASE_URL = 'https://api.audnex.us';

interface AudnexusAuthor {
  name: string;
  asin?: string;
}

interface AudnexusNarrator {
  name: string;
}

interface AudnexusGenre {
  name: string;
  type?: string;
}

interface AudnexusSeriesEntry {
  name: string;
  position?: string;
  asin?: string;
}

interface AudnexusBook {
  asin?: string;
  title?: string;
  subtitle?: string;
  summary?: string;
  description?: string;
  authors?: AudnexusAuthor[];
  narrators?: AudnexusNarrator[];
  genres?: AudnexusGenre[];
  image?: string;
  publisherName?: string;
  releaseDate?: string;
  language?: string;
  seriesLadder?: AudnexusSeriesEntry[];
  runtimeLengthMin?: number;
}

@Injectable()
export class AudnexusService {
  private readonly logger = new Logger(AudnexusService.name);
  private readonly baseUrl: string;

  constructor(private readonly config: ConfigService) {
    this.baseUrl =
      this.config.get<string>('AUDNEXUS_BASE_URL') ?? DEFAULT_BASE_URL;
  }

  async searchByAsin(asin: string): Promise<MetadataResult | null> {
    const url = `${this.baseUrl}/books/${encodeURIComponent(asin)}`;
    this.logger.debug(`Audnexus request: GET ${url}`);
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Litara/1.0' } });
      this.logger.debug(
        `Audnexus response: HTTP ${res.status} for ASIN ${asin}`,
      );
      if (!res.ok) {
        if (res.status === 404) return null;
        this.logger.warn(`Audnexus: HTTP ${res.status} for ASIN ${asin}`);
        return null;
      }
      const data = (await res.json()) as AudnexusBook;
      const result = this.mapToResult(data);
      this.logger.debug(
        `Audnexus result: title="${result?.title ?? 'null'}" asin=${result?.asin ?? 'n/a'}`,
      );
      return result;
    } catch (err) {
      this.logger.warn(
        `Audnexus ASIN lookup failed: ${(err as Error).message}`,
      );
      return null;
    }
  }

  private mapToResult(data: AudnexusBook): MetadataResult | null {
    if (!data.title) return null;

    const result: MetadataResult = { title: data.title };

    if (data.subtitle) result.subtitle = data.subtitle;
    if (data.summary || data.description)
      result.description = data.summary ?? data.description;
    if (data.publisherName) result.publisher = data.publisherName;
    if (data.image) result.coverUrl = data.image;
    if (data.asin) result.asin = data.asin;

    if (data.releaseDate) {
      const d = new Date(data.releaseDate);
      if (!isNaN(d.getTime()))
        result.publishedDate = d.toISOString().slice(0, 10);
    }

    if (data.language) result.language = data.language.toLowerCase();

    if (data.authors?.length) {
      result.authors = data.authors
        .map((a) => a.name)
        .filter((n): n is string => !!n);
    }

    if (data.genres?.length) {
      result.genres = data.genres
        .filter((g) => g.type === 'genre' || !g.type)
        .map((g) => g.name)
        .filter((n): n is string => !!n);
    }

    // Store narrators in categories as "Narrator: <name>" for tag ingestion
    if (data.narrators?.length) {
      result.categories = data.narrators
        .map((n) => n.name)
        .filter((n): n is string => !!n)
        .map((n) => `Narrator: ${n}`);
    }

    const primarySeries = data.seriesLadder?.[0];
    if (primarySeries?.name) {
      result.seriesName = primarySeries.name;
      if (primarySeries.position != null) {
        const pos = parseFloat(primarySeries.position);
        if (!isNaN(pos)) result.seriesPosition = pos;
      }
    }

    return result;
  }
}
