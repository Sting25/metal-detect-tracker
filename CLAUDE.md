# Metal Detect Tracker - Development Rules

These rules MUST be followed for all development work on this project.

## Error Handling

- **Fail gracefully**: Every user-facing operation must have error handling. Never show raw error messages, stack traces, or technical details to the user.
- **Try/catch everything**: All API calls, database operations, and async operations must be wrapped in try/catch blocks.
- **User-friendly messages**: Show clear, helpful error messages. "Something went wrong" is better than a stack trace, but a specific message like "Failed to load sites" is even better.
- **Don't crash the app**: A single failed operation should never take down the whole page. If loading map pins fails, the dashboard should still show stats and activity.
- **Log server errors**: Always `console.error()` on the server side for debugging. Never expose internal error details in API responses in production.

## Security

- **Never expose user data**: API endpoints must scope data by user_id. Regular users must only see their own data and data explicitly shared with them.
- **Admin endpoints require admin role**: All /api/admin/* routes require both authentication AND admin role verification.
- **Generic auth errors**: Login failures must use generic messages like "Invalid email or password" — never reveal whether an email exists in the system.
- **Validate all inputs**: Check required fields, data types, and lengths on the server side. Never trust client-side validation alone.
- **No secrets in client code**: Never put API keys, passwords, or tokens in JavaScript files or HTML. Use environment variables on the server.
- **Sanitize display data**: Always escape HTML when rendering user-provided content to prevent XSS.

## Data Isolation

- **User scoping**: All queries for sites, finds, and permissions must filter by user_id or check sharing permissions.
- **Admin sees all**: Admins can view all data for management purposes.
- **Shared access is explicit**: Users only see shared sites when explicitly granted via site_shares table.

## UX Principles

- **Empty states must guide**: When a page has no data, show a helpful empty state with an icon, explanation, and a call-to-action button to create the first item.
- **Loading states**: Show loading indicators for async operations. Disable buttons during submission to prevent double-clicks.
- **Mobile first**: All features must work on mobile. Use the bottom tab navigation pattern. Minimum touch targets of 44px.
- **Consistent patterns**: Use the same card, badge, and button patterns throughout. Follow the existing CSS design system variables.

## Code Patterns

- **Auth wrapper**: All fetch calls in the frontend must use `Auth.authedFetch()`, never raw `fetch()`. This handles token injection and 401 redirects automatically.
- **No inline scripts**: Keep JavaScript in separate .js files, not inline in HTML.
- **BEM-ish CSS**: Follow the existing naming patterns. Use CSS custom properties from the design system (--color-*, --space-*, --radius-*, etc.).
- **Progressive enhancement**: Core functionality should work without JavaScript features like geolocation. Geolocation is a nice-to-have, not a requirement.

## Database

- **Migrations are additive**: Use `ALTER TABLE ... ADD COLUMN` with existence checks. Never drop columns or tables in migrations.
- **Foreign keys are ON**: The database has `PRAGMA foreign_keys = ON`. Respect referential integrity.
- **Transactions for batch ops**: Use `db.transaction()` for inserting multiple related rows.

## Deployment

- **Test locally first**: Verify changes work on localhost before deploying.
- **Git commit before deploy**: Always commit working changes to git before deploying.
- **Verify after deploy**: Check HTTP status codes for key pages after every deployment.

## File Structure

- Server routes go in `routes/` (auth, sites, finds, permissions, admin, feedback)
- Middleware goes in `middleware/` (auth.js — verifyToken, requireAdmin)
- Services go in `services/` (email.js — Nodemailer SMTP, sms.js — Twilio Verify)
- Frontend JS goes in `public/js/` (15 files — includes config.js and legal.js)
- Frontend CSS goes in `public/css/style.css` (single file)
- HTML pages go in `public/` (10 pages)
- Database schema and helpers are in `database.js`
- Tests go in `tests/` (29 test files + setup.js + helpers.js)

## Tech Stack

- **Runtime**: Node.js with Express.js
- **Database**: PostgreSQL via pg (Pool, parameterized queries)
- **Auth**: JWT (jsonwebtoken) + bcryptjs, role-based (admin/user)
- **File uploads**: Multer (sites, finds, permissions, feedback screenshots)
- **Email**: SendGrid (@sendgrid/mail)
- **SMS**: Twilio Verify (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SID)
- **Testing**: Vitest v4 + Supertest (585 tests across 29 files, ~25s runtime)
- **Frontend**: Vanilla JS, Leaflet.js maps, no build step

## API Route Structure

All data routes apply auth middleware internally (not globally on server.js):
- `POST/GET /api/auth/*` — No middleware (handles own auth)
- `GET/POST/PUT/DELETE /api/sites/*` — verifyToken, data scoped by user_id + site_shares
- `GET/POST/PUT/DELETE /api/finds/*` — verifyToken, data scoped by user_id + shared sites
- `GET/POST/PUT/DELETE /api/permissions/*` — verifyToken, data scoped by user_id
- `GET/POST/PUT/DELETE /api/admin/*` — verifyToken + requireAdmin
- `POST /api/feedback` — verifyToken (any user); GET/PUT/DELETE — requireAdmin
- `GET/POST/DELETE /api/land-types/*` — verifyToken, GET returns presets + user custom types by country

## Database Tables

users, sites, finds, permissions, site_shares, invite_codes, invite_requests, password_resets, feedback, app_settings, land_types

Key relationships:
- sites.user_id → users.id (owner)
- finds.user_id → users.id, finds.site_id → sites.id
- site_shares grants view/edit access to other users
- All data isolation enforced via user_id scoping + site_shares subqueries

## Testing

Run tests: `npm test` (or `npx vitest run`)
Watch mode: `npm run test:watch`
Coverage: `npm run test:coverage`

Test infrastructure:
- `vitest.config.mjs` — ESM config, globals: true, fileParallelism: false (PostgreSQL single-writer safety), excludes `.claude/` worktree dirs
- `tests/setup.js` — Sets DATABASE_URL + JWT_SECRET env vars, truncates all tables beforeEach
- `tests/helpers.js` — createUser(), createAdmin(), createSite(), createFind(), createPermission(), createInviteCode(), shareSite(), request()
- Tests use a separate PostgreSQL database (auto-truncated between tests)
- All tests run sequentially in ~25 seconds

## Common Workflows

**Run tests before deploy**: `npm test` — all tests must pass
**Add a new API route**: Create route file in routes/, mount in server.js, add tests in tests/
**Add frontend page**: Create HTML in public/, create JS in public/js/, use Auth.authedFetch() for API calls

## Internationalization (Complete)

The app was originally Colorado-focused. Full internationalization has been implemented.

**Design philosophy**: Generic by default, region-specific content is additive. Everything region-specific carries a disclaimer. Build the container now, fill content over time.

### Completed (All Phases 1-5):
- **land_types table**: Lookup table with presets per country (US: 9 types, GB: 7, AU: 6) + support for user custom types
- **users table**: New columns `country_code` (default 'US'), `region`, `unit_preference` (default 'imperial')
- **finds table**: New `depth_cm` column, existing inch data migrated to cm
- **sites.land_type CHECK removed**: No longer locked to US values, supports any land type string
- **Land types API**: `GET/POST/DELETE /api/land-types` (routes/land-types.js)
- **Auth routes updated**: Setup/register accept country_code/region; `PUT /api/auth/preferences` endpoint for unit_preference/country/region
- **Finds routes updated**: Store depth as cm internally, return both depth_cm and depth_inches in responses, accept either on create/update
- **Seed sites region-aware**: `insertSeedSites(userId, countryCode)` — US gets Colorado sites, GB gets rally/beach templates, AU gets prospecting templates, others get a generic template
- **middleware/auth.js**: User SELECT includes country_code, region, unit_preference
- **Tests (Phase 2D)**: Tests for auth country capture, preferences endpoint, finds depth_cm conversion
- **config.js (Phase 3A)**: Shared frontend module — `AppConfig` provides user profile, land types, map defaults, depth formatting, unit-aware helpers, land type dropdown population, unit toggle in navbar
- **Dynamic maps (Phase 3B)**: sites.js, dashboard.js, map.js use `AppConfig.getMapDefaults()` for country-aware map centering (US, GB, AU, world fallback)
- **Dynamic land types (Phase 3C)**: sites.html select and permissions.html select populated from API via `AppConfig.populateLandTypeSelect()` instead of hardcoded options. print-site.js uses `AppConfig.landTypeLabel()`. Custom type creation supported via "Custom..." option.
- **Unit-aware depth (Phase 3D-E)**: finds.js displays depth with `AppConfig.formatDepth()`, form input converts to/from cm. Label updates dynamically. "Units: in/cm" toggle in navbar calls preferences API and refreshes page.
- **config.js included (Phase 3F)**: All 8 authenticated HTML pages include config.js after auth.js
- **Legal page (Phase 4)**: Restructured with disclaimer banner, country selector dropdown, US/Colorado content preserved in `data-country="US"` section, GB (Treasure Act, PAS, permissions, Scotland) and AU (state differences, protected areas) placeholder sections added. legal.js handles show/hide and defaults to user's country.
- **Registration (Phase 5)**: Country dropdown added to registration form with US/GB/AU/CA/NZ/Other options. Timezone detection via `Intl.DateTimeFormat` pre-selects country. `country_code` passed in register API call.
