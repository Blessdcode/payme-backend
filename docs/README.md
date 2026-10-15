# Implementation documentation

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
