# Signal Bouncer

> **Track your metal detecting sites, finds, and landowner permissions — all in one place.**

**[signalbouncer.com](https://signalbouncer.com)** | [Try the Demo](https://signalbouncer.com/login.html)

Signal Bouncer is a free, open-source web app built for metal detectorists who want to stay organized, document their finds, and keep landowner relationships on good terms. It runs on any device — desktop, tablet, or phone — and installs as a PWA for offline access.

---

## What It Does

**Map Your Sites** — Pin detecting sites on interactive maps with satellite and street layers. Track land type, permission status, priority, and notes. Maps center automatically based on your country.

**Log Your Finds** — Record every find with photos, depth, GPS coordinates, date, and description. Finds link to sites so you can track what came from where. Depth is stored in metric and displayed in your preferred unit.

**Manage Permissions** — Generate professional permission request letters as PDFs. Create public approval links with QR codes so landowners can review and sign from their phone. Track status per site: pending, granted, denied, or expired.

**Share With Friends** — Invite other detectorists to view or edit your sites. Shared users can log finds on shared sites. You control access.

**Export Everything** — Download your sites, finds, and permissions as CSV, JSON, or a full ZIP backup including photos.

---

## Features

### Core
- Interactive maps with Leaflet.js + OpenStreetMap (satellite, street, and topo layers)
- Site management with GPS, land type, notes, and status tracking
- Finds logger with photo uploads, depth recording, and GPS
- Permission letter generator with PDF export and digital signatures
- Hunt session planner linked to sites
- Data export/import (CSV, JSON, ZIP with photos)

### Authentication
- Email/password with strong password requirements
- Google Sign-In (auto-links matching accounts)
- WebAuthn passkeys for passwordless/biometric login
- Email verification and SMS-based password reset
- Demo mode — try the full app without creating an account

### International Support
- Country-specific land type presets (US, GB, AU, CA, NZ)
- Custom land types per user
- Imperial/metric unit toggle
- Multi-language (English, Spanish, French)
- Country-aware legal reference content

### Admin
- User management dashboard
- Invite code system for controlled registration
- Feedback inbox
- App-wide settings

### Security
- JWT authentication with role-based access control
- Rate limiting on auth endpoints
- Helmet security headers and CSRF protection
- Zod input validation on all API routes
- Data isolation — users only see their own data and explicitly shared sites

---

## Quick Start

### Prerequisites

- **Node.js** 18+
- **PostgreSQL** 14+

### Setup

```bash
git clone https://github.com/Sting25/metal-detect-tracker.git
cd metal-detect-tracker
npm install

createdb metal_detect_tracker
cp .env.example .env
```

Edit `.env` and set the two required values:

```env
DATABASE_URL=postgresql://localhost:5432/metal_detect_tracker
JWT_SECRET=your-secret-here
```

Generate a JWT secret: `openssl rand -hex 32`

### Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — you'll be guided through creating your first admin account.

---

## Configuration

All configuration is through environment variables. Only two are required — everything else enables optional features that degrade gracefully when absent. See [`.env.example`](.env.example) for the full list.

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_SECRET` | Yes | Secret for signing auth tokens |
| `PORT` | No | Server port (default: 3000) |
| `BASE_URL` | No | Public URL for emails and permission links |

### Optional Integrations

| Feature | Variables | What It Enables |
|---------|-----------|----------------|
| **Photo Uploads** | `DO_SPACES_*` | S3-compatible file storage (DigitalOcean Spaces, AWS S3, MinIO) |
| **Email** | `SENDGRID_*` | Email verification, password resets, admin notifications |
| **SMS** | `TWILIO_*` | Phone-based password reset via Twilio Verify |
| **Google Sign-In** | `GOOGLE_CLIENT_ID` | "Sign in with Google" on the login page |
| **Passkeys** | `WEBAUTHN_*` | Passwordless login with biometrics or security keys |

---

## Production Deployment

1. Set `NODE_ENV=production` and `ALLOW_SETUP=false`
2. Set `BASE_URL` to your public domain
3. Configure S3 storage for photo uploads

### PM2

```bash
npm install -g pm2
pm2 start server.js --name signal-bouncer
pm2 save && pm2 startup
```

See [`ecosystem.config.js.example`](ecosystem.config.js.example) for a full config template.

### Nginx + SSL

```bash
sudo cp nginx/example.conf /etc/nginx/sites-available/yourdomain.com
sudo ln -s /etc/nginx/sites-available/yourdomain.com /etc/nginx/sites-enabled/
sudo certbot --nginx -d yourdomain.com
sudo nginx -t && sudo systemctl reload nginx
```

---

## Testing

585 tests across 29 files. External services (S3, email, SMS) are automatically mocked — no API keys needed.

```bash
createdb metal_detect_tracker_test   # one time

npm test                # run all tests (~25s)
npm run test:watch      # re-run on file changes
npm run test:coverage   # generate coverage report
```

---

## Tech Stack

| | |
|---|---|
| **Runtime** | Node.js + Express.js |
| **Database** | PostgreSQL via [pg](https://www.npmjs.com/package/pg) |
| **Auth** | JWT + bcrypt, Google OAuth, WebAuthn passkeys |
| **Validation** | [Zod](https://zod.dev) |
| **Maps** | [Leaflet.js](https://leafletjs.com) + OpenStreetMap |
| **File Storage** | S3-compatible (DigitalOcean Spaces, AWS S3, MinIO) |
| **Email** | [SendGrid](https://sendgrid.com) |
| **PDF** | [PDFKit](https://pdfkit.org) |
| **Testing** | [Vitest](https://vitest.dev) + [Supertest](https://www.npmjs.com/package/supertest) |
| **Frontend** | Vanilla JavaScript — no build step, no framework |

## Project Structure

```
├── server.js                # Express app entry point
├── database.js              # PostgreSQL pool + query helpers
├── db/
│   ├── schema.js            # Table definitions
│   ├── migrations.js        # Additive ALTER TABLE migrations
│   └── seeds.js             # Default data (land types, demo user)
├── middleware/
│   ├── auth.js              # JWT verification + role checking
│   ├── csrf.js              # CSRF protection
│   ├── upload.js            # Multer file upload config
│   └── validate.js          # Zod validation schemas
├── routes/
│   ├── auth.js              # Login, register, email verification
│   ├── auth-social.js       # Google OAuth
│   ├── auth-passkey.js      # WebAuthn passkeys
│   ├── sites.js             # Site CRUD + sharing
│   ├── finds.js             # Finds CRUD
│   ├── permissions.js       # Permission letters + PDF + signatures
│   ├── admin.js             # Admin dashboard
│   └── ...                  # feedback, exports, imports, land-types, hunts
├── services/
│   ├── s3.js                # S3-compatible storage
│   └── email.js             # SendGrid email
├── public/
│   ├── *.html               # Frontend pages
│   ├── js/                  # Client-side JavaScript
│   ├── css/style.css        # Single stylesheet (CSS custom properties)
│   └── locales/             # i18n translation files (en, es, fr)
├── tests/                   # 29 test files, 585 tests
├── nginx/example.conf       # Nginx reverse proxy template
├── .env.example             # Environment variable template
└── ecosystem.config.js.example  # PM2 config template
```

---

## Self-Hosting

Signal Bouncer is designed to be easy to self-host. The only hard requirements are Node.js and PostgreSQL. All external integrations (email, SMS, file storage, OAuth) are optional and the app works without them — you just won't have those specific features.

If you deploy under your own domain, update the SEO meta tags in the HTML files:
- `public/landing.html`, `public/login.html`, `public/legal.html`, `public/privacy.html` — canonical and og: URLs
- `public/sitemap.xml` and `public/robots.txt` — sitemap URLs

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, code style, and PR guidelines.

If you discover a security vulnerability, please do not open a public issue — email the maintainers directly.

## License

[MIT](LICENSE)
