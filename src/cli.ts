#!/usr/bin/env node
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { defineCommand, runMain } from "citty";
import { consola } from "consola";
import { convertOpenAPIToSkill } from "./converter.js";
import { toFileName } from "./renderer.js";
import { loadSpecFromInput } from "./spec-loader.js";
import type { OpenAPISpec } from "./types.js";
import { validateArgs } from "./validate.js";

const main = defineCommand({
	meta: {
		name: "openapi-to-skills",
		version: "0.3.2",
		description: "Convert OpenAPI specifications to Agent Skills format",
	},
	args: {
		input: {
			type: "positional",
			description: "Path or URL to OpenAPI spec (JSON or YAML)",
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
		assets: {
			type: "string",
			alias: "a",
			description:
				"Static assets directory overlaid onto the skill after generation (survives --force; overrides generated files of the same path)",
		},
		excludePaths: {
			type: "string",
			description: "Exclude paths matching these prefixes (comma-separated)",
		},
		groupBy: {
			type: "string",
			alias: "g",
			description:
				"How to group operations: 'tags' (use OpenAPI tags), 'path' (use first path segment), 'auto' (tags if available, else path)",
			default: "auto",
		},
		caseStrategy: {
			type: "string",
			description:
				"Strategy for case-insensitive filesystem safety: 'lowercase' (lowercase all paths, disambiguate collisions)",
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

		const spec: OpenAPISpec = await loadSpecFromInput(inputFile);

		// Validate spec and options
		let validated: ReturnType<typeof validateArgs>;
		try {
			validated = validateArgs({ spec, ...args });
		} catch (err) {
			consola.error((err as Error).message);
			process.exit(1);
		}
		const { groupBy, caseStrategy } = validated;

		// Derive skill name for output path check
		const skillName = args.name ?? toFileName(spec.info.title).toLowerCase();
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

		// Validate the assets dir up front: it must exist and live outside the
		// output dir (anything inside outputPath was just wiped by --force).
		if (args.assets) {
			if (!existsSync(args.assets)) {
				consola.error(`Assets directory not found: ${args.assets}`);
				process.exit(1);
			}
			const assetsAbs = resolve(args.assets);
			const outputAbs = resolve(outputPath);
			if (
				assetsAbs === outputAbs ||
				assetsAbs.startsWith(`${outputAbs}${sep}`)
			) {
				consola.error(
					`Assets directory must be outside the output directory: ${args.assets}`,
				);
				process.exit(1);
			}
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
			assetsDir: args.assets,
			caseStrategy,
			parser: {
				skillName: args.name,
				groupBy,
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
