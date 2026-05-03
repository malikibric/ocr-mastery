import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listDocumentSummaries: vi.fn(),
  requireReviewerApiSession: vi.fn()
}));

vi.mock("@/lib/database", () => ({
  listDocumentSummaries: mocks.listDocumentSummaries
}));

vi.mock("@/lib/reviewer-session", () => ({
  requireReviewerApiSession: mocks.requireReviewerApiSession,
  unauthorizedApiResponse: () =>
    Response.json({ error: "Unauthorized." }, { status: 401 })
}));

import * as documentsRoute from "@/app/api/documents/route";

describe("/api/documents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireReviewerApiSession.mockResolvedValue({
      reviewerEmail: "reviewer@example.com",
      reviewerName: "Reviewer"
    });
  });

  it("rejects unauthenticated document requests", async () => {
    mocks.requireReviewerApiSession.mockResolvedValue(null);

    const response = await documentsRoute.GET();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized." });
    expect(mocks.listDocumentSummaries).not.toHaveBeenCalled();
  });

  it("returns document summaries without exposing a delete handler", async () => {
    mocks.listDocumentSummaries.mockResolvedValue([
      {
        id: "doc-1",
        sourceName: "invoice.pdf",
        sourceType: "upload",
        mimeType: "application/pdf",
        fileExtension: "pdf",
        status: "needs_review",
        processingError: null,
        validationIssues: [],
        createdAt: "2024-01-15T00:00:00.000Z",
        updatedAt: "2024-01-15T00:00:00.000Z",
        activeData: {
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
        }
      }
    ]);

    const response = await documentsRoute.GET();

    expect("DELETE" in documentsRoute).toBe(false);
    expect(await response.json()).toEqual({
      documents: [
        expect.objectContaining({
          id: "doc-1",
          sourceName: "invoice.pdf"
        })
      ]
    });
  });
});
