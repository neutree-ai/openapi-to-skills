# POST /user

**Resource:** [user](../resources/user.md)
**Create user.**
**Operation ID:** `createUser`

This can only be done by the logged in user.

## Request Body

Created user object

**Content Types:** `application/json`, `application/xml`, `application/x-www-form-urlencoded`

**Schema:** [User](../schemas/user/user.md)

## Responses

| Status | Description |
|--------|-------------|
| 200 | successful operation |
| default | Unexpected error |

**Success Response Schema:**

[User](../schemas/user/user.md)

