# Pet

**Type:** object

## Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | integer (int64) | No |  |
| `name` | string | Yes |  |
| `category` | [Category](Category.md) | No |  |
| `photoUrls` | string[] | Yes |  |
| `tags` | Tag[] | No |  |
| `status` | enum: available, pending, sold | No | pet status in the store |

