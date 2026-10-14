# POST /orders

**Resource:** [orders](../resources/orders.md)
**Create an order**
**Operation ID:** `createOrder`

## Request Body

**Required:** Yes

**Content Types:** `application/json`

**Schema** (inline):

- [SingleOrderRequest](../schemas/Single/SingleOrderRequest.md)
- [BatchOrderRequest](../schemas/Batch/BatchOrderRequest.md)


## Responses

| Status | Description |
|--------|-------------|
| 201 | Created |

**Success Response Schema:**

[Order](../schemas/Order/Order.md)

