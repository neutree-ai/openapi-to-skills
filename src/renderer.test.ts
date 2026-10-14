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
	test("preserves case", () => {
		expect(toFileName("UserProfile")).toBe("UserProfile");
		expect(toFileName("GetCustomersCustomer")).toBe("GetCustomersCustomer");
	});

	test("replaces spaces with hyphens", () => {
		expect(toFileName("User Profile")).toBe("User-Profile");
	});

	test("removes special characters", () => {
		expect(toFileName("User@Profile!")).toBe("User-Profile");
	});

	test("collapses multiple hyphens", () => {
		expect(toFileName("User---Profile")).toBe("User-Profile");
	});

	test("trims leading and trailing hyphens", () => {
		expect(toFileName("--User--")).toBe("User");
	});

	test("handles mixed special characters", () => {
		expect(toFileName("My Awesome API!")).toBe("My-Awesome-API");
	});

	test("preserves Japanese characters", () => {
		expect(toFileName("ユーザー")).toBe("ユーザー");
		expect(toFileName("顧客管理")).toBe("顧客管理");
	});

	test("preserves mixed Japanese and English", () => {
		expect(toFileName("User-ユーザー")).toBe("User-ユーザー");
		expect(toFileName("顧客-Management")).toBe("顧客-Management");
	});

	test("replaces forbidden filesystem characters", () => {
		expect(toFileName("file:name")).toBe("file-name");
		expect(toFileName("file<>name")).toBe("file-name");
		expect(toFileName("file|name")).toBe("file-name");
		expect(toFileName('file"name')).toBe("file-name");
		expect(toFileName("file*name")).toBe("file-name");
		expect(toFileName("file?name")).toBe("file-name");
		expect(toFileName("file\\name")).toBe("file-name");
		expect(toFileName("file/name")).toBe("file-name");
	});

	test("normalizes Unicode to NFC", () => {
		const nfd = "\u30E6\u30FC\u30B5\u30FC".normalize("NFD");
		const nfc = "\u30E6\u30FC\u30B5\u30FC".normalize("NFC");
		expect(toFileName(nfd)).toBe(nfc);
	});

	test("handles control characters", () => {
		expect(toFileName("file\x00name")).toBe("file-name");
		expect(toFileName("file\x1Fname")).toBe("file-name");
	});

	test("preserves other Unicode scripts", () => {
		expect(toFileName("Файл")).toBe("Файл");
		expect(toFileName("文件")).toBe("文件");
		expect(toFileName("Ñoño")).toBe("Ñoño");
	});

	test("returns fallback for empty result", () => {
		expect(toFileName(":*?")).toBe("unnamed");
		expect(toFileName("///")).toBe("unnamed");
		expect(toFileName("   ")).toBe("unnamed");
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

// =============================================================================
// TemplateRenderer - authentication
// =============================================================================

describe("TemplateRenderer - authentication", () => {
	test("renders apiKey header name when present", () => {
		const renderer = createRenderer();
		const result = renderer.renderAuthentication([
			{
				name: "ApiKeyAuth",
				type: "apiKey",
				in: "header",
				apiKeyName: "x-token",
				description: "API authentication token",
			},
		]);

		expect(result).toContain("## ApiKeyAuth");
		expect(result).toContain("**Type:** apiKey");
		expect(result).toContain("- **In:** header");
		expect(result).toContain("- **Name:** x-token");
	});
});

// =============================================================================
// TemplateRenderer - operation inline schemas (regression: inline bodies/
// responses were silently dropped because only schema.ref was rendered)
// =============================================================================

describe("TemplateRenderer - operation inline schemas", () => {
	const baseOp = {
		operationId: "mkdir",
		path: "/api/workspaces/{id}/agent/dirs",
		method: "POST",
		tag: "agent-files",
		deprecated: false,
		parameters: [],
		security: [],
	};

	test("renders inline object request body fields", () => {
		const renderer = createRenderer();
		const result = renderer.renderOperation({
			...baseOp,
			requestBody: {
				required: true,
				contentTypes: ["application/json"],
				schema: {
					inline: {
						name: "(inline)",
						type: "object",
						fields: [
							{
								name: "path",
								type: "string",
								required: true,
								description: "Directory path to create",
							},
						],
					},
				},
			},
			responses: [],
		});

		expect(result).toContain("## Request Body");
		expect(result).toContain("**Schema** (inline):");
		expect(result).toContain("| Field | Type | Required | Description |");
		expect(result).toContain(
			"| `path` | string | Yes | Directory path to create |",
		);
	});

	test("renders inline object success response fields", () => {
		const renderer = createRenderer();
		const result = renderer.renderOperation({
			...baseOp,
			responses: [
				{
					status: "200",
					description: "OK",
					schema: {
						inline: {
							name: "(inline)",
							type: "object",
							fields: [{ name: "ok", type: "boolean", required: true }],
						},
					},
				},
			],
		});

		expect(result).toContain("**Success Response Schema** (inline):");
		expect(result).toContain("| `ok` | boolean | Yes |  |");
	});

	test("links inline field that references a named schema", () => {
		const renderer = createRenderer();
		const result = renderer.renderOperation({
			...baseOp,
			requestBody: {
				required: false,
				contentTypes: ["application/json"],
				schema: {
					inline: {
						name: "(inline)",
						type: "object",
						fields: [
							{
								name: "owner",
								type: "object",
								required: false,
								schema: { ref: "UserRef" },
							},
						],
					},
				},
			},
			responses: [],
		});

		expect(result).toContain("[UserRef](../schemas/User/UserRef.md)");
	});
});

// =============================================================================
// TemplateRenderer - operation composition schemas (allOf/oneOf/anyOf)
// =============================================================================

describe("TemplateRenderer - operation composition schemas", () => {
	const baseOp = {
		operationId: "listOrders",
		path: "/api/orders",
		method: "GET",
		tag: "orders",
		deprecated: false,
		parameters: [],
		security: [],
	};

	test("renders allOf response with ref + inline fields", () => {
		const renderer = createRenderer();
		const result = renderer.renderOperation({
			...baseOp,
			responses: [
				{
					status: "200",
					description: "OK",
					schema: {
						inline: {
							name: "(inline)",
							type: "allOf",
							composition: [
								{ ref: "BaseResponse" },
								{
									inline: {
										name: "(inline)",
										type: "object",
										fields: [
											{
												name: "data",
												type: "object",
												required: true,
												schema: { ref: "OrderList" },
											},
											{
												name: "total",
												type: "integer",
												required: true,
												description: "Total count",
											},
										],
									},
								},
							],
						},
					},
				},
			],
		});

		expect(result).toContain("[BaseResponse](../schemas/Base/BaseResponse.md)");
		expect(result).toContain("| `data` | [OrderList](../schemas/Order/OrderList.md) | Yes |  |");
		expect(result).toContain("| `total` | integer | Yes | Total count |");
	});

	test("renders oneOf request body with multiple refs", () => {
		const renderer = createRenderer();
		const result = renderer.renderOperation({
			...baseOp,
			requestBody: {
				required: true,
				contentTypes: ["application/json"],
				schema: {
					inline: {
						name: "(inline)",
						type: "oneOf",
						composition: [
							{ ref: "CreateOrderRequest" },
							{ ref: "BatchOrderRequest" },
						],
					},
				},
			},
			responses: [],
		});

		expect(result).toContain("[CreateOrderRequest](../schemas/Create/CreateOrderRequest.md)");
		expect(result).toContain("[BatchOrderRequest](../schemas/Batch/BatchOrderRequest.md)");
	});

	test("renders composition inline fields with nestedFields", () => {
		const renderer = createRenderer();
		const result = renderer.renderOperation({
			...baseOp,
			responses: [
				{
					status: "200",
					description: "OK",
					schema: {
						inline: {
							name: "(inline)",
							type: "allOf",
							composition: [
								{
									inline: {
										name: "(inline)",
										type: "object",
										fields: [
											{
												name: "metadata",
												type: "object",
												required: false,
												description: "Extra info",
												nestedFields: [
													{
														name: "createdAt",
														type: "string",
														required: true,
														description: "Creation timestamp",
													},
												],
											},
										],
									},
								},
							],
						},
					},
				},
			],
		});

		expect(result).toContain("| `metadata` | object | No | Extra info |");
		expect(result).toContain("**`metadata` fields:**");
		expect(result).toContain("| `createdAt` | string | Yes | Creation timestamp |");
	});

	test("renders composition request body with contentTypes", () => {
		const renderer = createRenderer();
		const result = renderer.renderOperation({
			...baseOp,
			requestBody: {
				required: true,
				contentTypes: ["application/json", "application/xml"],
				schema: {
					inline: {
						name: "(inline)",
						type: "allOf",
						composition: [
							{ ref: "BaseRequest" },
							{
								inline: {
									name: "(inline)",
									type: "object",
									fields: [
										{
											name: "action",
											type: "string",
											required: true,
											description: "Action to perform",
										},
									],
								},
							},
						],
					},
				},
			},
			responses: [],
		});

		expect(result).toContain("**Content Types:** `application/json`, `application/xml`");
		expect(result).toContain("[BaseRequest](../schemas/Base/BaseRequest.md)");
		expect(result).toContain("| `action` | string | Yes | Action to perform |");
	});

	test("renders composition with array ref (e.g. OrderItem[])", () => {
		const renderer = createRenderer();
		const result = renderer.renderOperation({
			...baseOp,
			responses: [
				{
					status: "200",
					description: "OK",
					schema: {
						inline: {
							name: "(inline)",
							type: "allOf",
							composition: [
								{ ref: "OrderItem[]" },
							],
						},
					},
				},
			],
		});

		expect(result).toContain("Array of [OrderItem](../schemas/Order/OrderItem.md)");
	});

	test("renders composition ref with multi-segment name (e.g. GetUsersResponse)", () => {
		const renderer = createRenderer();
		const result = renderer.renderOperation({
			...baseOp,
			responses: [
				{
					status: "200",
					description: "OK",
					schema: {
						inline: {
							name: "(inline)",
							type: "oneOf",
							composition: [
								{ ref: "GetUsersResponse" },
								{ ref: "GetAdminsResponse" },
							],
						},
					},
				},
			],
		});

		expect(result).toContain("[GetUsersResponse](../schemas/Get/GetUsersResponse.md)");
		expect(result).toContain("[GetAdminsResponse](../schemas/Get/GetAdminsResponse.md)");
	});
});
