import {
  INestApplication,
  RequestMethod,
  VersioningType,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import helmet from 'helmet';
import { AppModule } from '../../src/app.module';
import { DatabaseService } from '../../src/database/database.service';
import { LibraryScannerService } from '../../src/library/library-scanner.service';

export interface TestApp {
  app: INestApplication;
  db: DatabaseService;
  moduleRef: TestingModule;
}

export async function createTestApp(options?: {
  mockScanner?: boolean;
}): Promise<TestApp> {
  const builder = Test.createTestingModule({ imports: [AppModule] });

  if (options?.mockScanner) {
    builder.overrideProvider(LibraryScannerService).useValue({
      onModuleInit: () => Promise.resolve(),
      onModuleDestroy: () => {},
      fullScan: () => Promise.resolve(),
      triggerFullScanTask: () => Promise.resolve({ taskId: 'mock-task-id' }),
    });
  }

  const moduleRef = await builder.compile();

  // Suppress the fire-and-forget startup scan that onModuleInit launches.
  // If allowed to run, it races with cleanDatabase() calls in beforeAll hooks:
  // the background scan creates a Book row, cleanDatabase truncates it, then
  // the scan tries to insert BookAuthor for the now-deleted bookId → P2003 FK
  // violation. Tests that need a scan call fullScan() explicitly after cleanup.
  if (!options?.mockScanner) {
    const scanner = moduleRef.get(LibraryScannerService);
    jest.spyOn(scanner, 'onModuleInit').mockResolvedValue();
  }

  const app = moduleRef.createNestApplication();

  // Apply the same middleware pipeline as src/main.ts
  const helmetMiddleware = helmet();
  app.use((req: { path: string }, res: unknown, next: () => void) => {
    if (req.path.startsWith('/opds')) return next();
    return helmetMiddleware(req as never, res as never, next);
  });
  app.setGlobalPrefix('api', {
    exclude: [
      { path: 'opds', method: RequestMethod.ALL },
      { path: 'opds/*path', method: RequestMethod.ALL },
      { path: '1', method: RequestMethod.ALL },
      { path: '1/*path', method: RequestMethod.ALL },
    ],
  });
  app.enableCors();
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  await app.init();

  const db = moduleRef.get(DatabaseService);
  return { app, db, moduleRef };
}
