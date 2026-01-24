# GET /pet/findByStatus

**Resource:** [pet](../resources/pet.md)
**Finds Pets by status.**
**Operation ID:** `findPetsByStatus`

Multiple status values can be provided with comma separated strings.

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `status` | query | enum: available, pending, sold | Yes | Status values that need to be considered for filter |

## Responses

| Status | Description |
|--------|-------------|
| 200 | successful operation |
| 400 | Invalid status value |
| default | Unexpected error |

**Success Response Schema:**

Array of [Pet](../schemas/Pet/Pet.md)

## Security

- **petstore_auth**: write:pets, read:pets
