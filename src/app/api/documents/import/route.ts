import { NextResponse } from "next/server";
import { importDatasetDocuments } from "@/lib/documents/pipeline";
import { importState } from "@/lib/import-state";

export async function GET() {
  return NextResponse.json(importState);
}

export async function POST() {
  // Count files first so the UI can show total immediately
  const { readdir } = await import("node:fs/promises");
  const { isSupportedDocument } = await import("@/lib/documents/file-types");
  const path = await import("node:path");
  const resourcesDirectory = path.join(process.cwd(), "resources");
  const entries = await readdir(resourcesDirectory, { withFileTypes: true });
  const total = entries.filter(
    (e) =>
      e.isFile() &&
      /^(data_|img_|invoice_|po_|text_)/.test(e.name) &&
      isSupportedDocument(e.name)
  ).length;

  importState.running = true;
  importState.total = total;
  importState.processed = 0;
  importState.failed = 0;
  importState.done = false;
  importState.error = null;

  // Fire and forget — do not await
  importDatasetDocuments((processed, failed) => {
    importState.processed = processed;
    importState.failed = failed;
  })
    .then(() => {
      importState.done = true;
      importState.running = false;
    })
    .catch((err) => {
      importState.error = err instanceof Error ? err.message : "Import failed.";
      importState.done = true;
      importState.running = false;
    });

  return NextResponse.json({ started: true, total });
}
