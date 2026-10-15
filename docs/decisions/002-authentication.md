# ADR 002: Cookie JWTs with revocable refresh sessions

Status: accepted for authentication phase.

## Problem and decision

Use NestJS JWT signing with short-lived access tokens and rotating refresh tokens in httpOnly cookies. Persist refresh-token SHA-256 hashes, absolute expiration, and revocation state in PostgreSQL. Verify the session on protected requests so logout takes effect immediately rather than waiting for access-token expiry.

Use bcrypt cost 12 for passwords. Enforce bcrypt's 72-byte input ceiling rather than silently accepting truncated passwords. Email normalization precedes uniqueness checks. JWTs use different access/refresh signing secrets with fixed issuer, audience, HS256 algorithm, and token-kind validation.

Use SameSite=Lax, exact browser Origin checks on mutations, and strict credentialed CORS for CSRF protection. Production cookies require HTTPS and same-site frontend/API deployments. Separate subdomains of one domain work. Cross-site hosting needs an explicit policy change before deployment.

Refresh rotation uses a conditional database update. Only the request that replaces the current hash may receive new credentials. Replayed refresh tokens revoke the session. Browsers coordinate refreshes to reduce false replay detection. Sessions retain an absolute 30-day expiry; rotation does not extend it indefinitely.

## Dependencies and simpler alternatives

`@nestjs/jwt` supplies established JWT signing and verification instead of custom cryptography. `bcryptjs` implements password hashing without native builds. `cookie-parser` parses request cookies, and `@nestjs/throttler` provides endpoint attempt limits. These address the new authentication workflow. No Passport abstraction, Redis dependency, or global state store is needed now.

The frontend adds React Hook Form and its Zod resolver for real forms. TanStack Query remains the session/server-state owner. One Axios client handles credentials and bounded refresh/retry. Tokens are never persisted in browser JavaScript storage.

## Limits

Throttling is per process. Expired/revoked session rows remain until a future retention job removes them. Scaling needs shared rate-limit storage and trusted-proxy configuration. Email verification, password reset, MFA, and account management are separate features. Apply the Session migration and verify authentication before enabling business workflows.
