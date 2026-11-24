# Ebnimaam starter

Next.js 14 storefront starter with cart, Paystack initialization and verification endpoints, and an admin password gate.

## Environment
- `PAYSTACK_SECRET_KEY`: Paystack secret key, server-only
- `ADMIN_PASSWORD`: strong admin password (legacy typo `ADMIN_PASWORD` also recognized)
- `DATABASE_URL`: Neon connection string (database schema included, order persistence not yet wired)

## Run
`npm install && npm run dev`

## Notes
This starter is not production-ready: checkout currently uses a placeholder customer email, it does not persist or reconcile orders, webhook processing and inventory management are not implemented, and the admin gate does not establish a persistent authenticated session. Do not use it to accept live payments until these issues are resolved and tested.
