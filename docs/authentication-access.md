# Verification enforcement and mail response handling

## Problem and behavior

Previously registration inserted the account, then waited for SMTP before returning. The browser's 10-second request timeout could fire even though the account existed; repeating registration then returned 409. Forgot-password and verification resend also waited for SMTP, causing the same apparent connection failure. Those API responses now complete without awaiting SMTP delivery. Database work still runs before acceptance, and can independently fail or time out.

Registration returns 201 with the unverified public user, creates no session and clears auth cookies. Correct credentials for an unverified account return 403 `Verify your email address before signing in`; incorrect credentials still return generic 401. Public verification resend/confirmation let the user complete verification before signing in. Duplicate email remains 409. An interrupted signup must be recovered through sign-in/verification, not automatic repeated POSTs.

`AuthGuard` authenticates the live database session and requires `emailVerifiedAt` by default. This includes change-password and future protected business endpoints. `AllowUnverifiedEmail` is an explicit narrow exception on `/me`, allowing legacy sessions to read status for the verification screen. Logout remains accessible, and public recovery endpoints prove account ownership through email tokens. Never add the exception to a business endpoint. No business or payment access is granted to unverified accounts.

Forgot/reset password remain public and keep their existing response contracts, token expiry, cooldown and throttling. Reset does not verify an account, so an unverified account still cannot sign in after resetting. Verification is a separate step. Do not assume 202 means an email has reached the mailbox.

## Delivery and setup

There are no new migrations, dependencies or environment values. Apply the existing verification/reset migrations and configure the backend's existing SMTP variables privately. The frontend and backend deploy independently; deploy these backend semantics before the matching frontend UI. Render is no longer the confirmed backend host.

Registration schedules verification sending without waiting. Verification resend and forgot-password reserve the hashed token/cooldown before scheduling SMTP. Send failures release the matching reservation and log only a sanitized message. Each asynchronous operation has a rejection handler. Password/token/session transaction rules remain unchanged.

Delivery is best effort in the running NestJS process, not a durable outbox. A restart or host suspension can interrupt pending mail. There is no automatic retry; users can resend after the account cooldown. A durable worker/outbox is required for guaranteed delivery across process restarts. Disabled SMTP returns 503 on explicit resend/recovery. Registration still succeeds, but the account cannot sign in until mail is configured and verification is completed. Never manually mark production accounts verified to work around mail problems.

## Verification and Postman

```powershell
pnpm typecheck
pnpm lint
pnpm test
```

The regression suite includes an HTTP flow with real Nest routing, DTOs, guards, cookies and password hashing, a transactional database substitute and deliberately pending SMTP promises. It checks registration without a session, denied unverified sign-in, resend/confirmation, verified sign-in, forgot/reset response completion before SMTP, revoked sessions, token replay and old/new passwords. A service test checks late SMTP rejection does not undo signup; guard tests check default denial and the narrow status exception. Compilation, ESLint and the full 37-test backend suite passed. Focused SMTP/HTTP regression tests were repeated after aligning failure-cleanup lock order. Actual Supabase/network, mailbox and browser verification are separate checks.

Reimport [the Postman collection](../postman/authentication.postman_collection.json). Start with **Create account and verify email first**, using a disposable new email. Run requests individually and pause to copy the email fragment token into Vault `pay-me-verification-token`. Confirm verification before session or password-change folders. The reset folder still works after signing out; update Vault's current password after a successful reset. SMTP and rate-limit errors are covered in the feature guides.
