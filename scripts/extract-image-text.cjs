const { createWorker } = require("tesseract.js");

const LOCAL_LANG_PATH = process.cwd();
const CONFIDENCE_THRESHOLD = 60;

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

async function ocr(filePath, lang) {
  const opts = lang === "eng"
    ? { langPath: LOCAL_LANG_PATH, logger: () => {} }
    : { logger: () => {} };
  const worker = await createWorker(lang, 1, opts);
  const { data } = await worker.recognize(filePath);
  await worker.terminate();
  return data;
}

async function detectLang(filePath) {
  try {
    const worker = await createWorker("osd", 1, { logger: () => {} });
    const { data } = await worker.detect(filePath);
    await worker.terminate();
    return SCRIPT_TO_LANG[data.script] ?? "eng";
  } catch {
    return "eng";
  }
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) throw new Error("An image file path is required.");

  // Fast path: try eng first (local file, no download, single worker)
  const engData = await ocr(filePath, "eng");

  if (engData.confidence >= CONFIDENCE_THRESHOLD) {
    process.stdout.write(engData.text);
    return;
  }

  // Low confidence — detect script and retry with correct language
  const lang = await detectLang(filePath);

  if (lang === "eng") {
    process.stdout.write(engData.text);
    return;
  }

  try {
    const retryData = await ocr(filePath, lang);
    process.stdout.write(retryData.text);
  } catch {
    // Language data unavailable — use eng result
    process.stdout.write(engData.text);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
