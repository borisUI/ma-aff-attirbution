analytics.subscribe("page_viewed", async (event) => {
  // Check for logged in customer
  const customer = init?.data?.customer;
  if (!customer) {
    console.log("NO CUSTOMER");
    return;
  }

  const isMetafieldSet = await browser.cookie.get("is_affiliate_metafield_set");

  if (isMetafieldSet && isMetafieldSet === "1") {
    console.log("METAFIELD IS SET");
    return;
  }

  const affiliateId = await browser.cookie.get("affiliate_id");
  // Check for an affiliate ID in cookies
  if (!affiliateId) {
    console.log("NO AFFILIATE ID FOUND IN COOKIES");
  }

  // Placeholder for the cloud function
  const workerUrl = "...";
  const newMetafieldResponse = await fetch(workerUrl, {
    method: "POST",
    body: JSON.stringify({
      affiliate_id: affiliateId,
      customerId: customer?.id || null,
      timestamp: new Date().toISOString(),
    }),
  });

  if (newMetafieldResponse.value && newMetafieldResponse.value !== "") {
    // needs some other checks for setting this
    browser.cookie.set("is_affiliate_metafield_set", "1");
  }
});
