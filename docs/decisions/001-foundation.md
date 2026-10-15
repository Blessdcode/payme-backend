# ADR 001: Independent repositories and a modular API

Status: accepted, following the user's explicit polyrepo instruction on 2026-10-15.

## Decision

The frontend and backend are independent repositories. The original monorepo recommendation is superseded. Each has its own dependency manifest, lockfile, tooling, environment, CI, and deployment. Neither imports sibling files. HTTP contracts are the integration boundary; the frontend does not consume Prisma models.

The backend starts as one modular NestJS application. Controllers handle transport, services handle application logic, and Prisma handles data access. Extra repository wrappers, shared packages, queues, and caches do not solve a current foundation requirement and are deferred.

## Database and payments

PostgreSQL runs locally through backend-owned Compose. Prisma owns schema and committed migrations. Money uses Decimal; timestamps are UTC-aware. Composite foreign keys prevent cross-business links for invoices and payments. Invoice numbers are business-scoped. Provider references and webhook event IDs are unique within their provider. Delete restrictions preserve financial records. Services will enforce ownership, immutable financial history, status transitions, and authoritative totals when those features are built.

Prisma 7 uses a generated CommonJS client and the PostgreSQL driver adapter. This keeps Nest's TypeScript decorator metadata workflow straightforward while using the current Prisma client configuration. See [Prisma's client setup](https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/introduction).

Bachs integration is deferred until official provider documentation is available. No checkout endpoint, signature format, or webhook payload is invented. Only verified server events may eventually mark invoices as paid.

## Foundation scope

At the time of this decision, foundation included infrastructure, configuration, health, and the frontend connection page. `/health` is unprefixed for infrastructure probes; business endpoints use `/api/v1`. Configuration validates currently used settings. Authentication and its session schema are described in [ADR 002](002-authentication.md); business CRUD, checkout, and seeding follow in their respective phases.

Security headers, strict credentialed CORS, DTO validation defaults, request IDs, and sanitized error responses are inexpensive foundation safeguards. Authentication will add cookies, CSRF controls appropriate to the deployment, password hashing, token/session persistence, and rate limits together.

## Consequences

The apps can evolve and deploy separately, with some duplicated tooling configuration. API changes must account for independently deployed clients. Lockfiles are generated only by successful dependency resolution. Package installation and database-backed checks must be completed on a machine with registry access and PostgreSQL.
