# POST /store/order

**Resource:** [store](../resources/store.md)
**Place an order for a pet.**
**Operation ID:** `placeOrder`

Place a new order in the store.

## Request Body

**Content Types:** `application/json`, `application/xml`, `application/x-www-form-urlencoded`

**Schema:** [Order](../schemas/Order/Order.md)

## Responses

| Status | Description |
|--------|-------------|
| 200 | successful operation |
| 400 | Invalid input |
| 422 | Validation exception |
| default | Unexpected error |

**Success Response Schema:**

[Order](../schemas/Order/Order.md)

