#!/usr/bin/env node
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { defineCommand, runMain } from "citty";
import { consola } from "consola";
import { parse as parseYaml } from "yaml";
import { convertOpenAPIToSkill } from "./converter.js";
import type { OpenAPISpec } from "./types.js";

const main = defineCommand({
	meta: {
		name: "openapi-to-skills",
		version: "0.1.0",
		description: "Convert OpenAPI specifications to Agent Skills format",
	},
	args: {
		input: {
			type: "positional",
			description: "Path to OpenAPI spec (JSON or YAML)",
			required: true,
		},
		output: {
			type: "string",
			alias: "o",
			description: "Output directory",
			default: "./output",
		},
		name: {
			type: "string",
			alias: "n",
			description: "Skill name (default: derived from API title)",
		},
		includeTags: {
			type: "string",
			description: "Only include these tags (comma-separated)",
		},
		excludeTags: {
			type: "string",
			description: "Exclude these tags (comma-separated)",
		},
		excludeDeprecated: {
			type: "boolean",
			description: "Exclude deprecated operations",
			default: false,
		},
		templates: {
			type: "string",
			alias: "t",
			description: "Custom templates directory",
		},
		excludePaths: {
			type: "string",
			description: "Exclude paths matching these prefixes (comma-separated)",
		},
		force: {
			type: "boolean",
			alias: "f",
			description: "Overwrite existing output directory",
			default: false,
		},
		quiet: {
			type: "boolean",
			alias: "q",
			description: "Suppress output except errors",
			default: false,
		},
	},
	async run({ args }) {
		const inputFile = args.input;

		// Configure logging
		if (args.quiet) {
			consola.level = 1; // Only errors
		}

		consola.start(`Reading OpenAPI spec: ${inputFile}`);

		const content = await readFile(inputFile, "utf-8");
		let spec: OpenAPISpec;

		if (inputFile.endsWith(".yaml") || inputFile.endsWith(".yml")) {
			spec = parseYaml(content) as OpenAPISpec;
		} else {
			spec = JSON.parse(content) as OpenAPISpec;
		}

		// Validate basic structure
		if (!spec.openapi) {
			consola.error('Invalid OpenAPI spec: missing "openapi" field');
			process.exit(1);
		}
		if (!spec.info?.title) {
			consola.error('Invalid OpenAPI spec: missing "info.title" field');
			process.exit(1);
		}
		if (!spec.paths) {
			consola.error('Invalid OpenAPI spec: missing "paths" field');
			process.exit(1);
		}

		// Derive skill name for output path check
		const skillName =
			args.name ??
			spec.info.title
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, "-")
				.replace(/^-+|-+$/g, "");
		const outputPath = join(args.output, skillName);

		// Check if output exists
		if (existsSync(outputPath)) {
			if (!args.force) {
				consola.error(
					`Output directory already exists: ${outputPath}\nUse --force to overwrite.`,
				);
				process.exit(1);
			}
			await rm(outputPath, { recursive: true });
		}

		consola.info(`API: ${spec.info.title} (v${spec.info.version})`);
		consola.info(`OpenAPI version: ${spec.openapi}`);
		consola.info(`Paths: ${Object.keys(spec.paths).length}`);
		consola.info(`Tags: ${spec.tags?.map((t) => t.name).join(", ") || "none"}`);

		if (spec.components?.schemas) {
			consola.info(`Schemas: ${Object.keys(spec.components.schemas).length}`);
		}

		consola.start("Converting to Agent Skill...");

		await convertOpenAPIToSkill(spec, {
			outputDir: args.output,
			templateDir: args.templates,
			parser: {
				skillName: args.name,
				filter: {
					includeTags: args.includeTags?.split(",").map((t) => t.trim()),
					excludeTags: args.excludeTags?.split(",").map((t) => t.trim()),
					excludeDeprecated: args.excludeDeprecated,
					excludePaths: args.excludePaths?.split(",").map((p) => p.trim()),
				},
			},
		});
	},
});

runMain(main);
