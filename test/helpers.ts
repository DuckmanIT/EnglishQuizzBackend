import { UnauthorizedException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import {
  GoogleTokenVerifier,
  type GoogleProfile,
} from '../src/auth/google-token-verifier.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

/**
 * Stands in for Google: the "ID token" is a JWT-shaped string whose payload is the profile itself.
 * A token whose payload is not valid JSON is rejected the way Google would reject a bad token.
 */
class FakeGoogleVerifier extends GoogleTokenVerifier {
  verify(idToken: string): Promise<GoogleProfile> {
    try {
      const payload = idToken.split('.')[1];
      return Promise.resolve(
        JSON.parse(
          Buffer.from(payload, 'base64url').toString(),
        ) as GoogleProfile,
      );
    } catch {
      return Promise.reject(
        new UnauthorizedException({
          code: 'AUTH_INVALID_GOOGLE_TOKEN',
          message: 'Google ID token is invalid or expired',
        }),
      );
    }
  }
}

export function fakeGoogleToken(profile: Partial<GoogleProfile> = {}): string {
  const full: GoogleProfile = {
    sub: 'google-sub-1',
    email: 'learner@example.com',
    emailVerified: true,
    name: 'Test Learner',
    picture: 'https://example.com/avatar.png',
    ...profile,
  };
  const b64 = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64(full)}.c2ln`;
}

export interface TestApp {
  app: INestApplication<App>;
  prisma: PrismaService;
}

export async function createTestApp(): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(GoogleTokenVerifier)
    .useClass(FakeGoogleVerifier)
    .compile();

  const app = moduleRef.createNestApplication<INestApplication<App>>();
  setupApp(app);
  await app.init();
  return { app, prisma: app.get(PrismaService) };
}

/** Empties every table (except Prisma's migration log) between tests. */
export async function resetDatabase(prisma: PrismaService): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} CASCADE`);
}

/** Pulls `name=value` for a cookie out of a Set-Cookie header list. */
export function getCookie(
  setCookie: string[] | string | undefined,
  name: string,
): { value: string; raw: string } | undefined {
  const headers = Array.isArray(setCookie)
    ? setCookie
    : setCookie
      ? [setCookie]
      : [];
  const raw = headers.find((h) => h.startsWith(`${name}=`));
  if (!raw) return undefined;
  return { value: raw.slice(name.length + 1).split(';')[0], raw };
}
