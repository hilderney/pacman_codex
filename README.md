# Neon Maze

Original web arcade built with TypeScript, Vite, and Canvas 2D. Arrow-shaped player, crystal enemies (Trace, Veil, Flux, and Drift), neon palette, and synthesized audio. No game engine, external fonts, third-party images, or downloads during play.

## Run locally

Requirements: **Node.js 24** and **pnpm 11.19.0**. The lockfile is committed.

```sh
npm install -g pnpm@11.19.0
pnpm install --frozen-lockfile
pnpm dev
```

Open `http://127.0.0.1:5173`. Supabase is not required to play as a guest. To enable accounts, copy `.env.example` to `.env` and fill in the two public variables. Restart the dev server after changing the file.

```sh
pnpm check                 # TypeScript + Vitest (includes 1,200 seeds and PostgreSQL)
pnpm build                 # dist/ + manifest + service worker
pnpm preview               # production build at http://127.0.0.1:4173
pnpm exec playwright install chromium
pnpm test:browser          # uses existing build; includes reload with network offline
```

On the Codex Windows environment, if pnpm shims are missing, use `node node_modules/typescript/bin/tsc --noEmit`, `node node_modules/vitest/vitest.mjs run`, and `node node_modules/vite/bin/vite.js build`.

## How to play

- Arrow keys or WASD; an early turn is buffered until a valid intersection. Keys are remappable in Settings, with two bindings per direction and conflict detection. P/Escape pause.
- Default Gamepad API controls: D-pad or left stick, Start to pause; deadzone 0.35. Enable and status in Settings. Press a gamepad button so the browser can expose the device.
- Swipe on the canvas with `@use-gesture/vanilla`; pause button in the board footer.
- No fixed life limit: each death deducts 10, 20, 40, 80, 160… points. The penalty doubles for the entire run, including across screens. Balance never goes negative; Game Over when a death leaves balance at zero. A new run resets balance, deaths, and screens cleared.
- The HUD shows balance, current screen, screens cleared, deaths, peak balance, next penalty, and speed multiplier. Local high score and leaderboard use the **highest balance reached in the run**, because final balance is zero. They do not use gross points collected.
- Pellets: 10 points; power pellets: 50; consecutive ghost captures: 200, 400, 800, 1,600. Fruit at 70 and 170 items collected: `min(100 × stage, 1,000)`, available for 12 seconds.
- Linear speed: `1 + (screen - 1) / 99`. Screen 1 runs at 1× and screen 100 at exactly 2×, roughly +1.01% of base speed per screen, without compound interest. Player and ghosts (including frightened and eyes) share the same multiplier. There is no final screen or configured speed cap.
- Power mode lasts 7 seconds; chase/scatter intervals stay the same so difficulty comes from smooth acceleration. Eyes return home before the ghost respawns. Adaptive substeps keep turns, collection, and collisions correct at high speed.
- Losing focus or hiding the tab pauses the run. Submitted time is active simulation time only—no pause, intros, or death screen.

## Architecture

| File | Responsibility |
| --- | --- |
| `src/game/maze.ts` | Symmetric 28×31 generator, flood fill, and validation |
| `src/game/engine.ts` | DOM-independent simulation, fixed 1/60 s step |
| `src/game/pathfinding.ts` | BFS and targets for the four personalities |
| `src/game/renderer.ts` | Canvas, original geometry, and wall cache |
| `src/services/controls.ts` | Keyboard, Gamepad API, and swipe |
| `src/services/audio.ts` | Web Audio, envelopes, and siren |
| `src/services/storage.ts` | Settings, local high score, and in-memory fallback |
| `src/services/network.ts` | Google Auth, profile, leaderboard, and per-user queue |
| `src/i18n/en.ts` | Centralized English UI strings |
| `supabase/migrations/001_neon_maze.sql` | Tables, indexes, RLS, and RPCs |
| `supabase/migrations/002_endless_runs.sql` | Endless screens migration and speed-adjusted duration validation |
| `.github/workflows/deploy.yml` | Tests, build, and Cloudflare Pages deploy |
| `.github/workflows/supabase-keepalive.yml` | Weekly database read |

### Maze generation

The algorithm starts with small wall islands and single-tile corridors, including frequent passages through the center. It picks blockages on the left half with a deterministic PRNG and mirrors each change immediately, so boundaries also apply to walls crossing the central axis. Two tunnel rows enable horizontal wrap and four openings. Only ghosts leaving the house or returning as eyes use the central gallery.

New rules, also applied to the house and doors (inaccessible to the player):

- Every interior wall block touches at least one path on one of its four sides. Diagonals do not count.
- Each connected component of interior walls has at most **8 tiles total**, counting corners and branches—not just straight segments.
- Every path tile has at least two exits, including tunnel wrap. Single-tile dead ends are not allowed.
- The path graph cannot contain bridges: removing one edge must not isolate a region. This also rejects full loops connected to the map by a single passage, even when every tile individually has two exits.
- Still required: connectivity, no 2×2 blocks of **player-accessible paths**, symmetry, two tunnels, all pickups reachable, and four power pellets far from the house, one per quadrant.

The outer frame is the only exception to wall limits, preserving a closed outline and two tunnels. That does not exempt interior walls near the border. House and doors count as walls for player rules, though authorized ghosts may cross them. If final validation fails, the generator tries another seed up to 64 times. Stages use `initialSeed + (stage - 1) × 7919`.

The 1,200-seed test performs its own tile checks, wall components, full pickup coverage, closed boundaries, doors, and variety. Regression cases reproduce the red, blue, and yellow issues from the reference image. Simulation tests cover penalties, peak balance, restart, screens cleared, doubled speed at screen 100, advancing past 999, and high-speed collisions.

### Offline and data

The `vite-plugin-pwa` service worker precaches HTML, JS, CSS, icons, and the manifest. **The first visit must be online** until “READY TO PLAY OFFLINE” appears. Then the installed app or a previously visited URL can reopen offline. Dev mode does not install a service worker; validate offline with a production build. Updates wait for tabs to close so runs are not interrupted. Auth and database responses are not cached.

localStorage holds settings, local high score, Supabase session, nickname, last top 20, and one pending best run per account. If storage is unavailable, the game runs in temporary memory and warns about missing persistence.

**Guests never enqueue or submit scores**, even if they sign in later. “Play as guest” stays local even when a session exists. The owner of an authenticated run is captured at start; switching accounts does not transfer its queue. The pending queue is only sent for the same authenticated account.

Submissions happen at run end, on screen clear, on life lost, when opening the leaderboard, on login/session restore, and on the `online` event. The queue keeps only the best checkpoint of the run, and the RPC keeps only each player’s best score; deaths that did not change the peak do not cause redundant writes. Network failures, rate limits, and missing nickname preserve the queue; permanent plausibility rejections are not retried, but the local high score remains. Resubmits of the same run are idempotent for up to 30 days. There is no polling, Realtime, or per-pellet submission. The SDK may refresh session tokens independently; that does not submit scores.

## Configure Supabase and Google OAuth

1. Create a Supabase project, pick a region, and store the database password outside the repo.
2. In **SQL Editor**, run `supabase/migrations/001_neon_maze.sql` then `supabase/migrations/002_endless_runs.sql`, once each in that order. If the initial version is already applied, run **only 002**. Alternatively, apply migrations via the Supabase CLI. They create `profiles`, `scores`, and private receipts, and adapt the leaderboard to endless screen progression.
3. In **Project Settings → API**, copy the URL `https://YOUR_PROJECT_REF.supabase.co` and the **publishable key** (or legacy `anon` key). Never put `service_role`, secret key, database password, or Google secret in the frontend.
4. In Google Cloud Console, select or create a project. Configure the OAuth consent screen (name, contacts, audience); while in Testing, add test users.
5. Create an **OAuth client ID → Web application**. Under *Authorized JavaScript origins*, add production origin, e.g. `https://neon-maze.pages.dev`, and your local origin (`http://127.0.0.1:5173`). Under *Authorized redirect URIs*, add **exactly** `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`.
6. In **Supabase → Authentication → Sign In / Providers → Google**, enable the provider and paste Google Client ID and Client Secret. Client Secret stays only in Supabase.
7. In **Authentication → URL Configuration**, set production Site URL. Add Redirect URLs `https://neon-maze.pages.dev/`, `http://127.0.0.1:5173/`, and `http://127.0.0.1:4173/`. If you use `localhost`, register that origin separately. Include a custom domain if you have one.
8. Fill `.env` locally. On GitHub, store `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUB_KEY` (or `VITE_SUPABASE_ANON_KEY` for legacy projects). These keys are in the bundle and public by design; security is RLS/RPC.
9. Test “Sign in with Google”. OAuth return uses PKCE managed by the SDK. On first login, choose a unique nickname of 3–12 ASCII characters: letters, numbers, or `_`. Uniqueness is case-insensitive. Nickname is immutable in this version.
10. Finish an authenticated run, open the leaderboard, and verify a single row in `scores`. A worse run does not replace the record. Test another account and a guest session.

Official references: [Google on Supabase](https://supabase.com/docs/guides/auth/social-login/auth-google), [OAuth in the JavaScript SDK](https://supabase.com/docs/reference/javascript/auth-signinwithoauth), [database functions and security definer](https://supabase.com/docs/guides/database/functions).

### Backend rules

`profiles(user_id, nickname UNIQUE)` and `scores(user_id, best_score, level_reached, updated_at)` allow public SELECT via RLS. Direct INSERT, UPDATE, and DELETE are revoked. `claim_nickname` is the only profile write. `submit_score` is the only leaderboard write; both are `SECURITY DEFINER`, use `search_path = ''`, and run only as `authenticated`.

After migration 002, `submit_score` derives identity from `auth.uid()` (no user_id argument), requires a profile, positive score multiple of 10, stage ≥ 1, and score ≤ 25,000 × stage. Score is peak balance. Minimum active duration is `max(1,000 ms, ceil(score / speed), ceil((stage−1) × 8,000 / speed))`, using the same linear speed curve as the game. The migration removes old artificial limits of 999 screens and seven days; values are stored in bigint, bounded only by exact JavaScript integers (2⁵³−1). Up to five new runs per minute per user; advisory lock serializes concurrent calls. Duplicate receipts return the record without consuming a new quota. Lower scores keep associated score and stage; on ties, higher stage wins.

**Security limit:** the offline client reports score and duration. These limits block absurd values and simple abuse but do not prove a legitimate run against a tampered client. A competitive leaderboard with strong guarantees would need verifiable replay or an authoritative server. There is no browser secret that fixes this. Tests use embedded PostgreSQL (PGlite) and simulate only `auth.users`, `auth.uid()`, and roles; real OAuth flow requires configured accounts.

## Deploy to Cloudflare Pages via GitHub Actions

1. Create a GitHub repository and push this folder to `main` (including `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `public/`, and `.github/`; exclude `.env`, `node_modules/`, and `dist/`). If you use a personal token to push workflows, grant the appropriate workflow scope/permission.
2. In Cloudflare, create a **Pages → Direct Upload** project named, for example, `neon-maze`. Upload is done by the Action; you do not need Pages Git Integration as well.
3. Create a Cloudflare API token with **Account → Cloudflare Pages → Edit**, scoped to the correct account. Copy the Account ID too.
4. In GitHub, open **Settings → Secrets and variables → Actions** and create:

   | Type | Name | Value |
   | --- | --- | --- |
   | Secret | `CLOUDFLARE_API_TOKEN` | Pages deploy token |
   | Secret | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID |
   | Secret | `VITE_SUPABASE_URL` | Public Supabase project URL |
   | Secret | `VITE_SUPABASE_PUB_KEY` | Supabase publishable key (preferred) |
   | Secret | `VITE_SUPABASE_ANON_KEY` | Legacy anon key, fallback |
   | Variable | `CLOUDFLARE_PAGES_PROJECT` | Exact Pages project name |

5. Create the GitHub Environment `production` (optionally require human deploy approval). Keep both Supabase secrets at repo level: the `verify` job and keepalive need them too.
6. Push to `main` or run **Actions → Verify and deploy Neon Maze → Run workflow**. Pull requests run validation but do not publish or receive production credentials on forks.
7. CI installs with frozen lockfile, checks TypeScript, runs Vitest (1,200 seeds + database), builds, tests Chromium including offline mode, and publishes **the same artifact** with `wrangler pages deploy`. Deploy URL appears in Wrangler logs.
8. Open `https://PROJECT_NAME.pages.dev`, update Supabase/Google redirect URLs for that domain, and test the full flow. Without Supabase secrets, the bundle still works in guest mode.
9. To roll back, promote a previous deploy in the Pages dashboard or revert the commit and run the workflow again. The service worker keeps a consistent version until the user closes old tabs.

Official reference: [Direct Upload with CI on Cloudflare Pages](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/).

### Weekly Supabase activity

`supabase-keepalive.yml` performs a real read of the scores table every Monday at **09:17 UTC / 06:17 São Paulo**, using only the public key. It can be triggered manually and fails visibly if the project or secret is unavailable.

This is a **best-effort** activity measure, not a guarantee that the Free plan will never pause. Supabase evaluates low activity over seven-day windows; GitHub’s scheduler can delay or disable schedules on inactive repos. One weekly query is not an availability guarantee. If the project pauses, restore it from the dashboard; offline play still works. [Supabase official pause policy](https://supabase.com/docs/guides/platform/free-project-pausing).

## Acceptance checklist

- [ ] `pnpm check`, `pnpm build`, and `pnpm test:browser` pass locally/CI.
- [ ] All five screens open on desktop and mobile; no gameplay feature depends on the network.
- [ ] Remapping, volume, mute, and high score survive reload.
- [ ] After initial cache, disconnecting the network and reloading keeps a playable run.
- [ ] A guest does not create database rows, including after later login.
- [ ] Duplicate nickname, direct REST writes, and implausible scores are rejected.
- [ ] Best offline authenticated run syncs when back online with the same account.
- [ ] OAuth works on production domain and leaderboard highlights the current account in the top 20.
- [ ] Physical gamepad and gestures were checked on target devices.

Installation PNGs are original and versioned. `scripts/create-icons.py` reproduces them with Pillow if you want to edit branding; Python is not part of the game build or runtime.
