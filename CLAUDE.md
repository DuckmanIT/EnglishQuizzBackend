# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Backend API for EnglishQuizz, a clone of [openquiz.ai](https://openquiz.ai/): a vocabulary-learning app with flashcards, spaced repetition (FSRS), dictation, prebuilt learning paths, and Premium AI features. **`docs/DESIGN.md` is the source of truth** for the data model, endpoints, feature phases and hosting. Read it before adding a feature, and update it when a decision changes.

The frontend (Next.js) is a separate repo at `../EnglishQuizz` ([DuckmanIT/EnglishQuizz](https://github.com/DuckmanIT/EnglishQuizz)). It generates its API types from this server's OpenAPI spec at `/docs-json`, so DTOs and Swagger decorators are part of the contract.

## Commands

```bash
npm run start:dev                          # http://localhost:4000 (frontend dev uses :3000)
npm run build
npm run lint && npm run typecheck
npm test                                   # unit tests: src/**/*.spec.ts
npx vitest run src/path/to/file.spec.ts    # single file
npx vitest run -t "test name"              # single test
npm run test:e2e                           # test/**/*.e2e-spec.ts, real Postgres DB englishquizz_test (needs docker compose up)
docker compose up -d                       # Postgres + Redis for local dev
npm run db:migrate                         # prisma migrate dev + prisma generate (Prisma 7 no longer generates on migrate)
```

## Conventions

- **ESM + NodeNext:** relative imports must end in `.js` (e.g. `./app.module.js`).
- **Prisma 7:** the client is generated into `src/generated/prisma` (gitignored; `npm install` runs `prisma generate`). Import from `../generated/prisma/client.js`. Migrations use `DIRECT_URL` (`prisma.config.ts`); the app uses `DATABASE_URL` through the `@prisma/adapter-pg` driver adapter in `PrismaService`.
- **Env:** every variable is declared and validated in `src/config/env.ts` (zod). Read config through `ConfigService<Env, true>` with `{ infer: true }`, not `process.env`.
- **HTTP pipeline** lives in `src/setup-app.ts` (prefix `/api/v1`, CORS, cookies, helmet, ValidationPipe, Swagger, error filter) and is shared by `main.ts` and e2e tests.
- **Errors:** all responses use `{ statusCode, code, message }`. For a domain error, throw `new HttpException({ code: 'DECK_NOT_FOUND', message }, 404)`; the frontend branches on `code`.
- **Auth:** a global `JwtAuthGuard` protects every route. Mark public routes with `@Public()` and get the caller with `@CurrentUser() user: AuthUser` (both in `src/auth/auth-user.ts`). The refresh token only travels in the `eq_refresh` cookie, handled by `RefreshCookie`.
- **E2E tests** run against a dedicated database, `englishquizz_test`, which `test/global-setup.ts` creates and migrates. Use `createTestApp()` and `resetDatabase()` from `test/helpers.ts`. Google is faked through `GoogleTokenVerifier`, so `fakeGoogleToken({...})` stands in for an ID token. Never point tests at the dev DB.
- **Modules:** one folder per domain under `src/` (auth, decks, cards, study, …) as listed in DESIGN.md. Ownership checks live in services, not controllers.
- **Phases:** build MVP features first (auth, decks/cards, catalog, SRS, study modes, stats). Do not build Phase 2/3 features unless asked.
- **Environments:** localhost (`.env` + docker compose) and production (env vars on the hosting platform). Production deploys only from `main` via `.github/workflows/ci.yml`, after lint, typecheck, unit, e2e, build and docker build all pass. Never point local tooling at the production DB. Migrations run before the new code goes live, so keep them backward compatible.
- **Hosting:** Singapore region. API on Render (Docker service `englishquizzbackend`, deployed only by the CI deploy hook), Postgres on Neon (`neondb`), S3/Upstash planned for phase 2. Domain `duckman.io.vn`, API at `https://api.duckman.io.vn` (CNAME at Nhân Hòa). Do not use Cloudflare.
