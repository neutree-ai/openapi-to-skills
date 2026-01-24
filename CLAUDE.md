# OpenAPI to Skills

A CLI tool that converts OpenAPI specifications into Agent Skills format - structured markdown documentation optimized for AI agents.

## Architecture

```
OpenAPI Spec (YAML/JSON)
         │
         ▼
┌─────────────────┐
│     Parser      │  ──▶  SkillDocument (IR)
└─────────────────┘
         │
         ▼
┌─────────────────┐
│    Renderer     │  ──▶  Markdown files (via eta templates)
└─────────────────┘
         │
         ▼
┌─────────────────┐
│     Writer      │  ──▶  File system
└─────────────────┘
```

### Core Components

| Component | File | Responsibility |
|-----------|------|----------------|
| Types | `src/types.ts` | All TypeScript interfaces including IR (`SkillDocument`) |
| Parser | `src/parser.ts` | OpenAPI → IR. Handles filtering, grouping by tags |
| Renderer | `src/renderer.ts` | IR → Markdown via eta templates |
| Writer | `src/writer.ts` | File system abstraction for testability |
| Converter | `src/converter.ts` | Orchestrates Parser → Renderer → Writer |
| CLI | `src/cli.ts` | Command-line interface using citty |
| Templates | `templates/*.md.eta` | Eta templates for markdown generation |

## Development

### Commands

```bash
bun install              # Install dependencies
bun test                 # Run all tests (unit + e2e)
bun test src/            # Run unit tests only
bun test e2e/            # Run e2e snapshot tests only
bun run dev              # Run CLI in dev mode
bun run lint             # Check with Biome
bun run lint:fix         # Auto-fix lint issues
bun run snapshot:update  # Regenerate e2e snapshots
```

### Testing Strategy

- **Unit tests**: `src/*.test.ts` - Test Parser, Renderer, Converter in isolation with mocks
- **E2E tests**: `e2e/snapshot.test.ts` - Compare CLI output against expected snapshots
- **Snapshots**: `examples/input/` → `examples/output/` (both committed to git)

### Adding a New E2E Test Case

1. Add spec to `examples/input/{name}.yaml`
2. Run `bun run snapshot:update`
3. Commit both input and generated output

## Bun vs Node.js

**Development**: Use Bun for running, testing, and package management.

**Runtime**: The published package must be compatible with both Bun and Node.js. Avoid Bun-specific APIs in source code:

- Use `node:fs` and `node:path` instead of `Bun.file()`
- Use standard `fetch` instead of Bun-specific features
- `Bun.Glob` is acceptable in test files only (`*.test.ts`, `e2e/`)
