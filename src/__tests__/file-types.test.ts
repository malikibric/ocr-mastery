import { describe, it, expect } from "vitest";
import {
  getFileExtension,
  getMimeType,
  isSupportedDocument
} from "@/lib/documents/file-types";

describe("getFileExtension", () => {
  it("returns lowercase extension without dot", () => {
    expect(getFileExtension("invoice.PDF")).toBe("pdf");
    expect(getFileExtension("data.CSV")).toBe("csv");
    expect(getFileExtension("image.PNG")).toBe("png");
  });

  it("returns empty string for no extension", () => {
    expect(getFileExtension("noextension")).toBe("");
  });
});

describe("isSupportedDocument", () => {
  it("accepts supported formats", () => {
    for (const name of ["doc.pdf", "doc.csv", "doc.txt", "doc.png", "doc.jpg", "doc.jpeg"]) {
      expect(isSupportedDocument(name)).toBe(true);
    }
  });

  it("rejects unsupported formats", () => {
    expect(isSupportedDocument("doc.docx")).toBe(false);
    expect(isSupportedDocument("doc.xlsx")).toBe(false);
    expect(isSupportedDocument("doc")).toBe(false);
  });
});

describe("getMimeType", () => {
  it("returns correct mime types", () => {
    expect(getMimeType("file.csv")).toBe("text/csv");
    expect(getMimeType("file.txt")).toBe("text/plain");
    expect(getMimeType("file.pdf")).toBe("application/pdf");
    expect(getMimeType("file.png")).toBe("image/png");
    expect(getMimeType("file.jpg")).toBe("image/jpeg");
    expect(getMimeType("file.jpeg")).toBe("image/jpeg");
  });

  it("falls back to octet-stream for unknown", () => {
    expect(getMimeType("file.xyz")).toBe("application/octet-stream");
  });
});
