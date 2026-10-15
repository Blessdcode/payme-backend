# Authentication implementation

This phase adds email/password authentication to the existing NestJS API. Supabase remains the PostgreSQL host; these endpoints do not use Supabase Auth. The frontend and backend are independent repositories.

## Setup

From `backend`, install the new dependencies:

```powershell
pnpm install
```

Generate missing local JWT secrets without displaying them or changing your database URL:

```powershell
node scripts/setup-auth-env.cjs
```

This writes two different cryptographically random values to the ignored `.env` file. The required settings are `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`, each at least 32 characters. Never put these secrets in frontend variables. Configure real production secrets through your deployment platform.

Stop the running backend before regenerating Prisma's client, then run:

```powershell
pnpm db:validate
pnpm db:generate
pnpm db:deploy
pnpm dev
```

`db:deploy` applies the new `Session` table migration to the database configured in `.env`. It does not reset existing users, businesses, or invoices. Use this command with Supabase; it does not require a Prisma development shadow database. Each repository must commit its updated package manifest and lockfile together after successful installation.

## Endpoints

All paths start with `/api/v1/auth`. All responses set `Cache-Control: no-store`. POST requests must include an `Origin` header exactly matching `FRONTEND_URL`, including its port in development. The browser supplies this automatically. Cookies are sent with credentials; tokens never appear in JSON responses.

| Method | Path        | Body                                         | Result                                               |
| ------ | ----------- | -------------------------------------------- | ---------------------------------------------------- |
| POST   | `/register` | `email`, `password`, `firstName`, `lastName` | 201, public user and auth cookies                    |
| POST   | `/login`    | `email`, `password`                          | 200, public user and auth cookies                    |
| POST   | `/refresh`  | None                                         | 200, public user and rotated auth cookies            |
| POST   | `/logout`   | None                                         | 204, current session revoked and cookies cleared     |
| GET    | `/me`       | None                                         | 200, public user; 401 without a valid active session |

User response:

```json
{
  "data": {
    "id": "user-id",
    "email": "ada@example.com",
    "firstName": "Ada",
    "lastName": "Okafor",
    "createdAt": "2026-10-15T12:00:00.000Z"
  }
}
```

Emails are trimmed and lowercased. Registration passwords require at least 8 characters and at most 72 UTF-8 bytes, reflecting bcrypt's input limit. Passwords are never trimmed. Names are trimmed and require 1–80 characters. Unexpected body fields are rejected. Login returns the same 401 message for unknown emails and incorrect passwords. Duplicate registration returns 409. Invalid bodies return 400, disallowed/missing origins return 403, and exhausted rate limits return 429.

## How the code fits together

- `auth.controller.ts` handles HTTP bodies, cookies, status codes, and endpoint rate limits.
- `auth.service.ts` registers/logs in users, creates/revokes sessions, and rotates refresh-token hashes.
- `password.service.ts` uses bcrypt with cost 12. A dummy hash keeps unknown-email login attempts on a real password-verification path.
- `token.service.ts` signs/verifies HS256 JWTs with separate access/refresh secrets, fixed issuer/audience, and a token-kind claim.
- `auth.guard.ts` validates the access cookie and checks the database session before supplying the current user to protected handlers.
- `cookies.ts` centralizes cookie creation, reading, and clearing.
- `configure-app.ts` enforces browser origin checks for mutations, security headers, and no-store auth responses.

A NestJS **guard** runs before a controller handler and determines whether the request may proceed. Future protected controllers should import `AuthModule` and use `@UseGuards(AuthGuard)`. They must still enforce business ownership when reading or changing tenant resources. Authentication alone does not grant access to every business.

## Sessions and rotation

The `Session` table stores a user ID, SHA-256 refresh-token hash, absolute expiry, revocation timestamp, and audit timestamps. Raw refresh tokens are never stored. User creation and its first session use one atomic nested database write.

Access cookies expire after 15 minutes. Refresh sessions expire after 30 days, including after rotation. Each refresh gets a new random JWT ID and atomically replaces the stored hash only if the previous hash still matches and the session remains active. Replayed stale refresh tokens revoke their session. A losing concurrent rotation issues no cookies. Logging out revokes the session immediately; even an otherwise valid access JWT then fails the database session check.

The frontend deduplicates refreshes, coordinates across tabs when browser Web Locks are available, and retries a failed request at most once. Clients should avoid concurrent manual `/refresh` requests. On browsers without cross-tab coordination, competing refreshes can require signing in again; stale credentials are never silently accepted.

## Cookie and deployment requirements

`pay_me_access` is httpOnly with path `/`. `pay_me_refresh` is httpOnly with path `/api/v1/auth`. Both are host-only, SameSite=Lax, and Secure in production. Clearing uses the same paths and security settings. No token is stored in localStorage or sessionStorage.

For this cookie policy, expose browser API requests on the frontend origin through a proxy, or deploy frontend/API subdomains under one site with HTTPS. The selected Vercel frontend proxies API paths to Render; see [deployment](deployment.md). Set Render's `FRONTEND_URL=https://payme-frontend-xi.vercel.app` and Vercel's `VITE_API_URL=/`. Direct cross-site browser calls between the provider domains remain unsupported by SameSite=Lax cookies. During development use `localhost` consistently for both apps, rather than mixing it with `127.0.0.1`.

Origin validation applies to all current mutation routes. The webhook namespace is exempt because providers do not send browser Origin headers; future webhook handlers must verify provider signatures. CORS is still restricted to `FRONTEND_URL` with credentials enabled.

Per-IP limits: registration 5/minute, login 10/minute, refresh 30/minute, other auth requests 120/minute. The initial throttler store is process-local. A multi-instance deployment needs shared throttling storage and an explicitly configured trusted-proxy policy before relying on per-IP limits across instances.

## Verification

```powershell
pnpm lint
pnpm typecheck
pnpm test
```

Automated auth tests cover validation, normalization, safe user serialization, password checks, authenticated access, cookies, refresh rotation/replay, session revocation, CSRF origins, and throttling. The HTTP suite substitutes database persistence to run without network credentials. The separate database integration suite requires a dedicated migrated PostgreSQL test database and covers real session persistence in addition to tenant constraints. See `README.md` for its environment requirements.

Manual browser check:

For API tools, send `Origin: http://localhost:5173` on POST requests and preserve the response cookies. A registration request body is:

```json
{
  "email": "ada@example.com",
  "password": "choose-a-unique-long-password",
  "firstName": "Ada",
  "lastName": "Okafor"
}
```

Login sends just `email` and `password`. Refresh/logout use the cookie jar and no body. `/me` is a GET using the same cookie jar. No `Authorization` header is needed.

1. Start both apps and open `http://localhost:5173/register`.
2. Create an account and confirm the protected dashboard opens.
3. Reload and confirm the session remains active.
4. Sign out, then open `/dashboard`; it should redirect to `/login`.
5. Sign in again. Incorrect credentials should show a useful form error.
6. In browser developer tools, remove only the access cookie and reload. The refresh cookie should restore the session and rotate.

Never paste real passwords, cookies, JWT secrets, or database connection strings into issue reports. Include the request ID and sanitized status/error instead.

Email verification, password reset, account deletion, and multi-factor authentication are later features. They are not exposed by this phase.

## Current verification record

Password policy update: the minimum is 8 characters. Backend compilation and registration validation checks passed, including acceptance at 8 characters and rejection at 7. This validation-only change requires no database migration.

During implementation, Prisma schema validation passed and a generated schema diff matched the checked-in Session migration. Backend lint passed. Seven configuration/DTO validation tests passed. Full JWT/cookie HTTP tests and the complete build could not run because this session cannot install the newly added packages into the existing dependency store. Direct outbound database connections are also blocked here, so the Session migration has not been applied to Supabase by this session. Complete installation, `db:deploy`, and the checks above before treating authentication as verified end to end.
