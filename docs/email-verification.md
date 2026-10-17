# Email verification — backend phase

This feature adds a verifiable email status without changing the frontend. The agreed sequence remains backend → tests → Postman → deployment → frontend. Password change and password reset remain separate authentication features.

## API contract

All POST requests require `Origin` matching `FRONTEND_URL`, even in Postman. Responses are `Cache-Control: no-store` under the existing auth middleware. No endpoint returns a verification token.

| Method/path                                    | Body                                | Response                                                                    |
| ---------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------- |
| `POST /api/v1/auth/email-verification/request` | `{ "email": "person@example.com" }` | 202 generic accepted message; 503 if delivery is disabled                   |
| `POST /api/v1/auth/email-verification/confirm` | `{ "token": "TOKEN_FROM_MAILBOX" }` | 200 verified message; 400 invalid, expired, consumed, or malformed token    |
| `GET /api/v1/auth/me`                          | None; session cookies required      | Public user now includes `emailVerifiedAt`, either null or an ISO timestamp |

The request response is:

```json
{
  "data": {
    "message": "If the account is eligible, a verification email will be sent."
  }
}
```

Unknown, verified, cooldown-limited, and delivery-failed accounts get that same response. The response intentionally does not disclose mailbox existence or promise actual delivery. This is response-level anti-enumeration; it does not guarantee identical response timing. Disabled delivery returns 503 before looking up the email, independently of whether an account exists.

Successful confirmation returns:

```json
{ "data": { "message": "Email address verified" } }
```

Registration requests a verification email automatically when configured. Email delivery failures do not roll back account creation or break sign-in; the user can use the resend endpoint. Existing accounts are not retroactively marked verified. Registration, login, refresh and `/me` add the nullable `emailVerifiedAt` field without removing previous fields. Unverified users can still sign in to check status and request another link.

## Tokens, transactions, and limits

Verification tokens are 32 random bytes encoded as 64 hexadecimal characters. Only SHA-256 hashes are stored in `EmailVerificationToken`. A token lasts 24 hours, can be used once, and is replaced by a successful resend reservation. Tokens are unrelated to access/refresh JWTs and cannot authenticate a session.

The database allows one pending token per user. A conditional update of the user's last-send timestamp enforces a 60-second per-account cooldown across app instances. Reservation and token replacement are transactional. Confirmation locks the user before consuming the token, matching resend's lock order; setting `emailVerifiedAt` and deleting the token are atomic. A replay or losing concurrent confirmation returns 400.

If delivery fails, conditional cleanup removes only that attempted token and releases its send reservation. A prior link replaced by the resend remains invalid; request another link. Provider timeouts have ambiguous delivery, so a link received from a failed attempt may be invalid. There are no automatic delivery retries or queues in this phase.

HTTP rate limits are 5 resend requests per hour per IP and 10 confirmation attempts per minute per IP. The existing auth throttler remains process-local. Accurate client IP handling behind Render/Vercel and shared throttling for multiple instances remain deployment considerations; the per-account cooldown is database-backed regardless.

`VerifiedEmailGuard` is exported from `AuthModule` for future protected business/payment controllers. Use it after `AuthGuard`; it returns 403 for unverified users. No existing login/dashboard route is newly blocked, because the verification UI is deliberately not implemented yet. Future business/financial mutations must explicitly opt into this guard.

## Email provider configuration

The default is `EMAIL_PROVIDER=disabled`, so deployment does not interrupt existing authentication or accidentally send mail. Nodemailer supplies the SMTP transport and is the only new runtime dependency. It uses its bundled TypeScript types. One transporter is reused, certificate verification stays enabled, and protocol debugging is disabled. Connection/greeting timeouts are 10 seconds; the socket timeout is 20 seconds. Automated tests stub the transport; they do not send emails. Run `pnpm install` in the backend and commit the updated lockfile before deploying.

Nodemailer is a mail-sending library, not a mailbox or SMTP provider. Obtain SMTP credentials and an authorized sender from your chosen email service, then configure these values privately in the backend environment:

```env
EMAIL_PROVIDER=smtp
SMTP_HOST=smtp.YOUR_PROVIDER.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=YOUR_SMTP_USERNAME
SMTP_PASSWORD=YOUR_PRIVATE_SMTP_PASSWORD
EMAIL_FROM=verify@YOUR_VERIFIED_DOMAIN
```

`EMAIL_FROM` is a plain sender email address. Host, username, password, and sender are required when SMTP is enabled. Port 587 uses `SMTP_SECURE=false` with mandatory STARTTLS; port 465 requires `SMTP_SECURE=true` for implicit TLS. For a provider-supported alternative port, follow its documented encryption settings. The literal strings `true` and `false` are parsed explicitly; `false` never becomes truthy by string coercion. Certificate verification cannot be disabled through these settings. There is no token-printing console email mode.

SMTP message IDs identify delivery attempts but do not guarantee idempotency. There are no automatic retries; token/cooldown controls remain database-backed. Recipient rejection and SMTP authentication/network failures produce sanitized errors; SMTP transcripts and credentials are never logged. The previous Resend adapter and its API key setting have been removed. This adapter does not implement OAuth-only SMTP services; use SMTP credentials or an app password supported by your provider.

Render free web services block outbound ports 25, 465, and 587. Standard SMTP delivery on those ports therefore requires a hosting plan that supports them, or another supported SMTP connection arrangement verified with the host/provider. Do not assume that local delivery success proves Render connectivity. Keep delivery disabled until hosting and SMTP credentials are ready. No hosting-plan changes or purchases are made by this implementation.

Links use the fixed configured frontend origin and `/verify-email#token=...`. The token lives in a fragment, so it is not included in HTTP request URLs or referrers. The future frontend screen must read the fragment, clear it from browser history, and ask the user to confirm through the POST endpoint. A GET does not consume tokens, protecting against email link scanners.

**The `/verify-email` frontend screen is not built yet.** For this backend phase, test by copying the token from the received email into a private Postman Vault entry and confirming through the API. Keep email delivery disabled on a broadly used production app until the corresponding frontend screen is deployed, or explicitly limit testing to your test accounts. No real email has been sent by this implementation session.

References: [Nodemailer SMTP settings](https://nodemailer.com/smtp) and [Render free-service SMTP restrictions](https://render.com/docs/free).

## Database migration and local checks

The committed migration adds two nullable fields on `User` plus `EmailVerificationToken`. It neither deletes users nor resets data. Back up and apply migrations using the existing Supabase workflow. Stop the local backend before regenerating the client if needed on Windows:

```powershell
pnpm db:validate
pnpm db:generate
pnpm lint
pnpm typecheck
pnpm test
```

After local checks, apply the migration to the intended database with `pnpm db:deploy`. Push/deploy the backend independently. Run the Postman cases locally and on Render before proceeding to frontend implementation. Do not use `migrate dev` against hosted production.

## Postman setup

Import [authentication.postman_collection.json](../postman/authentication.postman_collection.json). This is an importable artifact, not a collection uploaded to your Postman account. It contains session authentication and verification folders.

Set collection variables:

| Variable         | Local                   | Live Render                               |
| ---------------- | ----------------------- | ----------------------------------------- |
| `baseUrl`        | `http://localhost:3000` | `https://payme-backend-q4o5.onrender.com` |
| `frontendOrigin` | `http://localhost:5173` | `https://payme-frontend-xi.vercel.app`    |

Create local Postman Vault secrets named `pay-me-email`, `pay-me-password`, and `pay-me-verification-token`. Use a mailbox you control for testing; never commit credentials or tokens into collection files. Postman supplies stored cookies through its cookie jar. Requests contain the required Origin header; no Authorization header is needed.

Run in this order:

1. Register a fresh test account or log into an existing one.
2. Request/resend a verification email. If registration just sent one, the 60-second cooldown applies.
3. Retrieve the link from your test mailbox and place only its fragment token in the local verification-token Vault secret.
4. Confirm once; expect 200. Repeat the exact request; expect 400.
5. Log in again if you previously ran the logout requests, then call `/me`; expect a non-null `emailVerifiedAt`.
6. For another unverified account, request a link, wait at least 60 seconds, resend, and verify the older link is rejected.
7. Check unknown accounts return the same generic 202. Malformed tokens return 400; missing/wrong Origin returns 403.

The collection's full session folder ends with logout and an expected 401. Do not assume that running all folders blindly leaves you signed in for the final status check. Secrets are entered manually and not extracted into shared variables or logs. Clear the verification-token Vault secret when finished.

## Verification record and limits

Initial compilation and all 20 backend tests passed. Tests cover hashed storage, expiry, single-use/replay, resend invalidation, concurrent sends/confirms, cooldown, provider failures, disabled delivery, response privacy, HTTP authentication regression, and guard behavior. The SMTP adapter tests mock Nodemailer and do not make a live SMTP connection. Real Supabase migration, email delivery, imported Postman requests, and live endpoints remain to be verified after provider configuration and deployment. Frontend source is unchanged. Database-backed verification scenarios are also included in the dedicated integration suite; they must run only on a migrated test database.

SMTP replacement verification: Nodemailer is now installed, backend compilation passed, and all 21 non-database tests passed, including the mocked SMTP adapter and standard-port TLS validation. Local SMTP configuration was validated and `EMAIL_PROVIDER=smtp` enabled without displaying credentials. No real email was sent by the implementation session; actual mailbox delivery and the dedicated database suite remain unverified. No additional database migration or frontend change is needed for this adapter replacement. Apply the earlier email-verification migration if it has not yet been applied.

The project owner has stated that Render is no longer in use. The Render restriction above is historical hosting guidance only; confirm the current host before configuring live SMTP or API proxy routing.
