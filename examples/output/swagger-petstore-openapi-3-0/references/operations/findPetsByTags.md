# GET /pet/findByTags

**Resource:** [pet](../resources/pet.md)
**Finds Pets by tags.**
**Operation ID:** `findPetsByTags`

Multiple tags can be provided with comma separated strings. Use tag1, tag2, tag3 for testing.

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `tags` | query | string[] | Yes | Tags to filter by |

## Responses

| Status | Description |
|--------|-------------|
| 200 | successful operation |
| 400 | Invalid tag value |
| default | Unexpected error |

**Success Response Schema:**

Array of [Pet](../schemas/Pet/Pet.md)

## Security

- **petstore_auth**: write:pets, read:pets
