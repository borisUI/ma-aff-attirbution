# Scenario 1: Logged-In Customer Visits via Affiliate Link

## Problem

A customer already has an account but has no affiliate attribution yet. They later arrive on the storefront via an affiliate link while already logged in. We need to capture that attribution on any storefront page.

## Constraints

- Storefront pages are Liquid templates (not new Customer Accounts)
- Full JS and cookie access available in the browser
- `{{ customer.id }}` is accessible in Liquid when the customer is logged in
- App-proxy requests from Liquid pages are authenticated by Shopify — no extra auth needed
- Attribution must never change once set

## Solution: Liquid Snippet + App Proxy

### Flow

1. The existing theme snippet (`url-param-and-cookie.js`) runs on every page and captures the affiliate slug from the URL into a cookie
2. A Liquid snippet checks server-side whether:
   - A customer is logged in (`{{ customer.id }}` is non-empty)
   - The customer's affiliate metafield is already set (check via Liquid metafield access)
   - If metafield is already set → do nothing (abort entirely, no JS executed)
3. If metafield is not set, a JS snippet reads the affiliate cookie and POSTs to the app proxy with the affiliate slug
4. The app proxy handler verifies the request (Shopify handles auth), reads the session to get the customer ID, and sets the metafield

### Why App Proxy

- App proxy requests are authenticated by Shopify automatically (HMAC signature on every request)
- No session token or external cloud function needed
- Customer ID can be resolved server-side from the session — no need to pass it from the browser

### Metafield Check in Liquid

Checking the metafield in Liquid (backend) before rendering any JS means:
- Zero JS executed for already-attributed customers
- No unnecessary network requests
- Clean abort path

```liquid
{% assign affiliate = customer.metafields.custom.affiliate_id %}
{% if customer and affiliate == blank %}
  {%- comment -%} Render affiliate attribution snippet {%- endcomment -%}
  <script>
    // read cookie, POST to app proxy if cookie present
  </script>
{% endif %}
```

### App Proxy Handler Responsibilities

1. Verify request is from Shopify (HMAC)
2. Resolve customer ID from session
3. Double-check metafield is still empty (guard against race conditions)
4. Set metafield via Admin API

## Files to Create / Modify

- `theme-snippets/affiliate-attribution-storefront.js` — JS that reads cookie and calls app proxy
- `theme-snippets/affiliate-check.liquid` — Liquid guard + script include
- `app-proxy/set-affiliate.js` — App proxy handler (new Shopify app route)

## Notes

- The existing `url-param-and-cookie.js` snippet already handles cookie creation and is reused here
- This scenario does NOT use web pixels or the Cloudflare worker
- The app proxy approach is simpler and more secure than an external cloud function for this scenario
