# Affiliate Customer Attribution POC

This repository has several snippets that live in different environments.

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

This JS snippet checks for affiliate IDs in the URL and in cookies. If a cookie exists the URL is ignored, if not a cookie is created with the value from the URL

## Shopify Custom App

A shopify app needs to be created to provision an Admin API access token. The app needs to have `write_customers` access - this needs to be request
