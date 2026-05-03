const sharp = require("sharp");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { runTesseract } = require("./lib/run-tesseract.cjs");

const TESSDATA_DIR = process.cwd();

async function preprocessImage(filePath) {
  const tmpPath = path.join(os.tmpdir(), `ocr_pre_${process.pid}_${Date.now()}.png`);
  await sharp(filePath).grayscale().png().toFile(tmpPath);
  return tmpPath;
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) throw new Error("An image file path is required.");

  let preprocessed = null;
  try {
    preprocessed = await preprocessImage(filePath);
  } catch {
    preprocessed = filePath;
  }

  try {
    const stdout = await runTesseract(preprocessed, "txt", {
      psm: "6",
      tessdataDir: TESSDATA_DIR
    });
    process.stdout.write(stdout);
  } finally {
    if (preprocessed !== filePath && fs.existsSync(preprocessed)) {
      fs.unlinkSync(preprocessed);
    }
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
