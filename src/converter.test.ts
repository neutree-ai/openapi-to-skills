import { describe, expect, mock, test } from "bun:test";
import { convertOpenAPIToSkill } from "./converter.js";
import type { OpenAPISpec, Renderer, Writer } from "./types.js";

// =============================================================================
// Test Fixtures
// =============================================================================

function createMinimalSpec(): OpenAPISpec {
	return {
		openapi: "3.0.0",
		info: { title: "Test API", version: "1.0.0" },
		paths: {},
	};
}

function createMockWriter() {
	const mkdirCalls: string[] = [];
	const writeFileCalls: Array<{ path: string; content: string }> = [];

	const writer: Writer = {
		mkdir: mock((path: string) => {
			mkdirCalls.push(path);
			return Promise.resolve();
		}),
		writeFile: mock((path: string, content: string) => {
			writeFileCalls.push({ path, content });
			return Promise.resolve();
		}),
	};

	return { writer, mkdirCalls, writeFileCalls };
}

function createMockRenderer(): Renderer {
	return {
		renderSkill: mock(() => "# SKILL"),
		renderResource: mock(() => "# RESOURCE"),
		renderOperation: mock(() => "# OPERATION"),
		renderSchema: mock(() => "# SCHEMA"),
		renderSchemaIndex: mock(() => "# SCHEMA INDEX"),
		renderAuthentication: mock(() => "# AUTH"),
	};
}

// =============================================================================
// Directory Structure
// =============================================================================

describe("convertOpenAPIToSkill - directory structure", () => {
	test("creates skill and references directories", async () => {
		const spec = createMinimalSpec();
		const { writer, mkdirCalls } = createMockWriter();

		await convertOpenAPIToSkill(spec, {
			outputDir: "/out",
			renderer: createMockRenderer(),
			writer,
		});

		expect(mkdirCalls).toContain("/out/test-api");
		expect(mkdirCalls).toContain("/out/test-api/references/resources");
		expect(mkdirCalls).toContain("/out/test-api/references/operations");
		expect(mkdirCalls).toContain("/out/test-api/references/schemas");
	});

	test("creates schema prefix directories", async () => {
		const spec: OpenAPISpec = {
			...createMinimalSpec(),
			components: {
				schemas: {
					User: { type: "object" },
					Pet: { type: "object" },
				},
			},
		};
		const { writer, mkdirCalls } = createMockWriter();

		await convertOpenAPIToSkill(spec, {
			outputDir: "/out",
			renderer: createMockRenderer(),
			writer,
		});

		expect(mkdirCalls).toContain("/out/test-api/references/schemas/User");
		expect(mkdirCalls).toContain("/out/test-api/references/schemas/Pet");
	});
});

// =============================================================================
// File Writing
// =============================================================================

describe("convertOpenAPIToSkill - file writing", () => {
	test("writes SKILL.md", async () => {
		const spec = createMinimalSpec();
		const { writer, writeFileCalls } = createMockWriter();

		await convertOpenAPIToSkill(spec, {
			outputDir: "/out",
			renderer: createMockRenderer(),
			writer,
		});

		const skillFile = writeFileCalls.find((c) => c.path.endsWith("SKILL.md"));
		expect(skillFile).toBeDefined();
		expect(skillFile?.path).toBe("/out/test-api/SKILL.md");
	});

	test("writes resource and operation files", async () => {
		const spec: OpenAPISpec = {
			...createMinimalSpec(),
			paths: {
				"/users": {
					get: { tags: ["users"], operationId: "getUsers", responses: {} },
				},
			},
		};
		const { writer, writeFileCalls } = createMockWriter();

		await convertOpenAPIToSkill(spec, {
			outputDir: "/out",
			renderer: createMockRenderer(),
			writer,
		});

		const resourceFile = writeFileCalls.find((c) =>
			c.path.includes("/resources/users.md"),
		);
		const operationFile = writeFileCalls.find((c) =>
			c.path.includes("/operations/getUsers.md"),
		);

		expect(resourceFile).toBeDefined();
		expect(operationFile).toBeDefined();
	});

	test("writes schema index and schema files", async () => {
		const spec: OpenAPISpec = {
			...createMinimalSpec(),
			components: {
				schemas: {
					User: { type: "object" },
					UserInput: { type: "object" },
				},
			},
		};
		const { writer, writeFileCalls } = createMockWriter();

		await convertOpenAPIToSkill(spec, {
			outputDir: "/out",
			renderer: createMockRenderer(),
			writer,
		});

		const indexFile = writeFileCalls.find((c) =>
			c.path.includes("/schemas/User/_index.md"),
		);
		const schemaFile1 = writeFileCalls.find((c) =>
			c.path.includes("/schemas/User/User.md"),
		);
		const schemaFile2 = writeFileCalls.find((c) =>
			c.path.includes("/schemas/User/UserInput.md"),
		);

		expect(indexFile).toBeDefined();
		expect(schemaFile1).toBeDefined();
		expect(schemaFile2).toBeDefined();
	});
});

// =============================================================================
// Authentication Conditional Logic
// =============================================================================

describe("convertOpenAPIToSkill - authentication", () => {
	test("writes authentication.md when authSchemes present", async () => {
		const spec: OpenAPISpec = {
			...createMinimalSpec(),
			components: {
				securitySchemes: {
					BearerAuth: { type: "http", scheme: "bearer" },
				},
			},
		};
		const { writer, writeFileCalls } = createMockWriter();

		await convertOpenAPIToSkill(spec, {
			outputDir: "/out",
			renderer: createMockRenderer(),
			writer,
		});

		const authFile = writeFileCalls.find((c) =>
			c.path.includes("authentication.md"),
		);
		expect(authFile).toBeDefined();
		expect(authFile?.path).toBe("/out/test-api/references/authentication.md");
	});

	test("skips authentication.md when no authSchemes", async () => {
		const spec = createMinimalSpec();
		const { writer, writeFileCalls } = createMockWriter();

		await convertOpenAPIToSkill(spec, {
			outputDir: "/out",
			renderer: createMockRenderer(),
			writer,
		});

		const authFile = writeFileCalls.find((c) =>
			c.path.includes("authentication.md"),
		);
		expect(authFile).toBeUndefined();
	});
});
