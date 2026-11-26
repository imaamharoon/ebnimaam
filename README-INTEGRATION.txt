LEGACY INTEGRATION NOTES — SUPERSEDED

This file described the original static storefront prototype and is not the current checkout or catalogue implementation.

The current application is documented in README.md. Current production code uses:

- public/store.html for the responsive storefront and in-page customer-account panel.
- /api/products for the published, in-stock product catalogue.
- /api/create-payment for signed-in customer checkout and server-calculated pricing/delivery.
- /api/verify-payment and /api/paystack-webhook for Paystack verification and reconciliation.
- /api/track-order for order lookup using reference plus the order email.
- /admin for the authenticated owner dashboard.

Do not copy the sample code below or use any sample prices/inventory from the original starter package. Do not put Paystack credentials in browser code. Do not mark any test order as paid from client-side logic.

The owner must add and verify the real product images, product prices, variant availability and physical stock in the authenticated Admin dashboard before publishing products. Production email verification requires a working dedicated SMTP provider. Confirm the Paystack webhook URL in Paystack dashboard.

Preserve the existing Paystack integration and never make a live charge for testing. Read README.md for current release gates and owner exclusions.
