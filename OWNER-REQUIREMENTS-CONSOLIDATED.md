# Ebnimaam — Master Owner Requirements & Release Checklist

**Project:** ebnimaam (exact brand spelling)  
**Repository:** `imaamharoon/ebnimaam`  
**Release scope:** Consolidated requirements from the owner’s project brief and conversations, including the latest updates of 25 November 2026.  
**Status:** Master checklist; requirements are not automatically considered complete merely because they are documented. Acceptance testing and deployment verification are required.

## 1. Product principles and launch scope
- Maintain the exact brand `ebnimaam` and use the owner's supplied logo and consistent, polished premium visual design.
- Nigeria-only operations, including delivery, pickup and handover; do not enable unsupported international fulfilment.
- Build and maintain one integrated storefront/customer account experience, mobile-friendly website, PWA and appropriate Android/iPhone install experience.
- Keep interfaces professional, accessible, responsive, understandable, fast, and usable on mobile devices.
- Paystack is the existing payment provider and is active. **Do not replace, unnecessarily modify, disable, or test it with real charges.** Payments remain Paystack-only.
- Do not enable Facebook/social login or SMS/WhatsApp automated system messages. Facebook integration was explicitly skipped. Customer support WhatsApp contact may remain a contact link, not a system messaging workflow.

## 2. Storefront, brand and customer experience
- Professional home/store landing page, brand story, product collections, search, category filters, news/updates and promotional content.
- Responsive mobile header, navigation/menu, account, search, cart and install affordance; avoid duplicate install controls.
- Product cards and detail experiences with photos, descriptions, category, price in NGN, variants/sizes and availability.
- Wishlist/saved items and shopping lists where implemented; preserve cart contents across navigation and sign-in.
- Product discovery/search, with image/voice search planned where supported and verified.
- Clear customer-facing delivery/pickup information, terms, privacy, returns/refunds and contact details.
- News/announcement publishing on the store, managed through admin.
- SEO fundamentals, page metadata, robots/sitemap, analytics only with appropriate privacy controls, performance and accessibility.

## 3. Registration, login and account security
- Customers must create an account or sign in **before checkout or placing an order**. No guest checkout. Enforce this on the server, not just in the UI.
- Link orders to authenticated customer accounts; preserve and restore cart when redirected to sign in.
- Signup fields and account identity support as designed: name, email, phone and username/identity where supported; validation, clear errors and duplicate/invalid input handling.
- Password policy: minimum length and mixed-case, number and symbol; useful password visibility controls.
- Sign-in, session persistence, Remember Me, sign-out and password recovery/reset with automated email delivery, if configured and verified.
- Email verification and OTP flows only where configured and actually supported. Do not claim phone/email ownership verification from the anti-bot challenge.
- **New human-verification challenge at signup:** generate an unpredictable server-generated mixed alphanumeric code with a separator (example format `AV6-K9T2`, illustrative only), show it on the signup page, allow refresh and retry, validate server-side, expire promptly, use once only, bind to the signup session, and rate-limit attempts. Secure cookie signing, secrets and server checks required. Accessibility alternative required. This is anti-bot protection, not proof of email/phone ownership or a substitute for all security controls.
- Account profile, contact details, address book, security preferences, account-linked order history, order tracking and privacy-aware account data export.
- Account deletion/deactivation workflows must be real, secure, transparent and account-confirmed before they are offered as active features.

## 4. Checkout, order creation and payment
- Checkout requires a valid customer session; enforce this server-side and associate the order with that account.
- Server-side pricing, shipping/handover fees, discounts, totals, stock and checkout validation; never trust client-calculated amounts.
- Paystack-only checkout. Keep current working Paystack integration intact; no real-charge tests.
- Verify payment server-side, handle payment failure/cancel/return, idempotency, reconciliation and order creation safely.
- Reliable order persistence, payment reference and status reconciliation; webhook processing and event logs are required.
- Clear payment/checkout errors, success confirmation and post-payment cart-clearing behavior only after confirmed order/payment handling.
- Nigeria-only pickup/handover/delivery selection and state/area availability; customer-facing delivery estimates and instructions.

## 5. Fulfilment, orders, tracking and returns
- Customer order history and status tracking connected to the customer's authenticated account.
- Order lifecycle/statuses: processing/picked, packed, shipped, delivered, cancelled and relevant payment/refund states.
- Delivery/handover partner, location, tracking details, status changes and timestamps.
- Storefront order lookup with privacy safeguards and appropriate reference/customer verification.
- Returns/refunds policy and workflow, customer communication and order status visibility.
- Admin order search, filtering, handling, status updates and tracking details.

## 6. Admin and owner dashboard
- Secure owner/admin authentication and persistent session enforcement; no merely client-side password gate.
- Mobile-friendly admin dashboard, overview, sales/order/product/customer summaries and useful filters.
- Product CRUD and images/media, category, variants/sizes, NGN price, stock, out-of-stock/availability and catalogue sync.
- Inventory safeguards, server-side stock checks, decrement/reservation rules and low-stock awareness.
- Order/customer management, order history, tracking, fulfilment status, support inquiries and reviews where supported.
- News and content management (create, edit, publish/unpublish and delete).
- Owner-editable settings: store profile/branding/contact, pickup location, coverage, handover rules, hours/holiday exceptions, policies, support, notification templates and promotional content.
- Coupons/discounts/promotions with eligibility, validity, limits and correct server-side calculation. EBN10 only if the owner-defined rule is actually implemented and validated; do not assume.
- Reports, sales/orders/stock/customer summaries and exports (CSV/PDF) where supported.
- Admin actions must be real, persist to the backend and reflect on storefront. Remove/avoid fake/demo controls and placeholder promises.

## 7. Customer support and assistant
- Integrated store/customer assistant with clearly scoped capabilities and escalation/contact details.
- Support/help content and inquiry handling; do not imply automated messaging channels that the owner excluded.
- Product discovery assistant, image/voice features only when operational and tested.

## 8. Data, infrastructure and security
- Use a consistent, reliable database schema and customer/order/product relationships; reconcile schema differences rather than parallel disconnected data stores.
- Server-side auth/session enforcement for customer and admin APIs; authorization for every sensitive operation.
- Rate limiting/abuse protection on sign-in, signup, challenge generation, recovery, checkout and exposed endpoints.
- Secrets only in secure environment variables; never expose secret keys or log sensitive tokens/challenge answers.
- Protect personal data, minimize logs, validate/sanitize inputs, prevent unauthorized access and avoid leaking order/customer information.
- Audit logs for important admin actions, order/payment events and changes where practical.
- Payment and inventory safeguards, idempotent handlers and failure/recovery paths.
- HTTPS, deployment configuration and environment separation; preview and production must not share inappropriate secrets.

## 9. PWA and mobile
- Valid web manifest, icons, service-worker caching and safe update strategy.
- Android install experience and install guidance; avoid presenting unsupported APK downloads as available.
- iPhone Safari Add-to-Home-Screen support and clear guidance.
- Mobile responsive layouts and functional mobile admin/store navigation.
- Test installed app, offline/cache behavior, update behavior, navigation and checkout/account flows.

## 10. Legal, policies and content
- Publish and link privacy policy, terms, returns/refunds, delivery/pickup/handover and customer support information.
- Nigeria-specific store coverage and customer-facing terms must be clear.
- Accurate product/store copy; no unverified claims or placeholder policy links.

## 11. Acceptance tests and release gates
Run and record evidence for:
- Storefront production/preview HTTP response, HTTPS, domains/aliases and current deployment/commit.
- Mobile and desktop layout, navigation, search/filter, catalogue and cart.
- PWA manifest/icons, installation and service-worker/update behavior on supported devices.
- Signup challenge: generation, refresh, correct/incorrect answer, expiry, single-use, session binding, attempt limiting and accessible alternative.
- Signup, login, Remember Me, sign-out, password recovery and email verification (only configured flows).
- Authenticated-only checkout and order ownership; cart restoration after login.
- Price, stock, shipping, coupon and totals enforced server-side.
- Paystack integration remains intact; test verification paths without real charges.
- Order persistence, webhook/idempotency, failure recovery, reconciliation, history and tracking.
- Admin authorization/session, CRUD, settings persistence, catalogue sync, fulfilment and audit logs.
- Privacy/legal pages, accessibility, SEO, analytics/privacy, security and performance.
- Any failed or unavailable test must remain explicitly marked as a blocker; do not claim release-ready without evidence.

## 12. Publishing and change control
- Gather updates from the owner's brief and conversation, record them here and in implementation issues/change notes, and keep GitHub commits clear and professional.
- Use preview deployment for testing; promote to production only when the required acceptance tests and blockers are resolved, without disturbing the active Paystack setup.
- Maintain this checklist as the governing release scope and distinguish implemented, verified, pending and blocked items.

---
**Owner exclusions and safeguards:** Nigeria-only launch; Paystack only; no guest checkout; no Facebook/social login; no SMS/WhatsApp automated messages; do not perform live payment charges; preserve working payment configuration.