# Forgot and reset password

Backend recovery uses the existing Nodemailer SMTP settings from [email verification](email-verification.md). No new environment values are required. Never put SMTP credentials in the frontend.

## Database setup

Run from the independent backend repository:

```powershell
pnpm db:generate
pnpm db:deploy
```

The migration `20261017010000_password_reset` adds `User.passwordResetSentAt` and the `PasswordResetToken` table with a cascading user foreign key and unique token hash. Deploy all pending committed migrations, including email verification. This work generated migration SQL without connecting to or changing Supabase. Do not reset the database.

## API

Both POST endpoints are under `/api/v1/auth`, accept JSON and require `Origin` to exactly match `FRONTEND_URL`. They do not require a session; the reset token proves account access.

| Endpoint           | Body                                                                                | Success                                                                                         |
| ------------------ | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `/forgot-password` | `{ "email": "person@example.com" }`                                                 | 202, `{ "data": { "message": "If the account exists, a password reset email will be sent." } }` |
| `/reset-password`  | `{ "token": "64 lowercase hexadecimal characters", "newPassword": "new-password" }` | 200, `{ "data": { "message": "Password reset. Sign in again on all devices." } }`               |

Email is trimmed and lowercased. New passwords require at least 8 characters and at most 72 UTF-8 bytes; whitespace is preserved. Reusing the current password returns 400 without consuming the link. Invalid, expired or consumed links return 400. Successful reset clears both auth cookies and revokes all account sessions; the user must sign in again. It does not verify the account email or issue a new session.

Requests are limited to 5 per hour per IP; resets to 10 per minute per IP. Requests also have a 60-second account cooldown. Existing, unknown, cooldown and mail-failure requests share the same 202 response. Timing is not equalized. Disabled email delivery returns 503. Throttling uses process-local storage, so multiple instances need shared storage before relying on a global limit.

## Implementation choices

Recovery links contain 32 random bytes encoded as hexadecimal. Only the SHA-256 hash is stored. Tokens expire after 30 minutes; a newer request replaces the previous link. Email delivery failure removes that attempt's token and releases its cooldown without logging credentials or tokens. After token reservation, SMTP delivery runs asynchronously in this NestJS process; it has no durable queue or automatic retry. Requests return without waiting for SMTP. Process termination may lose delivery; request another link after cooldown.

Password replacement, single-use token consumption and session revocation run in one transaction. Conditional updates against the previous password hash prevent concurrent changes from overwriting winning credentials. User rows are locked before token/session changes. Authenticated password changes delete pending recovery tokens; login also checks that credentials have not changed before creating its session. Email-verification tokens cannot reset passwords.

Email links use `FRONTEND_URL/reset-password#token=...`. The token is kept in the URL fragment rather than the query string. The frontend reset screen has not been implemented yet; opening this link is not an end-to-end recovery test.

## Postman and verification

Import [authentication.postman_collection.json](../postman/authentication.postman_collection.json). Use the **Forgot and reset password (disposable account)** folder. Set `baseUrl` and `frontendOrigin`; configure Vault `pay-me-email`, `pay-me-password`, `pay-me-reset-password`. Request a link and copy only the fragment's token into Vault `pay-me-reset-token`. Use a different new password. Run the remaining requests, then update Vault `pay-me-password` to the new password. Do not run password-change and recovery folders unattended against an important account.

```powershell
pnpm typecheck
pnpm lint
pnpm test
```

Compilation, ESLint and all 37 non-database tests passed locally. Automated tests use an in-memory database substitute and stub SMTP. They cover cooldown, hashed storage, replacement, expiry, replay, concurrent resets, transactional rollback, password-change invalidation, email failure, HTTP validation/origin/cookies, stale sessions and old/new login. Real Supabase migration, database isolation, mailbox delivery, manual Postman and deployment verification remain pending. The current backend host must be confirmed before provider-specific deployment configuration. After deployment verification, implement the frontend recovery forms in its separate repository.

Recovery is available while signed out, including for unverified accounts. Reset preserves `emailVerifiedAt`; it never bypasses the verified-email requirement for sign-in. See [current auth access rules](authentication-access.md).
