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

assert.match(config, /key:\\s*['"]X-Content-Type-Options['"],\\s*value:\\s*['"]nosniff['"]/);
assert.match(config, /key:\\s*['"]X-Frame-Options['"],\\s*value:\\s*['"]SAMEORIGIN['"]/);
assert.doesNotMatch(config, /key:\\s*['"]X-Frame-Options['"],\\s*value:\\s*['"]DENY['"]/);
assert.match(config, /key:\\s*['"]Strict-Transport-Security['"]/);
assert.match(config, /key:\\s*['"]Referrer-Policy['"]/);
assert.match(storefront, /<iframe[^>]+id=["']accountFrame["'][^>]*>/);
assert.match(storefront, /frame\\.src=['"]\\/account\\.html\\?embedded=1['"]/);

// Parse inline storefront/account scripts to catch browser-side syntax errors.
for (const [file, html] of [['public/store.html', storefront], ['public/account.html', account]]) {
  const scripts = [...html.matchAll(/<script\\b[^>]*>([\\s\\S]*?)<\\/script>/gi)].map((match) => match[1]).filter((source) => source.trim());
  assert.ok(scripts.length, file + ' should contain its expected inline application script');
  for (const source of scripts) new vm.Script(source, { filename: file });
}

// Customer orders and private profile actions must validate the active device-bound session.
assert.match(sessionGuard, /ebnimaam_customer_sessions/);
assert.match(sessionGuard, /ebnimaam_customer_known_devices/);
assert.match(sessionGuard, /HttpOnly/iu); // The source sets HttpOnly cookies for session tokens.
assert.match(authProxy, /activateCustomerSession/);
assert.match(authProxy, /isCurrentCustomerSession/);
assert.match(trackingRoute, /getVerifiedCustomer/);
assert.match(trackingRoute, /o\\.auth_user_id=\\$2/);
assert.doesNotMatch(trackingRoute, /body\\?\\.email|body\\?\\.token/);
assert.match(paymentVerification, /getVerifiedCustomer/);
assert.match(paymentVerification, /owned\\.rowCount/);
assert.match(reviewRoute, /isCurrentCustomerSession/);

// The public app points to account sign-in for private tracking and official social follow links.
assert.match(storefront, /window\\.trackOrder/);
assert.match(storefront, /whatsappChannel/);
assert.match(account, /continueAfterAccountAuth/);

process.stdout.write('Security headers, browser script syntax, account-bound order access, and single-device session smoke checks passed.\\n');
