import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PersistedDocument } from "@/lib/documents/types";

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  getDocumentById: vi.fn(),
  hasValidDocumentFileAccess: vi.fn(),
  requireReviewerApiSession: vi.fn()
}));

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: mocks.readFile
  }
}));

vi.mock("@/lib/database", () => ({
  getDocumentById: mocks.getDocumentById
}));

vi.mock("@/lib/documents/file-access", () => ({
  hasValidDocumentFileAccess: mocks.hasValidDocumentFileAccess
}));

vi.mock("@/lib/reviewer-session", () => ({
  requireReviewerApiSession: mocks.requireReviewerApiSession,
  unauthorizedApiResponse: () =>
    Response.json({ error: "Unauthorized." }, { status: 401 })
}));

import { GET } from "@/app/api/documents/[id]/file/route";

function buildDocument(): PersistedDocument {
  return {
    id: "doc-1",
    sourceName: "invoice.txt",
    sourceType: "upload",
    mimeType: "text/plain",
    fileExtension: "txt",
    sourcePath: path.join(process.cwd(), "data", "uploads", "invoice.txt"),
    status: "needs_review",
    rawText: "invoice text",
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

describe("/api/documents/[id]/file", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireReviewerApiSession.mockResolvedValue({
      reviewerEmail: "reviewer@example.com",
      reviewerName: "Reviewer"
    });
  });

  it("returns 401 when the reviewer is not authenticated", async () => {
    mocks.requireReviewerApiSession.mockResolvedValue(null);

    const response = await GET(
      new Request("http://localhost/api/documents/doc-1/file"),
      { params: Promise.resolve({ id: "doc-1" }) }
    );

    expect(response.status).toBe(401);
    expect(mocks.getDocumentById).not.toHaveBeenCalled();
  });

  it("returns 403 when the signed file token is invalid", async () => {
    mocks.hasValidDocumentFileAccess.mockReturnValue(false);

    const response = await GET(
      new Request("http://localhost/api/documents/doc-1/file"),
      { params: Promise.resolve({ id: "doc-1" }) }
    );

    expect(response.status).toBe(403);
    expect(mocks.getDocumentById).not.toHaveBeenCalled();
  });

  it("serves the stored file when the signed file token is valid", async () => {
    mocks.hasValidDocumentFileAccess.mockReturnValue(true);
    mocks.getDocumentById.mockResolvedValue(buildDocument());
    mocks.readFile.mockResolvedValue(Buffer.from("hello world"));

    const response = await GET(
      new Request(
        "http://localhost/api/documents/doc-1/file?expires=123&token=abc"
      ),
      { params: Promise.resolve({ id: "doc-1" }) }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/plain");
    expect(response.headers.get("Content-Disposition")).toContain("inline;");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await response.text()).toBe("hello world");
  });

  it("rejects file reads outside the allowed storage roots", async () => {
    mocks.hasValidDocumentFileAccess.mockReturnValue(true);
    mocks.getDocumentById.mockResolvedValue({
      ...buildDocument(),
      sourcePath: "/etc/passwd"
    });

    const response = await GET(
      new Request(
        "http://localhost/api/documents/doc-1/file?expires=123&token=abc"
      ),
      { params: Promise.resolve({ id: "doc-1" }) }
    );

    expect(response.status).toBe(403);
    expect(mocks.readFile).not.toHaveBeenCalled();
  });
});
