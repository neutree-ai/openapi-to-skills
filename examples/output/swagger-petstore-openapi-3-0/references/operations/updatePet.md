# PUT /pet

**Resource:** [pet](../resources/pet.md)
**Update an existing pet.**
**Operation ID:** `updatePet`

Update an existing pet by Id.

## Request Body

Update an existent pet in the store

**Required:** Yes

**Content Types:** `application/json`, `application/xml`, `application/x-www-form-urlencoded`

**Schema:** [Pet](../schemas/Pet/Pet.md)

## Responses

| Status | Description |
|--------|-------------|
| 200 | Successful operation |
| 400 | Invalid ID supplied |
| 404 | Pet not found |
| 422 | Validation exception |
| default | Unexpected error |

**Success Response Schema:**

[Pet](../schemas/Pet/Pet.md)

## Security

- **petstore_auth**: write:pets, read:pets
