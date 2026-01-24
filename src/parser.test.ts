import { describe, expect, test } from "bun:test";
import { Parser } from "./parser.js";
import type { OpenAPISpec } from "./types.js";

// =============================================================================
// Test Fixtures
// =============================================================================

function createMinimalSpec(overrides: Partial<OpenAPISpec> = {}): OpenAPISpec {
	return {
		openapi: "3.0.0",
		info: {
			title: "Test API",
			version: "1.0.0",
		},
		paths: {},
		...overrides,
	};
}

// =============================================================================
// Meta Parsing
// =============================================================================

describe("Parser.parse - meta", () => {
	const parser = new Parser();

	test("extracts basic meta info", () => {
		const spec = createMinimalSpec({
			info: {
				title: "My API",
				version: "2.0.0",
				description: "A test API\nWith multiple lines",
			},
		});

		const doc = parser.parse(spec);

		expect(doc.meta.title).toBe("My API");
		expect(doc.meta.version).toBe("2.0.0");
		expect(doc.meta.openapiVersion).toBe("3.0.0");
		expect(doc.meta.description).toBe("A test API"); // first line only
	});

	test("generates skill name from title", () => {
		const spec = createMinimalSpec({
			info: { title: "My Awesome API!", version: "1.0.0" },
		});

		const doc = parser.parse(spec);

		expect(doc.meta.name).toBe("my-awesome-api");
	});

	test("uses custom skill name when provided", () => {
		const spec = createMinimalSpec();

		const doc = parser.parse(spec, { skillName: "custom-name" });

		expect(doc.meta.name).toBe("custom-name");
	});

	test("extracts servers", () => {
		const spec = createMinimalSpec({
			servers: [
				{ url: "https://api.example.com", description: "Production" },
				{ url: "https://staging.example.com" },
			],
		});

		const doc = parser.parse(spec);

		expect(doc.meta.servers).toHaveLength(2);
		expect(doc.meta.servers[0]).toEqual({
			url: "https://api.example.com",
			description: "Production",
		});
	});

	test("extracts security scheme names", () => {
		const spec = createMinimalSpec({
			components: {
				securitySchemes: {
					bearerAuth: { type: "http", scheme: "bearer" },
					apiKey: { type: "apiKey", in: "header", name: "X-API-Key" },
				},
			},
		});

		const doc = parser.parse(spec);

		expect(doc.meta.securitySchemes).toEqual(["bearerAuth", "apiKey"]);
	});
});

// =============================================================================
// Resource & Operation Parsing
// =============================================================================

describe("Parser.parse - resources", () => {
	const parser = new Parser();

	test("groups operations by tag", () => {
		const spec = createMinimalSpec({
			paths: {
				"/users": {
					get: { tags: ["users"], operationId: "getUsers", responses: {} },
					post: { tags: ["users"], operationId: "createUser", responses: {} },
				},
				"/pets": {
					get: { tags: ["pets"], operationId: "getPets", responses: {} },
				},
			},
		});

		const doc = parser.parse(spec);

		expect(doc.resources).toHaveLength(2);

		const users = doc.resources.find((r) => r.tag === "users");
		const pets = doc.resources.find((r) => r.tag === "pets");

		expect(users?.operations).toHaveLength(2);
		expect(pets?.operations).toHaveLength(1);
	});

	test("uses 'default' tag when no tags provided (auto mode)", () => {
		const spec = createMinimalSpec({
			paths: {
				"/health": {
					get: { operationId: "healthCheck", responses: {} },
				},
			},
		});

		// With 'auto' mode, no tags means it falls back to path-based grouping
		const doc = parser.parse(spec, { groupBy: "auto" });

		expect(doc.resources).toHaveLength(1);
		expect(doc.resources[0]?.tag).toBe("health");
	});

	test("uses 'default' tag when no tags provided (tags mode)", () => {
		const spec = createMinimalSpec({
			paths: {
				"/health": {
					get: { operationId: "healthCheck", responses: {} },
				},
			},
		});

		// With 'tags' mode, no tags means it falls back to 'default'
		const doc = parser.parse(spec, { groupBy: "tags" });

		expect(doc.resources).toHaveLength(1);
		expect(doc.resources[0]?.tag).toBe("default");
	});

	test("parses operation details", () => {
		const spec = createMinimalSpec({
			paths: {
				"/users/{id}": {
					get: {
						tags: ["users"],
						operationId: "getUserById",
						summary: "Get user by ID",
						description: "Returns a single user",
						deprecated: true,
						responses: {},
					},
				},
			},
		});

		const doc = parser.parse(spec);
		const op = doc.resources[0]?.operations[0];

		expect(op?.operationId).toBe("getUserById");
		expect(op?.path).toBe("/users/{id}");
		expect(op?.method).toBe("GET");
		expect(op?.summary).toBe("Get user by ID");
		expect(op?.description).toBe("Returns a single user");
		expect(op?.deprecated).toBe(true);
	});

	test("parses parameters", () => {
		const spec = createMinimalSpec({
			paths: {
				"/users/{id}": {
					get: {
						operationId: "getUser",
						parameters: [
							{
								name: "id",
								in: "path",
								required: true,
								schema: { type: "string" },
							},
							{
								name: "include",
								in: "query",
								required: false,
								description: "Include related data",
								schema: { type: "string" },
							},
						],
						responses: {},
					},
				},
			},
		});

		const doc = parser.parse(spec);
		const params = doc.resources[0]?.operations[0]?.parameters;

		expect(params).toHaveLength(2);
		expect(params?.[0]).toMatchObject({
			name: "id",
			in: "path",
			required: true,
		});
		expect(params?.[1]).toMatchObject({
			name: "include",
			in: "query",
			required: false,
			description: "Include related data",
		});
	});

	test("sorts resources by operation count descending", () => {
		const spec = createMinimalSpec({
			paths: {
				"/a": { get: { tags: ["small"], responses: {} } },
				"/b": {
					get: { tags: ["large"], responses: {} },
					post: { tags: ["large"], responses: {} },
					put: { tags: ["large"], responses: {} },
				},
				"/c": {
					get: { tags: ["medium"], responses: {} },
					post: { tags: ["medium"], responses: {} },
				},
			},
		});

		const doc = parser.parse(spec);

		expect(doc.resources.map((r) => r.tag)).toEqual([
			"large",
			"medium",
			"small",
		]);
	});
});

// =============================================================================
// Schema Parsing
// =============================================================================

describe("Parser.parse - schemas", () => {
	const parser = new Parser();

	test("groups schemas by prefix", () => {
		const spec = createMinimalSpec({
			components: {
				schemas: {
					User: { type: "object" },
					UserInput: { type: "object" },
					Pet: { type: "object" },
					PetStatus: { type: "string", enum: ["available", "sold"] },
				},
			},
		});

		const doc = parser.parse(spec);

		expect(doc.schemaGroups).toHaveLength(2);

		const userGroup = doc.schemaGroups.find((g) => g.prefix === "User");
		const petGroup = doc.schemaGroups.find((g) => g.prefix === "Pet");

		expect(userGroup?.schemas).toHaveLength(2);
		expect(petGroup?.schemas).toHaveLength(2);
	});

	test("parses object schema with fields", () => {
		const spec = createMinimalSpec({
			components: {
				schemas: {
					User: {
						type: "object",
						required: ["id", "name"],
						properties: {
							id: { type: "integer" },
							name: { type: "string", description: "User name" },
							email: { type: "string", format: "email" },
						},
					},
				},
			},
		});

		const doc = parser.parse(spec);
		const schema = doc.schemaGroups[0]?.schemas[0];

		expect(schema?.name).toBe("User");
		expect(schema?.type).toBe("object");
		expect(schema?.fields).toHaveLength(3);

		const idField = schema?.fields?.find((f) => f.name === "id");
		const nameField = schema?.fields?.find((f) => f.name === "name");
		const emailField = schema?.fields?.find((f) => f.name === "email");

		expect(idField?.required).toBe(true);
		expect(nameField?.required).toBe(true);
		expect(nameField?.description).toBe("User name");
		expect(emailField?.required).toBe(false);
	});

	test("parses enum schema", () => {
		const spec = createMinimalSpec({
			components: {
				schemas: {
					Status: {
						type: "string",
						enum: ["active", "inactive", "pending"],
					},
				},
			},
		});

		const doc = parser.parse(spec);
		const schema = doc.schemaGroups[0]?.schemas[0];

		expect(schema?.type).toBe("enum");
		expect(schema?.enumValues).toEqual(["active", "inactive", "pending"]);
	});

	test("parses nested inline objects", () => {
		const spec = createMinimalSpec({
			components: {
				schemas: {
					User: {
						type: "object",
						properties: {
							address: {
								type: "object",
								properties: {
									street: { type: "string" },
									city: { type: "string" },
								},
							},
						},
					},
				},
			},
		});

		const doc = parser.parse(spec);
		const schema = doc.schemaGroups[0]?.schemas[0];
		const addressField = schema?.fields?.find((f) => f.name === "address");

		expect(addressField?.nestedFields).toHaveLength(2);
		expect(addressField?.nestedFields?.map((f) => f.name)).toEqual([
			"street",
			"city",
		]);
	});
});

// =============================================================================
// Filter: includeTags / excludeTags
// =============================================================================

describe("Parser.parse - filter by tags", () => {
	const parser = new Parser();

	const spec = createMinimalSpec({
		paths: {
			"/users": { get: { tags: ["users"], responses: {} } },
			"/pets": { get: { tags: ["pets"], responses: {} } },
			"/admin": { get: { tags: ["admin"], responses: {} } },
		},
	});

	test("includeTags filters to only specified tags", () => {
		const doc = parser.parse(spec, {
			filter: { includeTags: ["users", "pets"] },
		});

		expect(doc.resources).toHaveLength(2);
		expect(doc.resources.map((r) => r.tag).sort()).toEqual(["pets", "users"]);
	});

	test("excludeTags removes specified tags", () => {
		const doc = parser.parse(spec, {
			filter: { excludeTags: ["admin"] },
		});

		expect(doc.resources).toHaveLength(2);
		expect(doc.resources.map((r) => r.tag).sort()).toEqual(["pets", "users"]);
	});

	test("includeTags takes precedence (only includes listed)", () => {
		const doc = parser.parse(spec, {
			filter: {
				includeTags: ["users"],
				excludeTags: ["pets"], // should be ignored
			},
		});

		expect(doc.resources).toHaveLength(1);
		expect(doc.resources[0]?.tag).toBe("users");
	});
});

// =============================================================================
// Filter: excludeDeprecated
// =============================================================================

describe("Parser.parse - filter deprecated", () => {
	const parser = new Parser();

	test("excludeDeprecated removes deprecated operations", () => {
		const spec = createMinimalSpec({
			paths: {
				"/v1/users": {
					get: {
						tags: ["users"],
						operationId: "getUsers_v1",
						deprecated: true,
						responses: {},
					},
				},
				"/v2/users": {
					get: {
						tags: ["users"],
						operationId: "getUsers_v2",
						responses: {},
					},
				},
			},
		});

		const doc = parser.parse(spec, {
			filter: { excludeDeprecated: true },
		});

		expect(doc.resources).toHaveLength(1);
		expect(doc.resources[0]?.operations).toHaveLength(1);
		expect(doc.resources[0]?.operations[0]?.operationId).toBe("getUsers_v2");
	});

	test("keeps deprecated when excludeDeprecated is false", () => {
		const spec = createMinimalSpec({
			paths: {
				"/old": {
					get: { deprecated: true, responses: {} },
				},
				"/new": {
					get: { responses: {} },
				},
			},
		});

		const doc = parser.parse(spec, {
			filter: { excludeDeprecated: false },
		});

		const allOps = doc.resources.flatMap((r) => r.operations);
		expect(allOps).toHaveLength(2);
	});
});

// =============================================================================
// Filter: excludePaths
// =============================================================================

describe("Parser.parse - filter by paths", () => {
	const parser = new Parser();

	const spec = createMinimalSpec({
		paths: {
			"/api/users": { get: { responses: {} } },
			"/api/pets": { get: { responses: {} } },
			"/internal/health": { get: { responses: {} } },
			"/internal/metrics": { get: { responses: {} } },
		},
	});

	test("excludePaths with string prefix", () => {
		const doc = parser.parse(spec, {
			filter: { excludePaths: ["/internal"] },
		});

		const allOps = doc.resources.flatMap((r) => r.operations);
		expect(allOps).toHaveLength(2);
		expect(allOps.every((op) => op.path.startsWith("/api"))).toBe(true);
	});

	test("excludePaths with regex", () => {
		const doc = parser.parse(spec, {
			filter: { excludePaths: [/\/internal\/.*/] },
		});

		const allOps = doc.resources.flatMap((r) => r.operations);
		expect(allOps).toHaveLength(2);
	});

	test("excludePaths with multiple patterns", () => {
		const doc = parser.parse(spec, {
			filter: { excludePaths: ["/internal", "/api/pets"] },
		});

		const allOps = doc.resources.flatMap((r) => r.operations);
		expect(allOps).toHaveLength(1);
		expect(allOps[0]?.path).toBe("/api/users");
	});
});

// =============================================================================
// Authentication Parsing
// =============================================================================

describe("Parser.parse - authSchemes", () => {
	const parser = new Parser();

	test("parses apiKey security scheme", () => {
		const spec = createMinimalSpec({
			components: {
				securitySchemes: {
					ApiKeyAuth: {
						type: "apiKey",
						in: "header",
						name: "X-API-Key",
					},
				},
			},
		});

		const doc = parser.parse(spec);
		const scheme = doc.authSchemes[0];

		expect(scheme?.name).toBe("ApiKeyAuth");
		expect(scheme?.type).toBe("apiKey");
		expect(scheme?.in).toBe("header");
	});

	test("parses http bearer security scheme", () => {
		const spec = createMinimalSpec({
			components: {
				securitySchemes: {
					BearerAuth: {
						type: "http",
						scheme: "bearer",
						bearerFormat: "JWT",
					},
				},
			},
		});

		const doc = parser.parse(spec);
		const scheme = doc.authSchemes[0];

		expect(scheme?.name).toBe("BearerAuth");
		expect(scheme?.type).toBe("http");
		expect(scheme?.scheme).toBe("bearer");
		expect(scheme?.bearerFormat).toBe("JWT");
	});

	test("returns empty array when no security schemes", () => {
		const spec = createMinimalSpec();

		const doc = parser.parse(spec);

		expect(doc.authSchemes).toEqual([]);
	});
});

// =============================================================================
// GroupBy Strategy
// =============================================================================

describe("Parser.parse - groupBy", () => {
	const parser = new Parser();

	describe("groupBy: 'tags'", () => {
		test("uses tags when available", () => {
			const spec = createMinimalSpec({
				paths: {
					"/users": { get: { tags: ["users"], responses: {} } },
					"/pets": { get: { tags: ["pets"], responses: {} } },
				},
			});

			const doc = parser.parse(spec, { groupBy: "tags" });

			expect(doc.resources.map((r) => r.tag).sort()).toEqual(["pets", "users"]);
		});

		test("falls back to 'default' when no tags", () => {
			const spec = createMinimalSpec({
				paths: {
					"/v1/accounts": { get: { responses: {} } },
					"/v1/customers": { get: { responses: {} } },
				},
			});

			const doc = parser.parse(spec, { groupBy: "tags" });

			expect(doc.resources).toHaveLength(1);
			expect(doc.resources[0]?.tag).toBe("default");
			expect(doc.resources[0]?.operations).toHaveLength(2);
		});
	});

	describe("groupBy: 'path'", () => {
		test("groups by first path segment", () => {
			const spec = createMinimalSpec({
				paths: {
					"/users": { get: { tags: ["users"], responses: {} } },
					"/users/{id}": { get: { tags: ["users"], responses: {} } },
					"/pets": { get: { tags: ["pets"], responses: {} } },
				},
			});

			// Even with tags, path mode should use path segments
			const doc = parser.parse(spec, { groupBy: "path" });

			expect(doc.resources.map((r) => r.tag).sort()).toEqual(["pets", "users"]);
			const users = doc.resources.find((r) => r.tag === "users");
			expect(users?.operations).toHaveLength(2);
		});

		test("strips version prefixes like /v1/", () => {
			const spec = createMinimalSpec({
				paths: {
					"/v1/accounts": { get: { responses: {} } },
					"/v1/accounts/{id}": { get: { responses: {} } },
					"/v1/customers": { get: { responses: {} } },
				},
			});

			const doc = parser.parse(spec, { groupBy: "path" });

			expect(doc.resources.map((r) => r.tag).sort()).toEqual([
				"accounts",
				"customers",
			]);
		});

		test("strips /api/v2/ prefix", () => {
			const spec = createMinimalSpec({
				paths: {
					"/api/v2/products": { get: { responses: {} } },
					"/api/v2/orders": { get: { responses: {} } },
				},
			});

			const doc = parser.parse(spec, { groupBy: "path" });

			expect(doc.resources.map((r) => r.tag).sort()).toEqual([
				"orders",
				"products",
			]);
		});

		test("handles root path as default", () => {
			const spec = createMinimalSpec({
				paths: {
					"/": { get: { responses: {} } },
				},
			});

			const doc = parser.parse(spec, { groupBy: "path" });

			expect(doc.resources).toHaveLength(1);
			expect(doc.resources[0]?.tag).toBe("default");
		});

		test("handles path parameter as first segment", () => {
			const spec = createMinimalSpec({
				paths: {
					"/{tenantId}/resources": { get: { responses: {} } },
				},
			});

			const doc = parser.parse(spec, { groupBy: "path" });

			expect(doc.resources).toHaveLength(1);
			expect(doc.resources[0]?.tag).toBe("default");
		});
	});

	describe("groupBy: 'auto' (default)", () => {
		test("uses tags when available", () => {
			const spec = createMinimalSpec({
				paths: {
					"/v1/accounts": { get: { tags: ["Account"], responses: {} } },
					"/v1/customers": { get: { tags: ["Customer"], responses: {} } },
				},
			});

			const doc = parser.parse(spec, { groupBy: "auto" });

			expect(doc.resources.map((r) => r.tag).sort()).toEqual([
				"Account",
				"Customer",
			]);
		});

		test("falls back to path when no tags", () => {
			const spec = createMinimalSpec({
				paths: {
					"/v1/accounts": { get: { responses: {} } },
					"/v1/accounts/{id}": { get: { responses: {} } },
					"/v1/customers": { get: { responses: {} } },
				},
			});

			const doc = parser.parse(spec, { groupBy: "auto" });

			expect(doc.resources.map((r) => r.tag).sort()).toEqual([
				"accounts",
				"customers",
			]);
		});

		test("mixed: uses tags for tagged ops, path for untagged", () => {
			const spec = createMinimalSpec({
				paths: {
					"/v1/accounts": { get: { tags: ["Accounts"], responses: {} } },
					"/v1/customers": { get: { responses: {} } }, // no tags
				},
			});

			const doc = parser.parse(spec, { groupBy: "auto" });

			expect(doc.resources.map((r) => r.tag).sort()).toEqual([
				"Accounts",
				"customers",
			]);
		});

		test("is the default when groupBy not specified", () => {
			const spec = createMinimalSpec({
				paths: {
					"/v1/accounts": { get: { responses: {} } },
				},
			});

			const doc = parser.parse(spec); // no options

			// Should use path-based grouping since no tags
			expect(doc.resources[0]?.tag).toBe("accounts");
		});
	});
});
