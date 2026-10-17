# Backend hosting

Current hosting status: the project owner stated that Render is no longer in use. Treat the Render-specific instructions and URLs below as historical configuration, not the current deployment target. Confirm the new host and its frontend origin before configuring deployment or proxy routing. General build/start, environment, migration, and health-check instructions still apply.

The backend is an independent Git repository. The project owner handles GitHub repository creation and pushing. Hosting connects to that backend repository; do not set a `backend/` root directory when its `package.json` is already at the repository root. Supabase remains the PostgreSQL host.

## Runtime and commands

Use Node.js 24 and pnpm 11.20.0, as specified by `package.json`. Install development dependencies during the build: TypeScript and the Prisma CLI are needed to generate and compile the application. The server binds to `0.0.0.0` and reads its port from `PORT`.

| Setting                | Value                                                       |
| ---------------------- | ----------------------------------------------------------- |
| Build                  | `pnpm install --frozen-lockfile --prod=false && pnpm build` |
| Migration/release step | `pnpm db:deploy`                                            |
| Start                  | `pnpm start`                                                |
| Health check           | `/health`                                                   |

Set the build environment to allow development dependencies, even though the running application's `NODE_ENV` is production. The explicit `--prod=false` handles this for pnpm. Do not use `pnpm dev` to run the deployed server. If the host does not provision the pinned pnpm version automatically, configure its supported package-manager setup mechanism before running these commands.

Run migrations once per release, before switching traffic to the new application. Use the host's pre-deploy/release step if available. Otherwise run `pnpm db:deploy` from a trusted environment against the target database before deploying that release. Do not run `migrate dev`, reset the database, or generate migrations against production. Keep schema changes compatible with the previous running version during rollouts.

## Environment variables

For Nodemailer, configure `EMAIL_PROVIDER=smtp`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, and `EMAIL_FROM` privately on Render. See the email verification guide for TLS settings. Render Free blocks outbound SMTP ports 25, 465, and 587; resolve plan/provider connectivity before enabling delivery. No SMTP credentials belong in Vercel.

Email verification adds an opt-in delivery configuration. Leave `EMAIL_PROVIDER=disabled` until provider setup and the verification UI are ready; see [email verification](email-verification.md). Deploy its committed database migration before the new API version. Do not add mail-provider keys to Vercel.

Set these in the hosting dashboard's secret/environment settings. Do not commit a real `.env` or paste secrets into build commands.

| Variable             | Value                                                                              |
| -------------------- | ---------------------------------------------------------------------------------- |
| `NODE_ENV`           | `production`                                                                       |
| `DATABASE_URL`       | Supabase PostgreSQL connection URI for the target environment, with TLS configured |
| `JWT_ACCESS_SECRET`  | A new random production secret of at least 32 characters                           |
| `JWT_REFRESH_SECRET` | A different new random production secret of at least 32 characters                 |
| `FRONTEND_URL`       | Exact HTTPS frontend origin, without a trailing slash                              |
| `PORT`               | Usually supplied by the hosting platform; keep its supplied value                  |

Generate production secrets separately from development secrets. The local `scripts/setup-auth-env.cjs` changes only the local ignored `.env`; it does not configure the host. Neither Bachs configuration nor local Compose `POSTGRES_*` variables are needed for the current deployed API.

## Browser authentication

For the selected Vercel/Render deployment, the frontend now proxies `/api/...` and `/health` to `https://payme-backend-q4o5.onrender.com`. Set Render's `FRONTEND_URL=https://payme-frontend-xi.vercel.app` and Vercel's `VITE_API_URL=/`, then redeploy each changed project. Cookie paths remain unchanged because the proxy preserves API paths. This is the same-origin proxy option described below; requests still require the configured frontend Origin. No backend source change or database migration is required for the proxy.

You can deploy and test `/health` before deploying the frontend. Production registration/login through the browser requires a matching HTTPS `FRONTEND_URL` and the current cookie policy's same-site deployment topology.

Use frontend/API subdomains under one domain, for example `app.example.com` and `api.example.com`, or a same-origin API proxy. The current SameSite=Lax production cookies will not support a localhost frontend talking directly to an unrelated hosted API domain. Unrelated frontend/backend provider domains need an explicit cookie/CSRF design adjustment before authentication can work there. Keep production HTTPS and origin checks enabled.

The backend's default Express proxy trust is disabled. Before public usage, configure a trusted-proxy policy appropriate to the selected provider so per-IP throttling identifies clients correctly without trusting forged forwarded headers. Rate limiting is currently process-local; keep one instance initially or add shared throttling storage before scaling. These choices depend on the selected host and its ingress topology.

## Render example, if selected

Create a Node web service connected to the backend repository. Select a region near the Supabase project and enter the build/start commands and `/health` path above. Configure the listed environment variables. Render requires a `0.0.0.0` listener and supplies `PORT`. Its pre-deploy command is available on paid services; use it for `pnpm db:deploy` when available. On a plan without it, run migrations from a trusted environment before the corresponding deployment.

Render's free web services can sleep after inactivity, so they are suitable for previews rather than a responsive payment service. Choose billing/compute settings yourself before creating a service; no plan or service has been provisioned by this implementation.

References: [Render web services](https://render.com/docs/web-services), [deploy steps](https://render.com/docs/deploys), [Node versions](https://render.com/docs/node-version), [free service limits](https://render.com/docs/free).

## Verification and current status

Before deploying, run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`. CI also applies migrations and runs database integration checks against a dedicated disposable PostgreSQL service. Ensure those checks pass on the pushed commit.

After deploying, request `https://YOUR_API_HOST/health`. Expect HTTP 200 and `{"data":{"status":"ok","database":"up"}}`. Then verify registration, login, refresh, and logout from the intended deployed frontend. A working health check alone does not validate the browser cookie topology.

Preparation checks passed: backend lint, TypeScript compilation, and all 12 backend non-database tests; frontend type checking and both form tests. The backend listener was updated to bind explicitly to all IPv4 interfaces. No hosting service or GitHub remote has been created, and no hosted migration or public endpoint has been verified by this session. Provider selection, domain configuration, and actual deployment remain pending.
