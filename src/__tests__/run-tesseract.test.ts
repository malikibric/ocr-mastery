import { describe, expect, it } from "vitest";
import path from "node:path";

const helper = require(path.join(process.cwd(), "scripts/lib/run-tesseract.cjs"));

describe("run-tesseract helper", () => {
  it("buildArgs produces stdout output and required flags", () => {
    const args = helper.buildArgs("/tmp/in.png", "txt", { psm: "6", tessdataDir: "/data" });
    expect(args).toEqual([
      "/tmp/in.png",
      "stdout",
      "--tessdata-dir",
      "/data",
      "-l",
      "eng",
      "--psm",
      "6",
      "-c",
      "preserve_interword_spaces=1",
      "txt"
    ]);
  });

  it("buildArgs supports tsv format", () => {
    const args = helper.buildArgs("/tmp/in.png", "tsv", { psm: "11", tessdataDir: "/data" });
    expect(args[args.length - 1]).toBe("tsv");
    expect(args).toContain("--psm");
    expect(args).toContain("11");
  });
});
