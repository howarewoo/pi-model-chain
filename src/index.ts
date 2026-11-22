import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { parseConfig } from "./config.ts";
import { installChain } from "./chain.ts";

export default async function modelChain(pi: ExtensionAPI) {
  const path = join(getAgentDir(), "model-chain.json");
  try {
    installChain(pi, parseConfig(JSON.parse(await readFile(path, "utf8"))));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw new Error(`Cannot load ${path}: ${String(error)}`);
  }
}
