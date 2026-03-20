import { INestApplication, VersioningType } from '@nestjs/common';
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
    });
  }

  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication();

  // Apply the same middleware pipeline as src/main.ts
  app.use(helmet());
  app.setGlobalPrefix('api');
  app.enableCors();
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  await app.init();

  const db = moduleRef.get(DatabaseService);
  return { app, db, moduleRef };
}
