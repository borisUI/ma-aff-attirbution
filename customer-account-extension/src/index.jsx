/**
 * Customer Account UI Extension — Affiliate Attribution (Scenario 2)
 *
 * Runs on a Customer Account page (e.g. the account overview page after sign-up).
 * Responsibilities:
 *   1. Get a short-lived session token (proves customer identity to the Worker)
 *   2. Check if the customer's affiliate metafield is already set — if so, abort
 *   3. Publish an analytics event so the web pixel can read the cookie and call
 *      the Cloudflare Worker with the token + affiliate slug
 *
 * The extension NEVER reads the cookie itself — cookies are inaccessible from
 * Customer Account extensions. The web pixel handles all cookie access.
 *
 * Registration: Shopify Partner Dashboard → Extensions → Customer account UI
 * Target:       customer-account.page.account.render  (or page you choose)
 */

import { useEffect } from 'react';
import {
  reactExtension,
  useSessionToken,
  useApi,
} from '@shopify/ui-extensions-react/customer-account';

export default reactExtension('customer-account.page.account.render', () => <AffiliateAttributor />);

function AffiliateAttributor() {
  const { sessionToken, analytics, customerAccount } = useApi();
  const getToken = useSessionToken();

  useEffect(() => {
    async function attribute() {
      // 1. Check metafield server-side — abort if attribution already exists
      const customer = await customerAccount.getCustomer();
      const metafields = customer?.metafields ?? [];
      const existing = metafields.find(
        (m) => m.namespace === 'custom' && m.key === 'affiliate_id',
      );
      if (existing?.value) {
        // Already attributed — nothing to do
        return;
      }

      // 2. Get session token to authenticate the Worker request
      const token = await getToken();
      if (!token) return;

      // 3. Publish event — web pixel subscribes and handles cookie + Worker call
      analytics.publish('affiliate_session', { token });
    }

    attribute();
  }, []);

  // This extension renders no visible UI
  return null;
}
