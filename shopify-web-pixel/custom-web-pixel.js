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

  const portalId = await browser.cookie.get("portal_id");
  if (!portalId) {
    console.log("NO AFFILIATE ID FOUND IN COOKIES");
    return;
  }

  const workerUrl =
    "https://ma-affiliate-session.bkrastev-personal.workers.dev/";
  const newMetafieldResponse = await fetch(workerUrl, {
    method: "POST",
    body: JSON.stringify({
      portal_id: portalId,
      customer_id: customer.id,
      session_token: token,
    }),
  });
});
