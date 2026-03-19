/*
 * ma-session-affiliate — Cloudflare Worker
 *
 * Validates a Shopify Customer Account API session token, checks whether a
 * customer affiliate metafield is already set, and sets it if not.
 * Uses the Web Crypto API — no npm dependencies, paste directly into the
 * Cloudflare dashboard code editor.
 *
 * ─── STEP 1: CREATE THE APP ───────────────────────────────────────────────────
 *
 * This worker is designed for apps created in the Shopify Dev Dashboard
 * (dev.shopify.com/dashboard), NOT the Partner Dashboard. The client
 * credentials grant used to fetch Admin API tokens only works for Dev
 * Dashboard apps.
 *
 * 1. Go to dev.shopify.com/dashboard and create a new app.
 * 2. In the app Settings, copy the Client ID and Client Secret — you'll need
 *    these for the Cloudflare environment variables below.
 *
 * ─── STEP 2: CONFIGURE API SCOPES ────────────────────────────────────────────
 *
 * The app needs write_customers scope to read and set customer metafields.
 *
 * 1. In the Dev Dashboard app → Settings → API access scopes, add:
 *      write_customers
 * 2. Save.
 *
 * ─── STEP 3: ENABLE PROTECTED CUSTOMER DATA ACCESS ───────────────────────────
 *
 * Shopify requires apps to explicitly declare they need access to customer
 * data before the metafieldsSet mutation will work on customer objects.
 * Without this, the API returns an ACCESS_DENIED error even with the right
 * scope.
 *
 * 1. In the Dev Dashboard app → Settings, find the
 *    "Protected customer data access" section.
 * 2. Enable it and select the customer data fields your app needs.
 * 3. Save.
 *
 * ─── STEP 4: INSTALL THE APP ON THE STORE ────────────────────────────────────
 *
 * Scope changes and protected data access changes only take effect after
 * reinstalling the app. Any time you change scopes or protected data
 * settings, reinstall.
 *
 * 1. In the Dev Dashboard app, click Install / Reinstall on your store.
 *
 * ─── STEP 5: SET CLOUDFLARE ENVIRONMENT VARIABLES ────────────────────────────
 *
 * In your Cloudflare Worker → Settings → Variables, add the following.
 * Mark SHOPIFY_CLIENT_SECRET as an encrypted secret.
 *
 *   SHOPIFY_CLIENT_ID     — Client ID from Dev Dashboard → Settings.
 *                           Used to validate the `aud` claim on session tokens
 *                           and to fetch Admin API tokens at runtime.
 *
 *   SHOPIFY_CLIENT_SECRET — Client Secret from Dev Dashboard → Settings.
 *                           Used to verify the HS256 signature on session
 *                           tokens and to fetch Admin API tokens at runtime.
 *                           No static admin token is needed — the worker
 *                           exchanges these credentials for a short-lived
 *                           token on each request.
 *
 *   SHOPIFY_STORE_URL     — The store's myshopify.com domain.
 *                           Format: my-store.myshopify.com
 *                           No https://, no trailing slash.
 *
 *   METAFIELD_NAMESPACE   — Namespace of the metafield to check/set.
 *
 *   METAFIELD_KEY         — Key of the metafield to check/set.
 *
 * ─── REQUEST ──────────────────────────────────────────────────────────────────
 *
 * POST /
 * Body: {
 *   "session_token": "<shopify-jwt>",
 *   "affiliate_id":  "<affiliate-id-string>",
 *   "customer_id":   "<numeric-shopify-customer-id>"
 * }
 *
 * ─── RESPONSE ─────────────────────────────────────────────────────────────────
 *
 * 200: { "customerId": "<id>", "affiliateId": "<id>" }  — metafield set
 * 400: Missing or malformed request body
 * 401: Invalid or expired session token
 * 409: Metafield already set — no action taken
 */

const corsHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: corsHeaders,
      });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const { session_token, affiliate_id, customer_id } = body;

    if (!session_token) {
      return new Response(JSON.stringify({ error: "Missing session_token" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    if (!affiliate_id) {
      return new Response(JSON.stringify({ error: "Missing affiliate_id" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    if (!customer_id) {
      return new Response(JSON.stringify({ error: "Missing customer_id" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    let payload;
    try {
      payload = await verifyShopifyJWT(session_token, env.SHOPIFY_CLIENT_ID, env.SHOPIFY_CLIENT_SECRET, env.SHOPIFY_STORE_URL);
    } catch (err) {
      return new Response(
        JSON.stringify({
          error: "Invalid or expired session token",
          detail: err.message,
        }),
        { status: 401, headers: corsHeaders },
      );
    }

    // Exchange client credentials for a short-lived Admin API token
    const adminToken = await getAdminAccessToken(env.SHOPIFY_STORE_URL, env.SHOPIFY_CLIENT_ID, env.SHOPIFY_CLIENT_SECRET);

    // Check if the metafield is already set
    const customerMetafield = await getCustomerMetafield(
      env.SHOPIFY_STORE_URL,
      adminToken,
      customer_id,
      env.METAFIELD_NAMESPACE,
      env.METAFIELD_KEY,
    );

    const existingValue = customerMetafield?.data?.customer?.metafield?.value;
    if (existingValue && existingValue !== "") {
      return new Response(
        JSON.stringify({ error: "Affiliate metafield already set" }),
        { status: 409, headers: corsHeaders },
      );
    }

    // Set the metafield
    await updateCustomerMetafield(
      env.SHOPIFY_STORE_URL,
      adminToken,
      customer_id,
      env.METAFIELD_NAMESPACE,
      env.METAFIELD_KEY,
      affiliate_id,
    );

    return new Response(
      JSON.stringify({ customerId: customer_id, affiliateId: affiliate_id }),
      { status: 200, headers: corsHeaders },
    );
  },
};

// ─── SHOPIFY ADMIN API ────────────────────────────────────────────────────────

async function getAdminAccessToken(shop, clientId, clientSecret) {
  const response = await fetch(
    `https://${shop}/admin/oauth/access_token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "client_credentials",
      }),
    },
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Failed to get admin token: ${err}`);
  }

  const { access_token } = await response.json();
  return access_token;
}

async function getCustomerMetafield(shop, token, customerId, namespace, key) {
  const response = await fetch(
    `https://${shop}/admin/api/2026-01/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
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
    },
  );

  return response.json();
}

async function updateCustomerMetafield(shop, token, customerId, namespace, key, value) {
  const response = await fetch(
    `https://${shop}/admin/api/2026-01/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({
        query: `
          mutation metafieldsSet($meta: [MetafieldsSetInput!]!) {
            metafieldsSet(metafields: $meta) {
              metafields {
                id
                namespace
                key
                value
              }
              userErrors {
                field
                message
              }
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
              type: "single_line_text_field",
            },
          ],
        },
      }),
    },
  );

  return response.json();
}

// ─── JWT VERIFICATION ─────────────────────────────────────────────────────────

async function verifyShopifyJWT(token, clientId, clientSecret, storeUrl) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid JWT format");

  const [headerB64, payloadB64, signatureB64] = parts;

  const header = JSON.parse(base64urlDecodeToString(headerB64));

  if (header.alg !== "HS256") {
    throw new Error(`Unsupported algorithm: ${header.alg}`);
  }

  // Import the client secret as an HMAC-SHA256 key
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(clientSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );

  // Verify the signature over "header.payload"
  const signingInput = `${headerB64}.${payloadB64}`;
  const isValid = await crypto.subtle.verify(
    "HMAC",
    key,
    base64urlDecode(signatureB64),
    new TextEncoder().encode(signingInput),
  );

  if (!isValid) throw new Error("Signature verification failed");

  const payload = JSON.parse(base64urlDecodeToString(payloadB64));

  // Validate standard claims
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && now > payload.exp) throw new Error("Token expired");
  if (payload.nbf && now < payload.nbf) throw new Error("Token not yet valid");
  const expectedIssuer = `https://${storeUrl}/checkouts`;
  if (payload.iss !== expectedIssuer) throw new Error("Invalid issuer");
  if (payload.aud !== clientId) throw new Error("Invalid audience");

  return payload;
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function base64urlDecode(str) {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + (4 - (base64.length % 4)) % 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function base64urlDecodeToString(str) {
  return new TextDecoder().decode(base64urlDecode(str));
}
