# GET /orders

**Resource:** [orders](../resources/orders.md)
**List orders with pagination**
**Operation ID:** `listOrders`

## Responses

| Status | Description |
|--------|-------------|
| 200 | Paginated order list |

**Success Response Schema** (inline):

- [PageMeta](../schemas/Page/PageMeta.md)
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `data` | Order[] | No |  |


