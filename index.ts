// OpenAPI to Agent Skills Converter
// CLI: npx openapi-to-skills <openapi-file> -o <output-dir>
// API: import { convertOpenAPIToSkill } from 'openapi-to-skills'

// Main converter
export { convertOpenAPIToSkill } from "./src/converter.js";

// Parser, Renderer, Writer for DI
export { createParser, Parser } from "./src/parser.js";
export { createRenderer, TemplateRenderer } from "./src/renderer.js";
// Types
export type {
	// Options
	ConvertOptions,
	// OpenAPI types
	OpenAPISpec,
	OperationDocument,
	ParserFilter,
	ParserOptions,
	// Interfaces
	Renderer,
	ResourceDocument,
	SchemaDocument,
	SchemaGroupDocument,
	// IR types
	SkillDocument,
	Writer,
} from "./src/types.js";
export { createWriter, FileSystemWriter } from "./src/writer.js";
