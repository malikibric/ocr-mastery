import fs from "node:fs/promises";
import path from "node:path";

const serverDirectory = path.join(process.cwd(), ".next", "server");
const chunksDirectory = path.join(serverDirectory, "chunks");

async function main() {
  const entries = await fs.readdir(chunksDirectory, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".js")) {
      continue;
    }

    const source = path.join(chunksDirectory, entry.name);
    const destination = path.join(serverDirectory, entry.name);

    try {
      await fs.access(destination);
    } catch {
      await fs.copyFile(source, destination);
    }
  }
}

await main();
