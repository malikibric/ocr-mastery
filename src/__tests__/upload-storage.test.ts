import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_UPLOAD_BYTES } from "@/lib/documents/file-types";

const mocks = vi.hoisted(() => ({
  writeFile: vi.fn(),
  getUploadDirectory: vi.fn()
}));

vi.mock("node:fs/promises", () => ({
  default: {
    writeFile: mocks.writeFile
  }
}));

vi.mock("@/lib/database", async () => {
  const actual = await vi.importActual<typeof import("@/lib/database")>(
    "@/lib/database"
  );

  return {
    ...actual,
    getUploadDirectory: mocks.getUploadDirectory
  };
});

import { storeUploadedFile } from "@/lib/documents/pipeline";

const PNG_BYTES = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aZ0AAAAASUVORK5CYII=",
    "base64"
  )
);

describe("storeUploadedFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUploadDirectory.mockReturnValue("/tmp/uploads");
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("upload-uuid");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stores uploads with a collision-safe UUID prefix and detected mime type", async () => {
    const file = new File([PNG_BYTES], "scan.png", { type: "image/png" });

    await expect(storeUploadedFile(file)).resolves.toEqual({
      storedName: "upload-uuid-scan.png",
      destination: "/tmp/uploads/upload-uuid-scan.png",
      fileExtension: "png",
      mimeType: "image/png"
    });
    expect(mocks.writeFile).toHaveBeenCalledWith(
      "/tmp/uploads/upload-uuid-scan.png",
      expect.any(Uint8Array)
    );
  });

  it("rejects uploads above the configured size limit", async () => {
    const file = new File([new Uint8Array(MAX_UPLOAD_BYTES + 1)], "scan.png", {
      type: "image/png"
    });

    await expect(storeUploadedFile(file)).rejects.toThrow(/10 MB limit/);
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });
});
