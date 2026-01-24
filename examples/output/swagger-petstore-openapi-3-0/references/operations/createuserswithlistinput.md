# POST /user/createWithList

**Resource:** [user](../resources/user.md)
**Creates list of users with given input array.**
**Operation ID:** `createUsersWithListInput`

## Request Body

**Content Types:** `application/json`

**Schema:** Array of [User](../schemas/user/user.md)

## Responses

| Status | Description |
|--------|-------------|
| 200 | Successful operation |
| default | Unexpected error |

**Success Response Schema:**

[User](../schemas/user/user.md)

