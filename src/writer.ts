import { mkdir as fsMkdir, writeFile as fsWriteFile } from "node:fs/promises";
import type { Writer } from "./types.js";

/**
 * Default file system writer implementation
 */
export class FileSystemWriter implements Writer {
	async writeFile(path: string, content: string): Promise<void> {
		await fsWriteFile(path, content, "utf-8");
	}

	async mkdir(path: string): Promise<void> {
		await fsMkdir(path, { recursive: true });
	}
}

/**
 * Create the default writer
 */
export function createWriter(): Writer {
	return new FileSystemWriter();
}
