const { execFileSync } = require("node:child_process");

try {
  const out = execFileSync("tesseract", ["--version"], { stdio: ["ignore", "pipe", "pipe"] }).toString();
  const match = /tesseract\s+(\d+)\.(\d+)/i.exec(out);
  if (!match) {
    process.stderr.write("Could not parse tesseract version. Install Tesseract 5.x: https://github.com/tesseract-ocr/tesseract\n");
    process.exit(1);
  }
  const major = Number(match[1]);
  if (major < 5) {
    process.stderr.write(`Tesseract ${match[0]} found, but >= 5.0 required.\n`);
    process.exit(1);
  }
  process.stdout.write(`tesseract ${match[1]}.${match[2]} OK\n`);
} catch (err) {
  process.stderr.write(
    "Native 'tesseract' binary not found on PATH. Install via:\n" +
    "  macOS:   brew install tesseract\n" +
    "  Debian:  sudo apt-get install tesseract-ocr\n" +
    "Repo: https://github.com/tesseract-ocr/tesseract\n"
  );
  process.exit(1);
}
