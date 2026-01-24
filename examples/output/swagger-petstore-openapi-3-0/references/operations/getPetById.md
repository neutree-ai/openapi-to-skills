# GET /pet/{petId}

**Resource:** [pet](../resources/pet.md)
**Find pet by ID.**
**Operation ID:** `getPetById`

Returns a single pet.

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `petId` | path | integer (int64) | Yes | ID of pet to return |

## Responses

| Status | Description |
|--------|-------------|
| 200 | successful operation |
| 400 | Invalid ID supplied |
| 404 | Pet not found |
| default | Unexpected error |

**Success Response Schema:**

[Pet](../schemas/Pet/Pet.md)

## Security

- **api_key**
- **petstore_auth**: write:pets, read:pets
