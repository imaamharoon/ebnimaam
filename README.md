# ebnimaam

The Ebnimaam application is a Nigeria-only mobile storefront, customer account and owner-admin system built with Next.js, Neon Postgres/Managed Auth, and the existing Paystack payment integration.

## Application routes

- `/store.html` — responsive storefront, live database catalogue, product filtering/search, saved cart, authenticated checkout and order tracking.
- `/account.html` — customer registration, sign-in, email verification, profile/address book, order history, sign-out and data export.
- `/admin` — owner dashboard for orders, fulfilment, product publishing, inventory, news and store/delivery settings.
- `/privacy.html`, `/returns.html`, `/terms.html` — customer policy pages.
- `/manifest.webmanifest` and `/service-worker.js` — installable web app resources.

## Services and environment

Required Vercel environment variables:

- `DATABASE_URL` — Neon Postgres connection string.
- `PAYSTACK_SECRET_KEY` — existing Paystack secret. Keep server-only.
- `ADMIN_PASSWORD` — owner-admin password. Keep secret.
- `AUTH_SECRET` — HMAC secret for signup challenge signing and rate-limit key hashing.

Neon Managed Auth is configured for email/password signup with mandatory OTP email verification. Production email delivery must use a verified, dedicated SMTP provider; the Neon shared sender is intended for development. Confirm SMTP delivery before opening public registration.

Paystack remains the payment provider. Checkout totals are calculated server-side from active products, the enabled EBN10 discount rule and the saved Nigeria delivery-fee settings. Server-side verification reconciles the payment reference, NGN amount, transaction ID, order status and available stock. The signed webhook handler is `/api/paystack-webhook`. Confirm that the matching webhook URL is registered in the Paystack dashboard before depending on webhook delivery; the customer return page also requests server-side transaction verification.

## Nigeria fulfilment

Checkout only accepts Nigerian addresses. Current delivery fee defaults are editable by the owner in Admin and are used by the checkout API. Confirm the live fee schedule, pickup details and fulfilment coverage before launch.

## Catalogue safety

The public catalogue returns only products marked as published and with available stock. New products are drafts by default. Starter/sample products from legacy prototypes are not automatically published. The owner must enter and verify the actual product image, whole-naira price, sizes/variants and physical stock before publishing an item.

## Android app

The Android workflow builds an APK from `main` and `preview/mobile-header-refine`. The APK is a branded Capacitor wrapper which loads the production storefront at `https://ebnimaam.vercel.app/store.html`; therefore it always uses the latest production website once that site is deployed. A new release is published from successful GitHub Actions runs.

## Development

```bash
npm install
npm run dev
```

The project uses Next.js 15.5.29. Build and type-check:

```bash
npm run build
```

## Release checks

Before promoting a release, verify all of the following on the exact candidate deployment:

1. Signup challenge, signup, OTP mail delivery, email verification, sign-in, password reset and session expiry.
2. Customer account profile, Nigeria address book, privacy export and authenticated order history.
3. Store catalogue, search/filter, stock/variants, cart persistence, mobile navigation and account panel.
4. Authenticated checkout; server price/discount/delivery calculation; Paystack initialize, return verification, signed webhook and idempotent reconciliation.
5. Admin login, authorization, product CRUD/publishing, inventory, news, store settings, order fulfilment and audit history.
6. Returns, privacy and terms pages; PWA manifest/icons/service-worker; mobile/desktop accessibility, performance and SEO.
7. Production domain/HTTPS, deployment health and the APK download/release.

Never use real Paystack charges for a test. Distinguish implemented code from tested end-to-end behavior and do not mark a launch gate passed without evidence. Do not publish demo inventory or placeholder product pricing.

## Owner exclusions

- Nigeria-only delivery/pickup.
- Paystack only; preserve the existing working payment integration.
- No guest checkout.
- No Facebook/social login; Google OAuth is not enabled until real provider credentials are configured.
- No automated SMS or WhatsApp system messages; WhatsApp is a customer contact link only.
- No real payment charges as part of testing.
