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
// Case Strategy
// =============================================================================

describe("convertOpenAPIToSkill - caseStrategy: lowercase", () => {
	const specWithCaseConflict: OpenAPISpec = {
		...createMinimalSpec(),
		components: {
			schemas: {
				alert: { type: "object", properties: { labels: { type: "object" } } },
				Alert: {
					type: "object",
					properties: { state: { type: "string" } },
				},
				AlertGroup: {
					type: "object",
					properties: {
						alerts: {
							type: "array",
							items: { $ref: "#/components/schemas/Alert" },
						},
					},
				},
			},
		},
	};

	test("lowercases schema directory names", async () => {
		const { writer, mkdirCalls } = createMockWriter();

		await convertOpenAPIToSkill(specWithCaseConflict, {
			outputDir: "/out",
			renderer: createMockRenderer(),
			writer,
			caseStrategy: "lowercase",
		});

		const schemaDirs = mkdirCalls.filter((p) => p.includes("/schemas/"));
		// Only one directory "alert", no "Alert"
		expect(schemaDirs).toContain("/out/test-api/references/schemas/alert");
		expect(schemaDirs).not.toContain("/out/test-api/references/schemas/Alert");
	});

	test("lowercases schema filenames", async () => {
		const { writer, writeFileCalls } = createMockWriter();

		await convertOpenAPIToSkill(specWithCaseConflict, {
			outputDir: "/out",
			renderer: createMockRenderer(),
			writer,
			caseStrategy: "lowercase",
		});

		const schemaFiles = writeFileCalls
			.filter((c) => c.path.includes("/schemas/"))
			.map((c) => c.path);

		// All filenames should be lowercase
		for (const path of schemaFiles) {
			const fileName = path.split("/").pop();
			expect(fileName).toBe(fileName?.toLowerCase());
		}
	});

	test("disambiguates colliding filenames with numeric suffix", async () => {
		const { writer, writeFileCalls } = createMockWriter();

		await convertOpenAPIToSkill(specWithCaseConflict, {
			outputDir: "/out",
			renderer: createMockRenderer(),
			writer,
			caseStrategy: "lowercase",
		});

		const schemaFiles = writeFileCalls
			.filter((c) => c.path.includes("/schemas/alert/"))
			.map((c) => c.path.split("/").pop())
			.sort();

		// "alert" and "Alert" both become "alert.md" → disambiguate
		expect(schemaFiles).toContain("alert.md");
		expect(schemaFiles).toContain("alert-2.md");
		expect(schemaFiles).toContain("alertgroup.md");
		expect(schemaFiles).toContain("_index.md");
	});

	test("disambiguates triple collision with incremental suffixes", async () => {
		const spec: OpenAPISpec = {
			...createMinimalSpec(),
			components: {
				schemas: {
					foo: { type: "object" },
					Foo: { type: "object" },
					FOO: { type: "object" },
				},
			},
		};
		const { writer, writeFileCalls } = createMockWriter();

		await convertOpenAPIToSkill(spec, {
			outputDir: "/out",
			renderer: createMockRenderer(),
			writer,
			caseStrategy: "lowercase",
		});

		const schemaFiles = writeFileCalls
			.filter(
				(c) => c.path.includes("/schemas/") && !c.path.endsWith("_index.md"),
			)
			.map((c) => c.path.split("/").pop())
			.sort();

		expect(schemaFiles).toEqual(["foo-2.md", "foo-3.md", "foo.md"]);
	});

	test("without caseStrategy, preserves original casing", async () => {
		const { writer, mkdirCalls } = createMockWriter();

		await convertOpenAPIToSkill(specWithCaseConflict, {
			outputDir: "/out",
			renderer: createMockRenderer(),
			writer,
		});

		// Should have both Alert and alert directories
		const schemaDirs = mkdirCalls.filter((p) => p.includes("/schemas/"));
		expect(schemaDirs).toContain("/out/test-api/references/schemas/Alert");
		expect(schemaDirs).toContain("/out/test-api/references/schemas/alert");
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

// =============================================================================
// Static Asset Overlay (--assets)
// =============================================================================

function createOrderTrackingWriter() {
	const order: string[] = [];
	const copyDirCalls: Array<{ src: string; dest: string }> = [];

	const writer: Writer = {
		mkdir: mock(() => Promise.resolve()),
		writeFile: mock((path: string) => {
			order.push(`write:${path}`);
			return Promise.resolve();
		}),
		copyDir: mock((src: string, dest: string) => {
			order.push(`copyDir:${src}->${dest}`);
			copyDirCalls.push({ src, dest });
			return Promise.resolve();
		}),
	};

	return { writer, order, copyDirCalls };
}

describe("convertOpenAPIToSkill - asset overlay", () => {
	test("overlays assetsDir onto the skill dir after generation", async () => {
		const spec = createMinimalSpec();
		const { writer, order, copyDirCalls } = createOrderTrackingWriter();

		await convertOpenAPIToSkill(spec, {
			outputDir: "/out",
			assetsDir: "/assets/test",
			renderer: createMockRenderer(),
			writer,
		});

		// Copied exactly once, into the skill dir, with the source assets dir.
		expect(copyDirCalls).toEqual([
			{ src: "/assets/test", dest: "/out/test-api" },
		]);

		// Applied AFTER generation so assets override generated files.
		const lastWriteIdx = order.findLastIndex((e) => e.startsWith("write:"));
		const copyIdx = order.findIndex((e) => e.startsWith("copyDir:"));
		expect(copyIdx).toBeGreaterThan(lastWriteIdx);
	});

	test("does not copy when assetsDir is absent", async () => {
		const spec = createMinimalSpec();
		const { writer, copyDirCalls } = createOrderTrackingWriter();

		await convertOpenAPIToSkill(spec, {
			outputDir: "/out",
			renderer: createMockRenderer(),
			writer,
		});

		expect(copyDirCalls).toEqual([]);
	});

	test("throws when assetsDir is set but the writer lacks copyDir", async () => {
		const spec = createMinimalSpec();
		const writer: Writer = {
			mkdir: mock(() => Promise.resolve()),
			writeFile: mock(() => Promise.resolve()),
		};

		await expect(
			convertOpenAPIToSkill(spec, {
				outputDir: "/out",
				assetsDir: "/assets/test",
				renderer: createMockRenderer(),
				writer,
			}),
		).rejects.toThrow(/copyDir/);
	});
});
