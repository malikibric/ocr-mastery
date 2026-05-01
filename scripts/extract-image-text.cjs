const { createWorker } = require("tesseract.js");

const LOCAL_LANG_PATH = process.cwd();

async function main() {
  const filePath = process.argv[2];
  if (!filePath) throw new Error("An image file path is required.");

  const worker = await createWorker("eng", 1, {
    langPath: LOCAL_LANG_PATH,
    logger: () => {}
  });
  const { data } = await worker.recognize(filePath);
  await worker.terminate();
  process.stdout.write(data.text);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
