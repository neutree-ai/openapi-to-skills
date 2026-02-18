import { describe, expect, mock, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSpecFromInput } from "./spec-loader.js";

describe("loadSpecFromInput", () => {
	test("loads spec from local YAML file", async () => {
		const dir = await mkdtemp(join(tmpdir(), "openapi-to-skills-loader-"));
		const file = join(dir, "spec.yaml");
		await writeFile(
			file,
			[
				"openapi: 3.0.0",
				"info:",
				"  title: Local Test API",
				"  version: 1.0.0",
				"paths: {}",
				"",
			].join("\n"),
			"utf-8",
		);

		const spec = await loadSpecFromInput(file);
		expect(spec.info.title).toBe("Local Test API");
		expect(spec.openapi).toBe("3.0.0");
	});

	test("loads spec from URL", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = mock(async () => {
			return new Response(
				[
					"openapi: 3.0.0",
					"info:",
					"  title: Remote Test API",
					"  version: 1.0.0",
					"paths: {}",
					"",
				].join("\n"),
				{
					status: 200,
					headers: { "content-type": "application/yaml" },
				},
			);
		}) as typeof fetch;

		try {
			const spec = await loadSpecFromInput("https://example.com/spec.yaml");
			expect(spec.info.title).toBe("Remote Test API");
			expect(spec.openapi).toBe("3.0.0");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("throws on non-2xx URL response", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = mock(async () => {
			return new Response("bad request", { status: 400 });
		}) as typeof fetch;

		try {
			await expect(
				loadSpecFromInput("https://example.com/bad.yaml"),
			).rejects.toThrow("Failed to fetch OpenAPI spec from URL");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
