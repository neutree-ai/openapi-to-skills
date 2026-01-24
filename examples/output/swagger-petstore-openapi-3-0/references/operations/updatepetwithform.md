# POST /pet/{petId}

**Resource:** [pet](../resources/pet.md)
**Updates a pet in the store with form data.**
**Operation ID:** `updatePetWithForm`

Updates a pet resource based on the form data.

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `petId` | path | integer (int64) | Yes | ID of pet that needs to be updated |
| `name` | query | string | No | Name of pet that needs to be updated |
| `status` | query | string | No | Status of pet that needs to be updated |

## Responses

| Status | Description |
|--------|-------------|
| 200 | successful operation |
| 400 | Invalid input |
| default | Unexpected error |

**Success Response Schema:**

[Pet](../schemas/Pet/Pet.md)

## Security

- **petstore_auth**: write:pets, read:pets
