---
name: openapi-to-skills
description: 'Generate an AI Agent Skill from an OpenAPI/Swagger spec using the openapi-to-skills CLI. Use when asked to convert an OpenAPI/Swagger document into a skill, create reference docs for an API, or make an API "AI-friendly" for on-demand loading.'
---

# openapi-to-skills

Converts an OpenAPI spec into an [Agent Skills](https://agentskills.io/) folder (`SKILL.md` + `references/`), so agents can load API docs on-demand instead of the whole spec.

## When to Use

- User gives an OpenAPI/Swagger URL or file and wants it turned into a skill.
- User wants context-efficient, per-operation/per-schema API reference docs instead of one giant spec file.

## Procedure

1. Confirm the spec source (local file path or URL) and desired output directory.
2. Run the CLI via `npx` (no install needed):

   ```bash
   npx openapi-to-skills <spec-path-or-url> -o <output-dir>
   ```

3. If the generated skill directory already exists, add `--force` to overwrite it (destructive: the generated skill directory is removed and recreated; overlaid `--assets` files are reapplied).
4. If the spec has external `$ref`s (e.g. `./common.yaml#/...`), bundle first:

   ```bash
   npx swagger-cli bundle ./api.yaml -o ./bundled.yaml
   npx openapi-to-skills ./bundled.yaml -o ./output
   ```
5. Verify output structure: `<output>/<skill-name>/SKILL.md`, `references/resources/`, `references/operations/`, `references/schemas/`, and `references/authentication.md` (if auth is defined).

## Options

| Option | Alias | Description |
|--------|-------|-------------|
| `--output` | `-o` | Output directory (default: `./output`) |
| `--name` | `-n` | Skill name (default: derived from API title) |
| `--include-tags` | | Only include specified tags (comma-separated) |
| `--exclude-tags` | | Exclude specified tags (comma-separated) |
| `--exclude-paths` | | Exclude paths matching prefixes (comma-separated) |
| `--exclude-deprecated` | | Exclude deprecated operations |
| `--group-by` | `-g` | Group operations by: `tags`, `path`, or `auto` (default: `auto`) |
| `--case-strategy` | | `lowercase` to avoid case-collision issues on case-insensitive filesystems (macOS/Windows) |
| `--templates` | `-t` | Custom templates directory (Eta templates) to override default output format |
| `--assets` | `-a` | Directory of hand-authored files overlaid onto the generated skill after each run (survives `--force`) |
| `--force` | `-f` | Overwrite the generated skill directory |
| `--quiet` | `-q` | Suppress output except errors |

## Notes

- Multiple specs for the same API (e.g. v1/v2) → run the CLI once per spec into separate output subfolders.
- Use `--assets` for anything hand-written that must survive regeneration (scripts, extra notes) instead of editing generated files directly. The assets directory must be outside the generated skill directory.
- Prefer `npx openapi-to-skills@latest` if the cached npx version seems stale.

## Maintaining This Skill

The CLI's flags may change over time. When re-verifying:

1. Fetch the current README: `https://raw.githubusercontent.com/neutree-ai/openapi-to-skills/main/README.md`.
2. Diff the `### Options` table against the one above; update rows that changed, and add/remove flags as needed.
3. Re-check the "Case-Insensitive Filesystem Safety", "Static Assets", and "External References" sections in the README for behavior changes and update the Procedure/Notes accordingly.
4. Bump nothing manually — this file has no version field; just keep the Options table in sync.
