import { describe, it, expect } from "vitest";
import {
  detectUploadedDocumentType,
  getFileExtension,
  getMimeType,
  MAX_UPLOAD_BYTES,
  isSupportedDocument
} from "@/lib/documents/file-types";

const PNG_BYTES = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aZ0AAAAASUVORK5CYII=",
    "base64"
  )
);

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

describe("detectUploadedDocumentType", () => {
  it("detects valid binary formats from file signatures", async () => {
    await expect(
      detectUploadedDocumentType("scan.png", PNG_BYTES)
    ).resolves.toEqual({
      fileExtension: "png",
      mimeType: "image/png"
    });
  });

  it("rejects content that does not match the file extension", async () => {
    await expect(
      detectUploadedDocumentType("invoice.pdf", PNG_BYTES)
    ).rejects.toThrow(/does not match the "\.pdf" extension/);
  });

  it("accepts plain-text csv uploads and enforces the upload limit", async () => {
    await expect(
      detectUploadedDocumentType(
        "lines.csv",
        new TextEncoder().encode("description,qty\nWidget,2\n")
      )
    ).resolves.toEqual({
      fileExtension: "csv",
      mimeType: "text/csv"
    });

    await expect(
      detectUploadedDocumentType("lines.csv", new Uint8Array(MAX_UPLOAD_BYTES + 1))
    ).rejects.toThrow(/10 MB limit/);
  });
});
