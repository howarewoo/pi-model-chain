import { randomBytes } from "node:crypto";
import { readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { parseConfig, type Config } from "./config.ts";

export const emptyConfig = (): Config => ({ version: 1, chains: Object.create(null) });

/** Read the config file; a missing file is an empty config, anything invalid throws. */
export async function readConfigFile(path: string): Promise<{ config: Config; raw?: string }> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { config: emptyConfig() };
    throw error;
  }
  return { config: parseConfig(JSON.parse(raw)), raw };
}

export function serializeConfig(config: Config): string {
  const chains = Object.fromEntries(
    Object.entries(config.chains).map(([name, targets]) => [
      name,
      targets.map(({ provider, model, effort }) => ({ provider, model, effort })),
    ]),
  );
  return `${JSON.stringify({ version: 1, chains }, null, 2)}\n`;
}

/**
 * Validate and atomically replace the config file. `expected` is the content read when editing
 * began (undefined when there was no file); a different file on disk is never overwritten.
 * Saving no chains removes the file, because a config must name at least one chain.
 */
export async function writeConfigFile(
  path: string,
  config: Config,
  expected: string | undefined,
): Promise<string | undefined> {
  const current = await readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (current !== expected)
    throw new Error(`${basename(path)} changed on disk; reopen /chain to edit the current file`);
  if (!Object.keys(config.chains).length) {
    if (current !== undefined) await unlink(path);
    return undefined;
  }
  const raw = serializeConfig(config);
  parseConfig(JSON.parse(raw));
  const temporary = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    await writeFile(temporary, raw, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return raw;
}
