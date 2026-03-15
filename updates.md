# Repository Summary: Affiliate Customer Attribution

## Overview

This repository implements a **Proof of Concept (POC)** for affiliate customer attribution on a Shopify store. The system tracks which affiliate referred a customer and permanently records that association on the customer's Shopify profile using a metafield. It is composed of three code snippets that run in different environments and work together as a pipeline.

---

## How It Works (End-to-End Flow)

1. A visitor arrives at the store via an affiliate link containing an `affiliate-id` URL parameter.
2. The theme snippet detects the parameter, stores the affiliate ID in a browser cookie, and cleans the URL.
3. On every page view, the web pixel checks if there is a logged-in customer and an `affiliate_id` cookie.
4. If both exist (and the metafield hasn't been set yet), the pixel POSTs the customer ID and affiliate ID to a cloud function.
5. The cloud function checks if the customer already has an affiliate metafield set in Shopify. If not, it writes it via the Shopify Admin GraphQL API.

---

## File Breakdown

### `README.md`
High-level documentation describing the purpose of the repository, the flow between components, required environment variables for the Cloudflare worker, and notes on Shopify setup (custom app, metafield definition, required API scopes).

---

### `theme-snippets/url-param-and-cookie.js`
**Environment:** Shopify storefront theme (runs in the customer's browser on every page load)

**What it does:**
- Reads the `affiliate-id` query parameter from the current page URL.
- If found, removes the parameter from the URL using `history.replaceState` (no page reload).
- Checks whether an `affiliate-id` cookie already exists.
  - If no cookie exists: sets one with a 1-day expiry (`max-age=86400`), `SameSite=Lax`.
  - If a cookie already exists: ignores the URL parameter (first-touch attribution — the original affiliate is preserved).

---

### `shopify-web-pixel/custom-web-pixel.js`
**Environment:** Shopify Web Pixel (sandboxed browser context, runs on Shopify storefront events)

**What it does:**
- Subscribes to the `page_viewed` analytics event (fires on every page view).
- Bails early if no customer is logged in.
- Bails early if the `is_affiliate_metafield_set` cookie is already `"1"` (avoids redundant API calls).
- Reads the `affiliate_id` cookie from the browser.
- POSTs the `affiliate_id`, `customerId`, and a `timestamp` to the configured Cloudflare worker URL.
- If the worker responds with a value, sets `is_affiliate_metafield_set=1` cookie to suppress future calls.

**Note:** The `workerUrl` is currently a placeholder (`"..."`) and must be set to the deployed Cloudflare worker URL.

---

### `cloudflare-function/worker-set-metafield.js`
**Environment:** Cloudflare Worker (serverless backend)

**What it does:**
- Listens for incoming POST requests with a JSON body containing `affiliate_id` and `customerId`.
- Returns early with an error if either value is missing.
- Queries the Shopify Admin GraphQL API (`getCustomerMetafield`) to check if the affiliate metafield is already set on the customer.
- If the metafield is already set, returns without making changes (idempotent — affiliate is only recorded once).
- If not set, calls `updateCustomerMetafield` to write the affiliate ID to the customer's metafield via the Shopify `metafieldsSet` mutation.
- Includes CORS headers on all responses to allow requests from the Shopify storefront domain.

**Required environment variables:**
| Variable | Description |
|---|---|
| `METAFIELD_NAMESPACE` | Namespace of the customer metafield in Shopify |
| `METAFIELD_KEY` | Key of the customer metafield in Shopify |
| `SHOPIFY_ADMIN_TOKEN` | Admin API access token from the Shopify custom app |
| `SHOPIFY_APP_SECRET` | App secret from the Shopify custom app |
| `SHOPIFY_STORE_URL` | Shopify store URL (e.g. `mystore.myshopify.com`) |

---

## Shopify Setup Requirements

- **Custom App:** A Shopify custom app must be created with `write_customers` access scope to generate the Admin API token.
- **Metafield Definition:** A metafield definition on the Customer object should be created in the Shopify admin so the field appears correctly in the UI. The `metafieldsSet` mutation will create the value without a definition, but a definition is recommended.

---

## Notes

- This is a POC — production use would require additional error handling and security hardening.
- The `workerUrl` in the web pixel must be updated to the live Cloudflare Worker URL before deploying.
