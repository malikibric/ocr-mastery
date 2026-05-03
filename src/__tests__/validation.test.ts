import { describe, it, expect, vi, beforeEach } from "vitest";
import { validateExtractedData } from "@/lib/documents/validation";
import type { ExtractedDocumentData } from "@/lib/documents/types";

vi.mock("@/lib/database", () => ({
  findDocumentsByDocumentNumber: vi.fn().mockResolvedValue([])
}));

import { findDocumentsByDocumentNumber } from "@/lib/database";

function validDoc(overrides: Partial<ExtractedDocumentData> = {}): ExtractedDocumentData {
  return {
    documentType: "invoice",
    supplierName: "Acme Corp",
    documentNumber: "INV-001",
    issueDate: "2024-01-15",
    dueDate: "2024-02-15",
    currency: "EUR",
    subtotal: 100,
    tax: 20,
    total: 120,
    lineItems: [],
    ...overrides
  };
}

beforeEach(() => {
  vi.mocked(findDocumentsByDocumentNumber).mockResolvedValue([]);
});

describe("validateExtractedData — required fields", () => {
  it("returns no errors for a complete valid document", async () => {
    const issues = await validateExtractedData(validDoc());
    const errors = issues.filter((i) => i.severity === "error");
    expect(errors).toHaveLength(0);
  });

  it.each(["supplierName", "documentNumber", "issueDate", "currency", "total"] as const)(
    "flags missing %s as error",
    async (field) => {
      const issues = await validateExtractedData(validDoc({ [field]: null }));
      expect(issues.some((i) => i.code === `missing-${field}` && i.severity === "error")).toBe(true);
    }
  );

  it("warns when document type is unknown", async () => {
    const issues = await validateExtractedData(validDoc({ documentType: "unknown" }));
    expect(issues.some((i) => i.code === "document-type-unknown" && i.severity === "warning")).toBe(true);
  });

  it("does not require finance fields for company details documents", async () => {
    const issues = await validateExtractedData(
      validDoc({
        documentType: "company_details",
        currency: null,
        subtotal: null,
        tax: null,
        total: null
      })
    );

    expect(issues.some((i) => i.code === "missing-total")).toBe(false);
    expect(issues.some((i) => i.code === "missing-currency")).toBe(false);
  });
});

describe("validateExtractedData — dates", () => {
  it("flags invalid issue date", async () => {
    const issues = await validateExtractedData(validDoc({ issueDate: "not-a-date" }));
    expect(issues.some((i) => i.code === "invalid-issue-date")).toBe(true);
  });

  it("flags invalid due date", async () => {
    const issues = await validateExtractedData(validDoc({ dueDate: "not-a-date" }));
    expect(issues.some((i) => i.code === "invalid-due-date")).toBe(true);
  });

  it("flags due date before issue date", async () => {
    const issues = await validateExtractedData(
      validDoc({ issueDate: "2024-03-01", dueDate: "2024-01-01" })
    );
    expect(issues.some((i) => i.code === "due-before-issue")).toBe(true);
  });

  it("accepts due date equal to issue date", async () => {
    const issues = await validateExtractedData(
      validDoc({ issueDate: "2024-01-15", dueDate: "2024-01-15" })
    );
    expect(issues.some((i) => i.code === "due-before-issue")).toBe(false);
  });
});

describe("validateExtractedData — totals", () => {
  it("flags subtotal + tax mismatch with total", async () => {
    const issues = await validateExtractedData(validDoc({ subtotal: 100, tax: 20, total: 999 }));
    expect(issues.some((i) => i.code === "total-mismatch")).toBe(true);
  });

  it("accepts totals within 0.01 tolerance", async () => {
    const issues = await validateExtractedData(validDoc({ subtotal: 100, tax: 20, total: 120.005 }));
    expect(issues.some((i) => i.code === "total-mismatch")).toBe(false);
  });

  it("flags line item math mismatch", async () => {
    const issues = await validateExtractedData(
      validDoc({
        lineItems: [{ description: "X", quantity: 2, unitPrice: 10, lineTotal: 30 }]
      })
    );
    expect(issues.some((i) => i.code === "line-item-mismatch-0")).toBe(true);
  });

  it("flags subtotal vs line items sum mismatch", async () => {
    const issues = await validateExtractedData(
      validDoc({
        subtotal: 999,
        lineItems: [{ description: "X", quantity: 2, unitPrice: 10, lineTotal: 20 }]
      })
    );
    expect(issues.some((i) => i.code === "subtotal-mismatch")).toBe(true);
  });

  it("warns when line items present but subtotal missing", async () => {
    const issues = await validateExtractedData(
      validDoc({
        subtotal: null,
        lineItems: [{ description: "X", quantity: 1, unitPrice: 10, lineTotal: 10 }]
      })
    );
    expect(issues.some((i) => i.code === "missing-subtotal" && i.severity === "warning")).toBe(true);
  });
});

describe("validateExtractedData — duplicate document number", () => {
  it("flags duplicate document number", async () => {
    vi.mocked(findDocumentsByDocumentNumber).mockResolvedValueOnce([
      { id: "other-id" } as never
    ]);
    const issues = await validateExtractedData(validDoc(), "current-id");
    expect(issues.some((i) => i.code === "duplicate-document-number")).toBe(true);
  });

  it("does not flag when no duplicates exist", async () => {
    const issues = await validateExtractedData(validDoc(), "current-id");
    expect(issues.some((i) => i.code === "duplicate-document-number")).toBe(false);
  });

  it("reuses the provided queryable for duplicate lookups", async () => {
    const queryable = { query: vi.fn() } as never;

    await validateExtractedData(validDoc(), "current-id", queryable);

    expect(findDocumentsByDocumentNumber).toHaveBeenCalledWith(
      "INV-001",
      "current-id",
      queryable
    );
  });
});
