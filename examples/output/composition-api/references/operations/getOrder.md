# GET /orders/{id}

**Resource:** [orders](../resources/orders.md)
**Get order by ID**
**Operation ID:** `getOrder`

## Parameters

| Name | In | Type | Required | Description |
|------|------|------|----------|-------------|
| `id` | path | string | Yes |  |

## Responses

| Status | Description |
|--------|-------------|
| 200 | Order detail |

**Success Response Schema** (inline):

- [Order](../schemas/Order/Order.md)
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `items` | OrderItem[] | No |  |
| `totalAmount` | number | No | Total order amount |


