import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { filterSchemaNames } from "./compact.js";
import type {
	OpenAPISpec,
	OperationObject,
	ParameterObject,
	ReferenceObject,
	RequestBodyObject,
	SchemaObject,
	SkillDocument,
	Writer,
} from "./types.js";
import { isReferenceObject } from "./types.js";

// runtime/ sits next to templates/, in the repository and in dist.
const RUNTIME_DIR = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"runtime",
);
const SCHEMA_PREFIX = "#/components/schemas/";

/** A schema reduced to what the validator checks. */
export interface ValidatorType {
	ref?: string;
	type?: string;
	nullable?: boolean;
	enum?: unknown[];
	items?: ValidatorType;
	props?: Record<string, ValidatorType>;
	required?: string[];
	/** No keys beyond `props` are accepted. */
	closed?: boolean;
	/** The type of keys beyond `props`, when the schema gives one. */
	values?: ValidatorType;
	oneOf?: ValidatorType[];
}

export interface ValidatorOperation {
	method: string;
	path: string;
	body?: ValidatorType;
	bodyRequired?: boolean;
	/** For an operation without a body: its parameters, as one object. */
	params?: { props: Record<string, ValidatorType>; required: string[] };
}

export interface ValidatorData {
	operations: Record<string, ValidatorOperation>;
	schemas: Record<string, ValidatorType>;
	/** Schemas recognized as filter inputs, for better hints. */
	filters: string[];
}

function lookup(spec: OpenAPISpec, ref: string): unknown {
	if (!ref.startsWith("#/")) return undefined;
	let target: unknown = spec;
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

function resolve<T>(
	spec: OpenAPISpec,
	value: T | ReferenceObject | undefined,
): T | undefined {
	const seen = new Set<string>();
	let current: unknown = value;
	while (isReferenceObject(current)) {
		if (seen.has(current.$ref)) return undefined;
		seen.add(current.$ref);
		current = lookup(spec, current.$ref);
	}
	return current as T | undefined;
}

function schemaName(ref: string): string | undefined {
	return ref.startsWith(SCHEMA_PREFIX)
		? decodeURIComponent(ref.slice(SCHEMA_PREFIX.length))
				.replace(/~1/g, "/")
				.replace(/~0/g, "~")
		: undefined;
}

/** Build what tools/validate.mjs checks calls against. */
export function buildValidatorData(
	spec: OpenAPISpec,
	doc: SkillDocument,
): ValidatorData {
	const schemas: Record<string, ValidatorType> = {};
	const pending: string[] = [];

	function reduce(
		value: SchemaObject | ReferenceObject | undefined,
		depth = 0,
	): ValidatorType {
		if (!value || depth > 64) return {};
		if (isReferenceObject(value)) {
			const name = schemaName(value.$ref);
			if (name !== undefined) {
				if (!(name in schemas)) {
					schemas[name] = {};
					pending.push(name);
				}
				return { ref: name };
			}
			return reduce(resolve<SchemaObject>(spec, value), depth + 1);
		}
		const s = value;
		const out: ValidatorType = {};
		if (s.nullable) out.nullable = true;
		const variants = s.oneOf ?? s.anyOf;
		if (variants && !s.properties) {
			out.oneOf = variants.map((v) => reduce(v, depth + 1));
			return out;
		}
		if (s.allOf) {
			// A single reference, perhaps marked nullable, is that schema.
			if (s.allOf.length === 1 && !s.properties && !s.type) {
				const inner = reduce(s.allOf[0], depth + 1);
				return s.nullable ? { ...inner, nullable: true } : inner;
			}
			// Otherwise the parts are merged into one object.
			const merged: ValidatorType = { type: "object", props: {}, required: [] };
			for (const part of [...s.allOf, { ...s, allOf: undefined }]) {
				const reduced = resolveReduced(reduce(part as SchemaObject, depth + 1));
				Object.assign(merged.props ?? {}, reduced.props);
				merged.required?.push(...(reduced.required ?? []));
				if (reduced.closed) merged.closed = true;
			}
			return { ...merged, ...(s.nullable ? { nullable: true } : {}) };
		}
		if (s.enum) {
			out.enum = s.enum;
			return out;
		}
		if (s.type === "array") {
			out.type = "array";
			out.items = reduce(s.items, depth + 1);
			return out;
		}
		if (
			s.type === "object" ||
			s.properties ||
			s.additionalProperties !== undefined
		) {
			out.type = "object";
			if (s.properties) {
				out.props = {};
				for (const [key, prop] of Object.entries(s.properties))
					out.props[key] = reduce(prop, depth + 1);
			}
			if (s.required?.length) out.required = s.required;
			if (s.additionalProperties === false) out.closed = true;
			else if (typeof s.additionalProperties === "object")
				out.values = reduce(s.additionalProperties, depth + 1);
			return out;
		}
		if (s.type) out.type = s.type;
		return out;
	}

	// The object a reduced type stands for, following references.
	function resolveReduced(type: ValidatorType): ValidatorType {
		const seen = new Set<string>();
		let current = type;
		while (current.ref && !seen.has(current.ref)) {
			seen.add(current.ref);
			const name = current.ref;
			// Fill a referenced schema now if it is still pending.
			if (pending.includes(name)) fill(name);
			current = schemas[name] ?? {};
		}
		return current;
	}

	function fill(name: string): void {
		const index = pending.indexOf(name);
		if (index >= 0) pending.splice(index, 1);
		const raw = spec.components?.schemas?.[name];
		schemas[name] = reduce(raw);
	}

	const operations: Record<string, ValidatorOperation> = {};
	for (const resource of doc.resources) {
		for (const op of resource.operations) {
			if (op.operationId in operations) continue;
			const item = spec.paths[op.path];
			const raw = item?.[op.method.toLowerCase() as "get"] as
				| OperationObject
				| undefined;
			if (!raw) continue;
			const entry: ValidatorOperation = { method: op.method, path: op.path };
			const body = resolve<RequestBodyObject>(spec, raw.requestBody);
			const media =
				body?.content?.["application/json"] ??
				Object.values(body?.content ?? {})[0];
			if (body && media) {
				entry.body = reduce(media.schema);
				if (body.required) entry.bodyRequired = true;
			} else {
				const params = new Map<string, ParameterObject>();
				for (const value of [
					...(item?.parameters ?? []),
					...(raw.parameters ?? []),
				]) {
					const param = resolve<ParameterObject>(spec, value);
					if (param && param.in !== "header" && param.in !== "cookie")
						params.set(param.name, param);
				}
				if (params.size) {
					entry.params = { props: {}, required: [] };
					for (const [name, param] of params) {
						entry.params.props[name] = reduce(param.schema);
						if (param.required) entry.params.required.push(name);
					}
				}
			}
			operations[op.operationId] = entry;
		}
	}
	while (pending.length) fill(pending[0] as string);

	const filters = filterSchemaNames(spec, doc).filter(
		(name) => name in schemas,
	);
	return { operations, schemas, filters };
}

export async function writeValidator(
	spec: OpenAPISpec,
	doc: SkillDocument,
	skillDir: string,
	writer: Writer,
): Promise<void> {
	const tools = join(skillDir, "tools");
	await writer.mkdir(tools);
	await writer.writeFile(
		join(tools, "validate-data.json"),
		JSON.stringify(buildValidatorData(spec, doc)),
	);
	await writer.writeFile(
		join(tools, "validate.mjs"),
		await readFile(join(RUNTIME_DIR, "validate.mjs"), "utf-8"),
	);
}
