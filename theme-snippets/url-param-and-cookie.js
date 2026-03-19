/**
 * Processes affiliate-id from URL and synchronizes with cookies.
 */
function handleAffiliateId() {
  const urlParams = new URLSearchParams(window.location.search);
  const affiliateId = urlParams.get("affiliate-id");

  if (!affiliateId) return;

  // Check for existing cookie
  const existingCookie = document.cookie
    .split("; ")
    .find((row) => row.startsWith("affiliate-id="));

  // Remove the param from the URL regardless of cookie state
  urlParams.delete("affiliate-id");
  const newSearch = urlParams.toString();
  const newUrl = window.location.pathname + (newSearch ? `?${newSearch}` : "");

  // Update browser history without refreshing the page
  window.history.replaceState(null, "", newUrl);

  // Logic for Cookie
  if (!existingCookie) {
    // Cookie doesn't exist, set it
    // Note: 'max-age' is in seconds (e.g., 86400 = 1 day)
    const rootDomain = window.location.hostname.split(".").slice(-2).join(".");
    document.cookie = `affiliate-id=${affiliateId}; path=/; max-age=86400; SameSite=Lax; domain=.${rootDomain}`;
    console.log(`Affiliate ID ${affiliateId} stored.`);
  } else {
    // Cookie exists, do nothing
    console.log(
      "Affiliate ID already exists in cookies. Ignoring URL parameter.",
    );
  }
}

handleAffiliateId();
