const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

function buildArgs(inputPath, format, options) {
  const { psm, tessdataDir } = options;
  return [
    inputPath,
    "stdout",
    "--tessdata-dir",
    tessdataDir,
    "-l",
    "eng",
    "--psm",
    String(psm),
    "-c",
    "preserve_interword_spaces=1",
    format
  ];
}

async function runTesseract(inputPath, format, options) {
  const args = buildArgs(inputPath, format, options);
  const { stdout } = await execFileAsync("tesseract", args, {
    maxBuffer: 20 * 1024 * 1024,
    timeout: 60_000
  });
  return stdout;
}

module.exports = { buildArgs, runTesseract };
