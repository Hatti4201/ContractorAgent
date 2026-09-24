import "dotenv/config";
import { spawn } from "node:child_process";
import { cp, mkdir, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";

// Starts the dedicated Chrome the Dice exposure channel drives (Phase 9). It is an ordinary Chrome
// window with its own data directory and remote debugging on localhost; sign in to Dice there once.
//
//   npm run exposure:chrome                         start it
//   npm run exposure:chrome -- --copy-from "<dir>"  first time only: copy an existing Chrome profile
//
// Chrome refuses remote debugging on its default data directory, so the profile has to be a copy.
// Close the source profile's Chrome before copying so its databases are consistent.

async function exists(path: string) {
  return stat(path).then(() => true, () => false);
}

async function main() {
  const dataDir = process.env.DICE_CHROME_USER_DATA_DIR ?? "";
  if (!isAbsolute(dataDir)) throw new Error("Set DICE_CHROME_USER_DATA_DIR in .env to an absolute path outside this repository.");
  if (!relative(process.cwd(), dataDir).startsWith("..")) throw new Error("DICE_CHROME_USER_DATA_DIR must stay outside this repository.");
  const port = new URL(process.env.EXPOSURE_CDP_URL ?? "http://127.0.0.1:9222").port || "9222";

  const copyFlag = process.argv.indexOf("--copy-from");
  if (copyFlag !== -1) {
    const source = process.argv[copyFlag + 1] ?? "";
    if (!isAbsolute(source) || !await exists(source)) throw new Error("--copy-from needs the absolute path of an existing Chrome profile directory.");
    if (await exists(dataDir)) throw new Error("DICE_CHROME_USER_DATA_DIR already exists; refusing to overwrite it.");
    await mkdir(dataDir, { recursive: true });
    await cp(source, join(dataDir, "Default"), { recursive: true });
    const localState = join(dirname(source), "Local State");
    if (await exists(localState)) await cp(localState, join(dataDir, "Local State"));
    console.log("Profile copied. If Dice asks you to sign in, do it once in the window that opens.");
  }

  spawn("open", ["-na", "Google Chrome", "--args", `--user-data-dir=${dataDir}`, `--remote-debugging-port=${port}`, "https://www.dice.com/dashboard"], { stdio: "ignore", detached: true }).unref();
  console.log(`Exposure Chrome starting with remote debugging on 127.0.0.1:${port}. Keep this window open while the channel runs.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Could not start the exposure Chrome.");
  process.exitCode = 1;
});
