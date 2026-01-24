# DELETE /store/order/{orderId}

**Resource:** [store](../resources/store.md)
**Delete purchase order by identifier.**
**Operation ID:** `deleteOrder`

For valid response try integer IDs with value < 1000. Anything above 1000 or non-integers will generate API errors.

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `orderId` | path | integer (int64) | Yes | ID of the order that needs to be deleted |

## Responses

| Status | Description |
|--------|-------------|
| 200 | order deleted |
| 400 | Invalid ID supplied |
| 404 | Order not found |
| default | Unexpected error |

