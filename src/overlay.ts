import type { OpenAPISpec } from "./types.js";

/**
 * An OpenAPI Overlay 1.0 document: a list of edits applied to a spec before
 * it is converted. Use it to add descriptions the spec lacks, or to remove
 * paths and schemas from the output.
 * https://spec.openapis.org/overlay/v1.0.0.html
 */
export interface OverlayDocument {
	overlay: string;
	info?: { title?: string; version?: string };
	actions: OverlayAction[];
}

export interface OverlayAction {
	/** JSONPath to the nodes the action applies to. */
	target: string;
	description?: string;
	/** Merged into each target: objects recursively, arrays appended. */
	update?: unknown;
	/** Removes each target from its parent. */
	remove?: boolean;
}

/**
 * The JSONPath this supports, which covers the usual overlay targets:
 *
 *   $.paths['/pets'].get        names, dotted or bracketed and quoted
 *   $.components.schemas.*      every member
 *   $.servers[0]                an array index
 *   $.tags[?(@.name == 'pets')] members whose key equals a string, number or boolean
 *
 * Anything else is rejected rather than guessed at.
 */
type Segment =
	| { kind: "name"; name: string }
	| { kind: "index"; index: number }
	| { kind: "wildcard" }
	| { kind: "filter"; key: string; value: unknown };

/** A matched node, located by its parent and the key it has there. */
interface Match {
	parent: Record<string | number, unknown>;
	key: string | number;
}

export function parseJsonPath(path: string): Segment[] {
	if (!path.startsWith("$"))
		throw new Error(`Overlay target must start with "$": ${path}`);
	const segments: Segment[] = [];
	let i = 1;
	const fail = (): never => {
		throw new Error(`Unsupported overlay target at offset ${i}: ${path}`);
	};
	while (i < path.length) {
		if (path[i] === ".") {
			i += 1;
			if (path[i] === "*") {
				segments.push({ kind: "wildcard" });
				i += 1;
				continue;
			}
			const match = /^[A-Za-z_$][\w$-]*/.exec(path.slice(i));
			if (!match) fail();
			const name = (match as RegExpExecArray)[0];
			segments.push({ kind: "name", name });
			i += name.length;
			continue;
		}
		if (path[i] !== "[") fail();
		const close = findClose(path, i);
		if (close < 0) fail();
		segments.push(parseBracket(path.slice(i + 1, close).trim(), path));
		i = close + 1;
	}
	return segments;
}

// The closing bracket, skipping any inside quotes.
function findClose(path: string, open: number): number {
	let quote = "";
	for (let i = open + 1; i < path.length; i++) {
		const ch = path[i];
		if (quote) {
			if (ch === "\\") i += 1;
			else if (ch === quote) quote = "";
		} else if (ch === "'" || ch === '"') quote = ch;
		else if (ch === "]") return i;
	}
	return -1;
}

function parseBracket(inner: string, path: string): Segment {
	if (inner === "*") return { kind: "wildcard" };
	if (/^\d+$/.test(inner)) return { kind: "index", index: Number(inner) };
	const quoted = parseQuoted(inner);
	if (quoted !== undefined) return { kind: "name", name: quoted };
	const filter = /^\?\(?\s*@\.([A-Za-z_$][\w$-]*)\s*==\s*(.+?)\s*\)?$/.exec(
		inner,
	);
	if (filter) {
		const literal = filter[2] as string;
		const value =
			parseQuoted(literal) ??
			(literal === "true"
				? true
				: literal === "false"
					? false
					: /^-?\d+(\.\d+)?$/.test(literal)
						? Number(literal)
						: undefined);
		if (value !== undefined)
			return { kind: "filter", key: filter[1] as string, value };
	}
	throw new Error(`Unsupported overlay target segment [${inner}]: ${path}`);
}

function parseQuoted(text: string): string | undefined {
	const quote = text[0];
	if ((quote !== "'" && quote !== '"') || text.at(-1) !== quote)
		return undefined;
	return text.slice(1, -1).replace(/\\(.)/g, "$1");
}

function isContainer(
	value: unknown,
): value is Record<string | number, unknown> {
	return typeof value === "object" && value !== null;
}

// `holder.$` is the root, so that "$" itself is a match with a parent.
function select(holder: { $: unknown }, segments: Segment[]): Match[] {
	let matches: Match[] = [{ parent: holder, key: "$" }];
	for (const segment of segments) {
		const next: Match[] = [];
		for (const { parent, key } of matches) {
			const node = parent[key];
			if (!isContainer(node)) continue;
			const keys: (string | number)[] = Array.isArray(node)
				? node.map((_, index) => index)
				: Object.keys(node);
			for (const child of keys) {
				const value = node[child];
				const hit =
					segment.kind === "wildcard" ||
					(segment.kind === "name" && child === segment.name) ||
					(segment.kind === "index" && child === segment.index) ||
					(segment.kind === "filter" &&
						isContainer(value) &&
						value[segment.key] === segment.value);
				if (hit) next.push({ parent: node, key: child });
			}
		}
		matches = next;
	}
	return matches;
}

function merge(target: unknown, update: unknown): unknown {
	if (Array.isArray(target) && Array.isArray(update))
		return [...target, ...update];
	if (
		isContainer(target) &&
		isContainer(update) &&
		!Array.isArray(target) &&
		!Array.isArray(update)
	) {
		const result: Record<string, unknown> = { ...target };
		for (const [key, value] of Object.entries(update))
			result[key] = key in result ? merge(result[key], value) : value;
		return result;
	}
	return update;
}

/**
 * Apply overlays in order and return the edited spec. The input is not
 * modified. An action whose target matches nothing is an error: it usually
 * means the spec changed under the overlay.
 */
export function applyOverlays(
	spec: OpenAPISpec,
	overlays: OverlayDocument[],
): OpenAPISpec {
	const holder = { $: structuredClone(spec) as unknown };
	for (const overlay of overlays) {
		if (!overlay || !Array.isArray(overlay.actions))
			throw new Error("Overlay document must have an actions array");
		for (const action of overlay.actions) {
			const matches = select(holder, parseJsonPath(action.target));
			if (matches.length === 0)
				throw new Error(`Overlay target matched nothing: ${action.target}`);
			if (action.remove) {
				// Remove from the end so array indexes stay valid.
				for (const { parent, key } of [...matches].reverse()) {
					if (Array.isArray(parent)) parent.splice(key as number, 1);
					else delete parent[key];
				}
				continue;
			}
			if (action.update === undefined) continue;
			for (const { parent, key } of matches)
				parent[key] = merge(parent[key], action.update);
		}
	}
	return holder.$ as OpenAPISpec;
}
