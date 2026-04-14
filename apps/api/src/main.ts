import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { RequestMethod, VersioningType } from '@nestjs/common';
import { AppModule } from './app.module';
import helmet from 'helmet';
import type { Request, Response, NextFunction } from 'express';

async function bootstrap() {
  const logLevels = (process.env.LOG_LEVEL ?? 'log,warn,error').split(
    ',',
  ) as any[];
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: logLevels,
  });

  // Trust X-Forwarded-Proto/X-Forwarded-For from a reverse proxy (e.g. Caddy)
  // so req.protocol reflects https and OPDS feed URLs are generated correctly.
  app.set('trust proxy', 1);

  // Security headers — skip for OPDS routes so ebook reader apps (Thorium,
  // KOReader, etc.) aren't blocked by CSP upgrade-insecure-requests or
  // Cross-Origin-Resource-Policy: same-origin.
  const helmetMiddleware = helmet({
    // HSTS is managed by the reverse proxy (e.g. Caddy); disable here so
    // direct HTTP access (e.g. on the LAN) isn't permanently locked to HTTPS.
    hsts: false,
    contentSecurityPolicy: {
      // useDefaults: true (default) applies Helmet's standard directives.
      // We only override imgSrc to allow external cover images.
      directives: {
        // Disable upgrade-insecure-requests so HTTP deployments (direct LAN
        // access, testing without a proxy) don't have assets upgraded to HTTPS.
        upgradeInsecureRequests: null,
        imgSrc: [
          "'self'",
          'data:',
          'blob:',
          'https://covers.openlibrary.org',
          'https://m.media-amazon.com',
          'https://books.google.com',
          'https://assets.hardcover.app',
        ],
        // foliate-js renders ebook content in blob: URL iframes and loads
        // blob: stylesheets and images from within those iframes
        frameSrc: ["'self'", 'blob:'],
        workerSrc: ["'self'", 'blob:'],
        styleSrc: ["'self'", 'https:', "'unsafe-inline'", 'blob:'],
        // ebook HTML inside foliate-js iframes uses inline event handlers
        scriptSrcAttr: ["'unsafe-inline'"],
      },
    },
  });
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/opds')) return next();
    return helmetMiddleware(req, res, next);
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

  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  const config = new DocumentBuilder()
    .setTitle('Litara API')
    .setDescription('The Litara API description')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const documentFactory = () => SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('/docs', app, documentFactory, {
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
