import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PersistedDocument } from "@/lib/documents/types";

const mocks = vi.hoisted(() => ({
  deleteDocumentById: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
  getDocumentById: vi.fn(),
  saveReviewedDocument: vi.fn(),
  withDocumentNumberTransaction: vi.fn(),
  validateExtractedData: vi.fn(),
  importDatasetDocuments: vi.fn(),
  processUploadedFile: vi.fn(),
  requireReviewerActionSession: vi.fn()
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect
}));

vi.mock("@/lib/database", () => ({
  deleteDocumentById: mocks.deleteDocumentById,
  getDocumentById: mocks.getDocumentById,
  saveReviewedDocument: mocks.saveReviewedDocument,
  withDocumentNumberTransaction: mocks.withDocumentNumberTransaction
}));

vi.mock("@/lib/documents/validation", () => ({
  validateExtractedData: mocks.validateExtractedData
}));

vi.mock("@/lib/documents/pipeline", () => ({
  importDatasetDocuments: mocks.importDatasetDocuments,
  processUploadedFile: mocks.processUploadedFile
}));

vi.mock("@/lib/reviewer-session", () => ({
  requireReviewerActionSession: mocks.requireReviewerActionSession
}));

import {
  deleteUploadDocumentAction,
  saveReviewAction
} from "@/app/actions";
import { INITIAL_REVIEW_FORM_STATE } from "@/lib/review-form-state";

function buildPersistedDocument(): PersistedDocument {
  return {
    id: "doc-1",
    sourceName: "invoice.pdf",
    sourceType: "upload",
    mimeType: "application/pdf",
    fileExtension: "pdf",
    sourcePath: "/tmp/invoice.pdf",
    status: "needs_review",
    rawText: "raw text",
    processingError: null,
    extractedData: {
      documentType: "invoice",
      supplierName: "Acme Corp",
      documentNumber: "INV-001",
      issueDate: "2024-01-15",
      dueDate: "2024-02-15",
      currency: "EUR",
      subtotal: 100,
      tax: 20,
      total: 120,
      lineItems: []
    },
    correctedData: null,
    validationIssues: [],
    createdAt: "2024-01-15T00:00:00.000Z",
    updatedAt: "2024-01-15T00:00:00.000Z"
  };
}

function buildReviewFormData() {
  const formData = new FormData();
  formData.set("documentId", "doc-1");
  formData.set("reviewAction", "save");
  formData.set("documentType", "invoice");
  formData.set("supplierName", "Acme Corp");
  formData.set("documentNumber", "INV-001");
  formData.set("issueDate", "2024-01-15");
  formData.set("dueDate", "2024-02-15");
  formData.set("currency", "eur");
  formData.set("subtotal", "100");
  formData.set("tax", "20");
  formData.set("total", "120");
  formData.set("lineItems", "Widget | 1 | 100 | 100");
  return formData;
}

describe("saveReviewAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireReviewerActionSession.mockResolvedValue({
      reviewerEmail: "reviewer@example.com",
      reviewerName: "Reviewer"
    });
    mocks.withDocumentNumberTransaction.mockImplementation(
      async (_documentNumber: string | null | undefined, callback: (queryable: unknown) => Promise<unknown>) =>
        callback({ query: vi.fn() })
    );
    mocks.getDocumentById.mockResolvedValue(buildPersistedDocument());
    mocks.saveReviewedDocument.mockResolvedValue({ id: "doc-1" });
    mocks.validateExtractedData.mockResolvedValue([]);
  });

  it("keeps save actions in needs_review and allows clearing numeric fields", async () => {
    const formData = buildReviewFormData();
    formData.set("subtotal", "");
    formData.set("tax", "");
    formData.set("total", "");

    await expect(saveReviewAction(INITIAL_REVIEW_FORM_STATE, formData)).rejects.toThrow(
      "NEXT_REDIRECT:/documents/doc-1"
    );

    expect(mocks.saveReviewedDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "doc-1",
        status: "needs_review",
        reviewerEmail: "reviewer@example.com",
        reviewerName: "Reviewer",
        correctedData: expect.objectContaining({
          currency: "EUR",
          subtotal: null,
          tax: null,
          total: null
        })
      }),
      expect.any(Object)
    );
  });

  it("marks documents validated only when validate is requested", async () => {
    const formData = buildReviewFormData();
    formData.set("reviewAction", "validate");

    await expect(saveReviewAction(INITIAL_REVIEW_FORM_STATE, formData)).rejects.toThrow(
      "NEXT_REDIRECT:/documents/doc-1"
    );

    expect(mocks.saveReviewedDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "validated"
      }),
      expect.any(Object)
    );
  });

  it("rejects invalid numeric input instead of silently restoring old values", async () => {
    const formData = buildReviewFormData();
    formData.set("subtotal", "not-a-number");

    await expect(
      saveReviewAction(INITIAL_REVIEW_FORM_STATE, formData)
    ).resolves.toEqual({
      message: "Subtotal must be a valid number.",
      fields: expect.objectContaining({
        subtotal: "not-a-number",
        total: "120"
      }),
      formKey: expect.any(String)
    });

    expect(mocks.saveReviewedDocument).not.toHaveBeenCalled();
  });

  it("redirects unauthenticated reviewers before saving", async () => {
    mocks.requireReviewerActionSession.mockRejectedValue(
      new Error("NEXT_REDIRECT:/login?next=%2Fdocuments%2Fdoc-1")
    );

    await expect(
      saveReviewAction(INITIAL_REVIEW_FORM_STATE, buildReviewFormData())
    ).rejects.toThrow(
      "NEXT_REDIRECT:/login?next=%2Fdocuments%2Fdoc-1"
    );

    expect(mocks.getDocumentById).not.toHaveBeenCalled();
  });
});

describe("deleteUploadDocumentAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireReviewerActionSession.mockResolvedValue({
      reviewerEmail: "reviewer@example.com",
      reviewerName: "Reviewer"
    });
    mocks.withDocumentNumberTransaction.mockImplementation(
      async (_documentNumber: string | null | undefined, callback: (queryable: unknown) => Promise<unknown>) =>
        callback({ query: vi.fn() })
    );
    mocks.getDocumentById.mockResolvedValue(buildPersistedDocument());
    mocks.deleteDocumentById.mockResolvedValue(buildPersistedDocument());
  });

  it("deletes uploaded documents and revalidates the dashboard", async () => {
    const formData = new FormData();
    formData.set("documentId", "doc-1");

    await expect(deleteUploadDocumentAction(formData)).resolves.toBeUndefined();

    expect(mocks.deleteDocumentById).toHaveBeenCalledWith("doc-1");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/");
  });

  it("rejects deleting dataset documents from the upload action", async () => {
    mocks.getDocumentById.mockResolvedValue({
      ...buildPersistedDocument(),
      sourceType: "dataset"
    });

    const formData = new FormData();
    formData.set("documentId", "doc-1");

    await expect(deleteUploadDocumentAction(formData)).rejects.toThrow(
      "Only uploaded documents can be deleted."
    );

    expect(mocks.deleteDocumentById).not.toHaveBeenCalled();
  });
});
