# Ebnimaam — Consolidated Owner Requirements (Preview Branch)

This document consolidates the owner requirements gathered from the conversation. Treat it as the implementation checklist for the preview; do not merge to production until the owner tests and approves.

## Brand, storefront and app
- Brand name exactly: ebnimaam; use the supplied logo consistently.
- Premium, responsive storefront on mobile and desktop; compact mobile header, one small “Install app” control (no duplicate download/install buttons), accessible menu and account/cart/search controls.
- Single integrated web experience; tracking and account features live within storefront/account navigation rather than disconnected standalone destinations.
- PWA install compatibility; Android installation/app experience, APK release workflow if supported, and iPhone-friendly web experience.

## Customer account and access
- Account mandatory before checkout/order placement; cart should be preserved and restored after sign-in.
- Sign-up: username/name, email, phone, password; validation and useful errors; create action must work.
- Login: working authentication, remember-me/session persistence.
- Forgot password: automatic email recovery/reset delivery, no manual owner sending.
- Email verification/recovery code flows where supported by the auth provider.
- Customer settings: editable profile/contact, saved delivery addresses, password/security, preferences and account actions.
- Account order history, order status/tracking within account/storefront.
- Track orders in the integrated storefront using appropriate reference/email lookup; privacy controls.

## Checkout and payments
- Nigeria-only handover/delivery/pickup workflow; do not add unsupported international delivery.
- Paystack is active and owner requests that existing payment integration remain intact; do not redesign payment unnecessarily.
- Server-calculated catalog prices, shipping, promotion and total; prevent checkout without authenticated account.
- Preserve cart through account sign-in.
- Test payment confirmation and order creation without real charges until owner approval.

## Catalogue, inventory and admin
- Secure owner/admin access; mobile-friendly admin interface.
- Product create/edit/delete, product photos/media, name, description, category, sizes/variants, Naira pricing, inventory/stock and out-of-stock controls.
- Admin catalogue changes must appear on storefront.
- Orders management with statuses: picked/processing, packed, shipped, delivered, cancelled; delivery/handover partners and tracking details.
- Customer management, order history, customer inquiries/reviews/questions.
- News/content publishing, edit, unpublish/delete; storefront news display.
- Product stock safeguards and low-stock awareness.

## Store settings (owner editable)
- Store information, brand/contact details, support/contact channels and social links.
- Pickup/handover location/address, states/areas supported, pickup hours and holiday/exception settings.
- Delivery/handover rules and customer-facing estimates, Nigeria-only coverage.
- Returns/refunds policy, privacy policy, terms/legal pages and relevant storefront copy.
- Promotions/coupons/deals: discount rules, validity, eligibility and usage limits; promotional banners.
- Customer notifications and message templates/workflows.
- Support/assistant inbox and customer support details.
- Analytics/reporting: sales/orders/products/stock/customer summaries, exports (CSV/PDF) where available.

## Admin governance and security
- Secure owner sessions; access controls, session/log visibility where practical.
- Audit log for important owner actions and downloads.
- Protect customer personal data, APIs and admin endpoints; input validation and abuse/rate protection.
- Admin-managed changes must persist and propagate; no fake/demo controls.
- Settings and content must be editable by owner without code changes where intended.

## Launch/preview acceptance
- Test registration, login, remember-me, forgot-password email, verification, profile/address save, mandatory-account checkout, cart restore, tracking, admin CRUD, catalogue sync, settings persistence, mobile navigation/install and order lifecycle.
- Do not publish to production before owner testing and approval.
- Payment section is not the focus of this update and Paystack should remain intact.


## Signup anti-bot security challenge (new owner requirement)
- Offer an on-page human-verification challenge during account creation (CAPTCHA-style) for customers who prefer not to receive an OTP at signup. Example challenge format: mixed uppercase letters and digits with a separator, such as `AV6-K9T2`; this is illustrative only, never a fixed shared code.
- Generate a fresh, unpredictable challenge on the server; display it clearly and allow refresh/retry. The user enters the displayed challenge to proceed.
- Validate only server-side; challenge must expire quickly, be single-use, and be tied to the signup session; limit attempts and rate-limit signup/challenge endpoints; avoid logging or exposing challenge secrets.
- Provide an accessible alternative for users who cannot read the visual challenge (e.g. audio/accessibility alternative or a reputable CAPTCHA alternative). Don't treat this challenge as email/phone ownership verification or as a complete security guarantee.
- Test challenge generation, refresh, expiry, single-use behavior, failed attempts, accessibility, and account creation flow.
