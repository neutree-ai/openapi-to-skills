import { describe, expect, test } from "bun:test";
import type { OpenAPISpec } from "./types.js";
import {
	validateArgs,
	validateCaseStrategy,
	validateGroupBy,
	validateLayout,
	validateSpec,
} from "./validate.js";

// =============================================================================
// validateSpec
// =============================================================================

describe("validateSpec", () => {
	function createMinimalSpec(
		overrides: Record<string, unknown> = {},
	): OpenAPISpec {
		return {
			openapi: "3.0.0",
			info: { title: "Test API", version: "1.0.0" },
			paths: {},
			...overrides,
		} as OpenAPISpec;
	}

	test("returns null for valid spec", () => {
		expect(validateSpec(createMinimalSpec())).toBeNull();
	});

	test("returns error when openapi field is missing", () => {
		const spec = createMinimalSpec({ openapi: "" });
		expect(validateSpec(spec)).toContain('"openapi"');
	});

	test("returns error when info.title is missing", () => {
		const spec = createMinimalSpec({ info: { version: "1.0.0" } });
		expect(validateSpec(spec)).toContain('"info.title"');
	});

	test("returns error when paths is missing", () => {
		const spec = createMinimalSpec({ paths: undefined });
		expect(validateSpec(spec)).toContain('"paths"');
	});

	test("returns first error only", () => {
		const spec = { info: {}, paths: {} } as unknown as OpenAPISpec;
		expect(validateSpec(spec)).toContain('"openapi"');
	});
});

// =============================================================================
// validateGroupBy
// =============================================================================

describe("validateGroupBy", () => {
	test("accepts 'tags'", () => {
		expect(validateGroupBy("tags")).toBe("tags");
	});

	test("accepts 'path'", () => {
		expect(validateGroupBy("path")).toBe("path");
	});

	test("accepts 'auto'", () => {
		expect(validateGroupBy("auto")).toBe("auto");
	});

	test("throws on invalid value", () => {
		expect(() => validateGroupBy("invalid")).toThrow("--group-by");
	});
});

// =============================================================================
// validateCaseStrategy
// =============================================================================

describe("validateCaseStrategy", () => {
	test("returns undefined when value is undefined", () => {
		expect(validateCaseStrategy(undefined)).toBeUndefined();
	});

	test("returns undefined when value is empty string", () => {
		expect(validateCaseStrategy("")).toBeUndefined();
	});

	test("accepts 'lowercase'", () => {
		expect(validateCaseStrategy("lowercase")).toBe("lowercase");
	});

	test("throws on invalid value", () => {
		expect(() => validateCaseStrategy("UPPERCASE")).toThrow("--case-strategy");
	});
});

// =============================================================================
// validateArgs
// =============================================================================

describe("validateArgs", () => {
	const validSpec = {
		openapi: "3.0.0",
		info: { title: "Test", version: "1.0.0" },
		paths: {},
	} as OpenAPISpec;

	test("returns validated options for valid args", () => {
		const result = validateArgs({
			spec: validSpec,
			groupBy: "tags",
			caseStrategy: "lowercase",
		});
		expect(result).toEqual({ groupBy: "tags", caseStrategy: "lowercase" });
	});

	test("caseStrategy defaults to undefined when omitted", () => {
		const result = validateArgs({ spec: validSpec, groupBy: "auto" });
		expect(result).toEqual({ groupBy: "auto", caseStrategy: undefined });
	});

	test("throws on invalid spec", () => {
		const badSpec = {
			info: { title: "T" },
			paths: {},
		} as unknown as OpenAPISpec;
		expect(() => validateArgs({ spec: badSpec, groupBy: "auto" })).toThrow(
			'"openapi"',
		);
	});

	test("throws on invalid groupBy", () => {
		expect(() => validateArgs({ spec: validSpec, groupBy: "bad" })).toThrow(
			"--group-by",
		);
	});

	test("throws on invalid caseStrategy", () => {
		expect(() =>
			validateArgs({ spec: validSpec, groupBy: "auto", caseStrategy: "bad" }),
		).toThrow("--case-strategy");
	});
});

describe("validateLayout", () => {
	test.each(["default", "compact"])("accepts %s", (layout) => {
		expect(validateLayout(layout)).toBe(layout);
	});
	test("rejects an unknown layout", () => {
		expect(() => validateLayout("unknown")).toThrow("--layout");
	});
	test("passes the compact layout through argument validation", () => {
		expect(
			validateArgs({
				spec: {
					openapi: "3.0.0",
					info: { title: "Test", version: "1" },
					paths: {},
				},
				groupBy: "tags",
				layout: "compact",
			}).layout,
		).toBe("compact");
	});
});
