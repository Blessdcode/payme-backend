# Pay Me backend

Authenticated password changes are documented in the [change-password guide](docs/change-password.md), with requests in the backend Postman collection. This backend-only phase revokes all account sessions and requires signing in again after a change.

Email delivery uses Nodemailer over SMTP. Run `pnpm install` after pulling the adapter change and follow the [SMTP configuration](docs/email-verification.md#email-provider-configuration). No extra database migration is needed for the provider replacement.

Email verification: see the [backend implementation guide](docs/email-verification.md) and [Postman collection](postman/authentication.postman_collection.json). Delivery is disabled until explicitly configured; the frontend phase follows backend/Postman/deployment verification.

Independent NestJS REST API with PostgreSQL and Prisma. This repository does not import code or configuration from the frontend or its parent directory.

Browse the [implementation documentation](docs/README.md), including [authentication](docs/authentication.md), for feature-specific decisions and API behavior.

For the selected hosted database, follow [Supabase setup](docs/supabase.md). Docker is optional; skip its commands when using Supabase.

## Requirements and setup

- Node.js 24 LTS
- pnpm 11.20.0 (install with `npm install --global pnpm@11.20.0` if needed)
- Docker Desktop running with Linux containers, or an existing PostgreSQL database

Run in this repository, using PowerShell:

```powershell
Copy-Item .env.example .env
pnpm install
node scripts/setup-auth-env.cjs
docker compose up -d --wait
pnpm db:validate
pnpm db:generate
pnpm db:deploy
pnpm dev
```

Keep the first generated `pnpm-lock.yaml` in Git. Later installations and CI should use `pnpm install --frozen-lockfile`. `pnpm-workspace.yaml` only configures build-script permissions for dependencies; there are no workspace packages.

The checked-in initial migration is applied with `db:deploy`. For subsequent schema changes, use `pnpm db:migrate --name descriptive_change` and commit the generated migration. Never use `db push` for production. The initial SQL includes nonnegative-money and positive-payment/quantity checks that Prisma cannot represent in its schema.

If using an existing database, skip Docker and set `DATABASE_URL` to its PostgreSQL connection URL. Configure TLS according to the database provider; do not disable certificate verification. The Compose database is bound only to localhost and uses a persistent named volume. `docker compose down` stops it without deleting the volume.

## Environment

| Variable             | Purpose                                                                          |
| -------------------- | -------------------------------------------------------------------------------- |
| `NODE_ENV`           | `development`, `test`, or `production`; defaults to development                  |
| `PORT`               | API port; defaults to 3000                                                       |
| `DATABASE_URL`       | Required PostgreSQL connection URL                                               |
| `FRONTEND_URL`       | Required allowed browser origin, e.g. `http://localhost:5173`; no trailing slash |
| `JWT_ACCESS_SECRET`  | Required random access-token signing secret, at least 32 characters              |
| `JWT_REFRESH_SECRET` | Required different random refresh-token signing secret, at least 32 characters   |
| `POSTGRES_USER`      | Local Compose database user                                                      |
| `POSTGRES_PASSWORD`  | Local Compose database password                                                  |
| `POSTGRES_DB`        | Local Compose database name                                                      |
| `POSTGRES_PORT`      | Local published PostgreSQL port; defaults to 5432                                |

Keep Compose values consistent with `DATABASE_URL`. Changing credentials after the database volume has been initialized does not change existing database credentials. Never commit `.env`. Production requires an HTTPS frontend origin. Authentication secrets are required now. Bachs variables remain comments until payments are implemented.

## Structure and decisions

```text
src/
├── app.module.ts
├── main.ts
├── configure-app.ts
├── common/filters/
├── config/
├── auth/
├── health/
└── prisma/
prisma/
├── schema.prisma
└── migrations/
test/
docs/
```

A NestJS **module** groups related providers and controllers. A **controller** handles HTTP requests and delegates to a **service**, which holds application logic. Nest's dependency injection creates services and supplies them to their consumers. `PrismaModule` exports a single database service; only modules that import it can use it. Feature modules are added as their features are implemented.

`ConfigModule` validates configuration at startup. `ValidationPipe` will validate mutation DTOs using `class-validator` and `class-transformer`, rejecting unexpected fields. A global exception filter produces consistent errors and hides unknown internal errors. Request IDs are server generated and returned in `X-Request-Id`.

Prisma 7 generates a local, ignored client and uses the PostgreSQL driver adapter. Schema amounts use Decimal, timestamps use UTC-aware database columns, and invoice due dates use a calendar date. A user may own multiple businesses structurally; the first business-profile flow can restrict MVP usage to one. Customer/invoice and payment/invoice relationships include `businessId` in their foreign keys. Financial records use restricted deletion. Future services must still check ownership and calculate authoritative totals on the server.

See [ADR 001](docs/decisions/001-foundation.md) and the [API contract](docs/api/health.md).

## Checks

```powershell
pnpm db:validate
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm format:check
```

`test` compiles real decorator metadata first and uses Node's test runner with Nest's testing module. It covers configuration validation, secret-safe errors, health success/failure, request IDs, Helmet headers, and CORS. Database access is replaced only in HTTP tests; they do not prove migrations or real database connectivity. No live payment API is called.

`pnpm test:database` is a separate integration check for real PostgreSQL health, exact Decimal storage, and cross-business foreign-key rejection. It requires a built API, `NODE_ENV=test`, `FRONTEND_URL`, and `DATABASE_URL` pointing to a **dedicated migrated test database** in the process environment. It rolls back its fixtures. CI provisions that separate database, applies migrations, and runs the integration check. For the local development database, apply migrations and open `/health` as the smoke check.

```powershell
Invoke-RestMethod http://localhost:3000/health
```

Expected response: `{"data":{"status":"ok","database":"up"}}`. If the database becomes unavailable after startup, the endpoint returns HTTP 503 without connection details.

## Deployment

Follow the [backend hosting guide](docs/deployment.md) for the exact build/start commands, production environment, migrations, health checks, and frontend cookie topology.

Build with `pnpm build`, apply committed migrations with `pnpm db:deploy`, and start with `pnpm start`. Supply environment variables through the hosting platform. Keep the app stateless and store uploads externally when that feature is introduced. Deploy the frontend separately, allow only its actual origin, and configure its hosting rewrites independently.

Authentication includes register, login, refresh, logout, and current-user endpoints, backed by revocable sessions. See the [authentication guide](docs/authentication.md) for setup and examples. Customer, business, invoice, checkout, and webhook endpoints are later phases. No development accounts are seeded automatically.

Password recovery is now implemented on the backend. See [forgot/reset password](docs/password-reset.md) for the API, migration, Postman workflow and verification limits. Authenticated password changes invalidate pending reset links.
