import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect } from "preact/hooks";

export default async () => {
  render(<Extension />, document.body);
};

function Extension() {
  useEffect(() => {
    async function shareSessionToken() {
      const token = await shopify.sessionToken.get();

      shopify.analytics.publish("get_session_token", { st: token });
    }

    shareSessionToken();
  }, [shopify.sessionToken]);

  return null;
}
