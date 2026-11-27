const fs = require('node:fs');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const config = fs.readFileSync('next.config.js', 'utf8');
const storefront = fs.readFileSync('public/store.html', 'utf8');
const account = fs.readFileSync('public/account.html', 'utf8');
const sessionGuard = fs.readFileSync('lib/customer-sessions.ts', 'utf8');
const authProxy = fs.readFileSync('app/api/auth/[...path]/route.ts', 'utf8');
const trackingRoute = fs.readFileSync('app/api/track-order/route.ts', 'utf8');
const paymentVerification = fs.readFileSync('app/api/verify-payment/route.ts', 'utf8');
const reviewRoute = fs.readFileSync('app/api/product-reviews/route.ts', 'utf8');
const paymentInitialization = fs.readFileSync('app/api/create-payment/route.ts', 'utf8');
const aiSupport = fs.readFileSync('app/api/chat/route.ts', 'utf8');

assert.ok(config.includes("key: 'X-Content-Type-Options'") && config.includes("value: 'nosniff'"));
assert.ok(config.includes("key: 'X-Frame-Options'") && config.includes("value: 'SAMEORIGIN'"));
assert.ok(!config.includes("value: 'DENY'"));
assert.ok(config.includes("key: 'Strict-Transport-Security'"));
assert.ok(config.includes("key: 'Referrer-Policy'"));
assert.ok(config.includes("camera=(self), microphone=(self), geolocation=()"));
assert.ok(paymentInitialization.includes("const pickupAddress = String(storeSettings.pickupAddress || '').trim();"));
assert.ok(paymentInitialization.includes("fulfilmentMethod === 'pickup' && !pickupAddress"));
assert.ok(paymentInitialization.includes("const definitiveFailure ="));
assert.ok(paymentInitialization.includes("verificationRequired: !definitiveFailure"));
assert.ok(!aiSupport.includes('1–3 working days'));
assert.ok(!aiSupport.includes('2–5 working days'));
assert.ok(aiSupport.includes("pickupAddress:storeSettings.pickupAddress||''"));
assert.ok(storefront.includes('id="accountFrame"'));
assert.ok(storefront.includes("frame.src='/account.html?embedded=1'"));

// Parse inline storefront/account scripts to catch browser-side syntax errors.
for (const [file, html] of [['public/store.html', storefront], ['public/account.html', account]]) {
  const scripts = html.split('<script').slice(1).map((block) => {
    const start = block.indexOf('>');
    const end = block.indexOf('</script>');
    return start >= 0 && end > start ? block.slice(start + 1, end) : '';
  }).filter((source) => source.trim());
  assert.ok(scripts.length, file + ' should contain its expected inline application script');
  for (const source of scripts) new vm.Script(source, { filename: file });
}

// Customer orders and private profile actions must validate the active device-bound session.
assert.ok(sessionGuard.includes('ebnimaam_customer_sessions'));
assert.ok(sessionGuard.includes('ebnimaam_customer_known_devices'));
assert.ok(sessionGuard.includes('httpOnly: true'));
assert.ok(authProxy.includes('activateCustomerSession'));
assert.ok(authProxy.includes('isCurrentCustomerSession'));
assert.ok(trackingRoute.includes('getVerifiedCustomer'));
assert.ok(trackingRoute.includes('o.auth_user_id=$2'));
assert.ok(!trackingRoute.includes('body?.email') && !trackingRoute.includes('body?.token'));
assert.ok(paymentVerification.includes('getVerifiedCustomer'));
assert.ok(paymentVerification.includes('owned.rowCount'));
assert.ok(reviewRoute.includes('isCurrentCustomerSession'));

// The public app points to account sign-in for private tracking and official social follow links.
assert.ok(storefront.includes('window.trackOrder'));
assert.ok(storefront.includes('whatsappChannel'));
assert.ok(account.includes('continueAfterAccountAuth'));

process.stdout.write('Security headers, browser script syntax, account-bound order access, and single-device session smoke checks passed.\\n');
