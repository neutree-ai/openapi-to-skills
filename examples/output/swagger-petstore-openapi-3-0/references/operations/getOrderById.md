# GET /store/order/{orderId}

**Resource:** [store](../resources/store.md)
**Find purchase order by ID.**
**Operation ID:** `getOrderById`

For valid response try integer IDs with value <= 5 or > 10. Other values will generate exceptions.

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `orderId` | path | integer (int64) | Yes | ID of order that needs to be fetched |

## Responses

| Status | Description |
|--------|-------------|
| 200 | successful operation |
| 400 | Invalid ID supplied |
| 404 | Order not found |
| default | Unexpected error |

**Success Response Schema:**

[Order](../schemas/Order/Order.md)

