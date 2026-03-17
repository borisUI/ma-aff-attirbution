# Scenario 3: Guest Checkout Attribution

## Problem

A customer arrives via an affiliate link, doesn't create an account, and goes straight to checkout. Shopify creates a customer record for each guest checkout email. We need to attribute that newly created customer to the affiliate after checkout completes.

## Constraints

- Guest customer doesn't exist in Shopify until AFTER the order is placed
- Checkout UI extensions cannot read cookies — same constraint as Customer Account extensions
- The affiliate slug is only stored in a browser cookie (set by the theme snippet)
- We need a way to carry the affiliate slug from the browser into the order record
- Attribution must happen after the customer exists (post-checkout)
- Attribution must never change once set (so we must check before setting)

## Solution: Cart Attributes → Order Attributes → Webhook

### Flow

1. Customer arrives via affiliate link → theme snippet stores slug in cookie
2. While browsing the storefront (any Liquid page), a JS snippet detects the affiliate cookie and writes it to the Shopify cart as a cart attribute via `/cart/update.js`
3. Cart attributes persist through checkout and are saved on the order as note attributes
4. Customer completes checkout (as guest) → Shopify creates the order and a customer record
5. The `orders/create` webhook fires → our handler reads the `affiliate_id` note attribute from the order, looks up the customer by the order's email, checks if metafield is already set, and sets it if not

### Step 2 — Writing to Cart Attributes

This runs on any Liquid storefront page (product, collection, cart, homepage). Since these are Liquid pages, regular JS has full cookie access and can call Shopify's AJAX Cart API.

```javascript
// Run after url-param-and-cookie.js has executed
const affiliateId = getCookie('affiliate_id');
if (affiliateId) {
  fetch('/cart/update.js', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ attributes: { affiliate_id: affiliateId } }),
  });
}
```

This should run on every page load (idempotent) so the attribute stays current even if the cart is recreated.

### Step 5 — Webhook Handler

```
POST /webhooks/orders-create (Shopify webhook)

Handler:
1. Verify HMAC signature
2. Read order.note_attributes → find affiliate_id
3. If not present → return 200 (no-op)
4. Look up customer by order.email via Admin API
5. GET customer metafield → if already set → return 200 (no-op)
6. SET metafield → affiliate_id = value from order attribute
```

### Why Cart Attributes

- The storefront is Liquid — full JS + cookie access available
- `/cart/update.js` is a same-site Storefront API call — no auth headers needed
- Cart attributes are a native Shopify feature that survive through checkout automatically
- No reliance on the pixel during checkout, no race conditions, no timing issues

### Why Not Use the Web Pixel on checkout_completed

The pixel CAN fire on `checkout_completed` and CAN read cookies in the checkout context. However:
- There's a timing issue — the customer record may not exist yet when the pixel fires
- The pixel can't hit app-proxy (same-site restriction), so it would need the cloud function + a queue/retry mechanism
- The cart attributes approach is simpler, more reliable, and doesn't require any new infrastructure

### Edge Case: Cart Cleared Before Checkout

If the customer clears their cart and starts a new one, the attribute write runs again on the next page load (it's idempotent). The only gap would be if someone empties their cart, leaves, and comes back directly to checkout from a bookmark without hitting any storefront page — this is an acceptable edge case.

### Edge Case: Already-Attributed Customer Completes Guest Checkout

The webhook handler checks the metafield before writing. If the customer (matched by email) already has an affiliate, we do nothing. Attribution never changes.

## Files to Create / Modify

- `theme-snippets/affiliate-cart-attribute.js` — new snippet that writes cookie value to cart attributes
- `theme-snippets/affiliate-check.liquid` — include this snippet (reuse from Scenario 1 or extend it)
- `webhooks/orders-create.js` — new webhook handler (can be a new Cloudflare Worker route or separate function)

## Notes

- This scenario does NOT require the web pixel or the UI extension
- The webhook handler can live in the same Cloudflare Worker as the existing `worker-set-metafield.js` — just add a new route
- The `orders/create` webhook must be registered in the Shopify app with `write_customers` permission
- For non-guest checkouts (customer already has account), Scenarios 1 and 2 handle attribution before checkout. The webhook should still check the metafield before writing to avoid duplicating work.
