// Re-export OpenAPI types from openapi-types
import type { OpenAPIV3 } from "openapi-types";

// OpenAPI 3.0 types
export type OpenAPISpec = OpenAPIV3.Document;
export type PathItemObject = OpenAPIV3.PathItemObject;
export type OperationObject = OpenAPIV3.OperationObject;
export type ParameterObject = OpenAPIV3.ParameterObject;
export type RequestBodyObject = OpenAPIV3.RequestBodyObject;
export type ResponseObject = OpenAPIV3.ResponseObject;
export type SchemaObject = OpenAPIV3.SchemaObject;
export type ReferenceObject = OpenAPIV3.ReferenceObject;
export type SecuritySchemeObject = OpenAPIV3.SecuritySchemeObject;
export type MediaTypeObject = OpenAPIV3.MediaTypeObject;

// =============================================================================
// Intermediate Representation (IR)
// =============================================================================

export interface SkillDocument {
	meta: SkillMeta;
	resources: ResourceDocument[];
	schemaGroups: SchemaGroupDocument[];
	authSchemes: AuthSchemeDocument[];
}

export interface SkillMeta {
	name: string;
	title: string;
	description: string;
	version: string;
	openapiVersion: string;
	license?: { name: string; url?: string };
	contact?: string;
	servers: ServerDocument[];
	securitySchemes: string[];
}

export interface ServerDocument {
	url: string;
	description?: string;
}

export interface ResourceDocument {
	tag: string;
	description?: string;
	operations: OperationDocument[];
}

export interface OperationDocument {
	operationId: string;
	path: string;
	method: string;
	tag: string;
	summary?: string;
	description?: string;
	deprecated: boolean;
	parameters: ParameterDocument[];
	requestBody?: RequestBodyDocument;
	responses: ResponseDocument[];
	security: SecurityRequirementDocument[];
}

export interface ParameterDocument {
	name: string;
	in: "query" | "header" | "path" | "cookie";
	type: string;
	required: boolean;
	description?: string;
	schema?: SchemaRefDocument;
}

export interface RequestBodyDocument {
	description?: string;
	required: boolean;
	contentTypes: string[];
	schema?: SchemaRefDocument;
}

export interface ResponseDocument {
	status: string;
	description: string;
	schema?: SchemaRefDocument;
}

export interface SecurityRequirementDocument {
	name: string;
	scopes: string[];
}

export interface SchemaGroupDocument {
	prefix: string;
	schemas: SchemaDocument[];
}

export interface SchemaDocument {
	name: string;
	type: "object" | "array" | "enum" | "primitive" | "allOf" | "oneOf" | "anyOf";
	description?: string;
	fields?: FieldDocument[];
	enumValues?: unknown[];
	composition?: SchemaRefDocument[];
	items?: SchemaRefDocument;
}

export interface FieldDocument {
	name: string;
	type: string;
	required: boolean;
	description?: string;
	schema?: SchemaRefDocument;
	nestedFields?: FieldDocument[];
}

export interface SchemaRefDocument {
	ref?: string;
	inline?: SchemaDocument;
}

export interface AuthSchemeDocument {
	name: string;
	type: string;
	description?: string;
	in?: string;
	scheme?: string;
	bearerFormat?: string;
	flows?: OAuthFlowDocument[];
	openIdConnectUrl?: string;
}

export interface OAuthFlowDocument {
	name: string;
	authorizationUrl?: string;
	tokenUrl?: string;
	scopes: Record<string, string>;
}

// =============================================================================
// Parser Options
// =============================================================================

export interface ParserOptions {
	/** Skill name override */
	skillName?: string;
	/** Filter options */
	filter?: ParserFilter;
}

export interface ParserFilter {
	/** Only include these tags */
	includeTags?: string[];
	/** Exclude these tags */
	excludeTags?: string[];
	/** Exclude deprecated operations */
	excludeDeprecated?: boolean;
	/** Exclude paths matching these patterns */
	excludePaths?: (string | RegExp)[];
}

// =============================================================================
// Renderer Interface
// =============================================================================

export interface Renderer {
	renderSkill(doc: SkillDocument): string;
	renderResource(doc: ResourceDocument): string;
	renderOperation(doc: OperationDocument): string;
	renderSchema(doc: SchemaDocument): string;
	renderSchemaIndex(group: SchemaGroupDocument): string;
	renderAuthentication(schemes: AuthSchemeDocument[]): string;
}

// =============================================================================
// Writer Interface
// =============================================================================

export interface Writer {
	writeFile(path: string, content: string): Promise<void>;
	mkdir(path: string): Promise<void>;
}

// =============================================================================
// Converter Options
// =============================================================================

export interface ConvertOptions {
	/** Output directory */
	outputDir: string;
	/** Parser options */
	parser?: ParserOptions;
	/** Custom templates directory (optional) */
	templateDir?: string;
	/** Custom renderer (optional, takes precedence over templateDir) */
	renderer?: Renderer;
	/** Custom writer (optional) */
	writer?: Writer;
}

// =============================================================================
// Helpers
// =============================================================================

export function isReferenceObject(obj: unknown): obj is ReferenceObject {
	return typeof obj === "object" && obj !== null && "$ref" in obj;
}
