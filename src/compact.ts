import { dirname, join } from "node:path";
import { toFileName } from "./renderer.js";
import type {
	CaseStrategy,
	CompactPageDocument,
	OpenAPISpec,
	OperationDocument,
	OperationObject,
	ParameterObject,
	ReferenceObject,
	Renderer,
	ResponseObject,
	SchemaObject,
	SkillDocument,
	Writer,
} from "./types.js";
import { isReferenceObject } from "./types.js";

type Schema = SchemaObject | ReferenceObject;
const MAX_DEPTH = 2;
const LIST_FIELDS = new Set([
	"where",
	"orderBy",
	"first",
	"skip",
	"after",
	"before",
	"last",
]);
const FILTER_RULES: Record<string, string> = {
	"": "Equality; use the field name without a suffix",
	_not: "Not equal",
	_in: "One of the values in an array",
	_not_in: "None of the values in an array",
	_contains: "Contains the substring",
	_not_contains: "Does not contain the substring",
	_starts_with: "Starts with the substring",
	_not_starts_with: "Does not start with the substring",
	_ends_with: "Ends with the substring",
	_not_ends_with: "Does not end with the substring",
	_gt: "Greater than",
	_gte: "Greater than or equal",
	_lt: "Less than",
	_lte: "Less than or equal",
	_some: "At least one related item matches the nested filter",
	_every: "Every related item matches the nested filter",
	_none: "No related item matches the nested filter",
};

function cell(value: unknown): string {
	return String(value ?? "")
		.replace(/\|/g, "\\|")
		.replace(/\r?\n/g, "<br>");
}

function code(value: unknown): string {
	const text = String(value ?? "").replace(/\r?\n/g, " ");
	const ticks = "`".repeat(
		Math.max(0, ...(text.match(/`+/g) ?? []).map((s) => s.length)) + 1,
	);
	const padding = text.startsWith("`") || text.endsWith("`") ? " " : "";
	return `${ticks}${padding}${text}${padding}${ticks}`;
}

function table(headers: string[], rows: unknown[][]): string {
	const columns = headers
		.map((_, i) => i)
		.filter((i) => i < headers.length - 1 || rows.some((row) => row[i] !== ""));
	return [headers, headers.map(() => "---"), ...rows]
		.map((row) => `|${columns.map((i) => cell(row[i])).join("|")}|`)
		.join("\n");
}

interface FilterField {
	name: string;
	schema: Schema;
	operators: string[];
}
interface FilterFamily {
	fields: FilterField[];
	combinators: string[];
}
interface ListShape {
	name: string;
	schema: SchemaObject;
}

/** Analyze raw schemas without changing the default parser's IR or output. */
class CompactContext {
	readonly filters = new Map<string, FilterFamily>();
	readonly listOperations = new Set<OperationDocument>();
	readonly lists = new Map<OperationDocument, ListShape>();
	readonly reachable = new Set<string>();
	readonly schemas: Record<string, Schema>;

	constructor(
		readonly spec: OpenAPISpec,
		readonly doc: SkillDocument,
	) {
		this.schemas = spec.components?.schemas ?? {};
		for (const [name, schema] of Object.entries(this.schemas)) {
			const family = this.detectFilter(name, schema);
			if (family) this.filters.set(name, family);
		}
		const shapes = new Map<
			string,
			{ schema: SchemaObject; operations: OperationDocument[] }
		>();
		for (const resource of doc.resources) {
			for (const op of resource.operations) {
				const raw = this.operation(op);
				this.visit(raw);
				this.visit(spec.paths[op.path]?.parameters);
				const body = this.resolve(raw.requestBody);
				const returnsArray = Object.entries(raw.responses).some(
					([status, response]) => {
						if (!/^2\d\d$/.test(status)) return false;
						return Object.values(
							this.resolve<ResponseObject>(response)?.content ?? {},
						).some((media) => this.unwrap(media.schema)?.type === "array");
					},
				);
				if (op.method === "GET" && returnsArray) this.listOperations.add(op);
				if (!body || !("content" in body)) continue;
				const media = Object.values(body.content);
				if (
					returnsArray &&
					media.some((m) => {
						const props = this.unwrap(m.schema)?.properties;
						return (
							props?.where &&
							Object.keys(props).every((key) => LIST_FIELDS.has(key)) &&
							Object.keys(props).some((key) => key !== "where")
						);
					})
				)
					this.listOperations.add(op);
				if (!this.listOperations.has(op)) continue;
				if (media.length !== 1) continue;
				const schema = this.unwrap(media[0]?.schema);
				const props = schema?.properties;
				if (!schema || !props?.where || !this.filterFor(props.where)) continue;
				if (Object.keys(props).some((key) => !LIST_FIELDS.has(key))) continue;
				if (!Object.keys(props).some((key) => key !== "where")) continue;
				const normalized = {
					...schema,
					properties: Object.fromEntries(
						Object.entries(props)
							.sort(([a], [b]) => a.localeCompare(b))
							.map(([key, value]) => [
								key,
								key === "where" || key === "orderBy"
									? this.genericSchema(value, key)
									: value,
							]),
					),
				};
				const key = JSON.stringify(normalized);
				const shape = shapes.get(key) ?? {
					schema,
					operations: [] as OperationDocument[],
				};
				shape.operations.push(op);
				shapes.set(key, shape);
			}
		}
		for (const shape of shapes.values()) {
			if (shape.operations.length < 2) continue;
			const shared = {
				name: `List query ${new Set(this.lists.values()).size + 1}`,
				schema: shape.schema,
			};
			for (const op of shape.operations) this.lists.set(op, shared);
		}
	}

	resolve<T>(value: T | ReferenceObject | undefined): T | undefined {
		const seen = new Set<string>();
		let current: unknown = value;
		while (isReferenceObject(current)) {
			if (!current.$ref.startsWith("#/") || seen.has(current.$ref))
				return undefined;
			seen.add(current.$ref);
			current = this.lookup(current.$ref);
		}
		return current as T | undefined;
	}

	private lookup(ref: string): unknown {
		if (!ref.startsWith("#/")) return undefined;
		let target: unknown = this.spec;
		for (const part of ref.slice(2).split("/")) {
			const key = decodeURIComponent(part)
				.replace(/~1/g, "/")
				.replace(/~0/g, "~");
			target =
				target && typeof target === "object"
					? (target as Record<string, unknown>)[key]
					: undefined;
		}
		return target;
	}

	unwrap(value: Schema | undefined): SchemaObject | undefined {
		const seen = new Set<SchemaObject>();
		let schema = this.resolve<SchemaObject>(value);
		while (
			schema?.allOf?.length === 1 &&
			!schema.properties &&
			!seen.has(schema)
		) {
			seen.add(schema);
			const child = this.resolve<SchemaObject>(schema.allOf[0]);
			if (!child || seen.has(child)) break;
			seen.add(child);
			const { allOf: _allOf, ...rest } = schema;
			schema = { ...child, ...rest };
			if (child.required || rest.required)
				schema.required = [
					...new Set([...(child.required ?? []), ...(rest.required ?? [])]),
				];
		}
		return schema;
	}

	refName(schema: Schema): string | undefined {
		if (isReferenceObject(schema)) {
			const prefix = "#/components/schemas/";
			return schema.$ref.startsWith(prefix)
				? decodeURIComponent(schema.$ref.slice(prefix.length))
						.replace(/~1/g, "/")
						.replace(/~0/g, "~")
				: undefined;
		}
		return schema.allOf?.length === 1 &&
			Object.keys(schema).every((key) =>
				["allOf", "nullable", "description"].includes(key),
			)
			? this.refName(schema.allOf[0] as Schema)
			: undefined;
	}

	filterFor(schema: Schema): FilterFamily | undefined {
		const name = this.refName(schema);
		return name ? this.filters.get(name) : undefined;
	}

	operation(op: OperationDocument): OperationObject {
		const item = this.resolve(this.spec.paths[op.path]);
		return (item as Record<string, unknown>)?.[
			op.method.toLowerCase()
		] as OperationObject;
	}

	private genericSchema(schema: Schema, name: string): unknown {
		if (isReferenceObject(schema)) return { $ref: name };
		return { ...schema, allOf: schema.allOf?.map(() => ({ $ref: name })) };
	}

	private visit(value: unknown): void {
		if (!value || typeof value !== "object") return;
		if (isReferenceObject(value)) {
			if (this.reachable.has(value.$ref)) return;
			this.reachable.add(value.$ref);
			const name = this.refName(value);
			if (name)
				this.reachable.add(
					`#/components/schemas/${name.replace(/~/g, "~0").replace(/\//g, "~1")}`,
				);
			this.visit(this.lookup(value.$ref));
			return;
		}
		for (const child of Object.values(value)) this.visit(child);
	}

	private detectFilter(name: string, value: Schema): FilterFamily | undefined {
		if (!name.endsWith("WhereInput")) return undefined;
		const schema = this.unwrap(value);
		const base = this.unwrap(this.schemas[name.slice(0, -"WhereInput".length)]);
		if (!schema?.properties || !base?.properties) return undefined;
		if (schema.required?.length) return undefined;
		const combinators = ["AND", "OR", "NOT"].filter(
			(key) => key in (schema.properties ?? {}),
		);
		if (combinators.length === 0) return undefined;
		for (const key of combinators) {
			const operand = schema.properties[key];
			const s = this.unwrap(operand);
			const ref = s?.type === "array" ? s.items : operand;
			if (!ref || this.refName(ref) !== name) return undefined;
		}
		const baseNames = Object.keys(base.properties).sort(
			(a, b) => b.length - a.length,
		);
		const groups = new Map<
			string,
			{ schema: Schema; operators: string[]; operands: Schema[] }
		>();
		for (const [key, operand] of Object.entries(schema.properties)) {
			if (combinators.includes(key)) continue;
			const field = baseNames.find(
				(f) =>
					key === f ||
					(key.startsWith(`${f}_`) && key.slice(f.length) in FILTER_RULES),
			);
			if (!field) return undefined; // Unknown filter dialect: preserve the full schema.
			const suffix = key.slice(field.length);
			const operandSchema = this.unwrap(operand);
			if (!operandSchema) return undefined;
			// Constraints and custom descriptions on individual operators must not
			// disappear into a generic suffix class.
			const supported = new Set([
				"type",
				"format",
				"nullable",
				"enum",
				"items",
				"properties",
				"allOf",
				"additionalProperties",
			]);
			if (Object.keys(operandSchema).some((key) => !supported.has(key)))
				return undefined;
			if (
				(suffix === "_in" || suffix === "_not_in") &&
				operandSchema.type !== "array"
			)
				return undefined;
			if (
				suffix.includes("contains") ||
				suffix.includes("starts_with") ||
				suffix.includes("ends_with")
			) {
				if (operandSchema.type !== "string" || operandSchema.enum)
					return undefined;
			}
			const group = groups.get(field) ?? {
				schema: base.properties[field] as Schema,
				operators: [],
				operands: [],
			};
			group.operators.push(suffix);
			group.operands.push(operand);
			if (suffix === "") group.schema = operand;
			else if (suffix === "_some" || suffix === "_every" || suffix === "_none")
				group.schema = operand;
			groups.set(field, group);
		}
		if (
			groups.size === 0 ||
			![...groups.values()].some((g) => g.operators.some(Boolean))
		)
			return undefined;
		for (const group of groups.values()) {
			const signature = (value: Schema | undefined): string => {
				const { nullable: _nullable, ...schema } = this.unwrap(value) ?? {};
				return JSON.stringify(schema);
			};
			const expected = signature(group.schema);
			for (let i = 0; i < group.operators.length; i++) {
				const suffix = group.operators[i];
				const operand = group.operands[i];
				const resolved = this.unwrap(operand);
				const actual =
					suffix === "_in" || suffix === "_not_in"
						? resolved?.type === "array"
							? resolved.items
							: undefined
						: operand;
				if (signature(actual) !== expected) return undefined;
			}
		}
		const fields = [...groups]
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([field, group]) => ({
				name: field,
				schema: group.schema,
				operators: group.operators.sort(),
			}));
		return { fields, combinators };
	}
}

/** Each resource owns its expansion and enum registry; references never cross pages. */
class CompactPage {
	private readonly pending: {
		schema: Schema;
		label: string;
		depth: number;
		key: string;
	}[] = [];
	private readonly expanded = new Set<string>();
	private readonly enums = new Map<
		string,
		{ name: string; values: unknown[] }
	>();
	private readonly anchors = new Map<string, string>();
	private readonly shared = new Map<
		string,
		{ id: string; title: string; body: string }
	>();

	constructor(private readonly context: CompactContext) {}

	private sharedBlock(title: string, body: string): string {
		const key = `${title}:${body}`;
		let entry = this.shared.get(key);
		if (!entry) {
			entry = { id: `shared-${this.shared.size + 1}`, title, body };
			this.shared.set(key, entry);
		}
		return `**${title}:** [${entry.id}](#${entry.id})`;
	}

	private anchor(key: string): string {
		let anchor = this.anchors.get(key);
		if (!anchor) {
			anchor = `s${this.anchors.size + 1}`;
			this.anchors.set(key, anchor);
		}
		return anchor;
	}

	type(
		value: Schema | undefined,
		depth = 0,
		label = "inline",
		seen = new Set<Schema>(),
	): string {
		if (!value) return "any";
		const name = this.context.refName(value);
		if (seen.has(value)) return code(name ?? "recursive array");
		const schema = this.context.unwrap(value);
		if (!schema) return isReferenceObject(value) ? code(value.$ref) : "any";
		if (schema.enum) {
			const key = JSON.stringify(schema.enum);
			let entry = this.enums.get(key);
			if (!entry) {
				entry = { name: `e${this.enums.size + 1}`, values: schema.enum };
				this.enums.set(key, entry);
			}
			return `[${cell(name ?? "enum")}](#${entry.name})${schema.nullable ? "?" : ""}`;
		}
		if (schema.type === "array")
			return `${this.type(schema.items, depth, label, new Set(seen).add(value))}[]${schema.nullable ? "?" : ""}`;
		if (
			schema.properties ||
			schema.allOf ||
			schema.oneOf ||
			schema.anyOf ||
			typeof schema.additionalProperties === "object"
		) {
			const key = name ? `ref:${name}` : JSON.stringify(value);
			if (depth < MAX_DEPTH) {
				if (!this.anchors.has(key))
					this.pending.push({
						schema: value,
						label: name ?? label,
						depth,
						key,
					});
				return `[${cell(name ?? label)}](#${this.anchor(key)})${schema.nullable ? "?" : ""}`;
			}
			return `${code(name ?? "object")}${schema.nullable ? "?" : ""}`;
		}
		let type: string = schema.type ?? "object";
		if (schema.format) type += ` (${schema.format})`;
		if (schema.nullable) type += "?";
		return type;
	}

	operation(op: OperationDocument): string {
		const raw = this.context.operation(op);
		const parts = [
			`## ${op.method} ${code(op.path)}`,
			`**ID:** ${code(op.operationId)}${op.deprecated ? " (deprecated)" : ""}`,
		];
		if (op.summary) parts.push(op.summary);
		if (op.description && op.description !== op.summary)
			parts.push(op.description);
		const params = [
			...(this.context.spec.paths[op.path]?.parameters ?? []),
			...(raw.parameters ?? []),
		];
		const merged = new Map<string, ParameterObject>();
		for (const value of params) {
			const param = this.context.resolve<ParameterObject>(value);
			if (param) merged.set(`${param.in}:${param.name}`, param);
		}
		if (merged.size)
			parts.push(
				this.sharedBlock(
					"Parameters",
					table(
						["Name", "In", "Type", "Required", "Description"],
						[...merged.values()].map((p) => [
							code(p.name),
							p.in,
							this.type(p.schema, 0, p.name),
							p.required ? "Yes" : "No",
							p.description ?? "",
						]),
					),
				),
			);
		const body = this.context.resolve(raw.requestBody);
		if (body) {
			parts.push(
				`### Request body${body.required ? " (required)" : " (optional)"}`,
			);
			if (body.description) parts.push(body.description);
			const shared = this.context.lists.get(op);
			for (const [contentType, media] of Object.entries(body.content)) {
				if (shared) {
					parts.push(`**Content type:** ${code(contentType)}`);
					parts.push(
						`**Shared request shape:** ${shared.name} (see SKILL.md).`,
					);
					const props = this.context.unwrap(media.schema)?.properties ?? {};
					for (const key of ["where", "orderBy"])
						if (props[key])
							parts.push(
								`${code(key)}: ${this.type(props[key], 0, key)}${this.details(props[key]) ? ` (${this.details(props[key])})` : ""}`,
							);
				} else
					parts.push(
						`${code(contentType)}: ${this.type(media.schema, 0, `${op.operationId} request`)}`,
					);
			}
		}
		const responses: unknown[][] = [];
		for (const [status, value] of Object.entries(raw.responses)) {
			const response = this.context.resolve<ResponseObject>(value);
			if (!response) {
				responses.push([code(status), "unresolved reference", ""]);
				continue;
			}
			const content = Object.entries(response.content ?? {});
			if (content.length === 0)
				responses.push([code(status), response.description, ""]);
			for (const [ct, media] of content)
				responses.push([
					code(status),
					response.description,
					`${code(ct)}: ${this.type(media.schema, 0, `${op.operationId} response ${status}`)}`,
				]);
		}
		parts.push(
			this.sharedBlock(
				"Responses",
				table(["Status", "Description", "Body"], responses),
			),
		);
		const security = raw.security ?? this.context.spec.security;
		if (security)
			parts.push(this.sharedBlock("Security", code(JSON.stringify(security))));
		return parts.join("\n\n");
	}

	definitions(): string {
		const parts: string[] = [...this.shared.values()].map(
			(s) => `<a id="${s.id}"></a>\n\n### ${s.title} (${s.id})\n\n${s.body}`,
		);
		for (const task of this.pending) {
			if (this.expanded.has(task.key)) continue;
			this.expanded.add(task.key);
			const schema = this.context.unwrap(task.schema);
			if (!schema) continue;
			parts.push(
				`<a id="${this.anchor(task.key)}"></a>\n\n### ${code(task.label)}${schema.additionalProperties === false ? " (closed)" : ""}`,
			);
			if (schema.description) parts.push(schema.description);
			const family = this.context.filterFor(task.schema);
			if (family) {
				parts.push(
					"Filterable fields. Each row lists fields with the same value type and supported suffixes; suffix meanings are defined in SKILL.md.",
				);
				const groups = new Map<
					string,
					{ fields: string[]; type: string; operators: string[] }
				>();
				for (const field of family.fields) {
					const type = this.type(field.schema, MAX_DEPTH, field.name);
					const key = JSON.stringify([type, field.operators]);
					const group = groups.get(key) ?? {
						fields: [],
						type,
						operators: field.operators,
					};
					group.fields.push(field.name);
					groups.set(key, group);
				}
				parts.push(
					table(
						["Fields", "Value type", "Supported suffixes"],
						[...groups.values()].map((group) => [
							group.fields.map(code).join(", "),
							group.type,
							group.operators
								.map((suffix) => (suffix ? code(suffix) : "equality"))
								.join(", "),
						]),
					),
				);
				const combinators = new Map<string, string[]>();
				for (const key of family.combinators) {
					const type = this.type(schema.properties?.[key], MAX_DEPTH, key);
					combinators.set(type, [...(combinators.get(type) ?? []), key]);
				}
				parts.push(
					`**Combinators:** ${[...combinators].map(([type, keys]) => `${keys.map(code).join(", ")}: ${type}`).join("; ")}.`,
				);
				continue;
			}
			if (schema.properties) {
				parts.push(
					table(
						["Field", "Type", "Notes"],
						Object.entries(schema.properties).map(([name, field]) => [
							`${code(name)}${schema.required?.includes(name) ? "*" : ""}`,
							this.type(field, task.depth + 1, `${task.label}.${name}`),
							this.details(field),
						]),
					),
				);
			}
			for (const key of ["allOf", "oneOf", "anyOf"] as const)
				if (schema[key])
					parts.push(
						`**${key}:** ${schema[key].map((s) => this.type(s, task.depth, task.label)).join(", ")}`,
					);
			if (
				schema.additionalProperties !== undefined &&
				schema.additionalProperties !== false
			)
				parts.push(
					`**Additional properties:** ${typeof schema.additionalProperties === "boolean" ? schema.additionalProperties : this.type(schema.additionalProperties, task.depth + 1)}`,
				);
		}
		if (this.enums.size)
			parts.push(
				"## Enum values",
				...[...this.enums.values()].map(
					(entry) =>
						`<a id="${entry.name}"></a>\n\n**${entry.name}:** ${code(JSON.stringify(entry.values))}`,
				),
			);
		return parts.join("\n\n");
	}

	details(value: Schema): string {
		const s = this.context.unwrap(value);
		if (!s) return "";
		const constraints = [
			"default",
			"minimum",
			"maximum",
			"exclusiveMinimum",
			"exclusiveMaximum",
			"minLength",
			"maxLength",
			"pattern",
			"minItems",
			"maxItems",
			"uniqueItems",
			"readOnly",
			"writeOnly",
		] as const;
		return [
			s.description,
			...constraints
				.filter((key) => s[key] !== undefined)
				.map((key) => `${key}: ${JSON.stringify(s[key])}`),
		]
			.filter(Boolean)
			.join("; ");
	}
}

export async function writeCompactOutput(
	spec: OpenAPISpec,
	doc: SkillDocument,
	outputDir: string,
	renderer: Renderer,
	writer: Writer,
	caseStrategy?: CaseStrategy,
): Promise<void> {
	if (!renderer.renderCompactPage)
		throw new Error(
			"Compact layout requires a renderer with renderCompactPage support.",
		);
	const context = new CompactContext(spec, doc);
	const root = join(outputDir, doc.meta.name);
	const used = new Set<string>();
	const files = new Map<string, string>();
	function allocate(folder: string, name: string): string {
		let base = toFileName(name);
		if (caseStrategy === "lowercase") base = base.toLowerCase();
		let path = `${folder}/${base}.md`;
		let count = 2;
		while (used.has(path.toLowerCase()))
			path = `${folder}/${base}-${count++}.md`;
		used.add(path.toLowerCase());
		return path;
	}
	function render(path: string, page: CompactPageDocument): void {
		files.set(path, renderer.renderCompactPage?.(page) ?? "");
	}
	const resources: string[] = [];
	const operationPages = new Map<
		string,
		{
			path: string;
			op: OperationDocument;
			resources: { tag: string; path: string }[];
		}
	>();
	for (const resource of doc.resources) {
		const page = new CompactPage(context);
		const path = allocate("references/resources", resource.tag);
		const operations: string[] = [];
		const otherOperations: unknown[][] = [];
		for (const op of resource.operations) {
			if (context.listOperations.has(op)) {
				operations.push(page.operation(op));
				continue;
			}
			const key = `${op.method} ${op.path}`;
			let entry = operationPages.get(key);
			if (!entry) {
				entry = {
					path: allocate("references/operations", op.operationId),
					op,
					resources: [],
				};
				operationPages.set(key, entry);
			}
			entry.resources.push({ tag: resource.tag, path });
			otherOperations.push([
				op.method,
				code(op.path),
				op.summary ?? "",
				`[${code(op.operationId)}](../operations/${entry.path.split("/").pop()})${op.deprecated ? " (deprecated)" : ""}`,
			]);
		}
		if (otherOperations.length)
			operations.push(
				"## Other operations",
				table(["Method", "Path", "Summary", "Details"], otherOperations),
			);
		render(path, {
			kind: "resource",
			title: resource.tag,
			body: [resource.description, ...operations, page.definitions()]
				.filter(Boolean)
				.join("\n\n"),
		});
		resources.push(
			`- [${cell(resource.tag)}](${path}) (${resource.operations.length} ops)`,
		);
	}
	for (const entry of operationPages.values()) {
		const page = new CompactPage(context);
		const operation = page.operation(entry.op);
		render(entry.path, {
			kind: "operation",
			title: entry.op.operationId,
			body: [
				`**Resources:** ${entry.resources.map((resource) => `[${cell(resource.tag)}](../resources/${resource.path.split("/").pop()})`).join(", ")}`,
				operation,
				page.definitions(),
			].join("\n\n"),
		});
	}
	const unattached: string[] = [];
	for (const [name, schema] of Object.entries(context.schemas)) {
		const pointer = `#/components/schemas/${name.replace(/~/g, "~0").replace(/\//g, "~1")}`;
		if (context.reachable.has(pointer)) continue;
		const page = new CompactPage(context);
		const path = allocate("references/schemas", name);
		const type = page.type(schema, 0, name);
		render(path, {
			kind: "schema",
			title: name,
			body: [`**Schema:** ${type}`, page.definitions()].join("\n\n"),
		});
		unattached.push(`- [${cell(name)}](${path})`);
	}
	const skill = [
		doc.meta.description,
		"## How to use this skill",
		"Read one resource page for its list operations, request bodies, filters, and response fields. Other operations have separate pages linked from the resource. Named schemas and enums are expanded once per page. Nested objects expand two levels; deeper object types are named without further expansion. A field marked * is required; other fields are optional. A type followed by ? accepts null. A closed object accepts no additional properties.",
	];
	if (doc.meta.servers.length)
		skill.push(
			"## Base URL",
			...doc.meta.servers.map(
				(s) => `${code(s.url)}${s.description ? ` — ${s.description}` : ""}`,
			),
		);
	if (doc.authSchemes.length) {
		skill.push(
			"## Authentication",
			"See [authentication](references/authentication.md) for credentials and scopes.",
		);
		files.set(
			"references/authentication.md",
			renderer.renderAuthentication(doc.authSchemes),
		);
	}
	if (context.filters.size) {
		skill.push(
			"## Filter suffix rules",
			"Use the field name for equality, or append a supported suffix. Pass arrays to `_in` and `_not_in`; pass scalar values to scalar comparisons and nested filters to relation operators. AND requires all filters, OR requires any filter, and NOT negates filters; each resource states the accepted combinator value types.",
		);
		const usedOperators = new Set(
			[...context.filters.values()].flatMap((family) =>
				family.fields.flatMap((field) => field.operators),
			),
		);
		skill.push(
			table(
				["Suffix", "Meaning"],
				Object.entries(FILTER_RULES)
					.filter(([suffix]) => usedOperators.has(suffix))
					.map(([suffix, meaning]) => [code(suffix || "(none)"), meaning]),
			),
		);
	}
	const page = new CompactPage(context);
	for (const shape of new Set(context.lists.values())) {
		skill.push(
			`## ${shape.name}`,
			"Shared request body. The resource page specifies the concrete `where` and `orderBy` types; do not assume pagination defaults.",
			table(
				["Field", "Type", "Required", "Notes"],
				Object.entries(shape.schema.properties ?? {}).map(([name, schema]) => [
					code(name),
					name === "where" || name === "orderBy"
						? "Resource-specific"
						: page.type(schema),
					shape.schema.required?.includes(name) ? "Yes" : "No",
					page.details(schema),
				]),
			),
		);
		if (shape.schema.additionalProperties !== undefined)
			skill.push(
				`**Additional properties:** ${typeof shape.schema.additionalProperties === "boolean" ? shape.schema.additionalProperties : page.type(shape.schema.additionalProperties)}`,
			);
	}
	skill.push(page.definitions());
	skill.push("## Resources", ...resources);
	if (unattached.length) skill.push("## Other schemas", ...unattached);
	render("SKILL.md", {
		kind: "skill",
		title: doc.meta.title,
		meta: doc.meta,
		body: skill.filter(Boolean).join("\n\n"),
	});
	for (const [path, content] of files) {
		await writer.mkdir(dirname(join(root, path)));
		await writer.writeFile(join(root, path), content);
	}
}
