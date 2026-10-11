# EnglishQuizz Backend

API cho EnglishQuizz — ứng dụng học từ vựng (clone [openquiz.ai](https://openquiz.ai/)): flashcard, spaced repetition (FSRS), luyện chính tả, lộ trình học, và các tính năng AI.

- Thiết kế: [`docs/DESIGN.md`](docs/DESIGN.md)
- Frontend: [DuckmanIT/EnglishQuizz](https://github.com/DuckmanIT/EnglishQuizz)
- Stack: NestJS 12 · TypeScript (ESM) · PostgreSQL · Prisma 7 · Vitest

## Yêu cầu

- Node.js 24+
- Docker Desktop (chạy Postgres + Redis khi dev) — hoặc dùng DB trên Neon và đặt URL vào `.env`

## Chạy ở máy

```bash
npm install                 # cài package và sinh Prisma Client
cp .env.example .env        # chỉnh nếu cần
docker compose up -d        # Postgres :5432, Redis :6379
npm run db:migrate          # tạo/áp dụng migration
npm run start:dev           # http://localhost:4000
```

- Health check: `GET http://localhost:4000/api/v1/health`
- Swagger UI: http://localhost:4000/docs — OpenAPI JSON: http://localhost:4000/docs-json

## Môi trường

- **Localhost:** `.env` + `docker compose`, như trên.
- **Production:** chỉ deploy từ `main` sau khi CI (lint, typecheck, test, build, docker build) pass — xem [`.github/workflows/ci.yml`](.github/workflows/ci.yml) và mục "Môi trường & quy trình deploy" trong [`docs/DESIGN.md`](docs/DESIGN.md).

## Scripts

| Lệnh | Mô tả |
|---|---|
| `npm run start:dev` | Chạy dev, tự reload |
| `npm run build` / `npm run start:prod` | Build và chạy bản production |
| `npm run lint` / `npm run typecheck` | oxlint / tsc |
| `npm test` | Unit test (`src/**/*.spec.ts`) |
| `npm run test:e2e` | E2E test (`test/**/*.e2e-spec.ts`, Prisma được mock — không cần DB) |
| `npm run db:migrate` | `prisma migrate dev` (dùng `DIRECT_URL`) |
| `npm run db:deploy` | Áp dụng migration ở production |
| `npm run db:studio` | Prisma Studio |
