# EnglishQuizz Backend — Thiết kế

> Backend cho sản phẩm clone [openquiz.ai](https://openquiz.ai/): ứng dụng học từ vựng ngoại ngữ bằng flashcard, lặp lại ngắt quãng (spaced repetition), luyện chính tả (dictation) và các tính năng AI (sinh flashcard từ ảnh, lộ trình cá nhân hoá, hội thoại với AI).

- **Stack:** NestJS + TypeScript, PostgreSQL + Prisma
- **AI provider:** chưa chốt — dùng lớp abstraction `AiProvider`, chọn provider sau
- **Frontend:** repo riêng [DuckmanIT/EnglishQuizz](https://github.com/DuckmanIT/EnglishQuizz) — Next.js (App Router) + TypeScript, chạy ở `http://localhost:3000` khi dev, gọi backend qua `NEXT_PUBLIC_API_BASE_URL`
- **Trạng thái:** bản thiết kế, chưa có code

### Hợp đồng với frontend

- Backend xuất OpenAPI spec (Swagger) tại `/docs-json`; frontend sinh type cho `lib/api/` từ spec này (vd `openapi-typescript`) để type hai bên luôn khớp.
- CORS cho phép origin của frontend (lấy từ env `CORS_ORIGINS`, mặc định `http://localhost:3000`).
- Auth: access token gửi qua header `Authorization: Bearer`; refresh token đặt trong cookie `httpOnly; Secure; SameSite=Lax` để Next.js (kể cả Server Components) dùng được.
- Backend giữ quyền chấm điểm và tính lịch ôn; frontend chỉ giữ state của phiên học đang chạy.

---

## 1. Phạm vi tính năng

### Bản tham chiếu (openquiz.ai)

| Nhóm | Tính năng | Gói |
|---|---|---|
| Flashcard | Tạo bộ thẻ / thẻ thủ công | Free |
| Ôn tập | Spaced repetition không giới hạn | Free |
| Ôn tập | Dictation / luyện chính tả không giới hạn | Free |
| Ôn tập | Các chế độ học cơ bản (lật thẻ, trắc nghiệm, ghép…) | Free |
| Lộ trình | Lộ trình dựng sẵn (IELTS, TOEIC, Vocabulary in Use, HSK, TOPIK, JLPT…) | Free |
| AI | Sinh flashcard từ ảnh (thực đơn, tài liệu, biển báo) | Premium |
| AI | Lộ trình học cá nhân hoá | Premium |
| AI | Hội thoại với AI theo kịch bản (du lịch, công việc, phỏng vấn) | Premium |
| Tài khoản | Đăng nhập Google / Apple | — |
| Thanh toán | Premium tháng 159.000đ / năm 790.000đ | — |
| Ngôn ngữ | 50+ ngôn ngữ học, giao diện VI/EN | — |

### Phân pha

- **MVP (Pha 1):** auth (Google/Apple + JWT), bộ thẻ & thẻ, thư viện bộ thẻ dựng sẵn, spaced repetition, các chế độ học (flip, multiple choice, dictation), thống kê cơ bản.
- **Pha 2:** subscription + gating Premium, AI sinh flashcard từ ảnh/văn bản, TTS phát âm.
- **Pha 3:** hội thoại AI, lộ trình cá nhân hoá, streak/gamification, thông báo nhắc ôn.

---

## 2. Kiến trúc tổng quan

```
Client (Web / Mobile)
        │  REST + JSON (JWT Bearer)       WebSocket/SSE (stream hội thoại AI)
        ▼
┌─────────────────────── NestJS API ───────────────────────┐
│ auth · users · decks · cards · catalog(paths) · study    │
│ srs · dictation · ai · conversation · subscription       │
│ media · stats · admin                                    │
└──────┬──────────────┬──────────────┬─────────────┬───────┘
       ▼              ▼              ▼             ▼
  PostgreSQL       Redis          Object storage   AI provider
  (Prisma)     (cache, rate     (S3: ảnh upload,    (qua AiProvider
               limit, BullMQ)    audio TTS)         abstraction)
```

- **Monolith module hoá** — tách module theo domain, đủ cho giai đoạn đầu; tách service sau nếu cần.
- **Hàng đợi (BullMQ trên Redis)** cho tác vụ chậm: sinh flashcard bằng AI, OCR ảnh, tạo audio TTS, gửi nhắc ôn.
- **Cấu trúc thư mục dự kiến:**

```
src/
  main.ts, app.module.ts
  common/        # guards, decorators, filters, interceptors, pagination
  config/        # env schema (zod/joi), config module
  prisma/        # PrismaService
  modules/
    auth/ users/ decks/ cards/ catalog/ study/ srs/
    ai/ conversation/ subscription/ media/ stats/ admin/
prisma/
  schema.prisma, migrations/, seed.ts
test/
```

---

## 3. Mô hình dữ liệu (Prisma, rút gọn)

```prisma
enum Plan        { FREE PREMIUM }
enum AuthProvider{ GOOGLE APPLE EMAIL }
enum DeckSource  { USER SYSTEM AI }
enum Visibility  { PRIVATE UNLISTED PUBLIC }
enum StudyMode   { FLIP MULTIPLE_CHOICE DICTATION MATCH TYPE_ANSWER }
enum CardState   { NEW LEARNING REVIEW RELEARNING }
enum Rating      { AGAIN HARD GOOD EASY }

model User {
  id            String   @id @default(uuid())
  email         String   @unique
  displayName   String?
  avatarUrl     String?
  nativeLang    String   @default("vi")     // ISO 639-1
  targetLangs   String[]                    // ngôn ngữ đang học
  role          String   @default("user")   // user | admin
  timezone      String   @default("Asia/Ho_Chi_Minh")
  dailyNewLimit Int      @default(20)
  createdAt     DateTime @default(now())
  identities    Identity[]
  subscription  Subscription?
  decks         Deck[]
  cardProgress  CardProgress[]
  reviewLogs    ReviewLog[]
}

model Identity {               // liên kết tài khoản OAuth
  id         String       @id @default(uuid())
  userId     String
  provider   AuthProvider
  providerId String                         // sub từ Google/Apple
  user       User @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([provider, providerId])
}

model RefreshToken {
  id        String   @id @default(uuid())
  userId    String
  tokenHash String   @unique
  expiresAt DateTime
  revokedAt DateTime?
}

model Deck {
  id          String     @id @default(uuid())
  ownerId     String?                       // null nếu là deck hệ thống
  title       String
  description String?
  frontLang   String                        // ngôn ngữ mặt trước (vd "en")
  backLang    String                        // ngôn ngữ mặt sau (vd "vi")
  source      DeckSource @default(USER)
  visibility  Visibility @default(PRIVATE)
  coverUrl    String?
  cardCount   Int        @default(0)
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt
  owner       User?      @relation(fields: [ownerId], references: [id])
  cards       Card[]
  pathItems   PathItem[]
  @@index([ownerId])
}

model Card {
  id          String  @id @default(uuid())
  deckId      String
  term        String                       // từ / cụm từ
  definition  String                       // nghĩa
  phonetic    String?                      // IPA / pinyin / romaji
  partOfSpeech String?
  example     String?
  exampleTrans String?
  imageUrl    String?
  audioUrl    String?
  position    Int
  deck        Deck @relation(fields: [deckId], references: [id], onDelete: Cascade)
  progress    CardProgress[]
  @@index([deckId, position])
}

model CardProgress {           // trạng thái SRS của 1 user với 1 thẻ
  userId     String
  cardId     String
  state      CardState @default(NEW)
  due        DateTime  @default(now())
  stability  Float     @default(0)          // FSRS
  difficulty Float     @default(0)          // FSRS
  reps       Int       @default(0)
  lapses     Int       @default(0)
  lastReview DateTime?
  user       User @relation(fields: [userId], references: [id], onDelete: Cascade)
  card       Card @relation(fields: [cardId], references: [id], onDelete: Cascade)
  @@id([userId, cardId])
  @@index([userId, due])
}

model ReviewLog {              // lịch sử mỗi lần trả lời — phục vụ thống kê & tối ưu FSRS
  id         String    @id @default(uuid())
  userId     String
  cardId     String
  mode       StudyMode
  rating     Rating
  correct    Boolean
  answer     String?                        // câu user gõ (dictation/type)
  durationMs Int?
  reviewedAt DateTime  @default(now())
  user       User @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId, reviewedAt])
}

model LearningPath {           // lộ trình dựng sẵn hoặc do AI tạo
  id          String  @id @default(uuid())
  slug        String  @unique                // "ielts-reading-vocab"
  title       String
  language    String
  level       String?                        // "B2", "N3", "HSK4"…
  isSystem    Boolean @default(true)
  ownerId     String?                        // khác null nếu là lộ trình AI cá nhân
  items       PathItem[]
}

model PathItem {
  pathId   String
  deckId   String
  position Int
  path     LearningPath @relation(fields: [pathId], references: [id], onDelete: Cascade)
  deck     Deck         @relation(fields: [deckId], references: [id])
  @@id([pathId, deckId])
}

model UserPathEnrollment {
  userId    String
  pathId    String
  startedAt DateTime @default(now())
  @@id([userId, pathId])
}

model Subscription {
  id               String    @id @default(uuid())
  userId           String    @unique
  plan             Plan      @default(FREE)
  period           String?                  // monthly | yearly
  status           String                   // active | canceled | expired
  provider         String?                  // vnpay | momo | apple | google | stripe
  providerRef      String?
  currentPeriodEnd DateTime?
  user             User @relation(fields: [userId], references: [id])
}

model AiJob {                  // job sinh flashcard bằng AI
  id        String   @id @default(uuid())
  userId    String
  type      String                          // image_to_cards | text_to_cards | path
  status    String                          // queued | running | done | failed
  input     Json
  result    Json?
  error     String?
  deckId    String?                         // deck được tạo ra
  createdAt DateTime @default(now())
}

model Conversation {
  id        String   @id @default(uuid())
  userId    String
  scenario  String                          // travel | work | interview | custom
  language  String
  level     String?
  createdAt DateTime @default(now())
  messages  ConversationMessage[]
}

model ConversationMessage {
  id             String   @id @default(uuid())
  conversationId String
  role           String                     // user | assistant
  content        String
  corrections    Json?                      // gợi ý sửa lỗi ngữ pháp/từ vựng
  createdAt      DateTime @default(now())
  conversation   Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
}

model UsageCounter {           // đếm quota AI theo ngày/tháng
  userId String
  key    String                             // "ai_cards:2026-10" …
  count  Int    @default(0)
  @@id([userId, key])
}
```

**Ghi chú:**
- Thẻ thuộc deck hệ thống được dùng chung; tiến độ riêng từng user nằm ở `CardProgress`, nên user không phải copy deck để học.
- User muốn chỉnh sửa deck hệ thống → "clone" sang deck riêng (`source = USER`).
- `cardCount` được cập nhật trong cùng transaction khi thêm/xoá thẻ.

---

## 4. Spaced repetition

- **Thuật toán:** FSRS (dùng thư viện `ts-fsrs`) — chính xác hơn SM-2, đang là chuẩn của Anki. Lưu `stability`, `difficulty`, `due`, `state` trong `CardProgress`.
- **Hàng đợi học hằng ngày** (`GET /study/queue`):
  1. Thẻ đến hạn ôn: `due <= now`, sắp xếp theo `due`.
  2. Thẻ mới: tối đa `dailyNewLimit − số thẻ mới đã học hôm nay` (tính theo `timezone` của user).
- **Quy đổi kết quả sang rating:**
  - Flip: user tự chọn Again/Hard/Good/Easy.
  - Multiple choice / Match: sai → AGAIN; đúng → GOOD (đúng nhanh dưới ngưỡng → EASY).
  - Dictation / Type answer: so khớp sau khi chuẩn hoá (lowercase, bỏ dấu câu, trim). Khoảng cách Levenshtein = 0 → GOOD, ≤ 1–2 ký tự (lỗi chính tả nhỏ) → HARD, còn lại → AGAIN.
- Mỗi câu trả lời: cập nhật `CardProgress` và ghi `ReviewLog` trong cùng một transaction.

---

## 5. API (REST, prefix `/api/v1`)

### Auth
| Method | Path | Mô tả |
|---|---|---|
| POST | `/auth/google` | Nhận `idToken` Google, xác thực, trả access + refresh token |
| POST | `/auth/apple` | Tương tự với Apple identity token |
| POST | `/auth/refresh` | Đổi refresh token (rotation) |
| POST | `/auth/logout` | Thu hồi refresh token |

Access token JWT sống 15 phút; refresh token sống 30 ngày, lưu dạng hash, xoay vòng mỗi lần dùng.

### User
| Method | Path | Mô tả |
|---|---|---|
| GET | `/me` | Thông tin user + gói + quota |
| PATCH | `/me` | Cập nhật tên, ngôn ngữ mẹ đẻ/đang học, giới hạn thẻ mới, timezone |
| DELETE | `/me` | Xoá tài khoản |

### Decks & Cards
| Method | Path | Mô tả |
|---|---|---|
| GET | `/decks` | Deck của tôi (phân trang, lọc theo ngôn ngữ) |
| POST | `/decks` | Tạo deck |
| GET | `/decks/:id` | Chi tiết deck + tiến độ của tôi |
| PATCH / DELETE | `/decks/:id` | Sửa / xoá (chỉ chủ sở hữu) |
| POST | `/decks/:id/clone` | Clone deck hệ thống/public sang deck của tôi |
| GET | `/decks/:id/cards` | Danh sách thẻ |
| POST | `/decks/:id/cards` | Thêm thẻ (một hoặc nhiều) |
| POST | `/decks/:id/cards/import` | Import CSV / dán văn bản "term - definition" |
| PATCH / DELETE | `/cards/:id` | Sửa / xoá thẻ |

### Catalog / Lộ trình
| Method | Path | Mô tả |
|---|---|---|
| GET | `/paths?language=en&level=B2` | Lộ trình dựng sẵn |
| GET | `/paths/:slug` | Chi tiết lộ trình + danh sách deck |
| POST | `/paths/:slug/enroll` | Đăng ký học lộ trình |
| GET | `/public/decks` | Thư viện deck public (tìm kiếm) |

### Study
| Method | Path | Mô tả |
|---|---|---|
| GET | `/study/queue?deckId=&limit=` | Thẻ cần học hôm nay (ôn + mới) |
| POST | `/study/sessions` | Bắt đầu phiên học `{deckId, mode}` → trả câu hỏi đã sinh (vd 4 phương án trắc nghiệm) |
| POST | `/study/answers` | Gửi câu trả lời `{cardId, mode, rating? , answer?, durationMs}` → kết quả đúng/sai + lịch ôn mới |
| GET | `/study/summary` | Số thẻ đến hạn theo từng deck |

### Stats
| Method | Path | Mô tả |
|---|---|---|
| GET | `/stats/overview` | Tổng thẻ đã thuộc, streak, độ chính xác |
| GET | `/stats/heatmap?from=&to=` | Số lượt ôn theo ngày |
| GET | `/stats/forecast` | Dự báo số thẻ đến hạn 30 ngày tới |

### AI (Premium)
| Method | Path | Mô tả |
|---|---|---|
| POST | `/media/uploads` | Lấy presigned URL để upload ảnh |
| POST | `/ai/jobs/image-to-cards` | `{imageKey, frontLang, backLang}` → tạo job |
| POST | `/ai/jobs/text-to-cards` | `{text \| topic, count, level}` → tạo job |
| GET | `/ai/jobs/:id` | Trạng thái & kết quả (danh sách thẻ nháp) |
| POST | `/ai/jobs/:id/accept` | Lưu thẻ nháp (đã chỉnh) thành deck |
| POST | `/ai/paths` | Sinh lộ trình cá nhân hoá theo mục tiêu/trình độ |
| POST | `/conversations` | Bắt đầu hội thoại `{scenario, language, level}` |
| POST | `/conversations/:id/messages` | Gửi tin nhắn, trả lời stream qua SSE kèm gợi ý sửa lỗi |
| GET | `/conversations/:id` | Lịch sử hội thoại |

### Subscription
| Method | Path | Mô tả |
|---|---|---|
| GET | `/plans` | Danh sách gói & giá |
| POST | `/subscriptions/checkout` | Tạo phiên thanh toán (VNPay/MoMo/Stripe) |
| POST | `/subscriptions/webhooks/:provider` | Nhận webhook thanh toán (xác minh chữ ký) |
| POST | `/subscriptions/iap/verify` | Xác minh receipt Apple / Google Play |

**Quy ước chung:** phân trang `?page=&pageSize=` (hoặc cursor cho danh sách dài), lỗi dạng `{ statusCode, code, message }`, validate bằng `class-validator`, tài liệu bằng Swagger tại `/docs`.

---

## 6. Lớp AI

```ts
interface AiProvider {
  generateCards(input: {
    source: { type: 'image'; url: string } | { type: 'text'; text: string } | { type: 'topic'; topic: string };
    frontLang: string; backLang: string; count: number; level?: string;
  }): Promise<DraftCard[]>;

  chat(input: {
    scenario: string; language: string; level?: string;
    history: { role: 'user' | 'assistant'; content: string }[];
  }): AsyncIterable<ChatChunk>;          // stream text + corrections

  planPath(input: { goal: string; language: string; level: string; minutesPerDay: number }): Promise<PathPlan>;
}
```

- Provider cụ thể đăng ký qua NestJS DI, chọn bằng biến môi trường `AI_PROVIDER`. Có `FakeAiProvider` cho dev/test.
- Output luôn có cấu trúc (JSON schema / tool use) và validate bằng zod trước khi lưu.
- Ảnh → cần model có vision; nếu provider không hỗ trợ thì OCR trước rồi gọi `text`.

---

## 7. Phân quyền & giới hạn gói

- `JwtAuthGuard` toàn cục, `@Public()` cho route không cần đăng nhập.
- `@RequiresPlan('PREMIUM')` + `PlanGuard` cho route AI.
- `QuotaService` dùng `UsageCounter` (vd Premium: 500 thẻ AI/tháng, 200 tin nhắn hội thoại/ngày — con số chốt sau) để chặn lạm dụng chi phí AI.
- Kiểm tra quyền sở hữu deck/thẻ ở tầng service (không dựa vào client).
- Rate limit bằng `@nestjs/throttler` + Redis.

---

## 8. Hạ tầng & vận hành

### Hosting (production)

Mọi thứ đặt ở **region Singapore**, gần người dùng Việt Nam; API và DB phải cùng region. **Không dùng Cloudflare** (chốt ngày 2026-10-11).

| Thành phần | Dịch vụ | Ghi chú |
|---|---|---|
| API NestJS + worker BullMQ | Railway / Render / Fly.io (chọn khi deploy) | Chạy dạng container; API và worker là 2 process từ cùng một image |
| PostgreSQL | Neon | `DATABASE_URL` đi qua pooler cho app, `DIRECT_URL` kết nối thẳng cho `prisma migrate` |
| Redis | Upstash | Cache, rate limit, hàng đợi BullMQ |
| Lưu file (ảnh upload, audio TTS) | AWS S3 `ap-southeast-1` (mặc định) | Code chỉ dùng API chuẩn S3 (`@aws-sdk/client-s3`), đổi nhà cung cấp qua `S3_ENDPOINT` mà không sửa code |
| Frontend Next.js | Vercel | Thuộc repo frontend |

### Môi trường & quy trình deploy

Hai môi trường, tách biệt hoàn toàn:

| | Localhost (dev) | Production |
|---|---|---|
| API | `http://localhost:4000` | `https://api.duckman.io.vn` |
| Frontend | `http://localhost:3000` | `https://duckman.io.vn` |
| Database | Postgres trong `docker compose` (hoặc 1 branch DB riêng trên Neon) | Neon, Singapore — DB riêng, không bao giờ dùng chung với dev |
| Redis | `docker compose` | Upstash |
| Biến môi trường | File `.env` (copy từ `.env.example`, gitignored) | Đặt trên dashboard của nền tảng hosting; `PRODUCTION_DIRECT_URL`, `DEPLOY_HOOK_URL` đặt trong GitHub Environment `production` |
| `NODE_ENV` | `development` (log dạng pretty) | `production` (log JSON) |

**Luồng code → production** (`.github/workflows/ci.yml`):

```
feature branch ──push/PR──► CI verify: lint · typecheck · unit test · e2e test · build · docker build
                                    │ tất cả pass + review
                                    ▼
                         merge vào main ──► CI verify lại
                                    │ pass
                                    ▼
                         deploy: prisma migrate deploy (DB production) ──► gọi deploy hook của hosting
```

- Chỉ nhánh `main` được deploy; bất kỳ bước nào fail thì dừng, production giữ nguyên bản cũ.
- Bật branch protection cho `main` trên GitHub: bắt buộc PR + check `verify` pass, cấm push thẳng.
- Trên nền tảng hosting: tắt auto-deploy khi push (deploy chỉ chạy qua hook từ CI).
- Migration chạy trước khi deploy code mới, nên migration phải tương thích ngược (thêm cột trước, xoá cột ở release sau).

### Tên miền

Tên miền `duckman.io.vn`, mua và quản lý DNS tại **Nhân Hòa**.

| Địa chỉ | Trỏ tới | Bản ghi DNS |
|---|---|---|
| `duckman.io.vn`, `www.duckman.io.vn` | Frontend (Vercel) | A / CNAME theo hướng dẫn của Vercel |
| `api.duckman.io.vn` | Backend NestJS | CNAME tới domain của Railway/Render/Fly |
| `cdn.duckman.io.vn` (tuỳ chọn) | Bucket S3 chứa ảnh/audio | CNAME |

- SSL do Vercel và nền tảng hosting backend cấp tự động.
- `CORS_ORIGINS=https://duckman.io.vn,https://www.duckman.io.vn` (thêm `http://localhost:3000` khi dev).
- Cookie refresh token: `Domain=.duckman.io.vn; Path=/; HttpOnly; Secure; SameSite=Lax`, để cả `api.` lẫn server Next.js đọc được.

Khi có nhiều người dùng: chuyển Postgres sang AWS RDS / DigitalOcean nếu cần; Prisma dùng được với cả hai nên gần như không phải sửa code.

- **Config:** `.env` validate khi khởi động (`DATABASE_URL`, `DIRECT_URL`, `REDIS_URL`, `JWT_*`, `GOOGLE_CLIENT_ID`, `APPLE_*`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_*`, `CORS_ORIGINS`, `AI_PROVIDER`, `AI_API_KEY`…).
- **Reverse proxy:** nền tảng hosting đứng trước app, nên bật `trust proxy` để rate limit lấy đúng IP người dùng.
- **Dev:** `docker-compose` gồm Postgres + Redis + MinIO.
- **Seed:** script import các lộ trình dựng sẵn (IELTS, TOEIC…) từ file JSON/CSV.
- **Log:** `pino` (nestjs-pino), có request id.
- **Test:** unit cho SRS/chấm dictation; e2e bằng Supertest với Postgres test container.
- **CI:** lint + typecheck + test + `prisma migrate diff` kiểm tra migration.

---

## 9. Câu hỏi còn mở

1. Thị trường mục tiêu: chỉ người Việt học tiếng Anh (như tên repo "EnglishQuizz") hay đa ngôn ngữ như openquiz.ai? Ảnh hưởng tới `frontLang/backLang` và dữ liệu seed.
2. ~~Client: web, mobile, hay cả hai?~~ → Web (Next.js). Tạm bỏ IAP Apple/Google; đăng nhập Apple chỉ làm nếu cần.
3. Cổng thanh toán: VNPay, MoMo, Stripe hay chỉ IAP?
4. Nguồn dữ liệu cho lộ trình dựng sẵn (bản quyền nội dung Vocabulary in Use, TOEIC… cần lưu ý).
5. TTS phát âm: dùng dịch vụ nào (Google TTS, Azure, ElevenLabs) và cache audio thế nào.
6. Có cần đăng nhập email/mật khẩu ngoài Google/Apple không?
