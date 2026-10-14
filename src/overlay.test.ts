import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { convertOpenAPIToSkill } from "./converter.js";
import { applyOverlays, parseJsonPath } from "./overlay.js";
import type { OpenAPISpec, SchemaObject, Writer } from "./types.js";

async function fixture(): Promise<OpenAPISpec> {
	return parse(
		await readFile(new URL("./fixtures/compact.yaml", import.meta.url), "utf8"),
	);
}

const overlay = (actions: object[]) => ({ overlay: "1.0.0", actions }) as never;

describe("parseJsonPath", () => {
	test("reads names, quoted names, wildcards, indexes and equality filters", () => {
		expect(
			parseJsonPath("$.paths['/a/b'].post.tags[0].*[?(@.name == 'x')][\"q\"]"),
		).toEqual([
			{ kind: "name", name: "paths" },
			{ kind: "name", name: "/a/b" },
			{ kind: "name", name: "post" },
			{ kind: "name", name: "tags" },
			{ kind: "index", index: 0 },
			{ kind: "wildcard" },
			{ kind: "filter", key: "name", value: "x" },
			{ kind: "name", name: "q" },
		]);
	});

	test("rejects what it does not support", () => {
		expect(() => parseJsonPath("paths")).toThrow('start with "$"');
		expect(() => parseJsonPath("$..description")).toThrow("Unsupported");
		expect(() => parseJsonPath("$.tags[?(@.name =~ /x/)]")).toThrow(
			"Unsupported",
		);
	});
});

describe("applyOverlays", () => {
	test("merges updates into every match without touching the input", async () => {
		const spec = await fixture();
		const result = applyOverlays(spec, [
			overlay([
				{
					target: "$.components.schemas.Order",
					update: { description: "A placed order." },
				},
				{
					target: "$.components.schemas.Order.properties.total",
					update: { description: "In cents." },
				},
				{
					target: "$.paths.*.post",
					update: { tags: ["Extra"] },
				},
			]),
		]);
		const order = result.components?.schemas?.Order as SchemaObject;
		expect(order.description).toBe("A placed order.");
		expect((order.properties?.total as SchemaObject).description).toBe(
			"In cents.",
		);
		expect(result.paths["/orders"]?.post?.tags).toEqual(["Order", "Extra"]);
		expect((spec.components?.schemas?.Order as SchemaObject).description).toBe(
			undefined,
		);
	});

	test("removes matches, array items by filter included", async () => {
		const spec = await fixture();
		spec.tags = [{ name: "Order" }, { name: "User" }];
		const result = applyOverlays(spec, [
			overlay([
				{ target: "$.paths['/orders']", remove: true },
				{ target: "$.tags[?(@.name == 'User')]", remove: true },
			]),
		]);
		expect(result.paths["/orders"]).toBeUndefined();
		expect(result.paths["/orders/list"]).toBeDefined();
		expect(result.tags).toEqual([{ name: "Order" }]);
	});

	test("fails on a target that matches nothing", async () => {
		expect(() =>
			applyOverlays(
				{ openapi: "3.0.0", info: { title: "t", version: "1" }, paths: {} },
				[overlay([{ target: "$.paths['/gone']", update: {} }])],
			),
		).toThrow("matched nothing: $.paths['/gone']");
	});

	test("puts overlay descriptions next to the fields they describe", async () => {
		const files = new Map<string, string>();
		const writer: Writer = {
			async mkdir() {},
			async writeFile(path, content) {
				files.set(path.replace("/out/compact-test-api/", ""), content);
			},
		};
		await convertOpenAPIToSkill(await fixture(), {
			outputDir: "/out",
			layout: "compact",
			writer,
			overlays: [
				overlay([
					{
						target: "$.components.schemas.Order",
						update: { description: "A placed order. More detail." },
					},
					{
						target: "$.components.schemas.Order.properties.total",
						update: { description: "In cents." },
					},
					{
						target: "$.components.schemas.Order.properties.state",
						update: { description: "Where the order is." },
					},
				]),
			],
		});
		const order = files.get("references/resources/Order.md");
		expect(order).toContain("# Order\n\nA placed order. More detail.");
		expect(order).toContain("- `total`: number [= _gt] — In cents.");
		// A description beside a $ref is the field's own.
		expect(order).toContain("[= _in] — Where the order is.");
		expect(files.get("SKILL.md")).toContain(
			"- [Order](references/resources/Order.md) — A placed order.",
		);
	});
});
