#!/usr/bin/env bun
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { consola } from "consola";

const INPUT_DIR = "examples/input";
const OUTPUT_DIR = "examples/output";

async function main() {
	// Clean output directory
	await rm(OUTPUT_DIR, { recursive: true, force: true });

	// Get all input specs
	const files = await readdir(INPUT_DIR);
	const specs = files.filter((f) => f.endsWith(".yaml") || f.endsWith(".json"));

	// Generate output for each
	for (const spec of specs) {
		consola.start(`Processing ${spec}`);
		const inputPath = join(INPUT_DIR, spec);

		const proc = Bun.spawn(
			["bun", "run", "src/cli.ts", inputPath, "-o", OUTPUT_DIR, "--force"],
			{
				stdout: "inherit",
				stderr: "inherit",
			},
		);

		await proc.exited;
	}

	consola.success("Snapshots updated");
}

main();
