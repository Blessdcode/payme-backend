# Implementation documentation

See [change password](change-password.md) for the authenticated API, session revocation, concurrency rules, Postman cases, and verification results.

SMTP configuration has been validated locally; backend compilation and all 34 non-database tests passed, including password change and authentication regressions. Real mailbox delivery and the new password-change Postman requests remain to be checked manually. Render is no longer the confirmed hosting target; see the hosting guide's current-status note.

Email delivery uses Nodemailer with SMTP. The email verification guide documents credentials, TLS modes, tests, and Render's SMTP restrictions.

The [email verification backend guide](email-verification.md) covers the new API, provider settings, migration, security rules, and importable Postman collection.

The hosting guide retains historical Vercel-to-Render instructions. Confirm the current backend host before applying provider-specific configuration.

See [backend hosting](deployment.md) for production commands, environment variables, migrations, and browser cookie deployment requirements.

Registration requires at least 8 characters; see the authentication guide for the complete password policy.

| Guide                                                      | Contents                                                                            |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| [Backend README](../README.md)                             | Installation, commands, environment, tests, deployment                              |
| [Supabase](supabase.md)                                    | Hosted PostgreSQL connection and migration setup                                    |
| [Authentication](authentication.md)                        | Registration/login/logout, cookies, JWTs, sessions, CSRF, rate limits, verification |
| [Health API](api/health.md)                                | Health-check response contract                                                      |
| [Foundation decision](decisions/001-foundation.md)         | Independent repositories and initial architecture                                   |
| [Authentication decision](decisions/002-authentication.md) | Security choices, dependencies, and tradeoffs                                       |

For every substantial feature, maintain setup/migrations, API requests and responses, validation/authorization rules, important implementation decisions, verification commands, and known limits. Keep instructions consistent with current code. Describe provider-specific behavior only when official documentation confirms it.

Password recovery is now implemented on the backend. See [forgot/reset password](password-reset.md) for the API, migration, Postman workflow and verification limits. Authenticated password changes invalidate pending reset links.
