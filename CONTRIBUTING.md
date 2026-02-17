# Contributing to Metal Detect Tracker

Thanks for your interest in contributing! This guide will help you get set up.

## Development Setup

1. Follow the [Quick Start](README.md#quick-start) in the README
2. Create a test database: `createdb metal_detect_tracker_test`
3. Run the tests to make sure everything works: `npm test`

## Running Tests

```bash
npm test              # Run all tests once
npm run test:watch    # Re-run on file changes
npm run test:coverage # Generate coverage report
```

All tests must pass before submitting a PR. Tests run in ~3 seconds — external services (S3, email, SMS) are automatically mocked, so no API keys are needed for testing.

## Code Style

This project uses specific patterns. Please follow the existing conventions:

- **Backend**: Express.js routes in `routes/`, middleware in `middleware/`, services in `services/`
- **Frontend**: Vanilla JavaScript using IIFEs (`window.ModuleName`). No build step, no framework.
- **API calls in frontend**: Always use `Auth.authedFetch()`, never raw `fetch()`
- **CSS**: Single stylesheet (`public/css/style.css`) with CSS custom properties (`--color-*`, `--space-*`, `--radius-*`)
- **Database queries**: Always use parameterized queries (`$1, $2, ...`). Never concatenate user input into SQL.
- **Error handling**: Wrap all async operations in try/catch. Show user-friendly messages, never raw errors.
- **Input validation**: Use Zod schemas in `middleware/validate.js` for all API input.

## Making Changes

1. Create a branch from `main`
2. Make your changes
3. Add tests for new functionality
4. Run `npm test` and make sure everything passes
5. Submit a pull request with a clear description of what changed and why

### PR Guidelines

- Keep PRs focused — one feature or fix per PR
- Include tests for new routes or changed behavior
- Don't include unrelated formatting changes or refactors
- Update the README if you're adding new configuration or features

## Adding a New API Route

1. Create the route file in `routes/`
2. Add auth middleware (`verifyToken`, `requireAdmin` if needed) inside the router
3. Add Zod validation schemas in `middleware/validate.js`
4. Mount the route in `server.js`
5. Add tests in `tests/`

## Adding a Frontend Page

1. Create the HTML file in `public/`
2. Create the JS file in `public/js/`
3. Include `auth.js` and `config.js` for authenticated pages
4. Use `Auth.authedFetch()` for all API calls
5. Follow the existing card/badge/button patterns

## Security

If you discover a security vulnerability, please **do not** open a public issue. Instead, email the maintainers directly so the issue can be addressed before public disclosure.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
