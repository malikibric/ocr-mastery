const { createWorker } = require("tesseract.js");
const path = require("path");

const LOCAL_LANG_PATH = process.cwd(); // eng.traineddata lives here

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
  // No langPath — tesseract.js downloads osd.traineddata from CDN and caches it
  try {
    const worker = await createWorker("osd", 1, { logger: () => {} });
    const { data } = await worker.detect(filePath);
    await worker.terminate();
    return SCRIPT_TO_LANG[data.script] ?? "eng";
  } catch {
    return "eng";
  }
}

async function runOcr(filePath, lang) {
  // Use local eng.traineddata for English; CDN for everything else
  const opts = lang === "eng"
    ? { langPath: LOCAL_LANG_PATH, logger: () => {} }
    : { logger: () => {} };
  const worker = await createWorker(lang, 1, opts);
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
