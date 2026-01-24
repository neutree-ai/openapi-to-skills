import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const INPUT_DIR = join(ROOT, "examples/input");
const OUTPUT_DIR = join(ROOT, "examples/output");

// =============================================================================
// Helpers
// =============================================================================

async function runCLI(
	...args: string[]
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const proc = Bun.spawn(["bun", "run", "src/cli.ts", ...args], {
		cwd: ROOT,
		stdout: "pipe",
		stderr: "pipe",
	});

	const stdout = await new Response(proc.stdout).text();
	const stderr = await new Response(proc.stderr).text();
	const exitCode = await proc.exited;

	return { exitCode, stdout, stderr };
}

async function readDirRecursive(dir: string): Promise<Map<string, string>> {
	const files = new Map<string, string>();
	const glob = new Bun.Glob("**/*");

	for await (const path of glob.scan({ cwd: dir, onlyFiles: true })) {
		const content = await Bun.file(join(dir, path)).text();
		files.set(path, content);
	}

	return files;
}

async function getInputSpecs(): Promise<string[]> {
	const files = await readdir(INPUT_DIR);
	return files.filter((f) => f.endsWith(".yaml") || f.endsWith(".json"));
}

async function getExpectedOutputDir(inputFile: string): Promise<string | null> {
	const outputs = await readdir(OUTPUT_DIR);
	const inputName = basename(inputFile, ".yaml").replace(".json", "");
	const match = outputs.find((dir) => dir.includes(inputName));
	return match ? join(OUTPUT_DIR, match) : null;
}

// =============================================================================
// Snapshot Tests
// =============================================================================

describe("e2e snapshot tests", async () => {
	let tempDir: string;

	beforeAll(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "openapi-to-skills-e2e-"));
	});

	afterAll(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	const specs = await getInputSpecs();

	for (const spec of specs) {
		describe(spec, async () => {
			let actual: Map<string, string>;
			let expected: Map<string, string>;
			let expectedFiles: string[];

			beforeAll(async () => {
				const inputPath = join(INPUT_DIR, spec);
				const outputDir = join(tempDir, spec);

				// Run CLI
				const result = await runCLI(inputPath, "-o", outputDir);
				if (result.exitCode !== 0) {
					throw new Error(`CLI failed: ${result.stderr}`);
				}

				// Find expected output directory
				const expectedDir = await getExpectedOutputDir(spec);
				if (!expectedDir) {
					throw new Error(`No expected output found for ${spec}`);
				}

				// Find actual output directory (first subdir)
				const actualOutputs = await readdir(outputDir);
				const actualDir = join(outputDir, actualOutputs[0]!);

				// Read both directories
				actual = await readDirRecursive(actualDir);
				expected = await readDirRecursive(expectedDir);
				expectedFiles = [...expected.keys()].sort();
			});

			test("has same files", () => {
				const actualFiles = [...actual.keys()].sort();
				expect(actualFiles).toEqual(expectedFiles);
			});

			// Generate one test per file
			const expectedDir = await getExpectedOutputDir(spec);
			if (expectedDir) {
				const files = await readDirRecursive(expectedDir);
				for (const [path] of files) {
					test(`file: ${path}`, () => {
						const expectedContent = expected.get(path);
						const actualContent = actual.get(path);
						expect(actualContent).toBe(expectedContent);
					});
				}
			}
		});
	}
});
