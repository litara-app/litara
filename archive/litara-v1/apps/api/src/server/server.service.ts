import { Injectable, Logger } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { VersionCheckDto } from './dto/version-check.dto';

interface GitHubRelease {
  tag_name: string;
  html_url: string;
  body: string | null;
}

@Injectable()
export class ServerService {
  private readonly logger = new Logger(ServerService.name);
  private readonly currentVersion: string;
  private readonly CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
  private cache: { data: VersionCheckDto; expiresAt: number } | null = null;

  constructor() {
    // In production Docker: LITARA_ROOT=/app, package.json is at /app/package.json
    // In dev (ts-node): __dirname = apps/api/src/server, 4 levels up = repo root
    const root =
      process.env.LITARA_ROOT ?? join(__dirname, '..', '..', '..', '..');
    try {
      const raw = readFileSync(join(root, 'package.json'), 'utf-8');
      const pkg = JSON.parse(raw) as { version: string };
      this.currentVersion = pkg.version;
    } catch {
      this.logger.warn(
        'Could not read root package.json; version will report as 0.0.0',
      );
      this.currentVersion = '0.0.0';
    }
  }

  getCurrentVersion(): { version: string } {
    return { version: this.currentVersion };
  }

  async getVersionCheck(): Promise<VersionCheckDto> {
    const now = Date.now();
    if (this.cache && now < this.cache.expiresAt) {
      return this.cache.data;
    }
    const data = await this.fetchFromGitHub();
    this.cache = { data, expiresAt: now + this.CACHE_TTL_MS };
    return data;
  }

  private async fetchFromGitHub(): Promise<VersionCheckDto> {
    const fallback: VersionCheckDto = {
      currentVersion: this.currentVersion,
      latestVersion: this.currentVersion,
      updateAvailable: false,
      releaseUrl: 'https://github.com/litara-app/litara/releases',
      releaseNotes: '',
      cachedAt: new Date().toISOString(),
    };

    try {
      const res = await fetch(
        'https://api.github.com/repos/litara-app/litara/releases/latest',
        {
          headers: {
            'User-Agent': 'litara-app/litara',
            Accept: 'application/vnd.github+json',
          },
          signal: AbortSignal.timeout(10_000),
        },
      );

      if (!res.ok) {
        this.logger.warn(`GitHub releases API returned HTTP ${res.status}`);
        return fallback;
      }

      const release = (await res.json()) as GitHubRelease;
      const latestVersion = release.tag_name.replace(/^v/, '');

      return {
        currentVersion: this.currentVersion,
        latestVersion,
        updateAvailable: this.isNewer(latestVersion, this.currentVersion),
        releaseUrl: release.html_url,
        releaseNotes: release.body ?? '',
        cachedAt: new Date().toISOString(),
      };
    } catch (err) {
      this.logger.warn(
        `Failed to fetch GitHub releases: ${(err as Error).message}`,
      );
      return fallback;
    }
  }

  private isNewer(latest: string, current: string): boolean {
    const parse = (v: string) => v.split('.').map(Number);
    const [lMaj, lMin, lPat] = parse(latest);
    const [cMaj, cMin, cPat] = parse(current);
    if (lMaj !== cMaj) return (lMaj ?? 0) > (cMaj ?? 0);
    if (lMin !== cMin) return (lMin ?? 0) > (cMin ?? 0);
    return (lPat ?? 0) > (cPat ?? 0);
  }
}
