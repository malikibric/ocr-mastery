import { afterEach, describe, expect, it, vi } from "vitest";

const originalFileAccessSecret = process.env.FILE_ACCESS_SECRET;
const originalNodeEnv = process.env.NODE_ENV;

async function importFileAccessModule() {
  vi.resetModules();
  return import("@/lib/documents/file-access");
}

describe("document file access signing", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();

    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }

    if (originalFileAccessSecret === undefined) {
      delete process.env.FILE_ACCESS_SECRET;
    } else {
      process.env.FILE_ACCESS_SECRET = originalFileAccessSecret;
    }
  });

  it("requires FILE_ACCESS_SECRET outside local development", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.FILE_ACCESS_SECRET;

    const { createDocumentFileUrl } = await importFileAccessModule();

    expect(() => createDocumentFileUrl("doc-1")).toThrow(
      /Missing required environment variable FILE_ACCESS_SECRET/
    );
  });

  it("allows a local development fallback secret", async () => {
    process.env.NODE_ENV = "development";
    delete process.env.FILE_ACCESS_SECRET;
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-03T00:00:00.000Z"));

    const { createDocumentFileUrl, hasValidDocumentFileAccess } =
      await importFileAccessModule();
    const url = new URL(createDocumentFileUrl("doc-1"), "http://localhost");

    expect(
      hasValidDocumentFileAccess(
        "doc-1",
        url.searchParams.get("expires"),
        url.searchParams.get("token")
      )
    ).toBe(true);
  });

  it("signs and validates URLs with the configured secret", async () => {
    process.env.NODE_ENV = "production";
    process.env.FILE_ACCESS_SECRET = "super-secret";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-03T00:00:00.000Z"));

    const { createDocumentFileUrl, hasValidDocumentFileAccess } =
      await importFileAccessModule();
    const url = new URL(createDocumentFileUrl("doc-1"), "http://localhost");

    expect(
      hasValidDocumentFileAccess(
        "doc-1",
        url.searchParams.get("expires"),
        url.searchParams.get("token")
      )
    ).toBe(true);
    expect(
      hasValidDocumentFileAccess(
        "doc-2",
        url.searchParams.get("expires"),
        url.searchParams.get("token")
      )
    ).toBe(false);
  });
});
