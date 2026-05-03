const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

function buildArgs(inputPath, format, options) {
  const { psm, tessdataDir } = options;
  const args = [
    inputPath,
    "stdout",
    "-l",
    "eng",
    "--psm",
    String(psm)
  ];

  if (format !== "tsv" && tessdataDir) {
    args.splice(2, 0, "--tessdata-dir", tessdataDir);
  }

  if (format === "txt") {
    args.push("-c", "preserve_interword_spaces=1");
  } else {
    args.push(format);
  }

  return args;
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
