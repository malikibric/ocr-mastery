import { describe, expect, it } from "vitest";

const {
  parseTsv,
  selectBestLayout
} = require(`${process.cwd()}/scripts/extract-image-layout.cjs`);

describe("parseTsv", () => {
  it("turns TSV lines into ImageOcrLayout words", () => {
    const tsv =
      "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n" +
      "5\t1\t1\t1\t1\t1\t10\t20\t40\t30\t91.2\tHello\n" +
      "5\t1\t1\t1\t1\t2\t60\t20\t50\t30\t-1\t \n" +
      "5\t1\t1\t1\t1\t3\t120\t20\t60\t30\t88\tWorld\n";
    const out = parseTsv(tsv, 800, 600);
    expect(out.width).toBe(800);
    expect(out.height).toBe(600);
    expect(out.words).toEqual([
      { text: "Hello", confidence: 91.2, bbox: { x0: 10, y0: 20, x1: 50, y1: 50 } },
      { text: "World", confidence: 88, bbox: { x0: 120, y0: 20, x1: 180, y1: 50 } }
    ]);
  });
});

describe("selectBestLayout", () => {
  it("prefers the OCR layout candidate with more usable words", () => {
    const emptyLayout = {
      width: 800,
      height: 600,
      words: []
    };
    const richLayout = {
      width: 800,
      height: 600,
      words: [
        { text: "Invoice", confidence: 92, bbox: { x0: 10, y0: 20, x1: 80, y1: 50 } },
        { text: "LOWE", confidence: 88, bbox: { x0: 90, y0: 20, x1: 140, y1: 50 } }
      ]
    };

    expect(selectBestLayout([emptyLayout, richLayout])).toEqual(richLayout);
  });
});
