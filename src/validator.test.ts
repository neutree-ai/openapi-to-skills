import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
// @ts-expect-error: a plain script, shipped as is
import { validate } from "../runtime/validate.mjs";
import { createParser } from "./parser.js";
import type { OpenAPISpec } from "./types.js";
import { buildValidatorData } from "./validator.js";

async function data() {
	const spec: OpenAPISpec = parse(
		await readFile(new URL("./fixtures/compact.yaml", import.meta.url), "utf8"),
	);
	spec.paths["/orders/{id}"] = {
		get: {
			tags: ["Order"],
			operationId: "getOrder",
			parameters: [
				{ name: "id", in: "path", required: true, schema: { type: "string" } },
				{ name: "expand", in: "query", schema: { type: "boolean" } },
			],
			responses: { "200": { description: "The order" } },
		},
	};
	return buildValidatorData(spec, createParser().parse(spec));
}

const check = async (call: object): Promise<string[]> =>
	validate(await data(), call).issues;

describe("validator", () => {
	test("reduces each operation's input and the schemas it reaches", async () => {
		const d = await data();
		expect(Object.keys(d.operations).sort()).toEqual([
			"createOrder",
			"getOrder",
			"listOrders",
			"listUsers",
		]);
		expect(d.operations.listOrders?.body).toEqual({ ref: "OrderListInput" });
		expect(d.schemas.OrderListInput?.closed).toBe(true);
		expect(d.schemas.Unused).toBeUndefined();
		expect(d.filters.sort()).toEqual(["OrderWhereInput", "UserWhereInput"]);
	});

	test("accepts a well-formed call", async () => {
		expect(
			await check({
				operation: "listOrders",
				input: {
					where: { id_in: ["a"], state: "active", total_gt: 3 },
					orderBy: "total_DESC",
					first: 10,
				},
			}),
		).toEqual([]);
		expect(
			await check({ operation: "getOrder", input: { id: "a", expand: true } }),
		).toEqual([]);
	});

	test("names the closest operation and keys", async () => {
		expect(await check({ operation: "listOrder", input: {} })).toEqual([
			'operation: "listOrder" is not an operation in this skill; did you mean listOrders, getOrder?',
		]);
		expect(
			await check({ operation: "listOrders", input: { frist: 10 } }),
		).toEqual(["input.frist: unknown key; did you mean first?"]);
	});

	test("explains filter mistakes in terms of the field's keys", async () => {
		expect(
			await check({
				operation: "listOrders",
				input: { where: { total_lt: 3 } },
			}),
		).toEqual([
			"input.where.total_lt: unknown key; keys for this field: total, total_gt",
		]);
		expect(
			await check({
				operation: "listOrders",
				input: { where: { id: { in: ["a"] } } },
			}),
		).toEqual([
			'input.where.id: expected a string, not an object; filter operators are key suffixes like id_in, not nested objects: write {"id_in": [...]}',
		]);
	});

	test("says how to write an operator given as a nested object", async () => {
		expect(
			await check({
				operation: "listOrders",
				input: { where: { state: { in: ["active"] } }, orderBy: ["id_ASC"] },
			}),
		).toEqual([
			'input.where.state: expected one of "active", "inactive", "pending", "archived", "deleted", not an object; filter operators are key suffixes like state_in, not nested objects: write {"state_in": [...]}',
			'input.orderBy: expected one of "id_ASC", "id_DESC", "total_ASC", "total_DESC", not an array',
		]);
	});

	test("checks enum values, types, arrays, nulls and required keys", async () => {
		expect(
			await check({
				operation: "listOrders",
				input: { where: { state: "open", id_in: "a" }, first: "10" },
			}),
		).toEqual([
			'input.where.state: "open" is not valid; allowed: "active", "inactive", "pending", "archived", "deleted"',
			"input.where.id_in: expected an array of a string",
			'input.first: expected an integer, got "10"',
		]);
		expect(await check({ operation: "getOrder", input: {} })).toEqual([
			"input.id: required, missing",
		]);
		expect(
			await check({
				operation: "createOrder",
				input: { id: null, state: "active" },
			}),
		).toEqual(["input.id: must not be null"]);
	});

	test("warns, without failing, on keys an open object does not list", async () => {
		const result = validate(await data(), {
			operation: "createOrder",
			input: { id: "a", state: "active", customer: { id: "u", nickname: "x" } },
		});
		expect(result.issues).toEqual([]);
		expect(result.warnings).toEqual([
			"input.customer.nickname: unknown key; did you mean name? (not in the spec; it may be ignored)",
		]);
	});
});
