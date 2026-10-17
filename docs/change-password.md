# Change password — backend phase

This is the authenticated change-password flow, separate from forgotten-password recovery. Frontend source is unchanged. Follow the agreed order: backend implementation/tests, Postman verification, backend deployment/live checks, then frontend UI. Email mailbox-delivery verification from the previous phase remains a separate pending check.

## API contract

`POST /api/v1/auth/change-password`

Requirements: a valid active access-cookie session, JSON body, and `Origin` exactly matching `FRONTEND_URL`. The existing CSRF origin check applies, and the endpoint is limited to 5 requests per minute per client IP through the auth throttler. Email verification is not required to change a password.

Body structure:

```json
{
  "currentPassword": "CURRENT_PASSWORD",
  "newPassword": "NEW_PASSWORD"
}
```

Set these privately in Postman Vault; do not commit actual passwords. No user ID or email is accepted in the body. The account is derived from the authenticated request. Unexpected body fields are rejected.

Current password: nonempty, at most 72 UTF-8 bytes. New password: at least 8 Unicode characters and at most 72 UTF-8 bytes. Neither is trimmed. The new password must not match the existing password. All password hashing/verification uses the existing bcrypt cost 12 service.

Successful response, HTTP 200:

```json
{ "data": { "message": "Password changed. Sign in again on all devices." } }
```

The response expires both auth cookies using their original paths. No replacement session or tokens are issued. All existing sessions for that account are revoked, including other devices; existing access and refresh cookies fail after the change because guards/refresh handlers check session revocation.

| Status | Meaning                                                               |
| ------ | --------------------------------------------------------------------- |
| 200    | Password updated, all account sessions revoked, cookies cleared       |
| 400    | Invalid body, incorrect current password, or new password reuse       |
| 401    | Missing, expired, or revoked authentication; account no longer exists |
| 403    | Missing or disallowed Origin                                          |
| 409    | Credentials changed concurrently; sign in again before retrying       |
| 429    | Endpoint attempt limit exceeded                                       |
| 500    | Unexpected server error; password/session transaction is rolled back  |

Incorrect current passwords use 400 rather than 401 so a future frontend does not mistake a failed reauthentication check for an expired access token and trigger its refresh interceptor. The response never includes passwords, hashes, cookies, or JWTs in JSON. Authentication routes remain no-store.

## Implementation and concurrency

`ChangePasswordDto` validates both passwords. `ChangePasswordService` checks the current password, rejects reuse, and hashes the replacement before opening a short transaction. Inside that transaction it conditionally updates the user's password only if the previously read hash still matches, then revokes every unrevoked session for that user. A failure rolls back both changes. Another user's sessions are unaffected.

Login session creation now uses the same user-row serialization. After verifying a password, login conditionally writes the unchanged password hash inside its session-creation transaction. This locks the user row and rechecks the credentials before creating the session. If a password change already replaced the hash, login fails instead of creating a session using obsolete credentials. If login wins first, the subsequent password change includes that session in its revocation. This uses Prisma directly and adds no dependency or schema field. The conditional write may advance `User.updatedAt` on successful login.

Concurrent password changes cannot silently overwrite one another: only the update matching the previously verified password hash succeeds. Losing requests receive 409. A refresh already in progress can return cookies for a session subsequently revoked by the password change; those cookies cannot authenticate afterward. No password-change email notification or password history is implemented in this phase. Password changes delete all outstanding recovery tokens in the same transaction and clear the recovery cooldown.

## Setup and migrations

No new environment variables, dependencies, or database migration are needed for this feature. Keep the existing authentication/session and email-verification migrations applied as required by the current backend version. No hosted database or credentials were modified by implementation tests.

```powershell
pnpm lint
pnpm typecheck
pnpm test
```

The dedicated `test:database` suite remains separate and requires a disposable migrated PostgreSQL database with `NODE_ENV=test`, never the production database. The feature's HTTP and service tests use substituted persistence to avoid affecting real accounts.

## Postman workflow

Import or re-import [authentication.postman_collection.json](../postman/authentication.postman_collection.json), which now contains a **Change password** folder. Supply local collection variables `baseUrl` and `frontendOrigin`; use the actual current host rather than an earlier Render URL. For local testing use `http://localhost:3000` and `http://localhost:5173` respectively.

Use a disposable test account. Create local Vault secrets `pay-me-email`, `pay-me-password` (the current password), and `pay-me-new-password` (a different valid password). The test for an intentionally incorrect password assumes your actual current password differs from that fixture text. Keep the cookie jar enabled.

1. Sign in with the current password.
2. Check incorrect-current, short-new, and reused-password requests return 400 and do not end the session.
3. Change to the new password; expect 200 and cleared cookies.
4. Call `/me`; expect 401. Old sessions on other devices should also fail; their refresh requests should return 401.
5. Try logging in with the old password; expect 401.
6. Sign in using the new password; expect 200, then `/me` returns 200.
7. Update the local current-password Vault secret before repeating other authentication tests. Do not run this folder blindly against your primary account.

The folder makes five or fewer change attempts, but preceding manual attempts can still exhaust the rate limit. Wait a minute and restart the checks if you receive 429. After local/Postman verification, push/deploy the backend and repeat against the selected host. Deployment remains pending the owner's current hosting configuration. No Postman workspace upload or production password change is performed by this implementation session.

## Verification record

Backend compilation and all 34 non-database tests passed. Automated coverage includes DTO boundaries, incorrect current password, password reuse, successful change and cookie clearing, revocation of two device sessions and refresh tokens, old/new password login behavior, transaction rollback on revocation failure, another account's unaffected sessions, concurrent password changes, and a stale-credential login race. ESLint is checked on the backend source, tests, scripts, and configuration. Real database integration, imported Postman execution, and deployment/live tests are distinct checks and are not implied by the mocked tests.

Password recovery is now implemented on the backend. See [forgot/reset password](password-reset.md) for the API, migration, Postman workflow and verification limits. Authenticated password changes invalidate pending reset links.
