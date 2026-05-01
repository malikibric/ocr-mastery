import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);

export async function extractRawText(
  filePath: string,
  fileExtension: string
): Promise<string> {
  switch (fileExtension) {
    case "csv":
    case "txt":
      return fs.readFile(filePath, "utf8");
    case "pdf":
      return runHelperScript("extract-pdf-text.mjs", filePath);
    case "png":
    case "jpg":
    case "jpeg":
      return runHelperScript("extract-image-text.cjs", filePath);
    default:
      throw new Error(`Unsupported file extension: ${fileExtension}`);
  }
}

async function runHelperScript(scriptName: string, filePath: string) {
  const { stdout } = await execFileAsync(
    process.execPath,
    [path.join(process.cwd(), "scripts", scriptName), filePath],
    {
      maxBuffer: 10 * 1024 * 1024
    }
  );

  return stdout;
}
