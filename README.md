# Affiliate Customer Attribution POC

This repository has several snippets that live in different environments. What these snippets accomplish is:

1. A JS snippet on the site watches for affiliate ID URL parameters on page load
2. Saves the affiliate ID in a cookie
3. A web pixel checks on every page load if there's a logged-in customer
4. When there is, it picks up the affiliate-id cookie and the customer-id and sends them to a cloud function
5. The cloud function checks if the affiliate-id metafield on the customer is set. If it is, it does nothing. If it isn't it sets it.
6. The cloud function would also trigger any other upstream updates

## Cloudflare function

This can be any backend service, here we've used cloudflare workers.
This worker listens for POST requests. From the request body, it takes a customer-id and an affiliate-id. Checks if the customer is already affiliated with a UFO, and if not it sets the metafield in Shopify.
The worker communicates with Shopify via Admin API
The worker is configured with these environment variables

- METAFIELD_NAMESPACE -> the namespace of the metafield in Shopify
- METAFIELD_KEY -> the key of the metafield in Shopify
- SHOPIFY_ADMIN_TOKEN -> the admin token from the Shopify app
- SHOPIFY_APP_SECRET -> the secret from the Shopify app
- SHOPIFY_STORE_URL -> the URL of the shpoify store

## Shopify Web Pixel

The web pixel is run on every "page_viewed" event
It checks for an affiliate-id cookie and if it exists sends its value and the logged-in customer's ID to the cloud function

## Shopify Theme Snippet

This JS snippet checks for affiliate IDs in the URL and in cookies. If a cookie exists the URL is ignored, if not a cookie is created with the value from the URL. This snippet should be run on every page. This code can also be run via web pixel

## Shopify Custom App

A shopify app needs to be created to provision an Admin API access token. The app needs to have `write_customers` access - this needs to be request

## Shopify Metafield

A metafield definition on customers should be created for it to show up properly in the admin. The `SetMetafield` mutation will create one but without a definiotion
