export default {
  async fetch(request, env, ctx) {
    let affiliateId = null;
    let customerId = null;
    if (request.method === "POST") {
      try {
        const body = await request.json();
        affiliateId = body.affiliate_id;
        customerId = body.customerId;
      } catch (e) {
        console.error("Payload error:", e);
      }
    }

    // CORS headers
    const corsHeaders = {
      "content-type": "application/json",
      "Access-Control-Allow-Origin": "*", // Or your specific shopify domain
      "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, X-Requested-With",
      "Access-Control-Max-Age": "86400",
    };

    // Check if a customer is passed
    if (!customerId) {
      console.log("No customer logged in.");
      return new Response(JSON.stringify({ error: "No customer logged in." }), {
        headers: corsHeaders,
      });
    }

    // Check if an affiliate ID is passed
    if (!affiliateId) {
      console.log("No Affiliate ID provided.");
      return new Response(
        JSON.stringify({ error: "No Affiliate ID provided." }),
        {
          headers: corsHeaders,
        },
      );
    }

    console.log(`Detected Logged-in Customer: ${customerId}`);

    // Check if the metafield has been set already
    const customerMetafield = await getCustomerMetafield(
      env.SHOPIFY_STORE_URL,
      env.SHOPIFY_ADMIN_TOKEN,
      customerId,
      env.METAFIELD_NAMESPACE,
      env.METAFIELD_KEY,
    );

    const existingMetafieldValue =
      customerMetafield?.data?.customer?.metafield?.value;
    if (existingMetafieldValue && existingMetafieldValue !== "") {
      console.log(`Metafield for customer ${customerId} has already been set`);

      return new Response(
        JSON.stringify({
          error: `Metafield for customer ${customerId} has already been set`,
        }),
        {
          headers: corsHeaders,
        },
      );
    }

    // Update the Metafield
    const updateResult = await updateCustomerMetafield(
      env.SHOPIFY_STORE_URL,
      env.SHOPIFY_ADMIN_TOKEN,
      customerId,
      env.METAFIELD_NAMESPACE,
      env.METAFIELD_KEY,
      affiliateId,
    );

    console.log("Metafield Update Response:", updateResult);

    return new Response(
      JSON.stringify({ message: "Success", value: affiliateId }),
      {
        headers: corsHeaders,
      },
    );
  },
};

async function updateCustomerMetafield(
  shop,
  token,
  customerId,
  namespace,
  key,
  value,
) {
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
          type: "single_line_text_field",
        },
      ],
    },
  };

  const response = await fetch(
    `https://${shop}/admin/api/2026-01/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify(graphqlQuery),
    },
  );

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

  const response = await fetch(
    `https://${shop}/admin/api/2026-01/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify(graphqlQuery),
    },
  );

  return await response.json();
}
