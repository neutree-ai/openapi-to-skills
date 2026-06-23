import { join } from "node:path";
import { consola } from "consola";
import { createParser } from "./parser.js";
import { createRenderer, toFileName } from "./renderer.js";
import type {
	ConvertOptions,
	OpenAPISpec,
	Renderer,
	SchemaGroupDocument,
	SkillDocument,
	Writer,
} from "./types.js";
import { createWriter } from "./writer.js";

/**
 * Convert an OpenAPI spec to Agent Skills format
 */
export async function convertOpenAPIToSkill(
	spec: OpenAPISpec,
	options: ConvertOptions,
): Promise<void> {
	const parser = createParser();
	const renderer = options.renderer ?? createRenderer(options.templateDir);
	const writer = options.writer ?? createWriter();

	// Parse OpenAPI to IR
	let doc = parser.parse(spec, options.parser);

	// Apply case strategy to IR before rendering
	if (options.caseStrategy === "lowercase") {
		doc = applyCaseStrategyLowercase(doc);
	}

	// Write output
	await writeSkillOutput(doc, options.outputDir, renderer, writer);

	// Overlay hand-authored static assets. Applied *after* generation so they
	// survive `--force` (which wipes the skill dir before this) and override any
	// generated file of the same relative path.
	if (options.assetsDir) {
		if (!writer.copyDir) {
			throw new Error("Writer does not support copyDir; cannot overlay assets");
		}
		const skillDir = join(options.outputDir, doc.meta.name);
		await writer.copyDir(options.assetsDir, skillDir);
		consola.success(`Overlaid static assets from ${options.assetsDir}`);
	}
}

/**
 * Transform IR for lowercase case strategy:
 * 1. Merge schema groups whose prefixes differ only in case
 * 2. Lowercase all group prefixes and schema names
 * 3. Disambiguate colliding names with numeric suffixes
 */
function applyCaseStrategyLowercase(doc: SkillDocument): SkillDocument {
	// Merge groups by case-insensitive prefix
	const mergedMap = new Map<string, SchemaGroupDocument>();

	for (const group of doc.schemaGroups) {
		const key = group.prefix.toLowerCase();

		const existing = mergedMap.get(key);
		if (existing) {
			existing.schemas.push(...group.schemas);
		} else {
			mergedMap.set(key, { prefix: key, schemas: [...group.schemas] });
		}
	}

	// Disambiguate schema names within each group
	const newGroups: SchemaGroupDocument[] = [];

	for (const group of mergedMap.values()) {
		const usedNames = new Set<string>();
		const renamedSchemas = group.schemas.map((schema) => {
			const baseName = toFileName(schema.name).toLowerCase();
			let finalName = baseName;
			let counter = 2;

			while (usedNames.has(finalName)) {
				finalName = `${baseName}-${counter}`;
				counter++;
			}

			usedNames.add(finalName);
			return { ...schema, name: finalName };
		});

		newGroups.push({ prefix: group.prefix, schemas: renamedSchemas });
	}

	return { ...doc, schemaGroups: newGroups };
}

/**
 * Write skill document to filesystem
 */
async function writeSkillOutput(
	doc: SkillDocument,
	outputDir: string,
	renderer: Renderer,
	writer: Writer,
): Promise<void> {
	const skillDir = join(outputDir, doc.meta.name);
	const referencesDir = join(skillDir, "references");
	const resourcesDir = join(referencesDir, "resources");
	const operationsDir = join(referencesDir, "operations");
	const schemasDir = join(referencesDir, "schemas");

	// Create directories
	await writer.mkdir(skillDir);
	await writer.mkdir(resourcesDir);
	await writer.mkdir(operationsDir);
	await writer.mkdir(schemasDir);

	// Write SKILL.md
	const skillMd = renderer.renderSkill(doc);
	await writer.writeFile(join(skillDir, "SKILL.md"), skillMd);
	consola.success("Generated SKILL.md");

	// Write resources and operations
	let totalOps = 0;
	for (const resource of doc.resources) {
		const fileName = toFileName(resource.tag);

		// Resource index
		const resourceMd = renderer.renderResource(resource);
		await writer.writeFile(join(resourcesDir, `${fileName}.md`), resourceMd);

		// Individual operation files
		for (const op of resource.operations) {
			const opFileName = toFileName(op.operationId);
			const opMd = renderer.renderOperation(op);
			await writer.writeFile(join(operationsDir, `${opFileName}.md`), opMd);
			totalOps++;
		}

		consola.success(
			`Generated resources/${fileName}.md + ${resource.operations.length} operation files`,
		);
	}

	// Write schema groups
	let totalSchemas = 0;
	for (const group of doc.schemaGroups) {
		const prefixDir = join(schemasDir, toFileName(group.prefix));
		await writer.mkdir(prefixDir);

		// Schema index
		const indexMd = renderer.renderSchemaIndex(group);
		await writer.writeFile(join(prefixDir, "_index.md"), indexMd);

		// Individual schema files
		for (const schema of group.schemas) {
			const schemaMd = renderer.renderSchema(schema);
			await writer.writeFile(
				join(prefixDir, `${toFileName(schema.name)}.md`),
				schemaMd,
			);
			totalSchemas++;
		}
	}
	consola.success(
		`Generated ${doc.schemaGroups.length} schema groups, ${totalSchemas} schema files`,
	);

	// Write authentication
	if (doc.authSchemes.length > 0) {
		const authMd = renderer.renderAuthentication(doc.authSchemes);
		await writer.writeFile(join(referencesDir, "authentication.md"), authMd);
		consola.success("Generated references/authentication.md");
	}

	consola.box(
		`Skill generated at: ${skillDir}\n${doc.resources.length} resources, ${totalOps} operations, ${doc.schemaGroups.length} schema groups`,
	);
}
