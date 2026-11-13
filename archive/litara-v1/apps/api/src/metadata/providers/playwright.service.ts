import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

const PLAYWRIGHT_SETTING_KEY = 'goodreads_playwright_enabled';

interface PlaywrightBrowserContext {
  newPage(): Promise<PlaywrightPage>;
  close(): Promise<void>;
}

interface PlaywrightBrowser {
  newContext(options?: {
    userAgent?: string;
  }): Promise<PlaywrightBrowserContext>;
  close(): Promise<void>;
}

interface PlaywrightPage {
  goto(
    url: string,
    options?: { waitUntil?: string; timeout?: number },
  ): Promise<unknown>;
  waitForFunction(fn: string, options?: { timeout?: number }): Promise<unknown>;
  content(): Promise<string>;
  url(): string;
  close(): Promise<void>;
}

interface PlaywrightModule {
  chromium: {
    launch(options?: {
      headless?: boolean;
      args?: string[];
    }): Promise<PlaywrightBrowser>;
  };
}

@Injectable()
export class PlaywrightService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PlaywrightService.name);
  private browser: PlaywrightBrowser | null = null;

  constructor(private readonly db: DatabaseService) {}

  async onModuleInit() {
    const setting = await this.db.serverSettings.findUnique({
      where: { key: PLAYWRIGHT_SETTING_KEY },
    });
    if (setting?.value === 'false') return;

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pw = require('playwright') as PlaywrightModule;
      this.browser = await pw.chromium.launch({
        headless: true,
        args: ['--disable-blink-features=AutomationControlled'],
      });
      this.logger.log('Playwright browser launched for Goodreads scraping');
    } catch {
      this.logger.warn(
        'goodreads_playwright_enabled is set but playwright is not installed. ' +
          'Run: npm install playwright && npx playwright install chromium',
      );
    }
  }

  async onModuleDestroy() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  isAvailable(): boolean {
    return this.browser !== null;
  }

  async fetchHtml(url: string): Promise<{ html: string; responseUrl: string }> {
    if (!this.browser) {
      throw new Error('Playwright browser is not running');
    }
    const context = await this.browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      // Wait for the page body to be populated by JS before capturing HTML
      await page.waitForFunction(
        'document.body && document.body.innerText.trim().length > 100',
        { timeout: 15000 },
      );
      const html = await page.content();
      const responseUrl = page.url();
      return { html, responseUrl };
    } finally {
      await page.close();
      await context.close();
    }
  }
}
