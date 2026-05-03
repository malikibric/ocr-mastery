import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  getDocumentCountsByStatus: vi.fn()
}));

vi.mock("node:child_process", () => ({
  execFile: mocks.execFile
}));

vi.mock("@/lib/database", () => ({
  getDocumentCountsByStatus: mocks.getDocumentCountsByStatus
}));

import { GET } from "@/app/api/health/route";

describe("/api/health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDocumentCountsByStatus.mockResolvedValue({
      uploaded: 0,
      needs_review: 0,
      validated: 0,
      rejected: 0
    });
    mocks.execFile.mockImplementation(
      (
        _file: string,
        _args: string[],
        _options: unknown,
        callback: (error: Error | null, stdout: string, stderr: string) => void
      ) => callback(null, "tesseract 5.5.0\n", "")
    );
  });

  it("returns ok when database and tesseract are available", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      checks: {
        database: { ok: true, detail: "reachable" },
        tesseract: { ok: true, detail: "tesseract 5.5.0" }
      }
    });
  });

  it("returns degraded when a dependency check fails", async () => {
    mocks.execFile.mockImplementation(
      (
        _file: string,
        _args: string[],
        _options: unknown,
        callback: (error: Error | null, stdout: string, stderr: string) => void
      ) => callback(new Error("spawn tesseract ENOENT"), "", "")
    );

    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: "degraded",
      checks: {
        database: { ok: true, detail: "reachable" },
        tesseract: { ok: false, detail: "spawn tesseract ENOENT" }
      }
    });
  });
});
