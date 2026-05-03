import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  writeFile: vi.fn(),
  extractImageLayout: vi.fn(),
  extractCroppedImageText: vi.fn(),
  extractRawText: vi.fn(),
  splitImageOcrLayoutIntoBlocks: vi.fn(),
  detectStructuredImageLayoutDocumentCount: vi.fn(),
  detectUploadedDocumentType: vi.fn(),
  validateExtractedData: vi.fn(),
  withDocumentNumberTransaction: vi.fn(),
  saveProcessedDocument: vi.fn(),
  getUploadDirectory: vi.fn()
}));

vi.mock("node:fs/promises", () => ({
  default: {
    writeFile: mocks.writeFile
  }
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

vi.mock("@/lib/documents/file-types", async () => {
  const actual = await vi.importActual<typeof import("@/lib/documents/file-types")>(
    "@/lib/documents/file-types"
  );

  return {
    ...actual,
    detectUploadedDocumentType: mocks.detectUploadedDocumentType
  };
});

vi.mock("@/lib/documents/validation", () => ({
  validateExtractedData: mocks.validateExtractedData
}));

vi.mock("@/lib/database", async () => {
  const actual = await vi.importActual<typeof import("@/lib/database")>(
    "@/lib/database"
  );

  return {
    ...actual,
    getUploadDirectory: mocks.getUploadDirectory,
    saveProcessedDocument: mocks.saveProcessedDocument,
    withDocumentNumberTransaction: mocks.withDocumentNumberTransaction
  };
});

import { processUploadedFile } from "@/lib/documents/pipeline";

describe("processUploadedFile image OCR flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.writeFile.mockResolvedValue(undefined);
    mocks.detectUploadedDocumentType.mockResolvedValue({
      fileExtension: "png",
      mimeType: "image/png"
    });
    mocks.getUploadDirectory.mockReturnValue("/tmp");
    mocks.extractImageLayout.mockResolvedValue({
      width: 1200,
      height: 900,
      words: []
    });
    mocks.splitImageOcrLayoutIntoBlocks.mockReturnValue([
      {
        text: [
          "Invoice",
          "Supplier: ACME Ltd",
          "Invoice Number: INV-1001",
          "Date: 2026-05-01",
          "Due Date: 2026-05-15",
          "Subtotal: USD 120.00",
          "Tax: USD 24.00",
          "Total: USD 144.00",
          "Billing Address: 123 Example Street",
          "Terms: Net 30"
        ].join("\n"),
        bbox: { x0: 10, y0: 10, x1: 280, y1: 320 }
      },
      {
        text: [
          "Purchase Order",
          "Supplier: Beta Logistics LLC",
          "Purchase Order Number: PO-2048",
          "Date: 2026-05-03",
          "Subtotal: USD 80.00",
          "Tax: USD 0.00",
          "Total: USD 80.00",
          "Description: Widget A",
          "Quantity: 2",
          "Unit price: USD 40.00"
        ].join("\n"),
        bbox: { x0: 620, y0: 40, x1: 1100, y1: 360 }
      }
    ]);
    mocks.detectStructuredImageLayoutDocumentCount.mockReturnValue(0);
    mocks.extractCroppedImageText
      .mockResolvedValueOnce(
        [
          "Invoice",
          "Supplier: ACME Ltd",
          "Invoice Number: INV-1001",
          "Date: 2026-05-01",
          "Due Date: 2026-05-15",
          "Subtotal: USD 120.00",
          "Tax: USD 24.00",
          "Total: USD 144.00",
          "Billing Address: 123 Example Street",
          "Terms: Net 30"
        ].join("\n")
      )
      .mockResolvedValueOnce(
        [
          "Purchase Order",
          "Supplier: Beta Logistics LLC",
          "Purchase Order Number: PO-2048",
          "Date: 2026-05-03",
          "Subtotal: USD 80.00",
          "Tax: USD 0.00",
          "Total: USD 80.00",
          "Description: Widget A",
          "Quantity: 2",
          "Unit price: USD 40.00"
        ].join("\n")
      );
    mocks.extractRawText.mockResolvedValue("unused fallback OCR");
    mocks.validateExtractedData.mockResolvedValue([]);
    mocks.withDocumentNumberTransaction.mockImplementation(
      async (_documentNumber: string | null, callback: (queryable: object) => unknown) =>
        callback({})
    );
    mocks.saveProcessedDocument.mockImplementation(async (input) => ({
      id: input.id ?? crypto.randomUUID(),
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
  });

  it("reuses one layout pass and preserves the OCR block count for uploads", async () => {
    const file = new File(["fake image bytes"], "collage.png", {
      type: "image/png"
    });

    const results = await processUploadedFile(file);

    expect(mocks.extractImageLayout).toHaveBeenCalledTimes(1);
    expect(mocks.extractCroppedImageText).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(2);
    expect(mocks.saveProcessedDocument).toHaveBeenCalledTimes(2);
  });
});
