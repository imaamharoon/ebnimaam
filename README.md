# Ebnimaam

Ebnimaam is a mobile-friendly storefront built with Next.js and static storefront assets.

## Current features
- Responsive storefront, product browsing, filtering and cart
- Checkout flow that initializes Paystack transactions
- Server-side payment verification and persisted order records (PostgreSQL)
- Customer order tracking by reference and email
- Customer sign-in/account page, profile/address editing and order history
- Admin dashboard for order visibility, fulfilment status, product and news management
- Installable web app manifest and service worker

## Environment variables
- `DATABASE_URL`: PostgreSQL/Neon connection string
- `PAYSTACK_SECRET_KEY`: Paystack secret key; keep server-only
- `ADMIN_PASSWORD`: administrator password

## Development
`npm install` then `npm run dev`

## Important launch checks
- Run checkout and payment verification end-to-end in Paystack test mode before accepting live payments.
- Review deployment environment variables and database connectivity.
- Verify account authentication, customer profile routes, admin access, product/news editing, tracking privacy, and installability on real mobile devices.
- Verify inventory, refund, webhook, shipping and account deletion workflows before treating them as complete.
- Do not use production payment credentials or make real charges as part of preview testing.

This repository is actively being improved. Some workflows may not yet be complete or fully tested; confirm the live behavior before relying on them.
