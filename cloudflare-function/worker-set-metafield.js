export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (request.method === 'POST' && url.pathname === '/webhooks/orders-create') {
      return handleOrdersCreate(request, env);
    }

    if (request.method === 'POST' && url.pathname === '/set-affiliate') {
      return handleSetAffiliate(request, env);
    }

    // Default route — original set-metafield behaviour
    return handleSetMetafield(request, env);
  },
};

// ---------------------------------------------------------------------------
// Route: POST /webhooks/orders-create  (Scenario 3 — guest checkout)
// ---------------------------------------------------------------------------
async function handleOrdersCreate(request, env) {
  const rawBody = await request.text();

  // 1. Verify HMAC
  const hmacHeader = request.headers.get('X-Shopify-Hmac-Sha256');
  if (!hmacHeader || !(await verifyHmac(rawBody, hmacHeader, env.SHOPIFY_APP_SECRET))) {
    return new Response('Unauthorized', { status: 401 });
  }

  let order;
  try {
    order = JSON.parse(rawBody);
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  // 2. Read affiliate_id from note_attributes
  const noteAttributes = order.note_attributes || [];
  const affiliateAttr = noteAttributes.find((a) => a.name === 'affiliate_id');
  if (!affiliateAttr || !affiliateAttr.value) {
    console.log('orders/create: no affiliate_id in note_attributes, skipping');
    return new Response('OK', { status: 200 });
  }
  const affiliateId = affiliateAttr.value;

  // 3. Look up customer by email
  const email = order.email;
  if (!email) {
    console.log('orders/create: order has no email, skipping');
    return new Response('OK', { status: 200 });
  }

  const customerId = await lookupCustomerIdByEmail(
    env.SHOPIFY_STORE_URL,
    env.SHOPIFY_ADMIN_TOKEN,
    email,
  );
  if (!customerId) {
    console.log(`orders/create: no customer found for email ${email}`);
    return new Response('OK', { status: 200 });
  }

  // 4. Check metafield — only set if empty (attribution is permanent)
  const existing = await getCustomerMetafield(
    env.SHOPIFY_STORE_URL,
    env.SHOPIFY_ADMIN_TOKEN,
    customerId,
    env.METAFIELD_NAMESPACE,
    env.METAFIELD_KEY,
  );

  const existingValue = existing?.data?.customer?.metafield?.value;
  if (existingValue && existingValue !== '') {
    console.log(`orders/create: metafield already set for customer ${customerId}, skipping`);
    return new Response('OK', { status: 200 });
  }

  // 5. Set metafield
  const result = await updateCustomerMetafield(
    env.SHOPIFY_STORE_URL,
    env.SHOPIFY_ADMIN_TOKEN,
    customerId,
    env.METAFIELD_NAMESPACE,
    env.METAFIELD_KEY,
    affiliateId,
  );
  console.log('orders/create: metafield set result:', result);

  return new Response('OK', { status: 200 });
}

// ---------------------------------------------------------------------------
// Route: POST /  (original — set metafield via direct customer_id + affiliate_id)
// ---------------------------------------------------------------------------
async function handleSetMetafield(request, env) {
  let affiliateId = null;
  let customerId = null;
  if (request.method === 'POST') {
    try {
      const body = await request.json();
      affiliateId = body.affiliate_id;
      customerId = body.customerId;
    } catch (e) {
      console.error('Payload error:', e);
    }
  }

  const headers = corsHeaders();

  if (!customerId) {
    console.log('No customer logged in.');
    return new Response(JSON.stringify({ error: 'No customer logged in.' }), { headers });
  }

  if (!affiliateId) {
    console.log('No Affiliate ID provided.');
    return new Response(JSON.stringify({ error: 'No Affiliate ID provided.' }), { headers });
  }

  console.log(`Detected Logged-in Customer: ${customerId}`);

  const customerMetafield = await getCustomerMetafield(
    env.SHOPIFY_STORE_URL,
    env.SHOPIFY_ADMIN_TOKEN,
    customerId,
    env.METAFIELD_NAMESPACE,
    env.METAFIELD_KEY,
  );

  const existingMetafieldValue = customerMetafield?.data?.customer?.metafield?.value;
  if (existingMetafieldValue && existingMetafieldValue !== '') {
    console.log(`Metafield for customer ${customerId} has already been set`);
    return new Response(
      JSON.stringify({ error: `Metafield for customer ${customerId} has already been set` }),
      { headers },
    );
  }

  const updateResult = await updateCustomerMetafield(
    env.SHOPIFY_STORE_URL,
    env.SHOPIFY_ADMIN_TOKEN,
    customerId,
    env.METAFIELD_NAMESPACE,
    env.METAFIELD_KEY,
    affiliateId,
  );

  console.log('Metafield Update Response:', updateResult);

  return new Response(JSON.stringify({ message: 'Success', value: affiliateId }), { headers });
}

// ---------------------------------------------------------------------------
// Route: POST /set-affiliate  (Scenario 2 — new Customer Account via UI extension)
// ---------------------------------------------------------------------------
async function handleSetAffiliate(request, env) {
  let token, affiliateId;
  try {
    const body = await request.json();
    token = body.token;
    affiliateId = body.affiliate_id;
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  if (!token || !affiliateId) {
    return new Response(
      JSON.stringify({ ok: false, reason: 'missing_fields' }),
      { status: 200, headers: corsHeaders() },
    );
  }

  // 1. Validate session token — extract customer ID from verified JWT
  const customerId = await validateSessionToken(token, env.SHOPIFY_STORE_URL, env.SHOPIFY_APP_CLIENT_ID);
  if (!customerId) {
    return new Response('Unauthorized', { status: 401 });
  }

  // 2. Check metafield — attribution is permanent
  const existing = await getCustomerMetafield(
    env.SHOPIFY_STORE_URL,
    env.SHOPIFY_ADMIN_TOKEN,
    customerId,
    env.METAFIELD_NAMESPACE,
    env.METAFIELD_KEY,
  );

  const existingValue = existing?.data?.customer?.metafield?.value;
  if (existingValue && existingValue !== '') {
    console.log(`set-affiliate: metafield already set for customer ${customerId}`);
    return new Response(JSON.stringify({ ok: false, reason: 'already_set' }), {
      status: 200,
      headers: corsHeaders(),
    });
  }

  // 3. Set metafield
  const result = await updateCustomerMetafield(
    env.SHOPIFY_STORE_URL,
    env.SHOPIFY_ADMIN_TOKEN,
    customerId,
    env.METAFIELD_NAMESPACE,
    env.METAFIELD_KEY,
    affiliateId,
  );

  console.log('set-affiliate: metafield set result:', result);

  return new Response(JSON.stringify({ ok: true, value: affiliateId }), {
    status: 200,
    headers: corsHeaders(),
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function corsHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    'Access-Control-Max-Age': '86400',
  };
}

/**
 * Validates a Shopify Customer Account session token (JWT).
 *
 * Shopify signs Customer Account ID tokens with RS256. Public keys are
 * published at: https://<store>/services/openid/jwks.json
 *
 * Steps:
 *   1. Decode the JWT header to get `kid`
 *   2. Fetch JWKS from Shopify and find the matching key
 *   3. Import the public key and verify the JWT signature
 *   4. Validate standard claims: exp, iss, aud
 *   5. Extract customer GID from `sub` claim
 *
 * Returns the numeric customer ID string, or null if validation fails.
 */
async function validateSessionToken(token, shop, clientId) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const header = JSON.parse(atob(parts[0]));
    const payload = JSON.parse(atob(parts[1]));

    // Check standard claims
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      console.log('validateSessionToken: token expired');
      return null;
    }
    if (payload.aud && payload.aud !== clientId) {
      console.log('validateSessionToken: aud mismatch');
      return null;
    }

    // Fetch JWKS
    const jwksUrl = `https://${shop}/services/openid/jwks.json`;
    const jwksResponse = await fetch(jwksUrl);
    if (!jwksResponse.ok) {
      console.error('validateSessionToken: failed to fetch JWKS');
      return null;
    }
    const jwks = await jwksResponse.json();

    const jwk = jwks.keys?.find((k) => k.kid === header.kid);
    if (!jwk) {
      console.error('validateSessionToken: no matching key in JWKS');
      return null;
    }

    // Import public key and verify signature
    const publicKey = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );

    const encoder = new TextEncoder();
    const signedData = encoder.encode(`${parts[0]}.${parts[1]}`);
    const signature = Uint8Array.from(atob(parts[2].replace(/-/g, '+').replace(/_/g, '/')), (c) =>
      c.charCodeAt(0),
    );

    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, signature, signedData);
    if (!valid) {
      console.error('validateSessionToken: signature invalid');
      return null;
    }

    // Extract customer ID from sub claim (gid://shopify/Customer/123456)
    const sub = payload.sub;
    if (!sub) return null;
    const match = sub.match(/Customer\/(\d+)$/);
    return match ? match[1] : null;
  } catch (e) {
    console.error('validateSessionToken: unexpected error', e);
    return null;
  }
}

async function verifyHmac(body, hmacBase64, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const signature = Uint8Array.from(atob(hmacBase64), (c) => c.charCodeAt(0));
  return crypto.subtle.verify('HMAC', key, signature, encoder.encode(body));
}

async function lookupCustomerIdByEmail(shop, token, email) {
  const graphqlQuery = {
    query: `
      query getCustomerByEmail($query: String!) {
        customers(first: 1, query: $query) {
          edges {
            node {
              id
            }
          }
        }
      }
    `,
    variables: { query: `email:${email}` },
  };

  const response = await fetch(`https://${shop}/admin/api/2026-01/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify(graphqlQuery),
  });

  const data = await response.json();
  const gid = data?.data?.customers?.edges?.[0]?.node?.id;
  if (!gid) return null;

  // Return numeric ID extracted from GID for consistency with existing helper
  return gid.replace('gid://shopify/Customer/', '');
}

async function updateCustomerMetafield(shop, token, customerId, namespace, key, value) {
  const graphqlQuery = {
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
          type: 'single_line_text_field',
        },
      ],
    },
  };

  const response = await fetch(`https://${shop}/admin/api/2026-01/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify(graphqlQuery),
  });

  return await response.json();
}

async function getCustomerMetafield(shop, token, customerId, namespace, key) {
  const graphqlQuery = {
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
  };

  const response = await fetch(`https://${shop}/admin/api/2026-01/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify(graphqlQuery),
  });

  return await response.json();
}
