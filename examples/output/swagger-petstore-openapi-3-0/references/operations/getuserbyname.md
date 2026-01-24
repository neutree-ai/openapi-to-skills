# GET /user/{username}

**Resource:** [user](../resources/user.md)
**Get user by user name.**
**Operation ID:** `getUserByName`

Get user detail based on username.

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `username` | path | string | Yes | The name that needs to be fetched. Use user1 for testing |

## Responses

| Status | Description |
|--------|-------------|
| 200 | successful operation |
| 400 | Invalid username supplied |
| 404 | User not found |
| default | Unexpected error |

**Success Response Schema:**

[User](../schemas/User/User.md)

