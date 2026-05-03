import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  extractImageLayout: vi.fn(),
  extractCroppedImageText: vi.fn(),
  extractRawText: vi.fn(),
  splitImageOcrLayoutIntoBlocks: vi.fn(),
  detectStructuredImageLayoutDocumentCount: vi.fn(),
  validateExtractedData: vi.fn(),
  withDocumentNumberTransaction: vi.fn(),
  saveProcessedDocument: vi.fn(),
  deleteDatasetDocumentsBySourcePathExcept: vi.fn()
}));

vi.mock("@/lib/documents/extraction", () => ({
  extractImageLayout: mocks.extractImageLayout,
  extractCroppedImageText: mocks.extractCroppedImageText,
  extractRawText: mocks.extractRawText
}));

vi.mock("@/lib/documents/image-layout", () => ({
  splitImageOcrLayoutIntoBlocks: mocks.splitImageOcrLayoutIntoBlocks,
  detectStructuredImageLayoutDocumentCount:
    mocks.detectStructuredImageLayoutDocumentCount
}));

vi.mock("@/lib/documents/validation", () => ({
  validateExtractedData: mocks.validateExtractedData
}));

vi.mock("@/lib/database", async () => {
  const actual = await vi.importActual<typeof import("@/lib/database")>(
    "@/lib/database"
  );

  return {
    ...actual,
    deleteDatasetDocumentsBySourcePathExcept:
      mocks.deleteDatasetDocumentsBySourcePathExcept,
    saveProcessedDocument: mocks.saveProcessedDocument,
    withDocumentNumberTransaction: mocks.withDocumentNumberTransaction
  };
});

import { processDocumentFile } from "@/lib/documents/pipeline";

describe("processDocumentFile for dataset image collages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.extractImageLayout.mockResolvedValue({
      width: 1200,
      height: 900,
      words: []
    });
    mocks.splitImageOcrLayoutIntoBlocks.mockReturnValue([
      {
        text: "Invoice\nSupplier: ACME Ltd",
        bbox: { x0: 10, y0: 10, x1: 300, y1: 350 }
      },
      {
        text: "Invoice\nSupplier: LOWE SUPPLY",
        bbox: { x0: 700, y0: 10, x1: 1050, y1: 360 }
      },
      {
        text: "Invoice\nSupplier: STEINS ELECTRIC, INC",
        bbox: { x0: 300, y0: 420, x1: 900, y1: 860 }
      }
    ]);
    mocks.detectStructuredImageLayoutDocumentCount.mockReturnValue(3);
    mocks.extractCroppedImageText
      .mockResolvedValueOnce(
        [
          "Invoice",
          "Supplier: ACME Ltd",
          "Invoice Number: INV-1001",
          "Date: 2026-05-01",
          "Subtotal: USD 120.00",
          "Tax: USD 24.00",
          "Total: USD 144.00",
          "Billing Address: 123 Example Street",
          "Terms: Net 30"
        ].join("\n")
      )
      .mockResolvedValueOnce(
        [
          "Invoice",
          "Supplier: LOWE SUPPLY",
          "Invoice Number: 12353211-11",
          "Date: 12/24/2018",
          "Subtotal: USD 207.44",
          "Tax: USD 20.74",
          "Total: USD 228.18",
          "PO Box 12087",
          "Cambridge MA"
        ].join("\n")
      )
      .mockResolvedValueOnce(
        [
          "Invoice",
          "Supplier: STEINS ELECTRIC, INC",
          "Invoice Number: 544",
          "Date: 2018-08-24",
          "Subtotal: USD 384.00",
          "Tax: USD 76.80",
          "Total: USD 460.80",
          "Contractors - Engineers",
          "405 North Port Washington Road"
        ].join("\n")
      );
    mocks.validateExtractedData.mockResolvedValue([]);
    mocks.withDocumentNumberTransaction.mockImplementation(
      async (_documentNumber: string | null, callback: (queryable: object) => unknown) =>
        callback({})
    );
    mocks.saveProcessedDocument.mockImplementation(async (input) => ({
      id: input.id,
      sourceName: input.sourceName,
      sourceType: input.sourceType,
      mimeType: input.mimeType,
      fileExtension: input.fileExtension,
      sourcePath: input.sourcePath,
      status: input.status,
      rawText: input.rawText,
      processingError: input.processingError ?? null,
      extractedData: input.extractedData,
      correctedData: null,
      validationIssues: input.validationIssues,
      createdAt: "2026-05-03T00:00:00.000Z",
      updatedAt: "2026-05-03T00:00:00.000Z"
    }));
    mocks.deleteDatasetDocumentsBySourcePathExcept.mockResolvedValue(0);
  });

  it("creates stable sibling dataset documents for a three-document screenshot", async () => {
    const results = await processDocumentFile({
      documentId: "dataset-screenshot-2026-04-28-at-18.26.01.png",
      sourceName: "Screenshot 2026-04-28 at 18.26.01.png",
      sourceType: "dataset",
      filePath: "/repo/resources/Screenshot 2026-04-28 at 18.26.01.png"
    });

    expect(results).toHaveLength(3);
    expect(mocks.saveProcessedDocument).toHaveBeenCalledTimes(3);
    expect(mocks.saveProcessedDocument).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        id: "dataset-screenshot-2026-04-28-at-18.26.01.png",
        sourceName: "Screenshot 2026-04-28 at 18.26.01.png (1 of 3)"
      }),
      expect.anything()
    );
    expect(mocks.saveProcessedDocument).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        id: "dataset-screenshot-2026-04-28-at-18.26.01.png--part-2",
        sourceName: "Screenshot 2026-04-28 at 18.26.01.png (2 of 3)"
      }),
      expect.anything()
    );
    expect(mocks.saveProcessedDocument).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        id: "dataset-screenshot-2026-04-28-at-18.26.01.png--part-3",
        sourceName: "Screenshot 2026-04-28 at 18.26.01.png (3 of 3)"
      }),
      expect.anything()
    );
    expect(mocks.deleteDatasetDocumentsBySourcePathExcept).toHaveBeenCalledWith(
      "/repo/resources/Screenshot 2026-04-28 at 18.26.01.png",
      [
        "dataset-screenshot-2026-04-28-at-18.26.01.png",
        "dataset-screenshot-2026-04-28-at-18.26.01.png--part-2",
        "dataset-screenshot-2026-04-28-at-18.26.01.png--part-3"
      ]
    );
  });

  it("falls back to a single image document when structured blocks stay unusable", async () => {
    mocks.extractCroppedImageText.mockReset();
    mocks.extractCroppedImageText.mockResolvedValue("blurred ui text");
    mocks.extractRawText.mockResolvedValue(
      [
        "Invoice",
        "Supplier: Solo Screenshot Ltd",
        "Invoice Number: INV-9001",
        "Date: 2026-05-01",
        "Total: USD 144.00"
      ].join("\n")
    );

    const results = await processDocumentFile({
      documentId: "dataset-single-screenshot.png",
      sourceName: "Single Screenshot.png",
      sourceType: "dataset",
      filePath: "/repo/resources/Single Screenshot.png"
    });

    expect(results).toHaveLength(1);
    expect(mocks.extractRawText).toHaveBeenCalledWith(
      "/repo/resources/Single Screenshot.png",
      "png"
    );
    expect(mocks.saveProcessedDocument).toHaveBeenCalledTimes(1);
    expect(mocks.saveProcessedDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "dataset-single-screenshot.png",
        sourceName: "Single Screenshot.png"
      }),
      expect.anything()
    );
  });

  it("does not use generic clustered splits for ordinary screenshots", async () => {
    mocks.splitImageOcrLayoutIntoBlocks.mockReturnValue([
      {
        text: "Invoice\nSupplier: YourCompany Pvt Ltd",
        bbox: { x0: 10, y0: 10, x1: 280, y1: 220 }
      },
      {
        text: "Invoice\nSupplier: ABC Bank Ltd",
        bbox: { x0: 300, y0: 10, x1: 560, y1: 220 }
      },
      {
        text: "Invoice\nSupplier: Jonathan Smith",
        bbox: { x0: 10, y0: 260, x1: 280, y1: 520 }
      },
      {
        text: "Invoice\nSupplier: Final Notes Ltd",
        bbox: { x0: 300, y0: 260, x1: 560, y1: 520 }
      }
    ]);
    mocks.detectStructuredImageLayoutDocumentCount.mockReturnValue(3);
    mocks.extractCroppedImageText.mockReset();
    mocks.extractCroppedImageText
      .mockResolvedValueOnce(
        [
          "Invoice",
          "Supplier: YourCompany Pvt Ltd",
          "Invoice Number: 143999",
          "Date: 2016-06-28",
          "Total: USD 3910.00",
          "Account No: 3400715"
        ].join("\n")
      )
      .mockResolvedValueOnce(
        [
          "Invoice",
          "Supplier: ABC Bank Ltd",
          "Reference: 482",
          "Date: 2016-06-28",
          "Total: USD 3910.00",
          "Notes: payment account"
        ].join("\n")
      )
      .mockResolvedValueOnce(
        [
          "Invoice",
          "Supplier: Jonathan Smith",
          "Reference: 777",
          "Date: 2016-06-28",
          "Total: USD 3910.00",
          "Notes: customer line"
        ].join("\n")
      )
      .mockResolvedValueOnce(
        [
          "Invoice",
          "Supplier: Final Notes Ltd",
          "Reference: 888",
          "Date: 2016-06-28",
          "Total: USD 3910.00",
          "Notes: footer block"
        ].join("\n")
      );
    mocks.extractRawText.mockResolvedValue(
      [
        "Invoice",
        "Supplier: YourCompany Pvt Ltd",
        "Invoice Number: 143999",
        "Date: 2016-06-28",
        "Total: USD 3910.00"
      ].join("\n")
    );

    const results = await processDocumentFile({
      documentId: "dataset-ordinary-screenshot.png",
      sourceName: "Screenshot 2026-04-28 at 18.26.27.png",
      sourceType: "dataset",
      filePath: "/repo/resources/Screenshot 2026-04-28 at 18.26.27.png"
    });

    expect(results).toHaveLength(1);
    expect(mocks.extractRawText).toHaveBeenCalledWith(
      "/repo/resources/Screenshot 2026-04-28 at 18.26.27.png",
      "png"
    );
  });

  it("falls back to one document when a three-block screenshot is just one invoice", async () => {
    mocks.splitImageOcrLayoutIntoBlocks.mockReturnValue([
      {
        text: "Invoice header and supplier area",
        bbox: { x0: 20, y0: 20, x1: 360, y1: 260 }
      },
      {
        text: "Invoice metadata and payment area",
        bbox: { x0: 380, y0: 20, x1: 1120, y1: 620 }
      },
      {
        text: "Invoice totals footer",
        bbox: { x0: 250, y0: 640, x1: 980, y1: 860 }
      }
    ]);
    mocks.detectStructuredImageLayoutDocumentCount.mockReturnValue(3);
    mocks.extractCroppedImageText.mockReset();
    mocks.extractCroppedImageText
      .mockResolvedValueOnce(
        [
          "Invoice",
          "Supplier: YourCompany Pvt Ltd",
          "Invoice Number: INV-143999",
          "Date: 2016-06-28",
          "Total: USD 3910.00"
        ].join("\n")
      )
      .mockResolvedValueOnce(
        [
          "Invoice",
          "Invoice Number: INV-143999",
          "Date: 2016-06-28",
          "Payment method: Bank transfer",
          "Reference: ABC1016969",
          "Total: USD 3910.00"
        ].join("\n")
      )
      .mockResolvedValueOnce(
        [
          "Invoice",
          "Subtotal: USD 3400.00",
          "Tax: USD 510.00",
          "Total: USD 3910.00"
        ].join("\n")
      )
      .mockResolvedValue("blurred invoice text");
    mocks.extractRawText.mockResolvedValue(
      [
        "Invoice",
        "Supplier: YourCompany Pvt Ltd",
        "Invoice Number: INV-143999",
        "Date: 2016-06-28",
        "Subtotal: USD 3400.00",
        "Tax: USD 510.00",
        "Total: USD 3910.00"
      ].join("\n")
    );

    const results = await processDocumentFile({
      documentId: "dataset-single-invoice-screenshot.png",
      sourceName: "Screenshot 2026-04-28 at 18.25.34.png",
      sourceType: "dataset",
      filePath: "/repo/resources/Screenshot 2026-04-28 at 18.25.34.png"
    });

    expect(results).toHaveLength(1);
    expect(mocks.extractRawText).toHaveBeenCalledWith(
      "/repo/resources/Screenshot 2026-04-28 at 18.25.34.png",
      "png"
    );
    expect(mocks.saveProcessedDocument).toHaveBeenCalledTimes(1);
    expect(mocks.saveProcessedDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "dataset-single-invoice-screenshot.png",
        sourceName: "Screenshot 2026-04-28 at 18.25.34.png"
      }),
      expect.anything()
    );
  });
});
