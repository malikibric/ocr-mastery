import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createDocumentFileUrl: vi.fn(),
  getDocumentById: vi.fn(),
  listReviewEvents: vi.fn(),
  requireReviewerApiSession: vi.fn(),
  toDocumentSummary: vi.fn()
}));

vi.mock("@/lib/database", () => ({
  getDocumentById: mocks.getDocumentById,
  listReviewEvents: mocks.listReviewEvents,
  toDocumentSummary: mocks.toDocumentSummary
}));

vi.mock("@/lib/documents/file-access", () => ({
  createDocumentFileUrl: mocks.createDocumentFileUrl
}));

vi.mock("@/lib/reviewer-session", () => ({
  requireReviewerApiSession: mocks.requireReviewerApiSession,
  unauthorizedApiResponse: () =>
    Response.json({ error: "Unauthorized." }, { status: 401 })
}));

import { GET } from "@/app/api/documents/[id]/route";

describe("/api/documents/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireReviewerApiSession.mockResolvedValue({
      reviewerEmail: "reviewer@example.com",
      reviewerName: "Reviewer"
    });
    mocks.getDocumentById.mockResolvedValue({
      id: "doc-1"
    });
    mocks.toDocumentSummary.mockReturnValue({
      id: "doc-1",
      activeData: { documentType: "invoice" }
    });
    mocks.listReviewEvents.mockResolvedValue([
      {
        id: 1,
        action: "review_saved",
        payload_json: {},
        reviewer_email: "reviewer@example.com",
        reviewer_name: "Reviewer",
        created_at: "2026-05-03T00:00:00.000Z"
      }
    ]);
    mocks.createDocumentFileUrl.mockReturnValue("/api/documents/doc-1/file");
  });

  it("returns 401 when the reviewer is not authenticated", async () => {
    mocks.requireReviewerApiSession.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/documents/doc-1"), {
      params: Promise.resolve({ id: "doc-1" })
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized." });
    expect(mocks.getDocumentById).not.toHaveBeenCalled();
  });

  it("returns the protected document payload for authenticated reviewers", async () => {
    const response = await GET(new Request("http://localhost/api/documents/doc-1"), {
      params: Promise.resolve({ id: "doc-1" })
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      document: { id: "doc-1", activeData: { documentType: "invoice" } },
      activeData: { documentType: "invoice" },
      reviewEvents: [
        {
          id: 1,
          action: "review_saved",
          payload_json: {},
          reviewer_email: "reviewer@example.com",
          reviewer_name: "Reviewer",
          created_at: "2026-05-03T00:00:00.000Z"
        }
      ],
      fileUrl: "/api/documents/doc-1/file"
    });
  });
});
