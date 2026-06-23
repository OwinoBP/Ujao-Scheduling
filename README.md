# School Bus Tracking MVP

This repository contains the first-pass scaffold for the Ujao school bus operations MVP:

- `worker/` is the Cloudflare Worker API built with Hono.
- `frontend/` is the static Cloudflare Pages frontend built with plain HTML, CSS, and vanilla JavaScript.

## Airtable setup

Create one Airtable base named `SchoolBusOps` using the exact table and field names in [airtable-schema-reference.md](/D:/Projects/Ujao%20Scheduling/airtable-schema-reference.md). The Worker code assumes those names match exactly.

## Worker setup

1. Install dependencies:

   ```bash
   cd worker
   npm install
   ```

2. Copy `.dev.vars.example` to `.dev.vars` and fill in your real values:

   ```bash
   cp .dev.vars.example .dev.vars
   ```

3. Create or connect your KV namespace, then update `wrangler.toml` with the real `id` and `preview_id`.

4. Add production secrets:

   ```bash
   wrangler secret put AIRTABLE_PAT
   wrangler secret put AIRTABLE_BASE_ID
   wrangler secret put JWT_SECRET
   wrangler secret put APP_TIMEZONE
   ```

   `APP_TIMEZONE` is optional. If omitted, the Worker defaults to `Africa/Nairobi`.

5. Start local Worker development:

   ```bash
   npm run dev
   ```

## Frontend setup

The frontend expects the API at `/api` on the same site by default, which keeps the auth cookie compatible with `SameSite=Strict`.

- If Pages and the Worker share the same hostname via Cloudflare routes, leave `frontend/config.js` as-is.
- If you are testing against a separate Worker URL, set `PRODUCTION_API_BASE_URL` inside `frontend/config.js`.

For local development with the static frontend proxied to the Worker:

```bash
cd worker
npm run dev
```

In a second terminal:

```bash
npx wrangler pages dev ../frontend --proxy 8787
```

That gives you a single local origin, so the login cookie behaves like production.

## Provisioning a staff login

Passwords are stored in Cloudflare KV, not Airtable.

1. Create the staff member in Airtable first.
2. Capture the Airtable record ID for that staff record.
3. Provision the login with the helper script:

   ```bash
   cd worker
   npm run provision-staff -- --email samuel@ujao.example --password "ChangeMe123!" --role Driver --airtableStaffId recXXXXXXXXXXXXXX --local --preview
   ```

For production KV, write to the remote main namespace:

```bash
cd worker
npm run provision-staff -- --email samuel@ujao.example --password "ChangeMe123!" --role Driver --airtableStaffId recXXXXXXXXXXXXXX --remote --preview false
```

The email in the KV key must match the Airtable `Email` field exactly.

The helper hashes the password, creates valid JSON, writes it through Wrangler, and avoids shell quoting issues on PowerShell.

## Deploy

### Worker API

```bash
cd worker
npm run deploy
```

### GitHub Pages frontend

If you deploy the static frontend to GitHub Pages, you still need the Worker API live on Cloudflare Workers.

1. Deploy the Worker:

   ```bash
   cd worker
   npm run deploy
   ```

2. Note the Worker URL, usually like:

   ```text
   https://school-bus-ops-api.<your-subdomain>.workers.dev
   ```

3. In `frontend/config.js`, set:

   ```js
   const PRODUCTION_API_BASE_URL = 'https://school-bus-ops-api.<your-subdomain>.workers.dev';
   ```

4. In `worker/wrangler.toml`, add production vars for the GitHub Pages origin:

   ```toml
   [vars]
   ALLOWED_ORIGINS = "https://<github-username>.github.io"
   COOKIE_SAMESITE = "None"
   ```

5. Deploy the Worker again after changing `wrangler.toml`:

   ```bash
   cd worker
   npm run deploy
   ```

6. Push the repository to GitHub.

7. In GitHub, open the repository settings and set Pages source to **GitHub Actions**. The included `.github/workflows/deploy-frontend.yml` workflow publishes the `frontend/` folder.

For the most reliable production auth, use a custom domain and put the frontend and API under the same root domain, such as `app.example.com` and `api.example.com`. If you use `github.io` plus `workers.dev`, the browser treats the API as cross-site, so the Worker must use `COOKIE_SAMESITE = "None"` and GitHub Pages must be listed in `ALLOWED_ORIGINS`.

## Included API routes

### Public

- `POST /api/login`

### Authenticated

- `POST /api/logout`
- `GET /api/me`

### Admin

- `GET/POST /api/schools`
- `PATCH/DELETE /api/schools/:id`
- `GET/POST /api/buses`
- `PATCH/DELETE /api/buses/:id`
- `GET/POST /api/staff`
- `PATCH/DELETE /api/staff/:id`
- `GET/POST /api/students`
- `PATCH/DELETE /api/students/:id`
- `GET /api/triplogs`
- `GET /api/incidents`

### Driver

- `GET /api/driver/students`
- `GET /api/driver/triplogs?date=YYYY-MM-DD`
- `PATCH /api/driver/triplogs/:id`
- `POST /api/driver/incidents`
