import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Eta, type EtaConfig } from "eta";
import type {
	AuthSchemeDocument,
	OperationDocument,
	Renderer,
	ResourceDocument,
	SchemaDocument,
	SchemaGroupDocument,
	SkillDocument,
} from "./types.js";

// Default templates directory (relative to this file in dist)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_TEMPLATES_DIR = join(__dirname, "..", "templates");

/**
 * Template-based Markdown renderer using Eta
 *
 * Supports partial template overrides: if a custom template directory is provided,
 * templates are first looked up there, then fall back to the default templates.
 */
export class TemplateRenderer implements Renderer {
	private defaultEta: Eta;
	private customEta?: Eta;
	private customDir?: string;

	constructor(templateDir?: string) {
		const defaultDir = DEFAULT_TEMPLATES_DIR;
		this.customDir = templateDir;

		if (!existsSync(defaultDir)) {
			throw new Error(`Default templates directory not found: ${defaultDir}`);
		}

		if (this.customDir && !existsSync(this.customDir)) {
			throw new Error(
				`Custom templates directory not found: ${this.customDir}`,
			);
		}

		const etaConfig: Partial<EtaConfig> = {
			autoEscape: false, // Don't escape - we're generating Markdown
			autoTrim: false, // Preserve newlines after tags
		};

		this.defaultEta = new Eta({ views: defaultDir, ...etaConfig });

		if (this.customDir) {
			this.customEta = new Eta({ views: this.customDir, ...etaConfig });
		}
	}

	/**
	 * Render a template, checking custom dir first then falling back to default
	 */
	private render(templateName: string, data: object): string {
		if (this.customDir && this.customEta) {
			const customPath = join(this.customDir, templateName);
			if (existsSync(customPath)) {
				return this.customEta.render(templateName, data);
			}
		}
		return this.defaultEta.render(templateName, data);
	}

	renderSkill(doc: SkillDocument): string {
		const totalOps = doc.resources.reduce(
			(sum, r) => sum + r.operations.length,
			0,
		);
		const totalSchemas = doc.schemaGroups.reduce(
			(sum, g) => sum + g.schemas.length,
			0,
		);

		return this.render("skill.md.eta", {
			...doc,
			totalOps,
			totalSchemas,
			toFileName,
		});
	}

	renderResource(doc: ResourceDocument): string {
		return this.render("resource.md.eta", {
			...doc,
			toFileName,
		});
	}

	renderOperation(doc: OperationDocument): string {
		return this.render("operation.md.eta", {
			...doc,
			toFileName,
			extractSchemaPrefix,
		});
	}

	renderSchema(doc: SchemaDocument): string {
		return this.render("schema.md.eta", {
			...doc,
			toFileName,
		});
	}

	renderSchemaIndex(group: SchemaGroupDocument): string {
		return this.render("schema-index.md.eta", {
			...group,
			toFileName,
		});
	}

	renderAuthentication(schemes: AuthSchemeDocument[]): string {
		return this.render("authentication.md.eta", { schemes });
	}
}

// =============================================================================
// Utility helpers (exported for testing and reuse)
// =============================================================================

export function toFileName(name: string): string {
	return name
		.replace(/[^a-zA-Z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.replace(/-{2,}/g, "-");
}

export function extractSchemaPrefix(name: string): string {
	const match = name.match(/^([A-Z][a-z]+)/);
	if (match?.[1]) return match[1];

	const underscoreMatch = name.match(/^([^_]+)/);
	if (underscoreMatch?.[1]) return underscoreMatch[1];

	return "Other";
}

/**
 * Create a renderer instance
 * @param templateDir - Optional custom templates directory
 */
export function createRenderer(templateDir?: string): Renderer {
	return new TemplateRenderer(templateDir);
}
