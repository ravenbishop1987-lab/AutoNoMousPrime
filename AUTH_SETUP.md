# Authentication Setup Guide

Autonomous Prime's Node.js SaaS API (`api/`) uses **Clerk** for production authentication
and **Supabase** for the database and org membership. Both are optional at boot time — the
server starts in stub mode when the keys are absent, which is useful for local development
but must never be used in production.

---

## What is currently stubbed

### Clerk (identity provider)

**Detected by:** `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` both set.

When Clerk keys are **absent**:
- `index.js` attaches `req.auth = { userId: 'dev-user' }` to every request via a plain
  Express middleware (the real Clerk SDK is not loaded).
- `auth.js → requireAuth` skips JWT verification entirely and sets
  `req.userContext = { userId: 'dev-user', email: 'dev@localhost', provider: 'dev' }`.
- Every request is treated as authenticated, regardless of any token (or lack of one).

### Supabase (database + org scoping)

**Detected by:** `SUPABASE_URL` (non-placeholder), `SUPABASE_SERVICE_ROLE_KEY`, and
`SUPABASE_ANON_KEY` all set.

When Supabase is **absent**:
- `auth.js → attachOrg` skips the database lookup and injects a hardcoded dev org:
  ```js
  req.org = { id: 'dev-org', name: 'Dev Organization', plan_tier: 'agency', ... }
  req.orgMembership = { id: 'dev-membership', role: 'owner', invite_status: 'accepted' }
  ```
- All plan-limit checks pass (agency tier, unlimited jobs).
- No data is written to or read from any database.

### What this means in practice

| Condition | Auth result |
|---|---|
| No Clerk + No Supabase | Every request → `dev-user` / `dev-org` (agency) |
| No Clerk + Supabase present | JWT validated against Supabase Auth; org looked up in DB |
| Clerk present | Clerk JWT validated; org looked up in Supabase |

A banner is printed to the console on startup whenever both Clerk and Supabase Auth are
absent. **If you see this banner in a deployed environment, stop the server immediately.**

---

## Environment variables required for real auth

Add these to `.env` (copy `.env.example` as a starting point):

```env
# Clerk — identity provider
CLERK_PUBLISHABLE_KEY=pk_live_...
CLERK_SECRET_KEY=sk_live_...

# Supabase — database
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...   # service role key (never expose to browser)
SUPABASE_ANON_KEY=eyJ...           # anon/public key

# Optional — restricts CORS to your production domain
FRONTEND_URL=https://yourdomain.com
```

---

## Step 1 — Set up Clerk

1. Go to [clerk.com](https://clerk.com) and create a free account.
2. Click **Create application**. Name it (e.g. "Autonomous Prime"). Choose any sign-in
   method (Email, Google, GitHub, etc.).
3. Once created, open **API Keys** in the left sidebar.
4. Copy **Publishable key** → `CLERK_PUBLISHABLE_KEY` in your `.env`.
5. Copy **Secret key** → `CLERK_SECRET_KEY` in your `.env`.
6. Under **Sessions → Customize session token**, you can leave defaults — the API only
   needs `userId` from the token, which Clerk always includes.
7. Optionally configure **Allowed origins** under **CORS** to match your frontend URL
   (e.g. `http://localhost:5173` for local dev, your production domain for prod).

> **Note:** Clerk's free tier supports unlimited MAUs for development. You only need a paid
> plan if you exceed the free-tier limits in production.

---

## Step 2 — Set up Supabase

1. Go to [supabase.com](https://supabase.com) and create a free account.
2. Click **New project**. Choose an organization (or create one), set a project name,
   database password, and region closest to your users. Click **Create new project**.
3. Wait ~2 minutes for the project to provision.
4. Open **Project Settings → API** (left sidebar → gear icon → API).
   - Copy **Project URL** → `SUPABASE_URL` in your `.env`.
   - Copy **service_role** key (under "Project API keys") → `SUPABASE_SERVICE_ROLE_KEY`.
   - Copy **anon** key → `SUPABASE_ANON_KEY`.
5. Open the **SQL Editor** (left sidebar → SQL Editor icon).
6. Click **New query**, paste the full contents of `api/src/db/schema.sql`, and click
   **Run**. This creates all tables (`orgs`, `org_members`, `brands`, `jobs`, etc.).
7. Confirm the tables exist under **Table Editor**.

> **Important:** The service role key bypasses Row Level Security. Keep it server-side
> only — never expose it in the browser or commit it to version control.

---

## Step 3 — Restart the server and verify

After updating `.env`, restart the Node.js API:

```bash
cd api && npm run dev
```

The startup banner should **not** appear. Instead you should see:

```
[AP API] Running on http://localhost:3001
```

### Test that auth is working

**Without a token (should fail):**

```bash
curl -s http://localhost:3001/saas/orgs | jq .
# Expected: { "error": "Missing bearer token" }  (or Clerk 401)
```

**With a valid Supabase session token:**

```bash
# 1. Sign in via Supabase Auth to get a JWT (replace URL/keys):
TOKEN=$(curl -s -X POST \
  "https://<project-ref>.supabase.co/auth/v1/token?grant_type=password" \
  -H "apikey: <anon-key>" \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"yourpassword"}' \
  | jq -r '.access_token')

# 2. Call a protected endpoint:
curl -s http://localhost:3001/saas/orgs \
  -H "Authorization: Bearer $TOKEN" | jq .
# Expected: 403 "No organization found..." (until you create an org via onboarding)
# or 200 with org list if onboarding is complete.
```

**With Clerk:** Use the Clerk frontend SDK (`useAuth()` → `getToken()`) to obtain a JWT,
then pass it as `Authorization: Bearer <token>` to any `/saas/*` endpoint.

### Health check (no auth required)

```bash
curl http://localhost:3001/saas/health
# { "ok": true, "service": "autonomous-prime-api", "ts": "..." }
```

---

## Summary checklist

- [ ] Created Clerk application and copied both keys to `.env`
- [ ] Created Supabase project and ran `api/src/db/schema.sql`
- [ ] Copied Supabase URL, service role key, and anon key to `.env`
- [ ] Restarted the Node.js API — no stub banner in output
- [ ] Unauthenticated request to `/saas/orgs` returns 401
- [ ] Authenticated request with a valid token returns 200 or 403 (not dev-user data)
