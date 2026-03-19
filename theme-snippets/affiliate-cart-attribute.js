/**
 * Reads the affiliate-id cookie and writes it to the Shopify cart as a cart
 * attribute so it persists through checkout and lands on the order as a note
 * attribute (used by the orders/create webhook handler for guest attribution).
 *
 * Must run AFTER url-param-and-cookie.js on every storefront Liquid page.
 * The call is idempotent — safe to repeat on every page load.
 */
(function () {
  const cookie = document.cookie
    .split('; ')
    .find((row) => row.startsWith('affiliate-id='));

  if (!cookie) return;

  const affiliateId = cookie.split('=')[1];
  if (!affiliateId) return;

  fetch('/cart/update.js', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ attributes: { affiliate_id: affiliateId } }),
  }).catch(function () {
    // Non-fatal — cart may not exist yet on first visit
  });
})();
