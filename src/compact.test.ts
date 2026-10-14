import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { convertOpenAPIToSkill } from "./converter.js";
import type {
	ConvertOptions,
	OpenAPISpec,
	SchemaObject,
	Writer,
} from "./types.js";

async function fixture(): Promise<OpenAPISpec> {
	return parse(
		await readFile(new URL("./fixtures/compact.yaml", import.meta.url), "utf8"),
	);
}

async function generate(
	spec: OpenAPISpec,
	options: Partial<ConvertOptions> = {},
) {
	const files = new Map<string, string>();
	const writer: Writer = {
		async mkdir() {},
		async writeFile(path, content) {
			files.set(path.replace("/out/compact-test-api/", ""), content);
		},
	};
	await convertOpenAPIToSkill(spec, {
		outputDir: "/out",
		layout: "compact",
		...options,
		writer,
	});
	return files;
}

describe("compact layout", () => {
	test("keeps list calls and schemas on one resource page and writes only unattached schemas", async () => {
		const files = await generate(await fixture());
		expect([...files.keys()].sort()).toEqual([
			"SKILL.md",
			"references/operations/createOrder.md",
			"references/resources/Order.md",
			"references/resources/User.md",
			"references/schemas/Unused.md",
		]);
		const order = files.get("references/resources/Order.md");
		expect(order).toContain("/orders/list");
		expect(order).toContain("application/json");
		expect(order).toContain("Request body (required)");
		expect(order).toContain("listOrders");
		expect(order).toContain("createOrder");
		expect(order).toContain("../operations/createOrder.md");
		expect(order).not.toContain("**ID:** `createOrder`");
		const create = files.get("references/operations/createOrder.md");
		expect(create).toContain("**ID:** `createOrder`");
		expect(create).toContain("../resources/Order.md");
		expect(create).toContain("Created");
		expect(order).toContain("Matching orders");
		expect(order).toContain("`total`");
		expect(order).toContain("`id`");
		expect(order).toContain("`customer`");
		expect(order).not.toContain("../schemas/");
	});

	test("defines filter rules and shared list shapes once without inventing operators", async () => {
		const files = await generate(await fixture());
		const skill = files.get("SKILL.md");
		const order = files.get("references/resources/Order.md");
		const user = files.get("references/resources/User.md");
		expect(skill?.match(/## Filter suffix rules/g)).toHaveLength(1);
		expect(skill?.match(/## List query /g)).toHaveLength(1);
		expect(skill).toContain("_in");
		expect(skill).toContain("_contains");
		expect(skill).not.toContain("_gte");
		expect(skill).toContain("minimum: 1");
		expect(skill).toContain("default: 20");
		for (const page of [order, user]) {
			expect(page).toContain("Shared request shape");
			expect(page).toContain("Filterable fields");
			expect(page).toContain("Supported suffixes");
			expect(page).toContain("Combinators");
		}
		expect(order).not.toContain("`id_in`");
		expect(user).not.toContain("`name_contains`");
		expect(order).not.toContain("OrderListInput");
	});

	test("shows exact suffixes on the page without spec-order-dependent class names", async () => {
		const spec = await fixture();
		const before = await generate(spec);
		const schemas = spec.components?.schemas;
		if (!schemas) throw new Error("Missing fixture schemas");
		spec.components = {
			...spec.components,
			schemas: Object.fromEntries(Object.entries(schemas).reverse()),
		};
		for (const name of ["OrderWhereInput", "UserWhereInput"]) {
			const filter = schemas[name] as SchemaObject;
			filter.properties = Object.fromEntries(
				Object.entries(filter.properties ?? {}).reverse(),
			);
		}
		const after = await generate(spec);
		const suffixRow = (page: string | undefined, field: string) =>
			page
				?.split("\n")
				.find(
					(line) =>
						line.startsWith(`|\`${field}\``) && line.includes("equality"),
				);
		for (const files of [before, after]) {
			const order = files.get("references/resources/Order.md");
			expect(suffixRow(order, "id")).toContain("`_in`");
			expect(suffixRow(order, "id")).not.toContain("`_gt`");
			expect(suffixRow(order, "total")).toContain("`_gt`");
			expect(suffixRow(order, "total")).not.toContain("`_in`");
			expect(
				suffixRow(files.get("references/resources/User.md"), "name"),
			).toContain("`_contains`");
			for (const content of files.values())
				expect(content).not.toMatch(/\b(?:string|number|enum|relation)-\d+\b/);
		}
		expect(suffixRow(after.get("references/resources/Order.md"), "id")).toBe(
			suffixRow(before.get("references/resources/Order.md"), "id"),
		);
	});

	test.each([
		false,
		true,
	])("keeps array-returning mutations on their own pages (data field: %s)", async (hasData) => {
		const spec = await fixture();
		const op = spec.paths["/orders"]?.post;
		if (!op) throw new Error("Missing fixture operation");
		op.requestBody = {
			content: {
				"application/json": {
					schema: {
						type: "object",
						properties: {
							where: { $ref: "#/components/schemas/OrderWhereInput" },
							...(hasData
								? { data: { $ref: "#/components/schemas/Order" } }
								: {}),
						},
					},
				},
			},
		};
		op.responses = {
			"200": {
				description: "Changed orders",
				content: {
					"application/json": {
						schema: {
							type: "array",
							items: { $ref: "#/components/schemas/Order" },
						},
					},
				},
			},
		};
		const files = await generate(spec);
		expect(files.get("references/resources/Order.md")).not.toContain(
			"**ID:** `createOrder`",
		);
		expect(files.get("references/operations/createOrder.md")).toContain(
			"Changed orders",
		);
	});

	test("groups only fields with matching types and suffix sets", async () => {
		const spec = await fixture();
		const user = spec.components?.schemas?.User as SchemaObject;
		user.properties = { ...user.properties, externalId: { type: "string" } };
		const filter = spec.components?.schemas?.UserWhereInput as SchemaObject;
		filter.properties = {
			...filter.properties,
			externalId: { type: "string" },
			externalId_in: { type: "array", items: { type: "string" } },
		};
		const page = (await generate(spec)).get("references/resources/User.md");
		const group = page
			?.split("\n")
			.find((line) => line.startsWith("|`externalId`, `id`|"));
		expect(group).toContain("equality, `_in`");
		expect(group).not.toContain("`name`");
		expect(group).not.toContain("_contains");
	});

	test("keeps a GET collection on its resource page without a request body", async () => {
		const spec = await fixture();
		const item = spec.paths["/orders/list"];
		if (!item?.post) throw new Error("Missing fixture operation");
		item.get = { ...item.post, requestBody: undefined };
		delete item.post;
		const files = await generate(spec);
		expect(files.get("references/resources/Order.md")).toContain(
			"**ID:** `listOrders`",
		);
		expect(files.has("references/operations/listOrders.md")).toBe(false);
	});

	test("shares one non-list operation page across tags and preserves filename disambiguation", async () => {
		const spec = await fixture();
		const op = spec.paths["/orders"]?.post;
		if (!op) throw new Error("Missing fixture operation");
		op.tags = ["Order", "User"];
		spec.paths["/other-orders"] = {
			post: { ...op, operationId: "createorder" },
		};
		const files = await generate(spec, { caseStrategy: "lowercase" });
		expect(
			[...files.keys()].filter((path) => path.includes("/operations/")).sort(),
		).toEqual([
			"references/operations/createorder-2.md",
			"references/operations/createorder.md",
		]);
		const create = files.get("references/operations/createorder.md");
		expect(create).toContain("../resources/order.md");
		expect(create).toContain("../resources/user.md");
		for (const resource of ["order", "user"]) {
			expect(files.get(`references/resources/${resource}.md`)).toContain(
				"../operations/createorder.md",
			);
			expect(files.get(`references/resources/${resource}.md`)).toContain(
				"../operations/createorder-2.md",
			);
		}
	});

	test("deduplicates schema definitions, recursive references, and enum values per page", async () => {
		const files = await generate(await fixture());
		const page = files.get("references/resources/Order.md");
		expect(page?.match(/### `Order` \(closed\)\n/g)).toHaveLength(1);
		expect(page?.match(/### `User`\n/g)).toHaveLength(1);
		expect(page?.match(/"archived"/g)).toHaveLength(1);
		expect(page?.match(/"deleted"/g)).toHaveLength(1);
		for (const content of files.values()) {
			const anchors = new Set(
				[...content.matchAll(/<a id="([^"]+)"/g)].map((m) => m[1]),
			);
			for (const match of content.matchAll(/\]\(#([^)]+)\)/g))
				expect(anchors.has(match[1])).toBe(true);
		}
	});

	test("preserves unknown filter dialects as full schemas", async () => {
		const spec = await fixture();
		const filter = spec.components?.schemas?.OrderWhereInput as SchemaObject;
		filter.properties = {
			...filter.properties,
			total_custom_operator: { type: "number" },
		};
		const files = await generate(spec);
		expect(files.get("references/resources/Order.md")).toContain(
			"`total_custom_operator`",
		);
		expect(files.get("references/resources/Order.md")).toContain("`id_in`");
	});

	test("does not merge list shapes with different pagination constraints", async () => {
		const spec = await fixture();
		const input = spec.components?.schemas?.UserListInput as SchemaObject;
		input.required = ["first"];
		const files = await generate(spec);
		expect(files.get("SKILL.md")).not.toContain("## List query");
		expect(files.get("references/resources/Order.md")).toContain(
			"OrderListInput",
		);
	});

	test("preserves operator-specific constraints rather than compressing them", async () => {
		const spec = await fixture();
		const filter = spec.components?.schemas?.OrderWhereInput as SchemaObject;
		filter.properties = {
			...filter.properties,
			total_gt: { type: "number", minimum: 0 },
		};
		const page = (await generate(spec)).get("references/resources/Order.md");
		expect(page).toContain("`total_gt`");
		expect(page).toContain("minimum: 0");
	});

	test("preserves mismatched filter operand types instead of inventing a class", async () => {
		const spec = await fixture();
		const filter = spec.components?.schemas?.OrderWhereInput as SchemaObject;
		filter.properties = {
			...filter.properties,
			total_in: { type: "array", items: { type: "string" } },
		};
		const page = (await generate(spec)).get("references/resources/Order.md");
		expect(page).toContain("`total_in`");
		expect(page).toContain("string[]");
	});

	test("keeps allOf wrappers with extra required fields distinct from their base schema", async () => {
		const spec = await fixture();
		const op = spec.paths["/orders"]?.post;
		if (!op) throw new Error("Missing fixture operation");
		op.requestBody = {
			content: {
				"application/json": {
					schema: {
						allOf: [{ $ref: "#/components/schemas/Order" }],
						required: ["total"],
					},
				},
			},
		};
		const page = (await generate(spec)).get(
			"references/operations/createOrder.md",
		);
		expect(page).toContain("`total`*");
		expect(page).toContain("`id`*");
		expect(page).toContain("`state`*");
	});

	test("tracks alias references and escaped schema names when removing reachable pages", async () => {
		const spec = await fixture();
		const schemas = spec.components?.schemas;
		if (!schemas) throw new Error("Missing fixture schemas");
		schemas.Alias = { $ref: "#/components/schemas/Odd~1Name" };
		schemas["Odd/Name"] = {
			type: "object",
			properties: { aliasField: { type: "string" } },
		};
		const order = schemas.Order as SchemaObject;
		order.properties = {
			...order.properties,
			alias: { $ref: "#/components/schemas/Alias" },
		};
		const files = await generate(spec);
		expect(files.get("references/resources/Order.md")).toContain(
			"`aliasField`",
		);
		expect([...files.keys()].filter((p) => p.includes("/schemas/"))).toEqual([
			"references/schemas/Unused.md",
		]);
	});

	test("renders referenced request bodies and response components for every media type", async () => {
		const spec = await fixture();
		const op = spec.paths["/orders"]?.post;
		if (!op) throw new Error("Missing fixture operation");
		spec.components = {
			...spec.components,
			requestBodies: {
				Upload: {
					required: true,
					content: {
						"multipart/form-data": {
							schema: {
								type: "object",
								required: ["file"],
								properties: { file: { type: "string", format: "binary" } },
							},
						},
						"application/json": {
							schema: {
								type: "object",
								properties: { message: { type: "string" } },
							},
						},
					},
				},
			},
			responses: {
				Text: {
					description: "Plain response",
					content: { "text/plain": { schema: { type: "string" } } },
				},
			},
		};
		op.requestBody = { $ref: "#/components/requestBodies/Upload" };
		op.responses = { "200": { $ref: "#/components/responses/Text" } };
		const page = (await generate(spec)).get(
			"references/operations/createOrder.md",
		);
		expect(page).toContain("multipart/form-data");
		expect(page).toContain("string (binary)");
		expect(page).toContain("`file`*");
		expect(page).toContain("`message`");
		expect(page).toContain("text/plain");
		expect(page).toContain("Plain response");
	});

	test("handles recursive array and allOf schemas without looping", async () => {
		const spec = await fixture();
		const schemas = spec.components?.schemas;
		if (!schemas) throw new Error("Missing fixture schemas");
		schemas.RecursiveArray = {
			type: "array",
			items: { $ref: "#/components/schemas/RecursiveArray" },
		};
		schemas.RecursiveAllOf = {
			allOf: [{ $ref: "#/components/schemas/RecursiveAllOf" }],
		};
		const files = await generate(spec);
		expect(files.get("references/schemas/RecursiveArray.md")).toContain(
			"RecursiveArray",
		);
		expect(files.get("references/schemas/RecursiveAllOf.md")).toContain(
			"allOf",
		);
	});

	test("disambiguates resource names on case-insensitive filesystems", async () => {
		const spec = await fixture();
		const op = spec.paths["/orders"]?.post;
		if (!op) throw new Error("Missing fixture operation");
		op.tags = ["order"];
		const files = await generate(spec, { caseStrategy: "lowercase" });
		expect(files.has("references/resources/order.md")).toBe(true);
		expect(files.has("references/resources/order-2.md")).toBe(true);
		expect(files.get("SKILL.md")).toContain("references/resources/order-2.md");
	});

	test("honors grouping, filtering, and lowercase paths", async () => {
		const spec = await fixture();
		const files = await generate(spec, {
			caseStrategy: "lowercase",
			parser: { groupBy: "path", filter: { excludePaths: ["/users"] } },
		});
		expect(files.has("references/resources/orders.md")).toBe(true);
		expect(files.has("references/resources/user.md")).toBe(false);
	});

	test("keeps the explicit default layout identical to the existing layout", async () => {
		const spec = await fixture();
		const implicit = await generate(spec, { layout: undefined });
		const explicit = await generate(spec, { layout: "default" });
		expect(explicit).toEqual(implicit);
	});
});
