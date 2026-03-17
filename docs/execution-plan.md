# Execution Plan: Affiliate Attribution — All 3 Scenarios

## Project Context

Shopify store on **new Customer Accounts** (extension-based, not classic Liquid account pages).
Goal: capture affiliate slugs from URL params and permanently attribute customers to affiliates.
**Attribution is permanent — once a metafield is set it must never change.**

MLM context — attribution accuracy is critical.

## What Already Exists

| File | Purpose |
|------|---------|
| `theme-snippets/url-param-and-cookie.js` | Reads affiliate slug from URL param, stores in cookie. Runs on every storefront page. |
| `shopify-web-pixel/custom-web-pixel.js` | Fires on `page_viewed`. Reads affiliate cookie + customer ID, POSTs to Cloudflare Worker. Currently unauthenticated. |
| `cloudflare-function/worker-set-metafield.js` | Receives `{ customer_id, affiliate_id }`, checks metafield, sets it via Admin API if empty. |

The existing code partially covers **Scenario 2** but is missing auth and the UI extension bridge.

## The 3 Scenarios

See `docs/` for full detail on each. Summary:

### Scenario 1 — Logged-in customer visits storefront via affiliate link
**Solution**: Liquid snippet checks metafield server-side. If empty + affiliate cookie present + customer logged in → JS calls app proxy → sets metafield.
**No web pixel or Cloudflare worker needed.**

### Scenario 2 — New customer creates account via affiliate link
**Solution**: Customer Account UI Extension gets session token → `analytics.publish('affiliate_session', { token })` → web pixel subscribes, reads cookie, POSTs `{ token, affiliate_id }` to Cloudflare Worker → worker validates token with Shopify to get customer ID → sets metafield.
**Requires: UI extension (new), updated web pixel, updated Cloudflare worker.**

### Scenario 3 — Guest checkout via affiliate link
**Solution**: JS snippet on Liquid pages writes affiliate cookie value to cart attributes via `/cart/update.js` → cart attributes persist to order note attributes → `orders/create` webhook reads attribute, looks up customer by email, sets metafield.
**Requires: new cart attribute snippet, new webhook handler.**

## Implementation Tasks (Ordered)

### Phase 1 — Scenario 3 (simplest, no new Shopify infrastructure)
- [ ] Create `theme-snippets/affiliate-cart-attribute.js` — reads affiliate cookie, POSTs to `/cart/update.js`
- [ ] Include in theme on all storefront pages alongside existing cookie snippet
- [ ] Add `orders/create` webhook handler to Cloudflare Worker (new route `/webhooks/orders-create`)
  - Verify HMAC
  - Read `affiliate_id` from `order.note_attributes`
  - Look up customer by `order.email`
  - Check metafield → set if empty
- [ ] Register `orders/create` webhook in Shopify app

### Phase 2 — Scenario 1 (Liquid + app proxy)
- [ ] Create `theme-snippets/affiliate-check.liquid` — server-side metafield guard + conditional JS include
- [ ] Create `theme-snippets/affiliate-attribution-storefront.js` — reads cookie, POSTs to app proxy
- [ ] Create app proxy route handler `app-proxy/set-affiliate.js`
  - Verify Shopify HMAC
  - Resolve customer ID from session
  - Check metafield → set if empty

### Phase 3 — Scenario 2 (UI extension + web pixel auth)
- [ ] Create Customer Account UI Extension `customer-account-extension/src/index.jsx`
  - `useSessionToken()` → get token
  - Check customer metafield via extension API → if set, return early
  - `analytics.publish('affiliate_session', { token })`
- [ ] Update `shopify-web-pixel/custom-web-pixel.js`
  - Add subscription to `affiliate_session` custom event
  - On event: read affiliate cookie → if present, POST `{ token, affiliate_id }` to Cloudflare Worker
- [ ] Update `cloudflare-function/worker-set-metafield.js`
  - Add session token validation path (call Shopify token introspection to get customer ID)
  - Existing `customer_id` path can stay for any direct calls

## Key Technical Decisions (Already Made)

- **Web pixels can't hit app-proxy** (same-site restriction) → Scenario 2 uses external Cloudflare Worker
- **UI extensions can't read cookies** → pixel handles all cookie reads, extension only gets session token
- **Extension → Pixel communication** is via `analytics.publish` (one-way only; pixel → extension is not possible)
- **Scenario 3 uses cart attributes** not the web pixel during checkout — simpler, no timing issues
- **All scenarios check metafield before writing** — belt-and-suspenders protection against overwriting attribution

## Shopify App Requirements

The Shopify custom app needs:
- `write_customers` permission (already noted in README)
- App proxy configured (for Scenario 1)
- Webhook subscription for `orders/create` (for Scenario 3)
- Customer Account UI Extension registered (for Scenario 2)

## Environment Variables (Cloudflare Worker)

Already in use:
- `METAFIELD_NAMESPACE`, `METAFIELD_KEY`, `SHOPIFY_ADMIN_TOKEN`, `SHOPIFY_APP_SECRET`, `SHOPIFY_STORE_URL`

New additions needed:
- `SHOPIFY_APP_CLIENT_ID` — required for session token introspection (Scenario 2)

## Start Here

Read the 3 scenario docs in `docs/` before writing any code. Start with Phase 1 (Scenario 3) as it has no new Shopify infrastructure dependencies and can be tested end-to-end fastest.
