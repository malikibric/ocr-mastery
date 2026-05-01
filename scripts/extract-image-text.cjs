const { createWorker } = require("tesseract.js");

async function main() {
  const filePath = process.argv[2];

  if (!filePath) {
    throw new Error("An image file path is required.");
  }

  const worker = await createWorker("eng");
  const { data } = await worker.recognize(filePath);
  await worker.terminate();
  process.stdout.write(data.text);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
