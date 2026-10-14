import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const INPUT = join(ROOT, "src/fixtures/compact.yaml");

async function cli(...args: string[]) {
	const proc = Bun.spawn(["bun", "run", "src/cli.ts", INPUT, ...args], {
		cwd: ROOT,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		proc.exited,
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	return { exitCode, stdout, stderr };
}

describe("compact CLI", () => {
	let temp: string;
	beforeAll(async () => {
		temp = await mkdtemp(join(tmpdir(), "openapi-compact-cli-"));
	});
	afterAll(async () => {
		await rm(temp, { recursive: true, force: true });
	});

	test("selects compact output with --layout compact", async () => {
		const output = join(temp, "compact");
		const result = await cli(
			"--layout",
			"compact",
			"--group-by",
			"tags",
			"-o",
			output,
		);
		expect(result.exitCode).toBe(0);
		const root = join(output, "compact-test-api");
		expect(await readFile(join(root, "SKILL.md"), "utf8")).toContain(
			"Filter suffix rules",
		);
		expect(
			await readFile(join(root, "references/resources/Order.md"), "utf8"),
		).toContain("listOrders");
		expect(existsSync(join(root, "references/operations/createOrder.md"))).toBe(
			true,
		);
		expect(
			await readFile(join(root, "references/resources/Order.md"), "utf8"),
		).toContain("../operations/createOrder.md");
	});

	test("rejects an invalid layout before --force removes existing output", async () => {
		const output = join(temp, "invalid");
		const root = join(output, "compact-test-api");
		await mkdir(root, { recursive: true });
		await writeFile(join(root, "keep.txt"), "keep");
		const result = await cli("--layout", "unknown", "--force", "-o", output);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("Invalid --layout");
		expect(await readFile(join(root, "keep.txt"), "utf8")).toBe("keep");
	});

	test("keeps asset overlays working with --force in compact mode", async () => {
		const output = join(temp, "overlay");
		const assets = join(temp, "assets");
		await mkdir(assets);
		await writeFile(join(assets, "SKILL.md"), "Custom skill\n");
		for (let i = 0; i < 2; i++) {
			const result = await cli(
				"--layout",
				"compact",
				"--assets",
				assets,
				"--force",
				"-o",
				output,
			);
			expect(result.exitCode).toBe(0);
			expect(
				await readFile(join(output, "compact-test-api/SKILL.md"), "utf8"),
			).toBe("Custom skill\n");
		}
	});

	test("supports partial compact template overrides", async () => {
		const output = join(temp, "templates-output");
		const templates = join(temp, "templates");
		await mkdir(templates);
		await writeFile(
			join(templates, "compact-resource.md.eta"),
			"# Custom <%= it.title %>\n\n<%~ it.body %>\n",
		);
		await writeFile(
			join(templates, "compact-operation.md.eta"),
			"# Custom operation <%= it.title %>\n\n<%~ it.body %>\n",
		);
		const result = await cli(
			"--layout",
			"compact",
			"--templates",
			templates,
			"-o",
			output,
		);
		expect(result.exitCode).toBe(0);
		expect(
			await readFile(
				join(output, "compact-test-api/references/resources/Order.md"),
				"utf8",
			),
		).toContain("# Custom Order");
		expect(
			await readFile(
				join(output, "compact-test-api/references/operations/createOrder.md"),
				"utf8",
			),
		).toContain("# Custom operation createOrder");
		expect(
			await readFile(join(output, "compact-test-api/SKILL.md"), "utf8"),
		).toContain("Filter suffix rules");
	});
});
