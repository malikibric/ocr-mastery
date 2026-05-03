import { describe, expect, it } from "vitest";
import {
  splitImageOcrLayoutIntoTextBlocks,
  type ImageOcrLayout,
  type OcrLayoutWord
} from "@/lib/documents/image-layout";

function word(
  text: string,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  confidence = 90
): OcrLayoutWord {
  return {
    text,
    confidence,
    bbox: { x0, y0, x1, y1 }
  };
}

describe("splitImageOcrLayoutIntoTextBlocks", () => {
  it("splits OCR words into multiple document text blocks", () => {
    const words: OcrLayoutWord[] = [];

    for (let index = 0; index < 10; index++) {
      words.push(word(`INV${index}`, 40 + index * 18, 60 + (index % 3) * 22, 80 + index * 18, 80 + (index % 3) * 22));
      words.push(word(`LEFT${index}`, 55 + index * 18, 110 + (index % 3) * 22, 95 + index * 18, 130 + (index % 3) * 22));
      words.push(word(`RIGHT${index}`, 520 + index * 18, 70 + (index % 3) * 22, 570 + index * 18, 90 + (index % 3) * 22));
      words.push(word(`PO${index}`, 540 + index * 18, 125 + (index % 3) * 22, 580 + index * 18, 145 + (index % 3) * 22));
      words.push(word(`BOTTOM${index}`, 240 + index * 16, 420 + (index % 3) * 22, 300 + index * 16, 440 + (index % 3) * 22));
      words.push(word(`TOTAL${index}`, 260 + index * 16, 470 + (index % 3) * 22, 320 + index * 16, 490 + (index % 3) * 22));
    }

    const layout: ImageOcrLayout = {
      width: 1000,
      height: 900,
      words
    };

    const blocks = splitImageOcrLayoutIntoTextBlocks(layout);

    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toContain("INV0");
    expect(blocks[1]).toContain("RIGHT0");
    expect(blocks[2]).toContain("BOTTOM0");
  });

  it("does not split a single document into fake tabs", () => {
    const words: OcrLayoutWord[] = [];

    for (let index = 0; index < 30; index++) {
      const row = Math.floor(index / 6);
      const column = index % 6;
      words.push(
        word(
          `WORD${index}`,
          80 + column * 90,
          70 + row * 50,
          130 + column * 90,
          92 + row * 50
        )
      );
    }

    const layout: ImageOcrLayout = {
      width: 900,
      height: 1000,
      words
    };

    const blocks = splitImageOcrLayoutIntoTextBlocks(layout);

    expect(blocks).toHaveLength(0);
  });

  it("refines an uneven three-document collage into three blocks", () => {
    const words: OcrLayoutWord[] = [];

    for (let index = 0; index < 14; index++) {
      words.push(
        word(
          `LEFT${index}`,
          40 + (index % 4) * 48,
          60 + Math.floor(index / 4) * 34,
          88 + (index % 4) * 48,
          82 + Math.floor(index / 4) * 34
        )
      );
    }

    for (let index = 0; index < 10; index++) {
      words.push(
        word(
          `RIGHT${index}`,
          760 + (index % 3) * 56,
          72 + Math.floor(index / 3) * 36,
          820 + (index % 3) * 56,
          94 + Math.floor(index / 3) * 36
        )
      );
    }

    for (let index = 0; index < 34; index++) {
      words.push(
        word(
          `BOTTOM${index}`,
          240 + (index % 6) * 78,
          430 + Math.floor(index / 6) * 34,
          310 + (index % 6) * 78,
          452 + Math.floor(index / 6) * 34
        )
      );
    }

    const layout: ImageOcrLayout = {
      width: 1200,
      height: 900,
      words
    };

    const blocks = splitImageOcrLayoutIntoTextBlocks(layout);

    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toContain("LEFT0");
    expect(blocks[1]).toContain("RIGHT0");
    expect(blocks[2]).toContain("BOTTOM0");
  });

  it("keeps a tall top-right document separate from the bottom document", () => {
    const words: OcrLayoutWord[] = [];

    for (let index = 0; index < 16; index++) {
      words.push(
        word(
          `LEFT${index}`,
          60 + (index % 4) * 54,
          70 + Math.floor(index / 4) * 38,
          118 + (index % 4) * 54,
          94 + Math.floor(index / 4) * 38
        )
      );
    }

    for (let index = 0; index < 24; index++) {
      words.push(
        word(
          `RIGHT${index}`,
          760 + (index % 4) * 72,
          90 + Math.floor(index / 4) * 64,
          834 + (index % 4) * 72,
          116 + Math.floor(index / 4) * 64
        )
      );
    }

    for (let index = 0; index < 18; index++) {
      words.push(
        word(
          `BOTTOM${index}`,
          420 + (index % 4) * 86,
          720 + Math.floor(index / 4) * 56,
          500 + (index % 4) * 86,
          748 + Math.floor(index / 4) * 56
        )
      );
    }

    const layout: ImageOcrLayout = {
      width: 1400,
      height: 1420,
      words
    };

    const blocks = splitImageOcrLayoutIntoTextBlocks(layout);

    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toContain("LEFT0");
    expect(blocks[0]).not.toContain("RIGHT0");
    expect(blocks[1]).toContain("RIGHT0");
    expect(blocks[1]).not.toContain("BOTTOM0");
    expect(blocks[2]).toContain("BOTTOM0");
    expect(blocks[2]).not.toContain("RIGHT0");
  });
});
