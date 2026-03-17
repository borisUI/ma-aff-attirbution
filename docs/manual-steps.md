# Manual Steps — All Phases

These are the steps that cannot be automated via code and must be done in Shopify Partner Dashboard, the theme editor, or Cloudflare.

---

## Phase 1 — Scenario 3 (Guest Checkout)

### 1. Include cart-attribute snippet in theme

In your theme's main layout file (`layout/theme.liquid`), load the new snippet **after** `url-param-and-cookie.js` on every storefront page:

```liquid
<script src="{{ 'url-param-and-cookie.js' | asset_url }}" defer></script>
<script src="{{ 'affiliate-cart-attribute.js' | asset_url }}" defer></script>
```

Both scripts must be present on every Liquid page (product, collection, cart, homepage, etc.).

### 2. Register orders/create webhook

In the Shopify Partner Dashboard → your app → **Webhooks**:

- **Event**: `orders/create`
- **URL**: `https://<your-worker>.workers.dev/webhooks/orders-create`
- **Format**: JSON

The app must have the `write_customers` (or `read_customers` + `write_customers`) access scope.

---

## Phase 2 — Scenario 1 (Logged-In Storefront)

### 3. Include Liquid guard snippet in theme

In `layout/theme.liquid`, add the affiliate check snippet inside `<body>` (after the cookie script):

```liquid
{% render 'affiliate-check' %}
```

### 4. Configure app proxy in Shopify

In the Shopify Partner Dashboard → your app → **App proxy**:

- **Subpath prefix**: `apps` (or your choice)
- **Subpath**: `affiliate`
- **Proxy URL**: URL of the server running `app-proxy/set-affiliate.js`

This makes requests to `https://<store>.myshopify.com/apps/affiliate/set-affiliate` route to your handler with Shopify-signed HMAC.

Update the `fetch` URL in `theme-snippets/affiliate-attribution-storefront.js` to match your chosen proxy path.

---

## Phase 3 — Scenario 2 (New Customer Account)

### 5. Add Cloudflare Worker environment variable

In Cloudflare Dashboard → your Worker → **Settings → Variables**:

| Variable | Value |
|----------|-------|
| `SHOPIFY_APP_CLIENT_ID` | Your app's client ID (from Partner Dashboard) |

Required for session token introspection.

### 6. Register Customer Account UI Extension

In the Shopify Partner Dashboard → your app → **Extensions → Customer account UI**:

- Deploy the extension from `customer-account-extension/`
- Set it to show on the **Account** page (or the page customers land on after sign-up)
- No configuration needed beyond registration — the extension reads its own metafield data at runtime

### 7. Update web pixel worker URL

In `shopify-web-pixel/custom-web-pixel.js`, replace the placeholder URL with your actual Cloudflare Worker URL:

```js
fetch('https://<your-worker>.workers.dev/set-affiliate', { ... })
```

---

## Summary Table

| Step | Phase | Where |
|------|-------|-------|
| Include `affiliate-cart-attribute.js` in theme | 1 | Theme editor / `theme.liquid` |
| Register `orders/create` webhook | 1 | Shopify Partner Dashboard |
| Include `affiliate-check` snippet in theme | 2 | Theme editor / `theme.liquid` |
| Configure app proxy | 2 | Shopify Partner Dashboard |
| Add `SHOPIFY_APP_CLIENT_ID` to Worker | 3 | Cloudflare Dashboard |
| Register Customer Account UI Extension | 3 | Shopify Partner Dashboard |
| Set worker URL in web pixel | 3 | `custom-web-pixel.js` |
