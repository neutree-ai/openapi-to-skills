# DELETE /pet/{petId}

**Resource:** [pet](../resources/pet.md)
**Deletes a pet.**
**Operation ID:** `deletePet`

Delete a pet.

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `api_key` | header | string | No |  |
| `petId` | path | integer (int64) | Yes | Pet id to delete |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Pet deleted |
| 400 | Invalid pet value |
| default | Unexpected error |

## Security

- **petstore_auth**: write:pets, read:pets
