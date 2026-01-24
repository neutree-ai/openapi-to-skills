import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	createRenderer,
	extractSchemaPrefix,
	TemplateRenderer,
	toFileName,
} from "./renderer.js";

// =============================================================================
// toFileName
// =============================================================================

describe("toFileName", () => {
	test("converts to lowercase", () => {
		expect(toFileName("UserProfile")).toBe("userprofile");
	});

	test("replaces spaces with hyphens", () => {
		expect(toFileName("User Profile")).toBe("user-profile");
	});

	test("removes special characters", () => {
		expect(toFileName("User@Profile!")).toBe("user-profile");
	});

	test("collapses multiple hyphens", () => {
		expect(toFileName("User---Profile")).toBe("user-profile");
	});

	test("trims leading and trailing hyphens", () => {
		expect(toFileName("--User--")).toBe("user");
	});

	test("handles mixed special characters", () => {
		expect(toFileName("My Awesome API!")).toBe("my-awesome-api");
	});
});

// =============================================================================
// extractSchemaPrefix
// =============================================================================

describe("extractSchemaPrefix", () => {
	test("extracts PascalCase prefix", () => {
		expect(extractSchemaPrefix("UserProfile")).toBe("User");
		expect(extractSchemaPrefix("UserInput")).toBe("User");
		expect(extractSchemaPrefix("User")).toBe("User");
	});

	test("extracts underscore prefix", () => {
		expect(extractSchemaPrefix("user_profile")).toBe("user");
		expect(extractSchemaPrefix("pet_status")).toBe("pet");
	});

	test("returns full name when no underscore", () => {
		// No PascalCase match + no underscore = entire string is the prefix
		expect(extractSchemaPrefix("123abc")).toBe("123abc");
		expect(extractSchemaPrefix("API")).toBe("API");
	});

	test("returns Other for empty string", () => {
		expect(extractSchemaPrefix("")).toBe("Other");
	});
});

// =============================================================================
// TemplateRenderer - constructor
// =============================================================================

describe("TemplateRenderer constructor", () => {
	test("throws when custom template dir not found", () => {
		expect(() => {
			new TemplateRenderer("/nonexistent/path");
		}).toThrow("Custom templates directory not found");
	});

	test("creates renderer with default templates", () => {
		const renderer = createRenderer();
		expect(renderer).toBeInstanceOf(TemplateRenderer);
	});
});

// =============================================================================
// TemplateRenderer - template fallback
// =============================================================================

describe("TemplateRenderer template fallback", () => {
	const testDir = join(import.meta.dir, "../.test-templates");

	beforeAll(() => {
		mkdirSync(testDir, { recursive: true });
	});

	afterAll(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	test("uses custom template when exists", () => {
		// Create a custom skill template
		writeFileSync(join(testDir, "skill.md.eta"), "CUSTOM: <%= it.meta.name %>");

		const renderer = new TemplateRenderer(testDir);
		const result = renderer.renderSkill({
			meta: {
				name: "test-api",
				title: "Test",
				description: "",
				version: "1.0.0",
				openapiVersion: "3.0.0",
				servers: [],
				securitySchemes: [],
			},
			resources: [],
			schemaGroups: [],
			authSchemes: [],
		});

		expect(result).toBe("CUSTOM: test-api");
	});

	test("falls back to default when custom template missing", () => {
		// testDir exists but has no resource.md.eta
		const renderer = new TemplateRenderer(testDir);
		const result = renderer.renderResource({
			tag: "users",
			operations: [],
		});

		// Should use default template, which includes "# users"
		expect(result).toContain("# users");
	});
});
