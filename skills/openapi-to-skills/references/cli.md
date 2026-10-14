# CLI Reference

Input must be an OpenAPI 3.x document in JSON or YAML, supplied as a local file or URL. Convert Swagger 2.0 documents to OpenAPI 3.x before using this CLI.

## Options

| Option | Alias | Description |
|--------|-------|-------------|
| `--output` | `-o` | Output directory (default: `./output`) |
| `--layout` | | Page layout: `default` or `compact` (default: `default`) |
| `--name` | `-n` | Skill name (default: derived from API title) |
| `--include-tags` | | Only include specified tags (comma-separated) |
| `--exclude-tags` | | Exclude specified tags (comma-separated) |
| `--exclude-paths` | | Exclude paths matching prefixes (comma-separated) |
| `--exclude-deprecated` | | Exclude deprecated operations |
| `--group-by` | `-g` | How to group operations: `tags`, `path`, or `auto` (default: `auto`) |
| `--case-strategy` | | Strategy for case-insensitive filesystem safety: `lowercase` |
| `--templates` | `-t` | Custom templates directory |
| `--assets` | `-a` | Static assets directory overlaid onto the skill after generation |
| `--overlay` | | OpenAPI Overlay files applied to the spec before conversion (comma-separated, in order) |
| `--validator` | | Also write `tools/validate.mjs`, an offline check of an operation's input |
| `--force` | `-f` | Overwrite existing output directory |
| `--quiet` | `-q` | Suppress output except errors |

## Compact Layout

`--layout compact` writes a skill for an agent that reads one page to make one call:

```bash
npx openapi-to-skills ./openapi.json -o ./output --layout compact --group-by tags
```

- `references/resources/<resource>.md` has the resource's list operations, then one line per field of what they return: its type, how it can be filtered, and its description. For example `` - `memory`*: int64 [cmp] — Bytes. ``
- Other operations have a page each in `references/operations/`, listed on their resources' pages.
- What repeats across pages is stated once in `SKILL.md`: the shared list-query body, the filter rules, and the parameters, security and errors most operations share.
- Schemas no included operation uses are left out.

List calls are GET operations returning arrays, and operations whose body is made only of list-query keys (`where`, `orderBy`, `first`, `skip`, `after`, `before`, `last`) with a filter. That includes count calls taking the same body.

Filters of the Prisma style (`<Entity>WhereInput`: the entity's fields, each alone for equality or with a suffix such as `_in` or `_contains`) are recognized by structure. A field whose suffixes are a well-known set is tagged with its name (`eq`, `cmp`, `str`, `rel`, `rels`…, explained in `SKILL.md`); any other set is spelled out, like `[= _in]`. A filter that does not fit the pattern is shown in full.

Types are short: `T?` may be null, `T[]` is a list, `a|b|c` are the allowed values, and an object of a few scalar fields is written inline as `Name {a, b}`. Larger named objects are described once per page, two levels deep; long enums are listed once at the end of the page.

The default layout is unchanged. Grouping, filtering, `--case-strategy lowercase`, overlays and asset overlays work with either layout. Custom compact templates are `compact-skill.md.eta`, `compact-resource.md.eta` and `compact-operation.md.eta`; each receives `title` and the generated Markdown `body`, and the skill template also receives `meta`. Programmatic custom renderers must implement the optional `renderCompactPage` hook to use compact mode. The programmatic option is `layout: "compact"` in `ConvertOptions`.

## Overlays

`--overlay` applies [OpenAPI Overlay 1.0](https://spec.openapis.org/overlay/v1.0.0.html) documents to the spec before anything is generated, so what the spec lacks can be added without editing it:

```yaml
overlay: 1.0.0
info: { title: Notes, version: "1" }
actions:
  - target: $.components.schemas.Vm.properties.memory
    update: { description: Bytes. }
  - target: $.paths['/delete-vm']
    remove: true
```

Descriptions land where the agent reads them: on a field's line, under a resource's heading, in the resource index. Removed paths are left out of the skill and of the validator. Targets support names (`.a`, `['a/b']`), `*`, array indexes and equality filters (`[?(@.name == 'x')]`); a target that matches nothing is an error, so an overlay cannot silently fall behind its spec.

## Validator

`--validator` adds `tools/validate.mjs` and its data to the skill. It checks a call against the spec offline:

```bash
node tools/validate.mjs '{"operation": "GetVms", "input": {"where": {"status": "RUNING"}}}'
# input.where.status: "RUNING" is not valid; allowed: "DELETED", "RUNNING", "STOPPED", "SUSPENDED", "UNKNOWN"
```

`input` is the request body, or the parameters by name for an operation without one. It reports unknown operations and keys with the closest names, wrong types, enum values, missing required keys, and filter mistakes (a nested operator object, a suffix the field does not take). It needs only Node.

## Case-Insensitive Filesystem Safety

Some OpenAPI specs define schemas whose names differ only in letter casing (e.g., `alert` and `Alert`). This produces output directories that collide on case-insensitive filesystems (macOS, Windows), causing one to silently overwrite the other.

Use `--case-strategy lowercase` to avoid this:

```bash
npx openapi-to-skills ./openapi.yaml -o ./output --case-strategy lowercase
```

This lowercases all schema output paths and disambiguates collisions with numeric suffixes (e.g., `alert.md` and `alert-2.md`). Without this option, the original casing is preserved (default behavior, no breaking change).

## Static Assets (`--assets`)

Generation is destructive: with `--force` the whole skill directory is wiped and rebuilt from the spec, so any hand-authored file dropped inside it is lost on the next run. Use `--assets` to keep hand-authored content (helper scripts, extra reference docs) alongside a generated skill:

```bash
npx openapi-to-skills ./openapi.yaml -o ./output --assets ./assets/my-api --force
```

The assets directory is overlaid onto the skill directory **after** generation, preserving relative paths and file modes (e.g. the executable bit on scripts):

```
assets/my-api/scripts/handoff.sh   →   output/my-api/scripts/handoff.sh
```

Because the overlay is re-applied from this external source on every run, the files survive `--force`. Applying after generation also means an asset **overrides** a generated file at the same relative path — an escape hatch for hand-editing a generated file. The assets directory must live outside the output directory.

```
{skill-name}/
  SKILL.md                 # Entry point with API overview
  references/
    resources/             # One file per tag
    operations/            # One file per operation
    schemas/               # Grouped by naming prefix
    authentication.md      # Auth schemes (if any)
```

## External References

If your OpenAPI spec contains external `$ref` references (e.g., `./common.yaml#/components/schemas/Error`), bundle them first:

```bash
npx swagger-cli bundle ./api.yaml -o ./bundled.yaml
npx openapi-to-skills ./bundled.yaml -o ./output
```
