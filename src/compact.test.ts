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

function schema(spec: OpenAPISpec, name: string): SchemaObject {
	const found = spec.components?.schemas?.[name];
	if (!found) throw new Error(`Missing fixture schema ${name}`);
	return found as SchemaObject;
}

/** The line describing one field of the resource's main entity. */
function fieldLine(
	page: string | undefined,
	field: string,
): string | undefined {
	return page?.split("\n").find((line) => line.startsWith(`- \`${field}\``));
}

describe("compact layout", () => {
	test("keeps list calls and their fields on the resource page, and leaves out unused schemas", async () => {
		const files = await generate(await fixture());
		expect([...files.keys()].sort()).toEqual([
			"SKILL.md",
			"references/operations/createOrder.md",
			"references/resources/Order.md",
			"references/resources/User.md",
		]);
		for (const content of files.values())
			expect(content).not.toContain("Unused");
		const order = files.get("references/resources/Order.md");
		expect(order).toContain("`listOrders` POST `/orders/list` → Order[]");
		expect(order).toContain("- `total`: number");
		expect(order).toContain("- `id`*: string");
		expect(order).toContain("- `customer`: User {id, name, state}");
		// A non-list operation is listed, its details are on its own page.
		expect(order).toContain("- `createOrder` POST `/orders`");
		expect(order).not.toContain("## Input");
		const create = files.get("references/operations/createOrder.md");
		expect(create).toContain("POST `/orders` · Order (../resources/Order.md)");
		expect(create).toContain("## Input (application/json)");
		expect(create).toContain("## Returns 201 (application/json)");
		expect(create).toContain("Created");
		expect(order).not.toContain("../schemas/");
	});

	test("states the list query and filter rules once, in SKILL.md", async () => {
		const files = await generate(await fixture());
		const skill = files.get("SKILL.md");
		expect(skill?.match(/## Filters/g)).toHaveLength(1);
		expect(skill?.match(/## List query/g)).toHaveLength(1);
		expect(skill).toContain("- `first`: int — default: 20; minimum: 1");
		for (const name of ["Order", "User"]) {
			const page = files.get(`references/resources/${name}.md`);
			expect(page).toContain("Input: List query (SKILL.md)");
			expect(page).toContain("`where`: filter on the tagged fields below");
			expect(page).not.toContain("ListInput");
			expect(page).not.toContain("WhereInput");
		}
		expect(files.get("references/resources/Order.md")).not.toContain("`id_in`");
	});

	test("tags each field with its exact suffixes, independent of spec order", async () => {
		const spec = await fixture();
		const before = await generate(spec);
		const schemas = spec.components?.schemas;
		if (!schemas) throw new Error("Missing fixture schemas");
		spec.components = {
			...spec.components,
			schemas: Object.fromEntries(Object.entries(schemas).reverse()),
		};
		for (const name of ["OrderWhereInput", "UserWhereInput"]) {
			const filter = schema(spec, name);
			filter.properties = Object.fromEntries(
				Object.entries(filter.properties ?? {}).reverse(),
			);
		}
		const after = await generate(spec);
		for (const files of [before, after]) {
			const order = files.get("references/resources/Order.md");
			expect(fieldLine(order, "id")).toContain("[= _in]");
			expect(fieldLine(order, "total")).toContain("[= _gt]");
			expect(fieldLine(order, "previousState")).not.toContain("[");
			const user = files.get("references/resources/User.md");
			expect(fieldLine(user, "name")).toContain("[= _contains]");
			for (const content of files.values())
				expect(content).not.toMatch(/\b(?:string|number|enum|relation)-\d+\b/);
		}
		expect(fieldLine(after.get("references/resources/Order.md"), "id")).toBe(
			fieldLine(before.get("references/resources/Order.md"), "id"),
		);
	});

	test("names a well-known suffix set and explains only the classes in use", async () => {
		const spec = await fixture();
		const filter = schema(spec, "OrderWhereInput");
		filter.properties = {
			...filter.properties,
			id_not: { type: "string" },
			id_not_in: { type: "array", items: { type: "string" } },
		};
		const files = await generate(spec);
		expect(
			fieldLine(files.get("references/resources/Order.md"), "id"),
		).toContain("[eq]");
		const skill = files.get("SKILL.md");
		expect(skill).toContain("- `eq`:");
		expect(skill).not.toContain("- `str`:");
		expect(skill).not.toContain("- `rels`:");
	});

	test("tags relations and says how to sort relative to the fields", async () => {
		const spec = await fixture();
		const filter = schema(spec, "OrderWhereInput");
		filter.properties = {
			...filter.properties,
			customer: { $ref: "#/components/schemas/UserWhereInput" },
		};
		const order = schema(spec, "OrderOrderByInput");
		order.enum = [
			"id_ASC",
			"id_DESC",
			"total_ASC",
			"total_DESC",
			"state_ASC",
			"state_DESC",
			"previousState_ASC",
			"previousState_DESC",
			"parent_ASC",
			"parent_DESC",
		];
		const page = (await generate(spec)).get("references/resources/Order.md");
		expect(fieldLine(page, "customer")).toContain("[rel]");
		expect(page).toContain(
			"`orderBy`: `<field>_ASC` or `<field>_DESC`, for any field below except [rel] and [rels] fields",
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
		expect(files.get("references/resources/Order.md")).toContain(
			"- `createOrder` POST `/orders`",
		);
		expect(files.get("references/operations/createOrder.md")).toContain(
			"Changed orders",
		);
	});

	test("keeps a count call taking the list query on the resource page", async () => {
		const spec = await fixture();
		spec.paths["/orders/count"] = {
			post: {
				tags: ["Order"],
				operationId: "countOrders",
				requestBody: {
					content: {
						"application/json": {
							schema: { $ref: "#/components/schemas/OrderListInput" },
						},
					},
				},
				responses: {
					"200": {
						description: "How many",
						content: {
							"application/json": {
								schema: {
									type: "object",
									required: ["count"],
									properties: { count: { type: "integer" } },
								},
							},
						},
					},
				},
			},
		};
		const files = await generate(spec);
		const order = files.get("references/resources/Order.md");
		expect(order).toContain("`countOrders` POST `/orders/count` → object");
		expect(files.has("references/operations/countOrders.md")).toBe(false);
	});

	test("keeps a GET collection on its resource page without a request body", async () => {
		const spec = await fixture();
		const item = spec.paths["/orders/list"];
		if (!item?.post) throw new Error("Missing fixture operation");
		item.get = { ...item.post, requestBody: undefined };
		delete item.post;
		const files = await generate(spec);
		expect(files.get("references/resources/Order.md")).toContain(
			"`listOrders` GET `/orders/list`",
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
			const page = files.get(`references/resources/${resource}.md`);
			expect(page).toContain("../operations/createorder.md");
			expect(page).toContain("../operations/createorder-2.md");
		}
	});

	test("describes a named object once per page, and refers to it by name after", async () => {
		const spec = await fixture();
		const user = schema(spec, "User");
		user.properties = {
			...user.properties,
			address: { $ref: "#/components/schemas/Address" },
			previous: {
				type: "array",
				items: { $ref: "#/components/schemas/Address" },
			},
		};
		const schemas = spec.components?.schemas;
		if (!schemas) throw new Error("Missing fixture schemas");
		schemas.Address = {
			type: "object",
			properties: {
				lines: { type: "array", items: { type: "string" } },
				city: { type: "string" },
			},
		};
		const page = (await generate(spec)).get("references/resources/Order.md");
		expect(page?.match(/^### User$/gm)).toHaveLength(1);
		expect(page?.match(/^### Address$/gm)).toHaveLength(1);
		expect(page).toContain("- `previous`: Address[]");
		// The page's own entity, referred to from itself.
		expect(page).toContain("- `parent`: Order");
		for (const content of (await generate(spec)).values()) {
			const headings = content.match(/^#+ .+$/gm) ?? [];
			expect(new Set(headings).size).toBe(headings.length);
		}
	});

	test("lists long enums once per page and short ones inline", async () => {
		const spec = await fixture();
		const state = schema(spec, "State");
		state.enum = Array.from({ length: 12 }, (_, i) => `state_${i}`);
		const page = (await generate(spec)).get("references/resources/Order.md");
		expect(fieldLine(page, "state")).toContain(": State");
		expect(page?.match(/state_11/g)).toHaveLength(1);
		expect(page).toContain("## Enums\n- State: state_0 | state_1");
	});

	test("preserves unknown filter dialects as full schemas", async () => {
		const spec = await fixture();
		const filter = schema(spec, "OrderWhereInput");
		filter.properties = {
			...filter.properties,
			total_custom_operator: { type: "number" },
		};
		const page = (await generate(spec)).get("references/resources/Order.md");
		expect(page).toContain("### OrderWhereInput");
		expect(page).toContain("- `total_custom_operator`: number");
		expect(page).toContain("- `id_in`: string[]");
	});

	test("does not merge list shapes with different pagination constraints", async () => {
		const spec = await fixture();
		schema(spec, "UserListInput").required = ["first"];
		const files = await generate(spec);
		expect(files.get("SKILL.md")).not.toContain("## List query");
		const user = files.get("references/resources/User.md");
		expect(user).toContain("- `first`*: int — default: 20; minimum: 1");
	});

	test("preserves operator-specific constraints rather than compressing them", async () => {
		const spec = await fixture();
		const filter = schema(spec, "OrderWhereInput");
		filter.properties = {
			...filter.properties,
			total_gt: { type: "number", minimum: 0 },
		};
		const page = (await generate(spec)).get("references/resources/Order.md");
		expect(page).toContain("- `total_gt`: number — minimum: 0");
	});

	test("preserves mismatched filter operand types instead of inventing a class", async () => {
		const spec = await fixture();
		const filter = schema(spec, "OrderWhereInput");
		filter.properties = {
			...filter.properties,
			total_in: { type: "array", items: { type: "string" } },
		};
		const page = (await generate(spec)).get("references/resources/Order.md");
		expect(page).toContain("- `total_in`: string[]");
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
		const input = page?.split("## Returns")[0];
		expect(input).toContain("- `total`*: number");
		expect(input).toContain("- `id`*: string");
		expect(input).toContain("- `state`*:");
	});

	test("follows alias references and escaped schema names", async () => {
		const spec = await fixture();
		const schemas = spec.components?.schemas;
		if (!schemas) throw new Error("Missing fixture schemas");
		schemas.Alias = { $ref: "#/components/schemas/Odd~1Name" };
		schemas["Odd/Name"] = {
			type: "object",
			properties: { aliasField: { type: "string" } },
		};
		const order = schema(spec, "Order");
		order.properties = {
			...order.properties,
			alias: { $ref: "#/components/schemas/Alias" },
		};
		const files = await generate(spec);
		expect(files.get("references/resources/Order.md")).toContain(
			"- `alias`: Alias {aliasField}",
		);
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
		expect(page).toContain("## Input (multipart/form-data, required)");
		expect(page).toContain("- `file`*: string(binary)");
		expect(page).toContain("## Input (application/json, required)");
		expect(page).toContain("- `message`: string");
		expect(page).toContain(
			"## Returns 200 (text/plain)\nPlain response\nstring",
		);
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
		const order = schema(spec, "Order");
		order.properties = {
			...order.properties,
			nested: { $ref: "#/components/schemas/RecursiveArray" },
			looped: { $ref: "#/components/schemas/RecursiveAllOf" },
		};
		const page = (await generate(spec)).get("references/resources/Order.md");
		expect(page).toContain("- `nested`: RecursiveArray[]");
		expect(page).toContain("- `looped`: any");
	});

	test("states parameters, security and errors most operations share once", async () => {
		const spec = await fixture();
		const header = {
			name: "x-tenant",
			in: "header" as const,
			schema: { type: "string" as const },
		};
		const error = {
			description: "Bad request",
			content: {
				"application/json": {
					schema: {
						type: "object" as const,
						properties: { message: { type: "string" as const } },
					},
				},
			},
		};
		spec.security = [{ token: [] }];
		for (const item of Object.values(spec.paths))
			for (const op of [item?.post, item?.get])
				if (op) {
					op.parameters = [header];
					op.responses = { ...op.responses, "400": error };
				}
		// One operation differs.
		const create = spec.paths["/orders"]?.post;
		if (!create) throw new Error("Missing fixture operation");
		create.parameters = [
			header,
			{ name: "dry", in: "query", schema: { type: "boolean" } },
		];
		const files = await generate(spec);
		const skill = files.get("SKILL.md");
		expect(skill).toContain("## Every operation");
		expect(skill).toContain("- `x-tenant` (header): string");
		expect(skill).toContain("Security: token");
		expect(skill).toContain("- 400 Bad request: object");
		expect(files.get("references/resources/Order.md")).not.toContain(
			"x-tenant",
		);
		const page = files.get("references/operations/createOrder.md");
		expect(page).toContain("- `dry` (query): boolean");
		expect(page).not.toContain("Errors:");
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
