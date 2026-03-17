/**
 * Custom Web Pixel — Affiliate Attribution
 *
 * Handles two subscription paths:
 *
 *  A) affiliate_session (Scenario 2 — new Customer Account)
 *     The Customer Account UI Extension publishes this event with a session token.
 *     The pixel reads the affiliate-id cookie and POSTs both to the Cloudflare Worker.
 *
 *  B) page_viewed (legacy / Scenario 2 fallback)
 *     Kept for reference. Superseded by the UI extension + affiliate_session flow
 *     which provides proper authentication via session token.
 *
 * NOTE: The cookie name is 'affiliate-id' (hyphen), matching what the theme
 * snippet url-param-and-cookie.js writes to the browser.
 */

const WORKER_URL = 'https://<your-worker>.workers.dev';

// ---------------------------------------------------------------------------
// A) Scenario 2 — UI Extension publishes session token, pixel handles the rest
// ---------------------------------------------------------------------------
analytics.subscribe('affiliate_session', async (event) => {
  const { token } = event.data;
  if (!token) return;

  const affiliateId = await browser.cookie.get('affiliate-id');
  if (!affiliateId) {
    console.log('affiliate_session: no affiliate-id cookie, skipping');
    return;
  }

  try {
    await fetch(`${WORKER_URL}/set-affiliate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, affiliate_id: affiliateId }),
    });
  } catch (e) {
    console.error('affiliate_session: worker request failed', e);
  }
});

// ---------------------------------------------------------------------------
// B) page_viewed — original flow (unauthenticated, kept as-is)
//    This path is superseded by the affiliate_session flow above for Scenario 2.
//    Remove or gate this once all three scenarios are fully live.
// ---------------------------------------------------------------------------
analytics.subscribe('page_viewed', async (event) => {
  const customer = init?.data?.customer;
  if (!customer) {
    console.log('page_viewed: no customer');
    return;
  }

  const isMetafieldSet = await browser.cookie.get('is_affiliate_metafield_set');
  if (isMetafieldSet === '1') {
    console.log('page_viewed: metafield already set (cached)');
    return;
  }

  const affiliateId = await browser.cookie.get('affiliate-id');
  if (!affiliateId) {
    console.log('page_viewed: no affiliate-id cookie');
    return;
  }

  const response = await fetch(`${WORKER_URL}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      affiliate_id: affiliateId,
      customerId: customer?.id || null,
      timestamp: new Date().toISOString(),
    }),
  });

  const result = await response.json();
  if (result?.value && result.value !== '') {
    browser.cookie.set('is_affiliate_metafield_set', '1');
  }
});
