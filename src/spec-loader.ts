import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import type { OpenAPISpec } from "./types.js";

function isHttpUrl(input: string): boolean {
	try {
		const url = new URL(input);
		return url.protocol === "http:" || url.protocol === "https:";
	} catch {
		return false;
	}
}

function parseSpecContent(content: string, hint: string): OpenAPISpec {
	const normalizedHint = hint.toLowerCase();

	if (normalizedHint.endsWith(".yaml") || normalizedHint.endsWith(".yml")) {
		return parseYaml(content) as OpenAPISpec;
	}

	if (normalizedHint.endsWith(".json")) {
		return JSON.parse(content) as OpenAPISpec;
	}

	try {
		return JSON.parse(content) as OpenAPISpec;
	} catch {
		return parseYaml(content) as OpenAPISpec;
	}
}

function getPathnameFromUrl(input: string): string {
	try {
		return new URL(input).pathname;
	} catch {
		return input;
	}
}

export async function loadSpecFromInput(input: string): Promise<OpenAPISpec> {
	if (isHttpUrl(input)) {
		const response = await fetch(input);
		if (!response.ok) {
			throw new Error(
				`Failed to fetch OpenAPI spec from URL (${response.status} ${response.statusText})`,
			);
		}
		const content = await response.text();
		return parseSpecContent(content, getPathnameFromUrl(input));
	}

	const content = await readFile(input, "utf-8");
	return parseSpecContent(content, input);
}
