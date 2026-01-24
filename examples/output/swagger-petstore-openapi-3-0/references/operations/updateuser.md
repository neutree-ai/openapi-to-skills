# PUT /user/{username}

**Resource:** [user](../resources/user.md)
**Update user resource.**
**Operation ID:** `updateUser`

This can only be done by the logged in user.

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `username` | path | string | Yes | name that need to be deleted |

## Request Body

Update an existent user in the store

**Content Types:** `application/json`, `application/xml`, `application/x-www-form-urlencoded`

**Schema:** [User](../schemas/user/user.md)

## Responses

| Status | Description |
|--------|-------------|
| 200 | successful operation |
| 400 | bad request |
| 404 | user not found |
| default | Unexpected error |

