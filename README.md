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

The Android workflow builds an APK from `main` and `preview/mobile-header-refine`. The APK is a branded Capacitor wrapper which loads the production storefront at `https://ebnimaam.vercel.app/store.html`; therefore it always uses the latest production website once that site is deployed. The storefront's Android `Download app` action starts a same-origin download through `/api/download-app`, which streams the APK from the latest successful GitHub release without showing an external release page. Android may still require the user to allow installs from the browser and confirm installation. A new release is published from successful GitHub Actions runs.

The public footer can show logo-only Instagram, Facebook, TikTok, YouTube and X links. Their profile URLs are saved under Admin → Store settings → Social profile links. Only URLs on the matching HTTPS platform domains are accepted; unset profiles remain hidden. These are external profile links, not social-login providers.

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


## Customer fulfilment, tracking and email notifications

Checkout offers **Home delivery** or **Pick up myself**. Pickup is enabled only after the owner saves a pickup address in Admin → Store settings. The API enforces a zero delivery fee for pickup and snapshots the pickup address/hours into the order, so later store-setting changes do not rewrite existing pickup instructions. Delivery orders continue to use the server-side Nigeria state fee schedule.

The owner manages order progress in Admin → Orders:
- Delivery: processing → picked → packed → shipped → delivered (or cancelled).
- Self-pickup: processing → picked → packed → ready for pickup → collected (or cancelled).
- Fulfilment cannot move into preparation/dispatch/collection before Paystack payment is verified.
- Delivery tracking partner, reference and HTTPS courier URL can be saved on each delivery order. The customer tracking page also shows the store's progress timeline and refreshes automatically while opened.

Customer order emails are triggered for initial pending status, successful payment/processing, payment failure, picked items, dispatch, delivery, ready for pickup, collection and cancellation. Each message links to the sign-in-required order page; private order details are only shown after the customer's verified account and active device-bound session are checked. Notification events are logged and de-duplicated so repeated admin saves do not repeatedly email customers. Admin can inspect provider-acceptance history and retry a failed/current-status notification. A provider-accepted message is not proof of inbox delivery.

### Transactional email provider

Resend is the primary provider for customer order and security notifications. Brevo is an optional API fallback when Resend is not configured. The app sends through HTTPS APIs; it does not use Gmail SMTP or store mail passwords.

Configure these encrypted environment variables in the canonical Vercel project for Production (and Preview only when the preview is isolated):
- `RESEND_API_KEY` — a Resend API key with permission to send mail.
- `EMAIL_FROM` — a sender address on a domain verified in Resend, for example `Ebnimaam <orders@your-verified-domain>`.
- `AUTH_SECRET` — a long, random server-only secret used for signed security tokens and private order-tracking functions.
- `BREVO_API_KEY` — optional; used only when `RESEND_API_KEY` is absent.

Keep API keys and secrets out of GitHub, source code, browser code and chat. Do not use a Gmail account password or app password as the mail-provider credential. Confirm the Resend domain's DNS verification (including SPF/DKIM), then send a controlled test to the store owner's inbox and confirm it appears in the provider's message logs. The email notification event log records provider acceptance; it does not prove inbox delivery.

Customer registration OTP, email verification and password-reset messages are sent by Neon Managed Auth, not by the order-notification API. Configure Neon Auth's custom SMTP settings separately with Resend's SMTP endpoint: host `smtp.resend.com`, port `465` (SSL) or `587` (STARTTLS), username `resend`, and the Resend API key as the password. Use a sender address verified in Resend. Test signup OTP, resend-code and password-reset flows separately; do not change the existing signup/session code as part of mail-provider setup.

New-device security alerts must also be explicitly wired to the Resend API before claiming they are active; the current authentication proxy's successful-login path only establishes the customer session and does not itself send a new-device alert.

The internal tracking page shows database status history and checks for updates every 30 seconds while the private link is open. Customers can also use the existing order-reference plus checkout-email lookup as a fallback. It is not a courier GPS feed. For map-based live location, a delivery partner API or rider location integration is required; a secure courier tracking URL can be saved per order in Admin.


## Rewards, wallet, coupons and customer discovery

The rewards area is available at `/rewards.html` for verified signed-in customers. It shows the wallet ledger, referral progress, bank-refund requests and team challenges. Wallet entries are auditable credits/debits. Wallet credit is reserved when checkout begins and debited only after Paystack verifies the remaining payment. A failed Paystack transaction releases its reservation; an ambiguous initialization/network result remains reserved until its payment status can be verified.

Referral reward settings are configured by the owner in Admin → Rewards, wallet & challenges. A referrer qualifies after **five different referred accounts** each complete a verified paid order; the referred customer receives their own welcome reward after their first verified paid order. Reward amounts default to zero until configured by the owner.

Team challenges support 2–5 members, 2–21 day durations, named milestones and evidence submissions. Every member must complete every milestone and an administrator must approve each submission before the per-member reward is credited. Challenge calendar dates can be exported by the customer as an `.ics` file; the website does not read a private calendar.

Coupons are managed in Admin → Coupons and validated on the server for status, expiry, minimum subtotal, per-account use and redemption limit. Redemption is counted only after verified Paystack payment. The owner chooses and publishes all coupon terms; no automatic or hard-coded discount is enabled.

Customers can sync their wishlist across devices after signing in, see recommendations for related in-stock products and use photo or voice search from the storefront. Photo search requires the server-side `GEMINI_API_KEY`; image selection is limited to a user-initiated JPG/PNG/WebP upload under 3 MB. Voice input is initiated only when the customer taps the microphone/search control. The browser handles microphone/camera permission prompts.

Ebnimaam AI can answer questions across the live catalogue, store settings, published news, policies and (for a verified signed-in customer) that customer's own recent order details and available wallet credit. It is read-only: order changes, refund approvals, wallet adjustments, coupon creation and challenge approvals still require the appropriate customer or admin workflow. Configure `GEMINI_API_KEY` in the Vercel environment for full AI responses; without it, the existing limited quick-help fallback is used.

Refund credits are added to the Ebnimaam wallet by an administrator after approving the return. Customers may request a bank refund from their wallet page; the request is reserved for admin review. A bank transfer is marked paid only after the administrator has completed the transfer manually. No automatic bank payout or Paystack refund API is claimed.

The admin dashboard refreshes order and inventory data periodically and shows active products that are low on stock or out of stock. WhatsApp remains a customer-initiated contact link; no automated WhatsApp or SMS messages are sent.


## Account security and private order access

- Customer accounts use one active Ebnimaam app session per account. A sign-in from a second device replaces the previous app session, and a browser/app installation cannot keep two customer accounts active at once.
- First sign-ins and newly recognised devices are recorded and trigger a Resend security alert to the verified account email. The security-event log records whether Resend accepted the alert; it requires `RESEND_API_KEY` and `EMAIL_FROM` and does not by itself confirm inbox delivery.
- Checkout, customer profile reads/updates, payment-return verification, saved reviews and order tracking check the active device-bound customer session. An order reference or email address alone cannot reveal private order details.
- The storefront includes a refresh control, mobile history-aware account/cart/checkout overlays and the owner-provided WhatsApp Channel follow link. Additional social handles are managed in Admin → Store settings.

**Passkeys / fingerprint login:** The current Neon Managed Auth client does not expose passkey/WebAuthn or MFA plugins. These are not enabled in this release. A supported implementation requires a separately reviewed move to self-managed Better Auth (or another identity provider) with an existing-user and recovery migration plan; do not claim biometric login is active before that work is complete.
