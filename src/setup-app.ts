import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import type { Env } from './config/env.js';

export const API_PREFIX = 'api/v1';

// Shared by main.ts and e2e tests so both run the exact same HTTP pipeline.
export function setupApp(app: INestApplication): void {
  const config = app.get(ConfigService<Env, true>);

  const expressApp = app as NestExpressApplication;
  // Behind the hosting platform's proxy: trust X-Forwarded-* for the real client IP.
  expressApp.set('trust proxy', 1);
  // Card imports send up to 1M characters (~3MB of UTF-8 for Vietnamese); the default is 100kb.
  expressApp.useBodyParser('json', { limit: '4mb' });

  app.setGlobalPrefix(API_PREFIX);
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: config.get('CORS_ORIGINS', { infer: true }),
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  // Swagger UI at /docs, OpenAPI JSON at /docs-json (frontend generates its API types from it).
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('EnglishQuizz API')
      .setVersion('0.0.1')
      .addBearerAuth()
      .build(),
  );
  SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: 'docs-json' });
}
