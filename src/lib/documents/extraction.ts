import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import type { ImageOcrLayout, OcrBoundingBox } from "@/lib/documents/image-layout";
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
      return runImageTextScript(filePath);
    default:
      throw new Error(`Unsupported file extension: ${fileExtension}`);
  }
}

async function runHelperScript(scriptName: string, filePath: string) {
  const { stdout } = await execFileAsync(
    process.execPath,
    [path.join(process.cwd(), "scripts", scriptName), filePath],
    {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 60_000
    }
  );

  return stdout;
}

async function runImageTextScript(filePath: string, psm = 6) {
  const { stdout } = await execFileAsync(
    process.execPath,
    [path.join(process.cwd(), "scripts", "extract-image-text.cjs"), filePath, String(psm)],
    {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 60_000
    }
  );

  return stdout;
}

export async function extractImageLayout(filePath: string): Promise<ImageOcrLayout> {
  const output = await runHelperScript("extract-image-layout.cjs", filePath);
  return JSON.parse(output) as ImageOcrLayout;
}

export async function extractCroppedImageText(
  filePath: string,
  bbox: OcrBoundingBox,
  options?: {
    paddingRatio?: number;
    minimumPadding?: number;
    psm?: number;
  }
): Promise<string> {
  const metadata = await sharp(filePath).metadata();
  const imageWidth = metadata.width ?? 0;
  const imageHeight = metadata.height ?? 0;

  if (imageWidth <= 0 || imageHeight <= 0) {
    throw new Error("Unable to read image metadata for OCR crop.");
  }

  const width = bbox.x1 - bbox.x0;
  const height = bbox.y1 - bbox.y0;
  const paddingRatio = options?.paddingRatio ?? 0.12;
  const minimumPadding = options?.minimumPadding ?? 32;
  const horizontalPadding = Math.max(minimumPadding, Math.round(width * paddingRatio));
  const verticalPadding = Math.max(minimumPadding, Math.round(height * paddingRatio));
  const left = Math.max(0, Math.floor(bbox.x0 - horizontalPadding));
  const top = Math.max(0, Math.floor(bbox.y0 - verticalPadding));
  const extractWidth = Math.max(
    1,
    Math.min(imageWidth - left, Math.ceil(width + horizontalPadding * 2))
  );
  const extractHeight = Math.max(
    1,
    Math.min(imageHeight - top, Math.ceil(height + verticalPadding * 2))
  );
  const tempFilePath = path.join(
    os.tmpdir(),
    `ocr-crop-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.png`
  );

  try {
    await sharp(filePath)
      .extract({
        left,
        top,
        width: extractWidth,
        height: extractHeight
      })
      .png()
      .toFile(tempFilePath);

    return await runImageTextScript(tempFilePath, options?.psm ?? 6);
  } finally {
    await fs.unlink(tempFilePath).catch(() => {});
  }
}
