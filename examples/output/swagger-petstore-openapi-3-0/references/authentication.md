# Authentication

This document describes the authentication methods supported by this API.

## petstore_auth

**Type:** oauth2

**implicit flow:**
- Authorization URL: https://petstore3.swagger.io/oauth/authorize
- Scopes:
  - `write:pets`: modify pets in your account
  - `read:pets`: read your pets

## api_key

**Type:** apiKey

- **In:** header

