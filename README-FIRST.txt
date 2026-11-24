EBNIMAAM STOREFRONT FRONTEND PATCH — 24 NOV 2026

WHAT THIS PATCH FIXES
- Uses the existing live database endpoint GET /api/products instead of showing six invented demo products.
- Displays database prices from price_kobo in naira and uses each product's database ID/image/stock.
- Sends checkout to the existing POST /api/checkout endpoint using the request fields that its deployed handler expects: name, email, phone, address (string), and items [{ productId, quantity }].
- Adds the PWA manifest and service-worker registration; includes the original logo and 192/512 icons.
- Includes the supplied terms.html and the supplied support email/WhatsApp/Instagram details.
- Does not fake successful payments. Checkout redirects to the authorization URL returned by the server.

IMPORTANT LIMITATIONS — NOT A FULL STORE RELEASE
- This is a frontend patch for the existing Next.js deployment. Place these files in the project's public/ directory; do not replace src/app or the database/payment API routes.
- The currently deployed checkout handler is the source of truth for payment. This patch has not been deployed or end-to-end tested with Paystack.
- The deployed backend does not currently expose the order-tracking endpoint referenced in the original integration notes. The tracking panel now tells customers to contact support rather than making a broken request.
- Customer registration/sign-in, AI support, admin image-file upload, and full order management are not implemented by this patch.
- Promo-code entry is omitted because the deployed checkout route contract inspected here does not accept promoCode.
- Product variants/sizes are not yet stored in the current products API; the storefront currently treats products as One Size.
- Review the supplied terms and delivery policies before public launch.

DEPLOYMENT SAFETY
- Keep PAYSTACK_SECRET_KEY private in Vercel environment variables. Never put it in public/ or commit it to source.
- Preserve the existing src/app API routes, Neon database connection, and admin authentication files.
- Deploy as a Preview first. Verify homepage, /api/products, checkout initialization, Paystack callback/verification, and mobile PWA install before promoting to production.
