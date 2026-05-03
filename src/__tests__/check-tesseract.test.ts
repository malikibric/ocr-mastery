import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

describe("check-tesseract preflight", () => {
  it("exits 0 when tesseract --version is available", () => {
    const script = path.join(process.cwd(), "scripts", "check-tesseract.cjs");
    expect(() => execFileSync(process.execPath, [script], { stdio: "pipe" })).not.toThrow();
  });
});
