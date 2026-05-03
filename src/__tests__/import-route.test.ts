import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_IMPORT_STATE } from "@/lib/import-state";

const mocks = vi.hoisted(() => ({
  clearDatasetDocuments: vi.fn(),
  getImportState: vi.fn(),
  startImportState: vi.fn(),
  updateImportStateProgress: vi.fn(),
  completeImportState: vi.fn(),
  failImportState: vi.fn(),
  resetImportState: vi.fn(),
  requireReviewerApiSession: vi.fn(),
  importDatasetDocuments: vi.fn(),
  readdir: vi.fn(),
  isSupportedDocument: vi.fn()
}));

vi.mock("@/lib/database", () => ({
  clearDatasetDocuments: mocks.clearDatasetDocuments,
  getImportState: mocks.getImportState,
  startImportState: mocks.startImportState,
  updateImportStateProgress: mocks.updateImportStateProgress,
  completeImportState: mocks.completeImportState,
  failImportState: mocks.failImportState,
  resetImportState: mocks.resetImportState
}));

vi.mock("@/lib/documents/pipeline", () => ({
  importDatasetDocuments: mocks.importDatasetDocuments
}));

vi.mock("node:fs/promises", () => ({
  readdir: mocks.readdir
}));

vi.mock("@/lib/documents/file-types", () => ({
  isSupportedDocument: mocks.isSupportedDocument
}));

vi.mock("@/lib/reviewer-session", () => ({
  requireReviewerApiSession: mocks.requireReviewerApiSession,
  unauthorizedApiResponse: () =>
    Response.json({ error: "Unauthorized." }, { status: 401 })
}));

import { DELETE, GET, POST } from "@/app/api/documents/import/route";

describe("/api/documents/import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireReviewerApiSession.mockResolvedValue({
      reviewerEmail: "reviewer@example.com",
      reviewerName: "Reviewer"
    });
    mocks.getImportState.mockResolvedValue(DEFAULT_IMPORT_STATE);
    mocks.startImportState.mockResolvedValue({
      ...DEFAULT_IMPORT_STATE,
      running: true,
      done: false
    });
    mocks.clearDatasetDocuments.mockResolvedValue(0);
    mocks.resetImportState.mockResolvedValue(undefined);
    mocks.isSupportedDocument.mockImplementation((name: string) =>
      name.endsWith(".pdf")
    );
  });

  it("returns the persisted import state", async () => {
    mocks.getImportState.mockResolvedValue({
      running: true,
      total: 3,
      processed: 1,
      failed: 0,
      done: false,
      error: null
    });

    const response = await GET();

    expect(await response.json()).toEqual({
      running: true,
      total: 3,
      processed: 1,
      failed: 0,
      done: false,
      error: null
    });
  });

  it("marks a fully processed running import as complete", async () => {
    mocks.getImportState.mockResolvedValue({
      running: true,
      total: 2,
      processed: 2,
      failed: 0,
      done: false,
      error: null
    });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      running: false,
      total: 2,
      processed: 2,
      failed: 0,
      done: true,
      error: null
    });
    expect(mocks.completeImportState).toHaveBeenCalledTimes(1);
  });

  it("rejects unauthenticated import requests", async () => {
    mocks.requireReviewerApiSession.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized." });
    expect(mocks.getImportState).not.toHaveBeenCalled();
  });

  it("rejects duplicate import starts when one is already running", async () => {
    mocks.readdir.mockResolvedValue([]);
    mocks.startImportState.mockResolvedValue(null);

    const response = await POST();

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "A dataset import is already running."
    });
    expect(mocks.importDatasetDocuments).not.toHaveBeenCalled();
  });

  it("starts a persisted import job and reports file totals", async () => {
    mocks.readdir.mockResolvedValue([
      { name: "invoice.pdf", isFile: () => true },
      { name: "notes.txt", isFile: () => true },
      { name: "nested", isFile: () => false }
    ]);
    mocks.importDatasetDocuments.mockImplementation(
      async (onProgress?: (processed: number, failed: number) => void) => {
        onProgress?.(1, 0);
        return [];
      }
    );

    const response = await POST();
    await Promise.resolve();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ started: true, total: 1 });
    expect(mocks.startImportState).toHaveBeenCalledWith(1);
    expect(mocks.importDatasetDocuments).toHaveBeenCalledTimes(1);
    expect(mocks.updateImportStateProgress).toHaveBeenCalledWith(1, 0);
    expect(mocks.completeImportState).toHaveBeenCalled();
  });

  it("resets imported dataset documents when no import is running", async () => {
    mocks.clearDatasetDocuments.mockResolvedValue(3);

    const response = await DELETE();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      reset: true,
      deleted: 3
    });
    expect(mocks.clearDatasetDocuments).toHaveBeenCalledTimes(1);
    expect(mocks.resetImportState).toHaveBeenCalledTimes(1);
  });

  it("resets import state even when the previous run is stuck as running", async () => {
    mocks.getImportState.mockResolvedValue({
      running: true,
      total: 10,
      processed: 4,
      failed: 0,
      done: false,
      error: null
    });
    mocks.clearDatasetDocuments.mockResolvedValue(2);

    const response = await DELETE();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      reset: true,
      deleted: 2
    });
    expect(mocks.clearDatasetDocuments).toHaveBeenCalledTimes(1);
    expect(mocks.resetImportState).toHaveBeenCalledTimes(1);
  });
});
