# GET /user/login

**Resource:** [user](../resources/user.md)
**Logs user into the system.**
**Operation ID:** `loginUser`

Log into the system.

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `username` | query | string | No | The user name for login |
| `password` | query | string | No | The password for login in clear text |

## Responses

| Status | Description |
|--------|-------------|
| 200 | successful operation |
| 400 | Invalid username/password supplied |
| default | Unexpected error |

