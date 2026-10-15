# Supabase database setup

Supabase hosts the PostgreSQL database. NestJS and Prisma remain the application's backend and data access layer. No additional Supabase SDK or frontend database keys are needed for this setup.

1. Create a Supabase project at <https://supabase.com/dashboard>. Keep its database password in your password manager.
2. In API Settings, disable the Data API for this project before applying application migrations. This application uses Prisma through NestJS, and its tables should not be exposed through a parallel browser-accessible API. Supabase's Prisma guide recommends disabling the Data API for Prisma-only access.
3. Open **Connect** and select the **Session pooler** connection string on port **5432**. This works with IPv4 connections and can be used for this server's runtime and migrations. Copy the host and username exactly as displayed; do not guess the region or project reference.
4. Replace `DATABASE_URL` in `backend/.env` with that URI. Insert the database password locally, percent-encoding reserved characters in the password. This is a PostgreSQL URI, not the Supabase project HTTPS URL or an API key.
5. Configure TLS verification using Supabase's connection guidance. Use `sslmode=verify-full` with the appropriate trusted root certificate when required. Do not work around certificate errors by disabling verification.

Example structure only (copy your actual URI from Supabase):

```env
NODE_ENV=development
PORT=3000
DATABASE_URL="postgresql://postgres.PROJECT_REF:ENCODED_DATABASE_PASSWORD@SESSION_POOLER_HOST:5432/postgres?sslmode=verify-full"
FRONTEND_URL=http://localhost:5173
```

Keep this URI in the backend `.env`. The existing `.gitignore` excludes it. The `POSTGRES_*` variables are only for optional local Docker infrastructure and are not used for Supabase connections.

From the backend repository:

```powershell
pnpm install
node scripts/setup-auth-env.cjs
pnpm db:validate
pnpm db:generate
pnpm db:deploy
pnpm dev
```

Use a new project without existing application tables for the checked-in initial migration. `db:deploy` applies that migration without requiring a development shadow database. Schema changes later require a migration workflow with an appropriate development/shadow database; do not run `migrate dev` against production.

Open <http://localhost:3000/health>. Success returns:

```json
{ "data": { "status": "ok", "database": "up" } }
```

The frontend keeps `VITE_API_URL=http://localhost:3000`; it calls NestJS. Supabase connectivity has not been verified until a real project URI is configured and this check succeeds.

Official references: [Supabase + Prisma](https://supabase.com/docs/guides/database/prisma) and [PostgreSQL connection options and TLS](https://supabase.com/docs/guides/database/connecting-to-postgres).
