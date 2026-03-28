import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { RequestMethod, VersioningType } from '@nestjs/common';
import { AppModule } from './app.module';
import helmet from 'helmet';
import type { Request, Response, NextFunction } from 'express';

async function bootstrap() {
  const logLevels = (process.env.LOG_LEVEL ?? 'log,warn,error').split(
    ',',
  ) as any[];
  const app = await NestFactory.create(AppModule, { logger: logLevels });

  // Security headers — skip for OPDS routes so ebook reader apps (Thorium,
  // KOReader, etc.) aren't blocked by CSP upgrade-insecure-requests or
  // Cross-Origin-Resource-Policy: same-origin.
  const helmetMiddleware = helmet({
    contentSecurityPolicy: {
      // useDefaults: true (default) applies Helmet's standard directives.
      // We only override imgSrc to allow external cover images.
      directives: {
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
