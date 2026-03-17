/**
 * App Proxy Handler — POST /apps/affiliate/set-affiliate
 *
 * Shopify routes requests through the app proxy and appends a signed HMAC to
 * the query string. This handler verifies that signature, resolves the
 * customer from the signed `logged_in_customer_id` param, then sets the
 * affiliate metafield if it is not already set.
 *
 * Environment variables required:
 *   SHOPIFY_APP_SECRET   — used to verify the proxy HMAC
 *   SHOPIFY_ADMIN_TOKEN  — Admin API access token
 *   SHOPIFY_STORE_URL    — e.g. "your-store.myshopify.com"
 *   METAFIELD_NAMESPACE  — e.g. "custom"
 *   METAFIELD_KEY        — e.g. "affiliate_id"
 *
 * Deploy target: Cloudflare Worker (Workers runtime) or any edge/serverless
 * environment that supports the Web Crypto API.
 */

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204 });
    }

    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const url = new URL(request.url);

    // ------------------------------------------------------------------
    // 1. Verify Shopify app proxy HMAC
    // ------------------------------------------------------------------
    const signature = url.searchParams.get('signature');
    if (!signature || !(await verifyProxyHmac(url.searchParams, env.SHOPIFY_APP_SECRET))) {
      return new Response('Unauthorized', { status: 401 });
    }

    // ------------------------------------------------------------------
    // 2. Resolve customer ID from signed proxy params
    //    Shopify injects `logged_in_customer_id` when a customer is logged in.
    // ------------------------------------------------------------------
    const customerId = url.searchParams.get('logged_in_customer_id');
    if (!customerId) {
      // No logged-in customer — nothing to attribute
      return new Response(JSON.stringify({ ok: false, reason: 'not_logged_in' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // ------------------------------------------------------------------
    // 3. Read affiliate_id from POST body
    // ------------------------------------------------------------------
    let affiliateId;
    try {
      const body = await request.json();
      affiliateId = body.affiliate_id;
    } catch {
      return new Response('Bad Request', { status: 400 });
    }

    if (!affiliateId) {
      return new Response(JSON.stringify({ ok: false, reason: 'no_affiliate_id' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // ------------------------------------------------------------------
    // 4. Check existing metafield — attribution is permanent
    // ------------------------------------------------------------------
    const existing = await getCustomerMetafield(
      env.SHOPIFY_STORE_URL,
      env.SHOPIFY_ADMIN_TOKEN,
      customerId,
      env.METAFIELD_NAMESPACE,
      env.METAFIELD_KEY,
    );

    const existingValue = existing?.data?.customer?.metafield?.value;
    if (existingValue && existingValue !== '') {
      console.log(`app-proxy: metafield already set for customer ${customerId}`);
      return new Response(JSON.stringify({ ok: false, reason: 'already_set' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // ------------------------------------------------------------------
    // 5. Set metafield
    // ------------------------------------------------------------------
    const result = await updateCustomerMetafield(
      env.SHOPIFY_STORE_URL,
      env.SHOPIFY_ADMIN_TOKEN,
      customerId,
      env.METAFIELD_NAMESPACE,
      env.METAFIELD_KEY,
      affiliateId,
    );

    console.log('app-proxy: metafield set result:', result);

    return new Response(JSON.stringify({ ok: true, value: affiliateId }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Verifies the Shopify app proxy HMAC.
 * Shopify signs all proxy requests by:
 *   1. Collecting all query params except `signature`
 *   2. Sorting them alphabetically by key
 *   3. Joining as "key=value" pairs with "&"
 *   4. HMAC-SHA256 signing with the app secret
 *   5. Hex-encoding the result
 */
async function verifyProxyHmac(searchParams, secret) {
  const params = [];
  for (const [key, value] of searchParams.entries()) {
    if (key !== 'signature') {
      params.push(`${key}=${value}`);
    }
  }
  params.sort();
  const message = params.join('&');

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signatureBytes = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  const computedHex = Array.from(new Uint8Array(signatureBytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return computedHex === searchParams.get('signature');
}

async function getCustomerMetafield(shop, token, customerId, namespace, key) {
  const response = await fetch(`https://${shop}/admin/api/2026-01/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify({
      query: `
        query getMetafield($id: ID!, $ns: String!, $key: String!) {
          customer(id: $id) {
            metafield(namespace: $ns, key: $key) {
              value
            }
          }
        }
      `,
      variables: {
        id: `gid://shopify/Customer/${customerId}`,
        ns: namespace,
        key,
      },
    }),
  });
  return response.json();
}

async function updateCustomerMetafield(shop, token, customerId, namespace, key, value) {
  const response = await fetch(`https://${shop}/admin/api/2026-01/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify({
      query: `
        mutation metafieldsSet($meta: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $meta) {
            metafields { id namespace key value }
            userErrors { field message }
          }
        }
      `,
      variables: {
        meta: [
          {
            ownerId: `gid://shopify/Customer/${customerId}`,
            namespace,
            key,
            value,
            type: 'single_line_text_field',
          },
        ],
      },
    }),
  });
  return response.json();
}
