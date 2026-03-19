analytics.subscribe("get_session_token", async (event) => {
  const token = event.customData?.st;
  if (!token) {
    console.log("NO TOKEN");
  }

  const customer = init?.data?.customer;
  if (!customer) {
    console.log("NO CUSTOMER");
    return;
  }

  const affiliateId = await browser.cookie.get("affiliate_id");
  if (!affiliateId) {
    console.log("NO AFFILIATE ID FOUND IN COOKIES");
    return;
  }

  const workerUrl =
    "https://ma-affiliate-session.bkrastev-personal.workers.dev/";
  const newMetafieldResponse = await fetch(workerUrl, {
    method: "POST",
    body: JSON.stringify({
      affiliate_id: affiliateId,
      customer_id: customer.id,
      session_token: token,
    }),
  });
});
