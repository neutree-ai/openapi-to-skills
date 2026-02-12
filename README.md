# openapi-to-skills

Convert OpenAPI specifications into [Agent Skills](https://agentskills.io/) format - structured markdown documentation that minimizes context size for AI agents.

AI agents often need domain-specific knowledge to complete tasks. Rather than writing custom prompts or building MCP tools from scratch, leveraging existing API documentation is a practical approach - and OpenAPI is the de facto standard with battle-tested specifications maintained over years.

However, feeding raw OpenAPI specs to agents has limitations. Complex specifications can exceed LLM context limits, and even when they fit, loading the entire document for every request wastes valuable context.

Agent Skills solves this by structuring documentation for on-demand reading. Agents load only what they need - starting with an overview, then drilling into specific operations or schemas. Since file reading is a universal capability across agent frameworks, this approach works everywhere without special integrations.

## Features

- **Semantic structure** - Output organized by resources, operations, and schemas, enabling agents to load only relevant sections
- **Smart grouping** - Operations grouped by tags or path prefix (auto-detected), schemas grouped by naming prefix
- **Filtering** - Include/exclude by tags, paths, or deprecated status
- **Customizable templates** - Override default Eta templates for custom output format

## Usage

```bash
npx openapi-to-skills ./openapi.yaml -o ./output
# or
bunx openapi-to-skills ./openapi.yaml -o ./output
```

### Options

| Option | Alias | Description |
|--------|-------|-------------|
| `--output` | `-o` | Output directory (default: `./output`) |
| `--name` | `-n` | Skill name (default: derived from API title) |
| `--include-tags` | | Only include specified tags (comma-separated) |
| `--exclude-tags` | | Exclude specified tags (comma-separated) |
| `--exclude-paths` | | Exclude paths matching prefixes (comma-separated) |
| `--exclude-deprecated` | | Exclude deprecated operations |
| `--group-by` | `-g` | How to group operations: `tags`, `path`, or `auto` (default: `auto`) |
| `--templates` | `-t` | Custom templates directory |
| `--force` | `-f` | Overwrite existing output directory |
| `--quiet` | `-q` | Suppress output except errors |

### Output Structure

```
{skill-name}/
  SKILL.md                 # Entry point with API overview
  references/
    resources/             # One file per tag
    operations/            # One file per operation
    schemas/               # Grouped by naming prefix
    authentication.md      # Auth schemes (if any)
```

### External References

If your OpenAPI spec contains external `$ref` references (e.g., `./common.yaml#/components/schemas/Error`), bundle them first:

```bash
npx swagger-cli bundle ./api.yaml -o ./bundled.yaml
npx openapi-to-skills ./bundled.yaml -o ./output
```

## Programmatic API

The package exports `convertOpenAPIToSkill` for integration into build pipelines or custom tooling:

```typescript
import { convertOpenAPIToSkill } from 'openapi-to-skills';

const spec = { /* OpenAPI spec object */ };

await convertOpenAPIToSkill(spec, {
  outputDir: './output',
  parser: {
    skillName: 'my-api',
    filter: {
      includeTags: ['users', 'orders'],
      excludeDeprecated: true,
    },
  },
});
```

For advanced use cases, individual components (`createParser`, `createRenderer`, `createWriter`) are also exported.

## Examples

### Petstore (simple)

See [examples/](./examples) for a simple demo with the classic Petstore spec (3 resources, 19 operations).

### Public APIs Collection (production-scale)

[public-api-skills](https://github.com/Yuyz0112/public-api-skills) demonstrates real-world usage across a large collection of public APIs:

| Metric | Original | Agent Skills |
|--------|----------|--------------|
| Source | 1 file (7.2 MB) | 2,135 files |
| Resources | - | 77 index files |
| Operations | 588 (all in one) | 588 individual files |
| Schemas | 1,315 (all in one) | 1,468 individual files |

A 7.2 MB monolithic spec becomes 2,135 focused files that agents can navigate on-demand.

## Roadmap

- [ ] Detect unresolved external `$ref` and warn users
- [ ] Support fetching OpenAPI specs from URL

## Contributing

Development guidelines are maintained in [CLAUDE.md](./CLAUDE.md), designed as a shared reference for both human contributors and AI agents.

We welcome AI-assisted development. However, whether a patch is written manually or with AI collaboration, the author must fully review all changes before submission and take responsibility for the content.

## License

Apache-2.0
