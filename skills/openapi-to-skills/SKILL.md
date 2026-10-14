---
name: openapi-to-skills
description: Generate an Agent Skill from an OpenAPI 3.x file or URL using the openapi-to-skills CLI. Use when asked to convert an API specification into a skill or create API reference docs for on-demand loading.
---

# openapi-to-skills

Convert an OpenAPI specification into a skill folder with `SKILL.md` and API references.

## Workflow

1. Determine the spec source and output directory from the request. Input must be OpenAPI 3.x in JSON or YAML; convert Swagger 2.0 first.
2. Read the relevant sections of [references/cli.md](references/cli.md) to choose options:
   - [Options](references/cli.md#options) for naming, grouping, and filtering.
   - [Compact Layout](references/cli.md#compact-layout) for resource pages that consolidate list-call details.
   - [Overlays](references/cli.md#overlays) to modify the spec before generation.
   - [Validator](references/cli.md#validator) to include an offline input checker.
   - [Case-Insensitive Filesystem Safety](references/cli.md#case-insensitive-filesystem-safety) for schemas whose names differ only in case.
   - [Static Assets](references/cli.md#static-assets---assets) and [External References](references/cli.md#external-references) when preserving hand-authored files or bundling external `$ref`s.
3. Run the CLI with the selected options:

   ```bash
   npx openapi-to-skills <spec-path-or-url> -o <output-dir>
   ```

   Use `--force` when replacing existing generated output is intended: it deletes and recreates the skill directory. Keep hand-authored content in an external `--assets` directory so it can be reapplied.
4. Inspect `<output-dir>/<skill-name>/SKILL.md` and its linked references. Check that the intended operations are present and filters took effect; the file layout depends on the selected layout.

## Maintenance

Keep CLI options and behavior documented in `references/cli.md`. README links to this skill and reference rather than maintaining another options table.
