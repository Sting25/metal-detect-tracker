# Metal Detect Tracker

Track your metal detecting sites, finds, and landowner permissions — all in one place.

Built for detectorists who want to stay organized, document their finds, and keep landowner relationships on good terms. Works on desktop and mobile.

## Features

**Sites & Mapping**
- Pin your detecting sites on an interactive map (Leaflet + OpenStreetMap)
- Track land type, permission status, priority, and notes per site
- Country-aware map centering (US, GB, AU, and more)
- Satellite and street map layers

**Finds Logging**
- Log every find with photos, depth, date, and description
- Depth stored in metric, displayed in your preferred unit (inches or cm)
- Link finds to specific sites
- Export/import your data (ZIP backup with photos)

**Landowner Permissions**
- Generate professional permission letters (PDF) for landowner signatures
- Public approval links with QR codes — landowners can sign from their phone
- Track permission status per site (pending, granted, denied, expired)

**Hunts**
- Plan and log detecting sessions
- Link hunts to sites and track conditions, equipment, and notes

**International Support**
- Country-specific land type presets (US, GB, AU)
- Custom land types per user
- Imperial/metric unit preference
- Region-aware legal reference content

**Authentication**
- Email/password with strong password requirements (12+ characters)
- Google OAuth ("Sign in with Google")
- WebAuthn passkeys (passwordless/biometric login)
- Optional email verification
- Optional SMS-based password reset (Twilio)
- Demo mode for trying the app without an account

**Admin**
- User management dashboard
- Invite code system for controlled registration
- Feedback inbox
- App settings

## Quick Start

### Prerequisites

- **Node.js** 18 or higher
- **PostgreSQL** 14 or higher

### 1. Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/metal-detect-tracker.git
cd metal-detect-tracker
npm install
```

### 2. Create the database

```bash
createdb metal_detect_tracker
```

### 3. Configure environment

```bash
cp .env.example .env
```

Open `.env` and set the two required values:

```env
DATABASE_URL=postgresql://localhost:5432/metal_detect_tracker
JWT_SECRET=paste-your-generated-secret-here
```

Generate a JWT secret:

```bash
openssl rand -hex 32
```

### 4. Start the server

```bash
npm run dev
```

### 5. Create your admin account

Open [http://localhost:3000](http://localhost:3000) in your browser. You'll be guided through creating your first admin account. That's it — you're up and running.

## Configuration

All configuration is done through environment variables. See `.env.example` for the complete list with descriptions.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | `postgresql://localhost:5432/metal_detect_tracker` | PostgreSQL connection string |
| `JWT_SECRET` | Yes | — | Secret for signing auth tokens |
| `PORT` | No | `3000` | Server port |
| `NODE_ENV` | No | — | Set to `production` for production |
| `BASE_URL` | No | `http://localhost:3000` | Used in emails and permission letter links |
| `ALLOW_SETUP` | No | `true` | Set to `false` after creating your admin account |

### Optional: File Storage (S3-compatible)

Required for photo uploads. Works with DigitalOcean Spaces, AWS S3, MinIO, or any S3-compatible service. Without this, the app works but photo uploads will fail.

```env
DO_SPACES_ENDPOINT=https://nyc3.digitaloceanspaces.com
DO_SPACES_BUCKET=your-bucket-name
DO_SPACES_KEY=your-access-key
DO_SPACES_SECRET=your-secret-key
DO_SPACES_REGION=nyc3
```

### Optional: Email (SendGrid)

Enables email verification, password reset emails, and admin notifications. Without this, those features are silently disabled.

```env
SENDGRID_API_KEY=SG.your-api-key
SENDGRID_FROM_EMAIL=noreply@yourdomain.com
SENDGRID_FROM_NAME=Metal Detect Tracker
EMAIL_VERIFICATION_ENABLED=true
```

### Optional: SMS (Twilio Verify)

Enables phone-based password reset. Without this, SMS features are disabled.

```env
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your-auth-token
TWILIO_VERIFY_SID=VAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### Optional: Google OAuth

Enables "Sign in with Google" on the login page. Create credentials at [Google Cloud Console](https://console.cloud.google.com/apis/credentials).

```env
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
```

### Optional: WebAuthn Passkeys

Enables passwordless login with biometrics or security keys. The `RP_ID` must match the domain your users access.

```env
WEBAUTHN_RP_NAME=Metal Detect Tracker
WEBAUTHN_RP_ID=yourdomain.com
WEBAUTHN_ORIGIN=https://yourdomain.com
```

## Production Deployment

### Basic setup

1. Set `NODE_ENV=production` in your environment
2. Set `ALLOW_SETUP=false` after creating your admin account
3. Set `BASE_URL` to your public URL
4. Configure S3 storage for photo uploads

### Process manager (PM2)

```bash
npm install -g pm2
pm2 start server.js --name metal-detect-tracker
pm2 save
pm2 startup
```

See `ecosystem.config.js.example` for a full PM2 config template.

### Reverse proxy (Nginx)

See `nginx/example.conf` for a ready-to-use Nginx config with SSL support via Let's Encrypt:

```bash
sudo cp nginx/example.conf /etc/nginx/sites-available/yourdomain.com
sudo ln -s /etc/nginx/sites-available/yourdomain.com /etc/nginx/sites-enabled/
sudo certbot --nginx -d yourdomain.com
sudo nginx -t && sudo systemctl reload nginx
```

## Running Tests

Tests use a separate PostgreSQL database so your development data is never touched.

```bash
# Create the test database (one time)
createdb metal_detect_tracker_test

# Run all tests
npm test

# Watch mode (re-runs on file changes)
npm run test:watch

# With coverage report
npm run test:coverage
```

Tests run sequentially in ~3 seconds. External services (S3, email, SMS) are automatically mocked.

## Project Structure

```
metal-detect-tracker/
├── server.js              # Express app entry point
├── database.js            # PostgreSQL pool + query helpers
├── db/
│   ├── schema.js          # CREATE TABLE statements
│   ├── migrations.js      # Additive ALTER TABLE migrations
│   └── seeds.js           # Default data (land types, legal content, demo user)
├── middleware/
│   ├── auth.js            # JWT verification + role checking
│   ├── csrf.js            # CSRF protection (Origin/Referer)
│   ├── upload.js          # Multer config (file type/size limits)
│   └── validate.js        # Zod input validation schemas
├── routes/
│   ├── auth.js            # Login, register, setup, OAuth, passkeys
│   ├── sites.js           # CRUD for detecting sites
│   ├── finds.js           # CRUD for finds
│   ├── hunts.js           # CRUD for hunt sessions
│   ├── permissions.js     # Landowner permission letters + PDF generation
│   ├── admin.js           # Admin dashboard endpoints
│   └── ...                # feedback, exports, imports, land-types, etc.
├── services/
│   ├── s3.js              # S3-compatible file storage
│   └── email.js           # SendGrid email service
├── public/
│   ├── *.html             # Frontend pages (no build step)
│   ├── js/                # Frontend JavaScript (vanilla JS, IIFEs)
│   ├── css/style.css      # Single stylesheet with CSS custom properties
│   └── icons/             # App icons and images
├── tests/
│   ├── setup.js           # Test database setup + teardown
│   ├── helpers.js         # Test utilities (createUser, createSite, etc.)
│   └── *.test.js          # Test files
├── nginx/
│   └── example.conf       # Example Nginx reverse proxy config
├── .env.example           # Environment variable template
└── ecosystem.config.js.example  # PM2 config template
```

## Tech Stack

- **Runtime**: Node.js + Express.js
- **Database**: PostgreSQL via [pg](https://www.npmjs.com/package/pg)
- **Auth**: JWT + bcryptjs + Google OAuth + WebAuthn passkeys
- **Validation**: [Zod](https://zod.dev)
- **File uploads**: Multer (memory) + S3-compatible storage
- **Email**: SendGrid
- **SMS**: Twilio Verify
- **Maps**: [Leaflet.js](https://leafletjs.com) + OpenStreetMap
- **PDF generation**: [PDFKit](https://pdfkit.org)
- **Testing**: [Vitest](https://vitest.dev) + [Supertest](https://www.npmjs.com/package/supertest)
- **Frontend**: Vanilla JavaScript (no build step, no framework)

## Customization Notes

The frontend HTML files contain `signalbouncer.com` references in SEO meta tags (canonical URLs, Open Graph tags, sitemap). If you deploy under your own domain, update these to match:

- `public/landing.html`, `public/login.html`, `public/legal.html`, `public/privacy.html` — canonical and og: URLs
- `public/sitemap.xml` — sitemap URLs
- `public/robots.txt` — sitemap reference

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, code style, and PR guidelines.

## License

[MIT](LICENSE)
