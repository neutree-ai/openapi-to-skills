# POST /pet/{petId}/uploadImage

**Resource:** [pet](../resources/pet.md)
**Uploads an image.**
**Operation ID:** `uploadFile`

Upload image of the pet.

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `petId` | path | integer (int64) | Yes | ID of pet to update |
| `additionalMetadata` | query | string | No | Additional Metadata |

## Request Body

**Content Types:** `application/octet-stream`

## Responses

| Status | Description |
|--------|-------------|
| 200 | successful operation |
| 400 | No file uploaded |
| 404 | Pet not found |
| default | Unexpected error |

**Success Response Schema:**

[ApiResponse](../schemas/Api/ApiResponse.md)

## Security

- **petstore_auth**: write:pets, read:pets
