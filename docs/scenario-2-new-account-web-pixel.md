# Scenario 2: New Customer Creates Account via Affiliate Link

## Problem

A customer arrives via an affiliate link (slug stored in cookie), has no account, and creates one through the new Customer Accounts system. We need to attribute them to the affiliate at the moment their account becomes active.

## Constraints

- New Customer Accounts uses Shopify's extension-based system — pages are NOT Liquid templates
- **UI extensions cannot read cookies** — this is the core constraint
- Web pixels CAN read cookies, even on new Customer Accounts pages
- Web pixels CANNOT make requests to same-site origins (app-proxy = same-site) — Shopify security sandbox
- Web pixels CAN make requests to external origins (e.g. a Cloudflare Worker)
- Unauthenticated requests to an external cloud function need a security mechanism

## Solution: UI Extension Session Token → Web Pixel → Cloud Function

### Flow

1. Customer arrives via affiliate link → theme snippet stores slug in cookie (storefront, before account creation)
2. Customer creates account and lands on a Customer Accounts page
3. **UI Extension** (Customer Account extension) runs on page load:
   - Calls `useSessionToken()` to get a short-lived Shopify session token
   - Checks the customer's affiliate metafield — **if already set, abort everything**
   - If not set, publishes a custom analytics event: `analytics.publish('affiliate_session', { token })`
4. **Web Pixel** subscribes to the `affiliate_session` custom event:
   - Receives the session token from the event payload
   - Reads the affiliate slug from the cookie
   - If no cookie → abort
   - POSTs `{ token, affiliate_id }` to the external Cloudflare Worker
5. **Cloudflare Worker** (updated from existing):
   - Validates the session token with Shopify to verify identity and extract customer ID
   - Checks if metafield is already set (double-check)
   - If not set → sets the metafield via Admin API

### Why This Architecture

- **Cookie access**: Only web pixels can read cookies in the new Customer Accounts context
- **Authentication**: Pixels can't use app proxy; session token from the UI extension provides auth
- **Communication direction**: Extension → Pixel via `analytics.publish` is a supported, documented pattern. Pixel → Extension is NOT possible (pixels are sandboxed)
- **Abort at extension level**: Checking the metafield in the UI extension before publishing the event means no pixel work happens for already-attributed customers

### Session Token Validation (Cloud Function)

The Cloudflare Worker validates the token by calling Shopify's session token introspection endpoint. A valid token confirms the customer's identity and provides the customer ID — the browser never needs to send the customer ID directly.

```
POST /set-affiliate
Body: { token: "<shopify-session-token>", affiliate_id: "slug123" }

Worker:
1. POST to Shopify token introspection → get customer_id
2. GET customer metafield → if set, return 200 (no-op)
3. PUT metafield → affiliate_id = "slug123"
```

### UI Extension Entry Point

```javascript
// Customer Account UI Extension
const token = await useSessionToken();
const metafield = customer.metafields.find(m => m.namespace === 'custom' && m.key === 'affiliate_id');

if (metafield?.value) return; // already attributed, abort

analytics.publish('affiliate_session', { token });
```

### Web Pixel Subscription

```javascript
// In custom-web-pixel.js
analytics.subscribe('affiliate_session', (event) => {
  const { token } = event.data;
  const affiliateId = getCookie('affiliate_id'); // existing cookie helper
  if (!affiliateId) return;

  fetch('https://your-worker.workers.dev/set-affiliate', {
    method: 'POST',
    body: JSON.stringify({ token, affiliate_id: affiliateId }),
  });
});
```

## Files to Create / Modify

- `shopify-web-pixel/custom-web-pixel.js` — add `affiliate_session` event subscription
- `customer-account-extension/src/index.jsx` — new UI extension (session token + metafield check + publish)
- `cloudflare-function/worker-set-metafield.js` — add session token validation path

## Notes

- This is the only scenario that requires the Cloudflare Worker — the other two use app-proxy or webhooks
- The UI extension does NOT need to read the cookie — it only needs to get the session token
- The web pixel handles both cookie reading and the external request
- `analytics.publish` is available in Customer Account extensions via the `@shopify/ui-extensions` analytics API
