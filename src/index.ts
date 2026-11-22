import { join } from "node:path";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installChain } from "./chain.ts";
import { readConfigFile } from "./store.ts";

export default async function modelChain(pi: ExtensionAPI) {
  const path = join(getAgentDir(), "model-chain.json");
  let config;
  try {
    // A missing file means no chains yet; /chain can create the first one.
    ({ config } = await readConfigFile(path));
  } catch (error) {
    throw new Error(`Cannot load ${path}: ${String(error)}`);
  }
  installChain(pi, config, { path });
}
