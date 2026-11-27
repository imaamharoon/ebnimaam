const fs = require('node:fs');
const assert = require('node:assert/strict');

const config = fs.readFileSync('next.config.js', 'utf8');
const storefront = fs.readFileSync('public/store.html', 'utf8');

assert.match(config, /key:\s*['"]X-Content-Type-Options['"],\s*value:\s*['"]nosniff['"]/);
assert.match(config, /key:\s*['"]X-Frame-Options['"],\s*value:\s*['"]SAMEORIGIN['"]/);
assert.doesNotMatch(config, /key:\s*['"]X-Frame-Options['"],\s*value:\s*['"]DENY['"]/);
assert.match(config, /key:\s*['"]Strict-Transport-Security['"]/);
assert.match(config, /key:\s*['"]Referrer-Policy['"]/);
assert.match(storefront, /<iframe[^>]+id=["']accountFrame["'][^>]*>/);
assert.match(storefront, /frame\.src=['"]\/account\.html\?embedded=1['"]/);

process.stdout.write('Security header and same-origin embedded account smoke checks passed.\n');
