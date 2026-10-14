import type {
	CaseStrategy,
	GroupByStrategy,
	Layout,
	OpenAPISpec,
} from "./types.js";

const VALID_GROUP_BY: GroupByStrategy[] = ["tags", "path", "auto"];
const VALID_CASE_STRATEGIES: CaseStrategy[] = ["lowercase"];

interface CLIArgs {
	spec: OpenAPISpec;
	groupBy: string;
	caseStrategy?: string;
	layout?: string;
}

interface ValidatedOptions {
	groupBy: GroupByStrategy;
	caseStrategy?: CaseStrategy;
	layout?: Layout;
}

export function validateSpec(spec: OpenAPISpec): string | null {
	if (!spec.openapi) return 'Invalid OpenAPI spec: missing "openapi" field';
	if (!spec.info?.title)
		return 'Invalid OpenAPI spec: missing "info.title" field';
	if (!spec.paths) return 'Invalid OpenAPI spec: missing "paths" field';
	return null;
}

export function validateGroupBy(value: string): GroupByStrategy {
	if (!VALID_GROUP_BY.includes(value as GroupByStrategy)) {
		throw new Error(
			`Invalid --group-by value: ${value}. Must be ${VALID_GROUP_BY.map((v) => `'${v}'`).join(", ")}.`,
		);
	}
	return value as GroupByStrategy;
}

export function validateCaseStrategy(
	value: string | undefined,
): CaseStrategy | undefined {
	if (!value) return undefined;
	if (!VALID_CASE_STRATEGIES.includes(value as CaseStrategy)) {
		throw new Error(
			`Invalid --case-strategy value: ${value}. Must be ${VALID_CASE_STRATEGIES.map((v) => `'${v}'`).join(", ")}.`,
		);
	}
	return value as CaseStrategy;
}

/**
 * Validate spec and all CLI args at once. Returns validated options or throws.
 */
export function validateArgs(args: CLIArgs): ValidatedOptions {
	const specError = validateSpec(args.spec);
	if (specError) throw new Error(specError);

	return {
		groupBy: validateGroupBy(args.groupBy),
		caseStrategy: validateCaseStrategy(args.caseStrategy),
		...(args.layout === undefined
			? {}
			: { layout: validateLayout(args.layout) }),
	};
}

export function validateLayout(value: string): Layout {
	if (value !== "default" && value !== "compact") {
		throw new Error(
			`Invalid --layout value: ${value}. Must be 'default', 'compact'.`,
		);
	}
	return value;
}
