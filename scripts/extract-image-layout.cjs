const sharp = require("sharp");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { runTesseract } = require("./lib/run-tesseract.cjs");

const TESSDATA_DIR = process.cwd();

async function preprocessImage(filePath) {
  const tmpPath = path.join(os.tmpdir(), `ocr_layout_${process.pid}_${Date.now()}.png`);
  await sharp(filePath).grayscale().normalize().png().toFile(tmpPath);
  return tmpPath;
}

function scoreLayout(layout) {
  return layout.words.reduce((score, word) => {
    const trimmedText = word.text.trim();
    const confidenceScore = Math.max(0, word.confidence) / 100;
    const lengthScore = Math.min(trimmedText.length, 16) / 16;
    return score + 1 + confidenceScore + lengthScore;
  }, 0);
}

function selectBestLayout(layouts) {
  return layouts.reduce((best, candidate) => {
    if (!best) {
      return candidate;
    }

    return scoreLayout(candidate) > scoreLayout(best) ? candidate : best;
  }, null);
}

function parseTsv(tsv, width, height) {
  const lines = tsv.split(/\r?\n/);
  const words = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const cols = line.split("\t");
    if (cols.length < 12) continue;
    const level = Number(cols[0]);
    if (level !== 5) continue; // word-level rows only
    const text = cols.slice(11).join("\t").trim();
    if (!text) continue;
    const left = Number(cols[6]);
    const top = Number(cols[7]);
    const w = Number(cols[8]);
    const h = Number(cols[9]);
    const conf = Number(cols[10]);
    if (!Number.isFinite(left) || !Number.isFinite(top) || !Number.isFinite(w) || !Number.isFinite(h)) continue;
    if (conf === -1) continue; // invalid confidence means no real word
    words.push({
      text,
      confidence: Number.isFinite(conf) ? conf : 0,
      bbox: { x0: left, y0: top, x1: left + w, y1: top + h }
    });
  }
  return { width, height, words };
}

async function extractLayout(filePath) {
  const metadata = await sharp(filePath).metadata();
  const tsv = await runTesseract(filePath, "tsv", {
    psm: "11",
    tessdataDir: TESSDATA_DIR
  });
  return parseTsv(tsv, metadata.width ?? 0, metadata.height ?? 0);
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
    const candidatePaths = [...new Set([preprocessed, filePath])];
    const layouts = [];

    for (const candidatePath of candidatePaths) {
      try {
        layouts.push(await extractLayout(candidatePath));
      } catch {
        // Try the next candidate path.
      }
    }

    const layout = selectBestLayout(layouts);

    if (!layout) {
      throw new Error("Unable to extract OCR layout.");
    }

    process.stdout.write(JSON.stringify(layout));
  } finally {
    if (preprocessed !== filePath && fs.existsSync(preprocessed)) {
      fs.unlinkSync(preprocessed);
    }
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}

module.exports = { parseTsv, scoreLayout, selectBestLayout };
