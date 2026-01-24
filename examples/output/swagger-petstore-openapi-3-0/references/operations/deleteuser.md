# DELETE /user/{username}

**Resource:** [user](../resources/user.md)
**Delete user resource.**
**Operation ID:** `deleteUser`

This can only be done by the logged in user.

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `username` | path | string | Yes | The name that needs to be deleted |

## Responses

| Status | Description |
|--------|-------------|
| 200 | User deleted |
| 400 | Invalid username supplied |
| 404 | User not found |
| default | Unexpected error |

