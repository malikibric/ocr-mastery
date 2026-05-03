import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import sharp from "sharp";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

describe("extract-image-text.cjs (native tesseract)", () => {
  it("extracts text from a synthesized PNG", async () => {
    const tmp = path.join(os.tmpdir(), `ocr-test-${Date.now()}.png`);
    await sharp({
      create: { width: 600, height: 120, channels: 3, background: "#ffffff" }
    })
      .composite([{
        input: Buffer.from(
          `<svg width="600" height="120"><text x="20" y="80" font-size="48" font-family="Arial" fill="black">INVOICE 12345</text></svg>`
        ),
        top: 0,
        left: 0
      }])
      .png()
      .toFile(tmp);

    const out = execFileSync(
      process.execPath,
      [path.join(process.cwd(), "scripts/extract-image-text.cjs"), tmp],
      { encoding: "utf8" }
    );
    fs.unlinkSync(tmp);
    expect(out).toMatch(/INVOICE/i);
    expect(out).toMatch(/12345/);
  }, 30_000);
});
