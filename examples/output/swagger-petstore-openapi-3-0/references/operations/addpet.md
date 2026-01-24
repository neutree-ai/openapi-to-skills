# POST /pet

**Resource:** [pet](../resources/pet.md)
**Add a new pet to the store.**
**Operation ID:** `addPet`

## Request Body

Create a new pet in the store

**Required:** Yes

**Content Types:** `application/json`, `application/xml`, `application/x-www-form-urlencoded`

**Schema:** [Pet](../schemas/pet/pet.md)

## Responses

| Status | Description |
|--------|-------------|
| 200 | Successful operation |
| 400 | Invalid input |
| 422 | Validation exception |
| default | Unexpected error |

**Success Response Schema:**

[Pet](../schemas/pet/pet.md)

## Security

- **petstore_auth**: write:pets, read:pets
