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

// The compact layout is written for an agent that reads one page to make one
// call. Each resource page carries the resource's list operations, the fields
// of what they return, and how each field can be filtered, as one line per
// field. Everything that repeats across pages (the list-query body, filter
// rules, parameters, errors) is stated once in SKILL.md. Other operations get
// a page each, linked from their resources. Schemas no included operation
// uses are left out: there is nothing an agent could do with them.

type Schema = SchemaObject | ReferenceObject;

/** Named objects nest this many levels below a page's top-level types. */
const MAX_DEPTH = 2;
/** An object of at most this many scalar fields is written inline, as `Name {a, b}`. */
const SUMMARY_MAX_FIELDS = 8;
/** Enums up to this many values, and this long, are written inline as `a|b|c`. */
const ENUM_INLINE_MAX = 8;
const ENUM_INLINE_CHARS = 100;

const LIST_FIELDS = new Set([
	"where",
	"orderBy",
	"first",
	"skip",
	"after",
	"before",
	"last",
]);

const FILTER_SUFFIXES = new Set([
	"",
	"_not",
	"_in",
	"_not_in",
	"_contains",
	"_not_contains",
	"_starts_with",
	"_not_starts_with",
	"_ends_with",
	"_not_ends_with",
	"_gt",
	"_gte",
	"_lt",
	"_lte",
	"_some",
	"_every",
	"_none",
]);

const EQ = ["", "_not", "_in", "_not_in"];
const CMP = [...EQ, "_gt", "_gte", "_lt", "_lte"];
const TEXT = [
	"_contains",
	"_not_contains",
	"_starts_with",
	"_not_starts_with",
	"_ends_with",
	"_not_ends_with",
];

/**
 * Named sets of filter suffixes. A field whose suffixes are exactly one of
 * these is tagged with its name; any other set is spelled out on the field.
 * Names come from the set, never from the order of the spec.
 */
const FILTER_CLASSES: {
	name: string;
	suffixes: string[];
	relation?: boolean;
	meaning: string;
}[] = [
	{
		name: "eq",
		suffixes: EQ,
		meaning:
			"`<field>` equals, `<field>_not`, `<field>_in` (a list), `<field>_not_in`",
	},
	{
		name: "is",
		suffixes: ["", "_not"],
		meaning: "`<field>` equals, `<field>_not`",
	},
	{
		name: "cmp",
		suffixes: CMP,
		meaning: "eq, plus `<field>_gt`, `_gte`, `_lt`, `_lte`",
	},
	{
		name: "str",
		suffixes: [...CMP, ...TEXT],
		meaning:
			"cmp, plus `<field>_contains`, `_starts_with`, `_ends_with` and their `_not_` forms (`<field>_not_contains`)",
	},
	{
		name: "text",
		suffixes: [...EQ, ...TEXT],
		meaning:
			"eq, plus `<field>_contains`, `_starts_with`, `_ends_with` and their `_not_` forms",
	},
	{
		name: "rel",
		suffixes: [""],
		relation: true,
		meaning:
			'a single related item: `{"<field>": {…}}` with a filter of the related resource',
	},
	{
		name: "rels",
		suffixes: ["_every", "_none", "_some"],
		relation: true,
		meaning:
			"related items: `<field>_some`, `<field>_every`, `<field>_none`, each a filter of the related resource",
	},
];

const sameSet = (a: string[], b: string[]) =>
	a.length === b.length && a.every((s) => b.includes(s));

/** The class name for a field's suffixes, or the suffixes spelled out. */
function filterTag(operators: string[], relation: boolean): string {
	const named = FILTER_CLASSES.find(
		(c) => !!c.relation === relation && sameSet(c.suffixes, operators),
	);
	if (named) return named.name;
	return operators.map((s) => (s === "" ? "=" : s)).join(" ");
}

function code(value: unknown): string {
	const text = String(value ?? "").replace(/\r?\n/g, " ");
	const ticks = "`".repeat(
		Math.max(0, ...(text.match(/`+/g) ?? []).map((s) => s.length)) + 1,
	);
	const padding = text.startsWith("`") || text.endsWith("`") ? " " : "";
	return `${ticks}${padding}${text}${padding}${ticks}`;
}

const oneLine = (text: string | undefined) =>
	(text ?? "").replace(/\s*\r?\n\s*/g, " ").trim();

/** The first sentence of a description, for an index line. */
function firstSentence(text: string | undefined): string {
	const line = oneLine(text);
	const end = line.search(/[.。](\s|$)/);
	return end < 0 ? line : line.slice(0, end + 1);
}

interface FilterField {
	name: string;
	schema: Schema;
	operators: string[];
	relation: boolean;
}
interface FilterFamily {
	/** The schema whose fields this filters on. */
	base: string;
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
	readonly schemas: Record<string, Schema>;
	/** Filters whose fields are on a resource page, by the resource's name. */
	readonly filterPages = new Map<string, string>();

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
				const media = Object.values(
					this.resolve(raw.requestBody)?.content ?? {},
				);
				// A list call: a GET returning an array, or a body made only of
				// list-query keys with a filter and at least one other key. The
				// latter covers count and aggregate calls taking the same body; a
				// mutation names what it changes (`data`), or filters alone.
				const listBody = media.some((m) => {
					const props = this.unwrap(m.schema)?.properties;
					return (
						!!props?.where &&
						Object.keys(props).every((key) => LIST_FIELDS.has(key)) &&
						Object.keys(props).some((key) => key !== "where")
					);
				});
				if (listBody || (op.method === "GET" && this.returnsArray(raw)))
					this.listOperations.add(op);
				if (!listBody || media.length !== 1) continue;
				const schema = this.unwrap(media[0]?.schema) as SchemaObject;
				const props = schema.properties ?? {};
				// Only a recognized filter can be described as "the resource's".
				if (!props.where || !this.filterFor(props.where)) continue;
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
		const shared = [...shapes.values()].filter((s) => s.operations.length > 1);
		shared.forEach((shape, i) => {
			const list = {
				name: shared.length === 1 ? "List query" : `List query ${i + 1}`,
				schema: shape.schema,
			};
			for (const op of shape.operations) this.lists.set(op, list);
		});
	}

	private returnsArray(raw: OperationObject): boolean {
		return Object.entries(raw.responses).some(([status, response]) => {
			if (!/^2\d\d$/.test(status)) return false;
			return Object.values(
				this.resolve<ResponseObject>(response)?.content ?? {},
			).some((media) => this.unwrap(media.schema)?.type === "array");
		});
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

	/**
	 * The fields of an object schema, with the parts of an `allOf` merged.
	 * Undefined when the schema is not an object with fields.
	 */
	fields(
		schema: SchemaObject,
		seen = new Set<SchemaObject>(),
	): { props: Record<string, Schema>; required: string[] } | undefined {
		if (seen.has(schema)) return undefined;
		seen.add(schema);
		const props: Record<string, Schema> = {};
		const required = new Set(schema.required ?? []);
		// `properties: {}` describes a free-form object, not one with fields.
		let found = Object.keys(schema.properties ?? {}).length > 0;
		for (const part of schema.allOf ?? []) {
			const resolved = this.unwrap(part);
			const inner = resolved && this.fields(resolved, seen);
			if (!inner) continue;
			found = true;
			Object.assign(props, inner.props);
			for (const key of inner.required) required.add(key);
		}
		Object.assign(props, schema.properties);
		return found ? { props, required: [...required] } : undefined;
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

	private detectFilter(name: string, value: Schema): FilterFamily | undefined {
		if (!name.endsWith("WhereInput")) return undefined;
		const baseName = name.slice(0, -"WhereInput".length);
		const schema = this.unwrap(value);
		const base = this.unwrap(this.schemas[baseName]);
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
					(key.startsWith(`${f}_`) && FILTER_SUFFIXES.has(key.slice(f.length))),
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
				relation: this.refName(group.schema)?.endsWith("WhereInput") === true,
			}));
		return { base: baseName, fields, combinators };
	}
}

/** Names of the schemas recognized as filter inputs. */
export function filterSchemaNames(
	spec: OpenAPISpec,
	doc: SkillDocument,
): string[] {
	return [...new CompactContext(spec, doc).filters.keys()];
}

function scalar(schema: SchemaObject): string {
	switch (schema.type) {
		case "integer":
			return schema.format === "int64" ? "int64" : "int";
		case "number":
			return "number";
		case "string":
			return schema.format ? `string(${schema.format})` : "string";
		case undefined:
			return "any";
		default:
			return schema.type;
	}
}

/**
 * One page's worth of types. Named objects are described once per page,
 * under their own heading after the page's main content; long enums are
 * listed once at the end.
 */
class CompactPage {
	private readonly queue: { name: string; schema: Schema; depth: number }[] =
		[];
	/** Names described on this page, or queued to be. */
	private readonly described = new Set<string>();
	private readonly enums = new Map<string, unknown[]>();

	constructor(private readonly context: CompactContext) {}

	/** Mark a name as described elsewhere on the page. */
	reserve(name: string): void {
		this.described.add(name);
	}

	/** A field's type, as a short string. */
	type(
		value: Schema | undefined,
		depth: number,
		stack = new Set<Schema>(),
	): string {
		if (!value) return "any";
		const name = this.context.refName(value);
		if (stack.has(value)) return name ?? "any";
		const schema = this.context.unwrap(value);
		if (!schema) return isReferenceObject(value) ? value.$ref : "any";
		const nullable =
			schema.nullable || (!isReferenceObject(value) && value.nullable)
				? "?"
				: "";
		const inner = new Set(stack).add(value);
		if (schema.enum) return `${this.enumType(name, schema.enum)}${nullable}`;
		if (schema.type === "array")
			return `${this.type(schema.items, depth, inner)}[]${nullable}`;
		const variants = schema.properties
			? undefined
			: (schema.oneOf ?? schema.anyOf);
		if (variants) {
			const union = variants.map((v) => this.type(v, depth, inner)).join(" | ");
			return nullable ? `(${union})?` : union;
		}
		const object = this.context.fields(schema);
		if (object) {
			if (!name) return `object${nullable}`;
			if (this.context.filters.has(name)) {
				// Described on its resource's page, unless that is this page.
				const owner = this.context.filterPages.get(name);
				if (owner && !this.described.has(name))
					return `${name} (filter of ${owner})${nullable}`;
				if (!this.described.has(name) && depth < MAX_DEPTH) {
					this.described.add(name);
					this.queue.push({ name, schema: value, depth });
				}
				return `${name}${nullable}`;
			}
			if (this.described.has(name)) return `${name}${nullable}`;
			if (this.summarizable(object.props))
				return `${name} {${Object.keys(object.props).join(", ")}}${nullable}`;
			if (depth < MAX_DEPTH) {
				this.described.add(name);
				this.queue.push({ name, schema: value, depth });
			}
			return `${name}${nullable}`;
		}
		if (typeof schema.additionalProperties === "object")
			return `map<string, ${this.type(schema.additionalProperties, depth, inner)}>${nullable}`;
		if (schema.additionalProperties === true || schema.type === "object")
			return `object${nullable}`;
		return `${scalar(schema)}${nullable}`;
	}

	private enumType(name: string | undefined, values: unknown[]): string {
		const inline = values.map(String).join("|");
		if (
			!name ||
			(values.length <= ENUM_INLINE_MAX && inline.length <= ENUM_INLINE_CHARS)
		)
			return inline;
		this.enums.set(name, values);
		return name;
	}

	/** Only scalar fields, few enough to name inline. */
	private summarizable(props: Record<string, Schema>): boolean {
		const entries = Object.values(props);
		return (
			entries.length > 0 &&
			entries.length <= SUMMARY_MAX_FIELDS &&
			entries.every((prop) => {
				const s = this.context.unwrap(prop);
				return (
					!!s &&
					(!!s.enum ||
						(s.type !== "array" &&
							s.type !== "object" &&
							!s.properties &&
							!s.allOf &&
							!s.oneOf &&
							!s.anyOf &&
							s.additionalProperties === undefined))
				);
			})
		);
	}

	/**
	 * An object's fields, one line each: `name`*: type [tag] — notes.
	 * Inline objects nest below their field, indented.
	 */
	fieldLines(
		schema: SchemaObject,
		depth: number,
		tag: (field: string) => string = () => "",
		indent = "",
	): string[] {
		const object = this.context.fields(schema);
		if (!object) return [];
		const lines: string[] = [];
		for (const [key, prop] of Object.entries(object.props)) {
			const required = object.required.includes(key) ? "*" : "";
			const type = this.type(prop, depth);
			const fieldTag = tag(key);
			const notes = this.notes(prop);
			lines.push(
				`${indent}- ${code(key)}${required}: ${type}${fieldTag ? ` [${fieldTag}]` : ""}${notes ? ` — ${notes}` : ""}`,
			);
			// An inline object (or a list of them) is spelled out under its field.
			const resolved = this.context.unwrap(prop);
			const item =
				resolved?.type === "array"
					? this.context.unwrap(resolved.items)
					: resolved;
			const itemValue = resolved?.type === "array" ? resolved.items : prop;
			if (
				item &&
				itemValue &&
				!this.context.refName(itemValue) &&
				this.context.fields(item) &&
				depth < MAX_DEPTH
			)
				lines.push(
					...this.fieldLines(item, depth + 1, () => "", `${indent}  `),
				);
		}
		return lines;
	}

	/** A field's own description and constraints, on one line. */
	notes(value: Schema): string {
		// The field's own description, not that of the schema it refers to.
		const own = oneLine((value as { description?: string }).description);
		const s = this.context.unwrap(value);
		const constraints = s
			? (
					[
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
					] as const
				)
					.filter((key) => s[key] !== undefined)
					.map((key) => `${key}: ${JSON.stringify(s[key])}`)
			: [];
		return [own, ...constraints].filter(Boolean).join("; ");
	}

	/** The described objects and long enums, for the end of the page. */
	definitions(): string {
		const parts: string[] = [];
		for (let i = 0; i < this.queue.length; i++) {
			const { name, schema, depth } = this.queue[i] as (typeof this.queue)[0];
			const s = this.context.unwrap(schema);
			if (!s) continue;
			const family = this.context.filters.get(name);
			if (family) {
				parts.push(
					[
						`### ${name}`,
						`A filter on ${code(family.base)} (see Filters in SKILL.md):`,
						...family.fields.map(
							(f) =>
								`- ${code(f.name)} [${filterTag(f.operators, f.relation)}]`,
						),
					].join("\n"),
				);
				continue;
			}
			const lines = [`### ${name}`];
			if (s.description) lines.push(oneLine(s.description));
			lines.push(...this.fieldLines(s, depth + 1));
			parts.push(lines.join("\n"));
		}
		if (this.enums.size)
			parts.push(
				[
					"## Enums",
					...[...this.enums].map(
						([name, values]) => `- ${name}: ${values.map(String).join(" | ")}`,
					),
				].join("\n"),
			);
		return parts.join("\n\n");
	}
}

// ── What every operation has in common ─────────────────────────────────────

interface OperationParts {
	params: ParameterObject[];
	security: string;
	errors: [string, string, Schema | undefined][];
}

function partsOf(
	context: CompactContext,
	op: OperationDocument,
): OperationParts {
	const raw = context.operation(op);
	const params = new Map<string, ParameterObject>();
	for (const value of [
		...(context.spec.paths[op.path]?.parameters ?? []),
		...(raw.parameters ?? []),
	]) {
		const param = context.resolve<ParameterObject>(value);
		if (param) params.set(`${param.in}:${param.name}`, param);
	}
	const errors: OperationParts["errors"] = [];
	for (const [status, value] of Object.entries(raw.responses)) {
		if (/^2\d\d$/.test(status)) continue;
		const response = context.resolve<ResponseObject>(value);
		const media = Object.values(response?.content ?? {})[0];
		errors.push([status, oneLine(response?.description), media?.schema]);
	}
	return {
		params: [...params.values()],
		security: JSON.stringify(raw.security ?? context.spec.security ?? []),
		errors,
	};
}

/** The value most operations share, when at least two share it. */
function mostCommon<T>(
	values: T[],
	key: (value: T) => string,
): string | undefined {
	const counts = new Map<string, number>();
	for (const value of values) {
		const k = key(value);
		counts.set(k, (counts.get(k) ?? 0) + 1);
	}
	let best: string | undefined;
	let bestCount = 1;
	for (const [k, count] of counts)
		if (count > bestCount) {
			best = k;
			bestCount = count;
		}
	return best;
}

interface Common {
	params?: string;
	security?: string;
	errors?: string;
}

const paramsKey = (params: ParameterObject[]) => JSON.stringify(params);
const errorsKey = (errors: OperationParts["errors"]) => JSON.stringify(errors);

function paramLines(page: CompactPage, params: ParameterObject[]): string[] {
	return params.map((p) => {
		const notes = oneLine(p.description);
		return `- ${code(p.name)}${p.required ? "*" : ""} (${p.in}): ${page.type(p.schema, 0)}${notes ? ` — ${notes}` : ""}`;
	});
}

function securityLine(security: string): string {
	const requirements = JSON.parse(security) as Record<string, string[]>[];
	if (requirements.length === 0) return "none";
	return requirements
		.map((r) =>
			Object.entries(r)
				.map(([name, scopes]) =>
					scopes.length ? `${name} (${scopes.join(", ")})` : name,
				)
				.join(" + "),
		)
		.join(", or ");
}

/** One line per error body, naming the statuses that return it. */
function errorLines(
	page: CompactPage,
	errors: OperationParts["errors"],
): string[] {
	const byBody = new Map<string, string[]>();
	for (const [status, description, schema] of errors) {
		const body = schema ? page.type(schema, 0) : "";
		const statuses = byBody.get(body) ?? [];
		statuses.push(`${status}${description ? ` ${description}` : ""}`);
		byBody.set(body, statuses);
	}
	return [...byBody].map(
		([body, statuses]) => `- ${statuses.join(", ")}${body ? `: ${body}` : ""}`,
	);
}

/**
 * What differs from the common parts, for an operation's own lines: its
 * parameters, security and errors when they are not the shared ones.
 */
function ownParts(
	page: CompactPage,
	parts: OperationParts,
	common: Common,
): string[] {
	const lines: string[] = [];
	if (parts.params.length && paramsKey(parts.params) !== common.params)
		lines.push("Parameters:", ...paramLines(page, parts.params));
	if (parts.security !== common.security && parts.security !== "[]")
		lines.push(`Security: ${securityLine(parts.security)}`);
	if (parts.errors.length && errorsKey(parts.errors) !== common.errors)
		lines.push("Errors:", ...errorLines(page, parts.errors));
	return lines;
}

// ── Pages ───────────────────────────────────────────────────────────────────

interface Success {
	status: string;
	contentType?: string;
	schema?: Schema;
	description: string;
}

function successes(context: CompactContext, op: OperationDocument): Success[] {
	const raw = context.operation(op);
	const out: Success[] = [];
	for (const [status, value] of Object.entries(raw.responses)) {
		if (!/^2\d\d$/.test(status)) continue;
		const response = context.resolve<ResponseObject>(value);
		if (!response) continue;
		const content = Object.entries(response.content ?? {});
		if (content.length === 0)
			out.push({ status, description: oneLine(response.description) });
		for (const [contentType, media] of content)
			out.push({
				status,
				contentType,
				schema: media.schema,
				description: oneLine(response.description),
			});
	}
	return out;
}

/** "a, b and c" for a short list of names. */
function names(list: string[]): string {
	return list.map(code).join(", ");
}

/**
 * The resource's main entity: what its list operations return and filter
 * on. Its fields are the heart of the page.
 */
function primaryOf(
	context: CompactContext,
	ops: OperationDocument[],
): { name: string; schema: SchemaObject; family: FilterFamily } | undefined {
	let fallback: string | undefined;
	for (const op of ops) {
		const body = Object.values(
			context.resolve(context.operation(op).requestBody)?.content ?? {},
		)[0];
		const where = context.unwrap(body?.schema)?.properties?.where;
		const family = where && context.filterFor(where);
		if (!family) continue;
		fallback ??= family.base;
		const returns = successes(context, op).some((s) => {
			const r = context.unwrap(s.schema);
			return (
				r?.type === "array" &&
				r.items !== undefined &&
				context.refName(r.items) === family.base
			);
		});
		if (returns) return withSchema(family.base);
	}
	return fallback ? withSchema(fallback) : undefined;

	function withSchema(name: string) {
		const schema = context.unwrap(context.schemas[name]);
		const family = context.filters.get(`${name}WhereInput`);
		return schema && family ? { name, schema, family } : undefined;
	}
}

/**
 * How `orderBy` is written, when its values are `<field>_ASC|_DESC`:
 * relative to the primary's scalar fields when it can be.
 */
function orderByText(
	context: CompactContext,
	orderBy: Schema,
	primary: ReturnType<typeof primaryOf>,
): string | undefined {
	const values = context.unwrap(orderBy)?.enum;
	if (!values?.length) return undefined;
	const fields = new Set<string>();
	for (const value of values) {
		const match = /^(.+)_(ASC|DESC)$/.exec(String(value));
		if (!match) return undefined;
		fields.add(match[1] as string);
	}
	const base = "`<field>_ASC` or `<field>_DESC`";
	const all = `${base}, for ${names([...fields])}`;
	if (!primary) return all;
	// Said relative to the fields below when that is shorter: usually every
	// field but the relations sorts.
	const props = context.fields(primary.schema)?.props ?? {};
	const relations = new Set(
		primary.family.fields.filter((f) => f.relation).map((f) => f.name),
	);
	if ([...fields].some((f) => !(f in props))) return all;
	const missing = Object.keys(props).filter((f) => !fields.has(f));
	const extra = missing.filter((f) => !relations.has(f));
	const skipsRelations = [...relations].every((f) => !fields.has(f));
	let relative: string;
	if (missing.length === 0) relative = `${base}, for any field below`;
	else if (skipsRelations && relations.size > 0)
		relative = `${base}, for any field below except [rel] and [rels] fields${extra.length ? ` and ${names(extra)}` : ""}`;
	else relative = `${base}, for any field below except ${names(missing)}`;
	return relative.length < all.length ? relative : all;
}

function resourcePage(
	context: CompactContext,
	resource: SkillDocument["resources"][0],
	common: Common,
	others: { op: OperationDocument; file: string }[],
): string {
	const page = new CompactPage(context);
	const lists = resource.operations.filter((op) =>
		context.listOperations.has(op),
	);
	const primary = primaryOf(context, lists);
	if (primary) {
		page.reserve(primary.name);
		page.reserve(`${primary.name}WhereInput`);
	}
	const parts: string[] = [];

	const description = resource.description ?? primary?.schema.description;
	if (description) parts.push(oneLine(description));

	if (lists.length) {
		// How each list operation is called. When they all take the same
		// input, it is said once above them.
		const inputs = new Map<OperationDocument, string[]>();
		for (const op of lists)
			inputs.set(op, listInput(context, page, op, primary));
		const distinct = new Set([...inputs.values()].map((v) => v.join("\n")));
		const lines = ["## List operations"];
		if (distinct.size === 1 && lists.length > 1)
			lines.push(...(inputs.get(lists[0] as OperationDocument) ?? []));
		for (const op of lists) {
			const returns = successes(context, op)
				.map((s) =>
					s.schema ? page.type(s.schema, 0) : s.description || s.status,
				)
				.join(" | ");
			const summary = oneLine(op.summary ?? op.description);
			lines.push(
				`- ${code(op.operationId)} ${op.method} ${code(op.path)}${returns ? ` → ${returns}` : ""}${op.deprecated ? " (deprecated)" : ""}${summary ? ` — ${summary}` : ""}`,
			);
			const own = [
				...(distinct.size === 1 && lists.length > 1
					? []
					: (inputs.get(op) ?? [])),
				...ownParts(page, partsOf(context, op), common),
			];
			lines.push(...own.map((line) => `  ${line}`));
		}
		parts.push(lines.join("\n"));
	}

	if (primary) {
		const tags = new Map(
			primary.family.fields.map((f) => [
				f.name,
				filterTag(f.operators, f.relation),
			]),
		);
		const lines = [
			`## ${primary.name}`,
			`Fields of each ${code(primary.name)}. A [tag] says how the field is filtered in \`where\` (SKILL.md); untagged fields cannot be filtered.`,
			...page.fieldLines(primary.schema, 0, (field) => tags.get(field) ?? ""),
		];
		parts.push(lines.join("\n"));
	}

	if (others.length) {
		const lines = [
			"## Other operations",
			"Each has a page: `../operations/<operationId>.md`.",
		];
		for (const { op, file } of others) {
			const summary = oneLine(op.summary);
			const elsewhere =
				file === `${toFileName(op.operationId)}.md`
					? ""
					: ` (page: ../operations/${file})`;
			lines.push(
				`- ${code(op.operationId)} ${op.method} ${code(op.path)}${op.deprecated ? " (deprecated)" : ""}${summary ? ` — ${summary}` : ""}${elsewhere}`,
			);
		}
		parts.push(lines.join("\n"));
	}

	const definitions = page.definitions();
	if (definitions) parts.push(definitions);
	return parts.join("\n\n");
}

/** The input of a list operation, as lines. */
function listInput(
	context: CompactContext,
	page: CompactPage,
	op: OperationDocument,
	primary: ReturnType<typeof primaryOf>,
): string[] {
	const raw = context.operation(op);
	const body = context.resolve(raw.requestBody);
	const shared = context.lists.get(op);
	const media = Object.values(body?.content ?? {})[0];
	const schema = context.unwrap(media?.schema);
	if (!schema) {
		// A GET collection: its query parameters are its input.
		return [];
	}
	const props = schema.properties ?? {};
	const lines: string[] = [];
	const describe = (key: string, value: Schema): string => {
		if (
			key === "where" &&
			primary &&
			context.filterFor(value)?.base === primary.name
		)
			return `${code("where")}: filter on the tagged fields below`;
		if (key === "orderBy") {
			const text = orderByText(context, value, primary);
			if (text) return `${code("orderBy")}: ${text}`;
		}
		return `${code(key)}: ${page.type(value, 0)}`;
	};
	if (shared) {
		const specific = ["where", "orderBy"].filter((k) => props[k]);
		lines.push(
			`Input: ${shared.name} (SKILL.md)${specific.length ? ", with" : ""}`,
			...specific.map((key) => `- ${describe(key, props[key] as Schema)}`),
		);
		return lines;
	}
	lines.push("Input:");
	const object = context.fields(schema);
	for (const [key, value] of Object.entries(object?.props ?? {})) {
		const required = object?.required.includes(key) ? "*" : "";
		const notes = page.notes(value);
		lines.push(
			`- ${describe(key, value).replace(code(key), `${code(key)}${required}`)}${notes ? ` — ${notes}` : ""}`,
		);
	}
	return lines;
}

function operationPage(
	context: CompactContext,
	op: OperationDocument,
	resources: { tag: string; file: string }[],
	common: Common,
): string {
	const page = new CompactPage(context);
	const raw = context.operation(op);
	const parts: string[] = [
		`${op.method} ${code(op.path)}${op.deprecated ? " (deprecated)" : ""} · ${resources.map((r) => `${r.tag} (../resources/${r.file})`).join(", ")}`,
	];
	for (const text of new Set([op.summary, op.description].map(oneLine)))
		if (text) parts.push(text);

	const own = ownParts(page, partsOf(context, op), common);
	if (own.length) parts.push(own.join("\n"));

	const body = context.resolve(raw.requestBody);
	if (body) {
		for (const [contentType, media] of Object.entries(body.content)) {
			const lines = [
				`## Input (${contentType}${body.required ? ", required" : ""})`,
			];
			if (body.description) lines.push(oneLine(body.description));
			lines.push(...topLevel(context, page, media.schema));
			parts.push(lines.join("\n"));
		}
	}
	for (const success of successes(context, op)) {
		const lines = [
			`## Returns ${success.status}${success.contentType ? ` (${success.contentType})` : ""}`,
		];
		if (success.description) lines.push(success.description);
		if (success.schema) lines.push(...topLevel(context, page, success.schema));
		parts.push(lines.join("\n"));
	}
	const definitions = page.definitions();
	if (definitions) parts.push(definitions);
	return parts.join("\n\n");
}

/**
 * A body or a response at the top of a page: an object's fields directly,
 * a list as "List of" its item, anything else as its type.
 */
function topLevel(
	context: CompactContext,
	page: CompactPage,
	schema: Schema | undefined,
): string[] {
	const resolved = context.unwrap(schema);
	if (!schema || !resolved) return [page.type(schema, 0)];
	const isList = resolved.type === "array";
	const item = isList ? resolved.items : schema;
	const itemSchema = context.unwrap(item);
	const name = item && context.refName(item);
	if (
		item &&
		itemSchema &&
		context.fields(itemSchema) &&
		!(name && context.filters.has(name))
	) {
		if (name) page.reserve(name);
		const head = isList
			? `List of ${name ?? "objects"}:`
			: name
				? `${name}:`
				: "";
		return [...(head ? [head] : []), ...page.fieldLines(itemSchema, 0)];
	}
	return [page.type(schema, 0)];
}

function skillBody(
	context: CompactContext,
	doc: SkillDocument,
	common: Common,
	commonParts: OperationParts | undefined,
	resources: string[],
	hasOperationPages: boolean,
): string {
	const page = new CompactPage(context);
	const parts: string[] = [];
	if (doc.meta.description) parts.push(doc.meta.description);

	parts.push(
		[
			"## Reading this skill",
			`Each resource page has the resource's list operations, the fields of what they return, and how each field can be filtered.${hasOperationPages ? " Other operations have a page each, under `references/operations/`." : ""}`,
			"In types, `T?` may be null, `T[]` is a list, `a|b|c` lists the allowed values, and `Name {a, b}` is an object with just those keys. `*` marks a required key. A named object is described once per page, under its own heading.",
		].join("\n"),
	);

	if (doc.meta.servers.length)
		parts.push(
			[
				"## Base URL",
				...doc.meta.servers.map(
					(s) =>
						`- ${code(s.url)}${s.description ? ` — ${s.description}` : ""}`,
				),
			].join("\n"),
		);
	if (doc.authSchemes.length)
		parts.push(
			"## Authentication\nSee [authentication](references/authentication.md) for credentials and scopes.",
		);

	if (commonParts) {
		const lines = [
			"## Every operation",
			"Unless its own entry says otherwise:",
		];
		if (common.params)
			lines.push("Parameters:", ...paramLines(page, commonParts.params));
		if (common.security)
			lines.push(`Security: ${securityLine(commonParts.security)}`);
		if (common.errors)
			lines.push("Errors:", ...errorLines(page, commonParts.errors));
		if (lines.length > 2) parts.push(lines.join("\n"));
	}

	for (const shape of new Set(context.lists.values())) {
		const object = context.fields(shape.schema);
		const lines = [
			`## ${shape.name}`,
			"The input of the list operations that name it.",
		];
		for (const [key, value] of Object.entries(object?.props ?? {})) {
			const required = object?.required.includes(key) ? "*" : "";
			const notes = page.notes(value);
			const type =
				key === "where"
					? "the resource's filter (see Filters)"
					: key === "orderBy"
						? "the resource's sort order (on its page)"
						: page.type(value, 0);
			lines.push(
				`- ${code(key)}${required}: ${type}${notes ? ` — ${notes}` : ""}`,
			);
		}
		parts.push(lines.join("\n"));
	}

	if (context.filters.size) {
		const used = new Set<string>();
		for (const family of context.filters.values())
			for (const field of family.fields)
				used.add(filterTag(field.operators, field.relation));
		const classes = FILTER_CLASSES.filter((c) => used.has(c.name));
		const lines = [
			"## Filters",
			'`where` is a flat object: each key is a field name, alone for equality or with a suffix, and its value is a plain value (a list for `_in`). Write `{"name_contains": "x"}`, never `{"name": {"contains": "x"}}`. All keys in one object must match; `AND`, `OR` and `NOT` each take a list of filter objects.',
		];
		if (classes.length)
			lines.push(
				"Each filterable field on a resource page is tagged with the suffixes it takes:",
				...classes.map((c) => `- \`${c.name}\`: ${c.meaning}`),
			);
		lines.push(
			"A tag of suffixes, like `[= _in]`, lists them directly (`=` is equality).",
		);
		parts.push(lines.join("\n"));
	}

	parts.push(["## Resources", ...resources].join("\n"));
	const definitions = page.definitions();
	if (definitions) parts.push(definitions);
	return parts.join("\n\n");
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
	const fileOf = (path: string) => path.split("/").pop() as string;
	function render(path: string, page: CompactPageDocument): void {
		files.set(path, renderer.renderCompactPage?.(page) ?? "");
	}

	// Parameters, security and errors most operations share are stated once.
	const allOps = [
		...new Set(doc.resources.flatMap((resource) => resource.operations)),
	];
	const allParts = allOps.map((op) => partsOf(context, op));
	const common: Common = {
		params: mostCommon(
			allParts.filter((p) => p.params.length),
			(p) => paramsKey(p.params),
		),
		security: mostCommon(
			allParts.filter((p) => p.security !== "[]"),
			(p) => p.security,
		),
		errors: mostCommon(
			allParts.filter((p) => p.errors.length),
			(p) => errorsKey(p.errors),
		),
	};
	const commonParts: OperationParts = {
		params:
			allParts.find((p) => paramsKey(p.params) === common.params)?.params ?? [],
		security: common.security ?? "[]",
		errors:
			allParts.find((p) => errorsKey(p.errors) === common.errors)?.errors ?? [],
	};

	// Files first, so pages can name each other.
	const resourceFiles = new Map(
		doc.resources.map((r) => [r, allocate("references/resources", r.tag)]),
	);
	const operationFiles = new Map<
		string,
		{
			path: string;
			op: OperationDocument;
			resources: { tag: string; file: string }[];
		}
	>();
	for (const resource of doc.resources) {
		for (const op of resource.operations) {
			if (context.listOperations.has(op)) continue;
			const key = `${op.method} ${op.path}`;
			let entry = operationFiles.get(key);
			if (!entry) {
				entry = {
					path: allocate("references/operations", op.operationId),
					op,
					resources: [],
				};
				operationFiles.set(key, entry);
			}
			entry.resources.push({
				tag: resource.tag,
				file: fileOf(resourceFiles.get(resource) as string),
			});
		}
	}

	// Each resource page describes its main entity's filter; elsewhere the
	// filter is named with the resource it belongs to.
	const primaries = new Map(
		doc.resources.map((resource) => [
			resource,
			primaryOf(
				context,
				resource.operations.filter((op) => context.listOperations.has(op)),
			),
		]),
	);
	for (const [resource, primary] of primaries)
		if (primary && !context.filterPages.has(`${primary.name}WhereInput`))
			context.filterPages.set(`${primary.name}WhereInput`, resource.tag);

	const index: string[] = [];
	for (const resource of doc.resources) {
		const path = resourceFiles.get(resource) as string;
		const others = resource.operations
			.filter((op) => !context.listOperations.has(op))
			.map((op) => ({
				op,
				file: fileOf(
					operationFiles.get(`${op.method} ${op.path}`)?.path as string,
				),
			}));
		render(path, {
			kind: "resource",
			title: resource.tag,
			body: resourcePage(context, resource, common, others),
		});
		const about = firstSentence(
			resource.description ?? primaries.get(resource)?.schema.description,
		);
		index.push(`- [${resource.tag}](${path})${about ? ` — ${about}` : ""}`);
	}
	for (const entry of operationFiles.values())
		render(entry.path, {
			kind: "operation",
			title: entry.op.operationId,
			body: operationPage(context, entry.op, entry.resources, common),
		});

	if (doc.authSchemes.length)
		files.set(
			"references/authentication.md",
			renderer.renderAuthentication(doc.authSchemes),
		);
	render("SKILL.md", {
		kind: "skill",
		title: doc.meta.title,
		meta: doc.meta,
		body: skillBody(
			context,
			doc,
			common,
			allOps.length ? commonParts : undefined,
			index,
			operationFiles.size > 0,
		),
	});
	for (const [path, content] of files) {
		await writer.mkdir(dirname(join(root, path)));
		await writer.writeFile(join(root, path), content);
	}
}
