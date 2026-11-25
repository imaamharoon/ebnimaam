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
- The storefront and customer account must be one integrated experience: clicking Account opens a responsive in-site account panel, not a disconnected second website/page; sign-in, registration, profile and order history must be reachable and responsive from that panel.
- Account access must visibly respond to clicks on desktop and mobile, support close/back behavior, and keep checkout sign-in within the same integrated storefront flow; preserve cart and return to checkout after successful sign-in.
- Add and maintain owner-approved social/contact links, a working newsletter subscription flow only when its backend is connected, and customer support entry points; avoid inert buttons and placeholder alerts.
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
- Account deletion/deactivation workflows must be real, secure, transparent and account-confirmed before they are offered as active features; export and deletion must not be represented as operational until verified.

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

## 13. Verification snapshot — 25 November 2026
This status snapshot records what has actually been checked. It supersedes any assumption that a code change alone constitutes a complete launch.

### Verified in the current GitHub preview branch
- The latest source at the time of this snapshot passed a local Next.js production build in the connected Vercel build sandbox: compilation, TypeScript checks and static page generation completed.
- The Android GitHub Actions workflow was changed to run on `main` and `preview/mobile-header-refine`. Run `45676696213` completed successfully for commit `9fe49154488a1b49df7af40fb3eeb8711cdbbd18`; its APK asset was published as release `android-apk-44`.
- Account panel, database catalogue, cart restoration, server-side checkout, signup challenge, OTP verification UI, admin session, Paystack verification/webhook code and policy pages are implemented in the branch.
- Neon main branch has the required Ebnimaam order, product, payment-event, status-history, customer-profile, news, store-settings and rate-limit tables.
- Neon Auth is configured to require email verification and use email OTP. The production Vercel environment has an `AUTH_SECRET`.
- The privacy, returns and terms documents are present in the branch. Returns wording references FCCPA section 122 and does not impose an arbitrary short deadline that could remove statutory rights.

### Not verified or currently blocked
- **Deployment:** the newest source is not deployed to Vercel production. Vercel's deployment API returned the Free-plan daily deployment quota error. The production alias still points to the older deployment at commit `04bce47963f56c6637f113693098b635585c72a2`. Do not claim the new website or Android wrapper is live until a deployment of the new commit is READY and its production domain is checked.
- **Registration:** Neon Auth currently has zero user records. No real customer registration or email OTP delivery test has been completed. Neon is using its shared sender; dedicated SMTP credentials and a confirmed delivery test are still required before public sign-up can be accepted as verified.
- **Catalogue:** the database currently has one legacy/test product record, zero published products and zero sale-ready active catalogue items. Keep that record hidden. The owner must confirm real merchandise, prices, sizes/variants, images and physical quantities before publishing products.
- **Payments:** no real charges were made. The current order table has four pending records and no paid orders; the payment-event and status-history tables currently contain no rows. The new Paystack verification, webhook signature and reconciliation code passed compilation but has not been exercised against a test transaction. Confirm the webhook URL in the Paystack dashboard before relying on asynchronous webhook delivery. Preserve the active Paystack configuration.
- **Refunds:** the returns policy describes a human-approved refund process; an automated refund API is not implemented or verified.
- **Production customer journey:** account registration/verification, login, mobile account panel, cart-to-checkout return, order creation/tracking, admin persistence and PWA behavior must be exercised end-to-end against the deployed release before launch.
- **APK:** release `android-apk-44` is a successful debug APK from the preview branch, but its Capacitor configuration loads `https://ebnimaam.vercel.app/store.html`. Until the new website is deployed to that production URL, the APK displays the older production website. It is not a Play Store-signed release.

### Release rule
Keep these gates open until their evidence is attached to the actual candidate deployment. A successful build or APK workflow is not proof that customer registration, email delivery, Paystack reconciliation, live inventory, production launch or installed-app behavior has passed.


## 14. Release audit addendum — 25 November 2026, 19:34 UTC

This addendum supersedes the older deployment statement in section 13 and records the latest source, production, database and hosting evidence.

### Published source and builds
- GitHub preview branch `preview/mobile-header-refine` now contains hardening commit `23cc473c2a81badeec2cec7ab6ff2b537ee4e868` (`Fix customer auth proxy and harden checkout controls`).
- The new source passed a local Next.js production build: compilation, TypeScript checks and all 16 static pages completed.
- The Git-connected Vercel project `ebnimaam-zk22` built commit `23cc473c2a81badeec2cec7ab6ff2b537ee4e868` successfully as deployment `dpl_2GUFN72PoqUubLbQEx1AwbESkFDe`. This is a separate protected project with no environment variables configured; its `/api/products` endpoint returns 503. It is not the production store and must not be promoted as-is.
- The intended production project `ebnimaam` remains on READY deployment `dpl_83B1QE21aNnSXkaJr7SsJyYDaLZ2`, commit `9ad166dace11f20a43fa45912982d3958d466721`, with `https://ebnimaam.vercel.app` assigned. The production alias is serving the prior source, not commit `23cc473`.
- The primary project's Vercel deployment check for commit `23cc473` failed with the Free-plan daily deployment quota error `api-deployments-free-per-day` (HTTP 402; retry after 24 hours). No paid plan change was made. The updated source is published to GitHub but is not yet deployed to the official production domain.

### Code changes in commit 23cc473
- Removed the invalid `x-forwarded-host` value from the Neon Auth proxy. Direct comparison confirmed that the forwarded storefront hostname causes Neon Auth to return `INVALID_HOSTNAME`; without that header the upstream session endpoint returns HTTP 200 with a null unauthenticated session. The new protected Vercel preview confirmed `/api/auth/get-session` returns 200/null.
- Signup challenge nonce consumption is now atomic and one-time, using a hashed nonce stored in the existing rate-limit table. A live production replay test is still pending because production serves the previous deployment and the successful secondary preview has no database connection.
- Removed the unverified hard-coded `EBN10` 10% discount from the checkout UI and server. No coupon is applied until the owner-defined promotion rules are configured and validated.
- Admin fulfilment updates now reject picked/packed/shipped/delivered transitions unless payment status is `paid`.
- Removed clickable account deactivation/deletion actions because no verified backend workflow exists; the account page now clearly says these requests are not yet available.

### Production and database evidence
- At the audit time, production HTML and static routes (store, account, admin, order tracking, payment return, manifest, service worker and icon assets) returned HTTP 200.
- Production `/api/auth/get-session` returned HTTP 400 `INVALID_HOSTNAME` before the new code is deployed. This is the current reason customer login/registration must not be marked production-verified.
- Unauthenticated production checkout correctly returned HTTP 401 requiring sign-in; unauthenticated customer profile returned 401 and admin API returned 401.
- Neon currently has one Ebnimaam catalogue row and zero active in-stock saleable products. The only Ebnimaam catalogue item is inactive; legacy/test catalogue records remain hidden and must not be published as real stock.
- Neon currently has four Ebnimaam orders, all payment status `pending`, with fulfilment labels including packed, shipped, delivered and cancelled. The payment-event and order-status-history tables contain zero rows. No rows were modified during this audit.
- Neon Auth currently has zero users. No real account registration or email OTP delivery has been verified.
- No real Paystack charge was initiated. Paystack credentials and configuration were not changed. The Paystack webhook and reconciliation paths have not been exercised against a test transaction.

### Remaining release gates
- Deploy commit `23cc473` (or a later verified commit) to the existing `ebnimaam` Vercel project when the deployment quota permits or the owner resolves the plan limit.
- Recheck `/api/auth/get-session`, signup challenge nonce use, email OTP delivery, sign-in, embedded account, cart restoration and profile/order history on the intended production domain.
- Owner must supply real product names, prices, variants, images and confirmed physical stock; do not publish test/legacy rows.
- Reconcile the four pending-order fulfilment inconsistencies with the owner before editing any order or payment records.
- Exercise Paystack in its test mode and verify webhook delivery without a real charge; confirm webhook endpoint settings in the Paystack dashboard.
- Build and verify a new Android APK from the deployed production version; the existing `android-apk-44` debug APK is older and not Play Store-signed.

 
## 15. Android build and challenge replay QA update — 25 November 2026, 19:35 UTC

- GitHub Actions run `45686141185` (run 46, branch `preview/mobile-header-refine`, source commit `23cc473c2a81badeec2cec7ab6ff2b537ee4e868`) completed successfully. The job's checkout, toolchain setup, Android SDK installation, dependency installation, branded icon generation, Capacitor wrapper generation, launcher icon generation, APK build and release-publish steps all report success.
- Release `android-apk-46` is published at https://github.com/imaamharoon/ebnimaam/releases/tag/android-apk-46. Its `app-debug.apk` asset is 5,481,713 bytes (about 5.5 MB), uploaded with SHA-256 `5be840faf5e00d3a1b56688a4592de64485ddbf5da69eb59e39e8eb1bd65f34c`. Direct download: https://github.com/imaamharoon/ebnimaam/releases/download/android-apk-46/app-debug.apk.
- This APK was built from the hardened code commit but is a debug/sideload APK, not a Play Store-signed release. Its Capacitor server URL remains `https://ebnimaam.vercel.app/store.html`, which currently serves the older production deployment. The APK has not been installed and verified on a physical Android device; rebuild after the updated application is deployed to the official production project.
- The single-use signup challenge database primitive was tested against the Neon rate-limit table using a temporary QA key: first insertion returned one row, a duplicate replay returned zero rows, and the temporary row was deleted. This verifies the atomic database consume operation only; it is not an end-to-end registration or OTP-delivery test.


## 16. Paystack inbox reconciliation note — 25 November 2026, 19:38 UTC

- The connected Gmail search returned two Paystack messages for the same reference, dated 24 November 2026 at 12:46 UTC: a merchant receipt notification and a Paystack receipt. The email reference is `EBN-1795524307294-71D619A9`.
- That reference does not match any of the four rows currently in `public.ebnimaam_orders`; the payment-events table also has zero rows. The four current orders remain `pending`, with null `paid_at` and null `provider_transaction_id`.
- Do not infer that any of those four pending orders was paid from the separate inbox receipt. Reconcile the email reference against the Paystack merchant transaction dashboard/API and the associated original checkout before making any order/payment database correction.
- No payment, order, status, stock, refund or customer row was changed during this investigation. No Paystack configuration was changed and no charge was initiated.
- Slack search for the Ebnimaam project returned no matching messages in the connected workspace search scope. No relevant project decision or product-inventory approval was found in the Gmail results reviewed.


## 17. Pending-order evidence check — 25 November 2026, 19:39 UTC

- Searched the connected Gmail account for each of the four current database order references. No matching email threads were returned for any of the four references.
- The only Paystack email pair found in the reviewed date window uses a different reference, documented in section 16. It does not establish payment for any current pending order.
- Keep the four orders unchanged and pending until verified against Paystack's transaction records and the original customer checkout. The database status and fulfillment mismatch is not evidence that the orders were paid or legitimately delivered.


## 18. Latest endpoint hardening and CI verification — 25 November 2026, 19:45 UTC

- Source commit `d8744321e6c342a3f22fec6ce6e4a48e0912af60` adds server-side limits of 20 checkout initializations per client IP per 15 minutes and 30 public order lookups per client IP per 15 minutes. Excess requests receive HTTP 429 with a 15-minute retry hint; if the rate-limit store is unavailable, the endpoints fail closed with HTTP 503.
- Source commit `c39dd3ba4682cad3e997a6d918918cbd169d5b29` prevents public order tracking from displaying picked/packed/shipped/delivered milestones when payment is not verified as paid. It returns `awaiting_payment` instead. The account's tracking display in commit `1587731e78107b91f18306dd7b388c54da60b788` renders this as “Awaiting payment”.
- A read-only check against the current four database rows confirmed the customer-visible mapping: the three unpaid delivered/packed/shipped records resolve to `awaiting_payment`; the cancelled row remains `cancelled`. No stored order fields were modified.
- The Android workflow now runs `npm run build` as a Next.js production-build verification step before generating the APK. Run 49 (workflow commit `bbbce2c8b36bc5978b351b1d4b021389bfc73105`) completed the Next.js build step successfully; run 50 (latest storefront account-label commit `1587731e78107b91f18306dd7b388c54da60b788`) has also completed its Next.js production-build step successfully. Android APK packaging/publishing was still running at the time of this note.
- The current official production `/api/products` endpoint responds HTTP 200 with an empty `products` array. There are no approved active, in-stock products to show to customers.
- Current candidate branch head is `1587731e78107b91f18306dd7b388c54da60b788`. Neither this code nor the later documentation-only commits have been deployed to the official Vercel project; the existing production domain remains on commit `9ad166d` pending the Free-plan deployment quota reset or a separately authorized hosting-plan change.


## 19. Latest verified Android release — 25 November 2026, 19:47 UTC

- GitHub Actions run 50 (`45688195704`) completed successfully for application source commit `1587731e78107b91f18306dd7b388c54da60b788`. The Next.js production build, Capacitor setup, branded icon generation, Android wrapper, launcher icon generation, APK assembly and GitHub release publishing all succeeded.
- The resulting release is `android-apk-50`: https://github.com/imaamharoon/ebnimaam/releases/tag/android-apk-50.
- APK asset `app-debug.apk`: 5,481,736 bytes; SHA-256 `d9fe84e079cb8a9cdb325c5f6a1a1ac07cc77416fb700c8160105a7c7015a74c`; direct download https://github.com/imaamharoon/ebnimaam/releases/download/android-apk-50/app-debug.apk. GitHub reports the asset state as uploaded.
- This remains a debug/sideload APK, not Play Store-signed, and it has not been installed on a physical device. The Capacitor remote server setting points to `https://ebnimaam.vercel.app/store.html`; that domain is still serving the older production deployment until the primary Vercel quota issue is resolved. Rebuild the APK after the official production deployment is updated and verify an installed-device sign-in/checkout journey.
- The latest application source commit is `1587731e78107b91f18306dd7b388c54da60b788`; this checklist update is documentation-only commit `65e505b9df89306222c31c72c335fd008d7ba67c`.
