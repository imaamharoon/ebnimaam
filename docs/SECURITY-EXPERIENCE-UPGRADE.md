# Ebnimaam security and customer-experience upgrade

This release groups security hardening, customer experience improvements, and an operational checklist. It distinguishes code changes from provider-level work that needs a separate, tested change.

## Implemented in this release branch

- Global security response headers: HTTP Strict Transport Security, frame protection, MIME sniffing protection, safer referrer handling, and a restricted browser permissions policy. The framework powered-by header is disabled.
- Rate-limit keys use HMAC with the application's configured authentication secret. The weak built-in fallback secret is removed. Missing database or signing configuration causes rate-limited routes to fail closed.
- Payment verification is rate-limited and served with no-store headers. Checkout and Paystack webhook request bodies have explicit size limits.
- Customer product-review submissions are rate-limited.
- Administrator activity is written to the existing `admin_activity_log` table for successful sign-ins, order fulfilment changes, product saves and archives, store-setting changes, and news saves and deletions. The latest events are visible in the authenticated admin dashboard.
- Dependabot checks npm packages and GitHub Actions weekly.
- The preview workflow runs a dependency audit, TypeScript checking, and a production Next.js build.

## Existing capabilities retained

- Verified customer accounts and email-verification checks.
- The existing two-minute account-creation cooldown. The signup/authentication route is intentionally unchanged in this release.
- Server-side Paystack payment verification, signed webhook reconciliation, and stock reconciliation.
- Server-side product price, quantity, delivery-fee, and stock validation.
- Browser-persisted cart, product search and category filters, lazy-loaded product images, saved addresses, customer order history, order tracking, support chat, purchase-verified product reviews, and installable PWA/service-worker support.

## Database findings and guardrails

- Neon Data API is disabled. Keep it disabled: this application uses server-side route handlers and a private Postgres connection.
- Row-level security is disabled on the inspected tables. Do not enable RLS with blanket policies: application authorization currently occurs in server-side route handlers, and policies must be designed and tested for each database access path before activation.
- The database currently exposes one application database role with broad table privileges. Introduce a dedicated least-privilege runtime role only after runtime table creation/alteration is moved into reviewed migrations and the Vercel `DATABASE_URL` is rotated safely. Do not replace the existing credential before that work is complete.
- The inspected Neon Free project has a six-hour history window and no scheduled snapshot backup. Automated snapshot schedules require an eligible paid plan; the Free plan includes one manual snapshot and snapshot storage is billed. This code release does not upgrade a plan, create a billable snapshot, or enable a paid backup schedule.

## Owner-level release tasks

1. Authorize the correct Vercel team connection and inspect the preview build.
2. Confirm required preview and production environment variables exist without revealing their values. Keep Paystack and database secrets server-only.
3. Refactor runtime DDL into versioned migrations, then create a dedicated least-privilege database role and rotate the private runtime connection string with a tested rollback.
4. Choose a backup strategy. The current Free plan does not provide scheduled snapshot backups; any paid plan or billable manual snapshot needs owner approval. Maintain independent exports and test restoration.
5. Configure stronger administrator authentication, preferably MFA, before creating additional staff administrator accounts.
6. Test privacy isolation with two customer accounts and verify that neither account can access or change the other's profile, addresses, or orders.
7. Test Paystack success, failed payment, webhook retries, duplicate callbacks, concurrent stock, low stock, cancellations, and refunds using test credentials before production use.
8. Test Android and slow-network journeys: account creation, browsing, search, cart persistence, checkout, payment return, order tracking, and customer support.
9. Promote only after preview build and release checks pass. Keep the previous production deployment available for rollback.
