const { createWorker } = require("tesseract.js");
const path = require("path");

// traineddata files are cached here alongside eng.traineddata
const LANG_PATH = process.cwd();

// Maps tesseract OSD script names → tesseract language codes
const SCRIPT_TO_LANG = {
  Latin: "eng",
  Cyrillic: "rus",
  Arabic: "ara",
  Devanagari: "hin",
  "Han Simplified": "chi_sim",
  "Han Traditional": "chi_tra",
  Japanese: "jpn",
  Korean: "kor",
  Greek: "ell",
  Hebrew: "heb",
  Thai: "tha",
};

async function detectLang(filePath) {
  // osd.traineddata is downloaded to LANG_PATH on first use and cached
  try {
    const worker = await createWorker("osd", 1, { langPath: LANG_PATH, logger: () => {} });
    const { data } = await worker.detect(filePath);
    await worker.terminate();
    return SCRIPT_TO_LANG[data.script] ?? "eng";
  } catch {
    return "eng";
  }
}

async function runOcr(filePath, lang) {
  const worker = await createWorker(lang, 1, { langPath: LANG_PATH, logger: () => {} });
  const { data } = await worker.recognize(filePath);
  await worker.terminate();
  return data.text;
}

async function main() {
  const filePath = process.argv[2];

  if (!filePath) {
    throw new Error("An image file path is required.");
  }

  const lang = await detectLang(filePath);

  try {
    const text = await runOcr(filePath, lang);
    process.stdout.write(text);
  } catch {
    // Detected language data unavailable — fall back to eng
    if (lang !== "eng") {
      const text = await runOcr(filePath, "eng");
      process.stdout.write(text);
    } else {
      throw new Error("OCR failed for this image.");
    }
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
