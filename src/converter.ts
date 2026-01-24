import { join } from "node:path";
import { consola } from "consola";
import { createParser } from "./parser.js";
import { createRenderer, toFileName } from "./renderer.js";
import type {
	ConvertOptions,
	OpenAPISpec,
	Renderer,
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
	const doc = parser.parse(spec, options.parser);

	// Write output
	await writeSkillOutput(doc, options.outputDir, renderer, writer);
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
