/**
 * Reads the affiliate-id cookie and POSTs it to the app proxy.
 *
 * This script is only rendered by affiliate-check.liquid when:
 *   - A customer is logged in
 *   - The customer's affiliate metafield is blank (server-side Liquid check)
 *
 * The app proxy URL must match what is configured in the Shopify Partner Dashboard.
 * Update APP_PROXY_URL if your proxy subpath differs.
 */
(function () {
  var APP_PROXY_URL = '/apps/affiliate/set-affiliate';

  var cookie = document.cookie
    .split('; ')
    .find(function (row) { return row.startsWith('affiliate-id='); });

  if (!cookie) return;

  var affiliateId = cookie.split('=')[1];
  if (!affiliateId) return;

  fetch(APP_PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ affiliate_id: affiliateId }),
  }).catch(function () {
    // Non-fatal — attribution will be retried on next page load
  });
})();
