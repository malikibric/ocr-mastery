import { NextResponse } from "next/server";
import {
  clearDatasetDocuments,
  completeImportState,
  failImportState,
  getImportState,
  resetImportState,
  startImportState,
  updateImportStateProgress
} from "@/lib/database";
import { importDatasetDocuments } from "@/lib/documents/pipeline";
import {
  requireReviewerApiSession,
  unauthorizedApiResponse
} from "@/lib/reviewer-session";
import { logStructuredError } from "@/lib/logging";
import { shouldAutoCompleteImportState } from "@/lib/import-state";

export async function GET() {
  const session = await requireReviewerApiSession();

  if (!session) {
    return unauthorizedApiResponse();
  }

  let state = await getImportState();

  if (shouldAutoCompleteImportState(state)) {
    await completeImportState();
    state = {
      ...state,
      running: false,
      done: true,
      error: null
    };
  }

  return NextResponse.json(state);
}

export async function POST() {
  const session = await requireReviewerApiSession();

  if (!session) {
    return unauthorizedApiResponse();
  }

  // Count files first so the UI can show total immediately
  const { readdir } = await import("node:fs/promises");
  const { isSupportedDocument } = await import("@/lib/documents/file-types");
  const path = await import("node:path");
  const resourcesDirectory = path.join(process.cwd(), "resources");
  const entries = await readdir(resourcesDirectory, { withFileTypes: true });
  const total = entries.filter(
    (e) => e.isFile() && isSupportedDocument(e.name)
  ).length;

  const started = await startImportState(total);

  if (!started) {
    return NextResponse.json(
      { error: "A dataset import is already running." },
      { status: 409 }
    );
  }

  // Fire and forget — do not await
  importDatasetDocuments((processed, failed) => {
    void updateImportStateProgress(processed, failed);
  })
    .then(() => {
      void completeImportState();
    })
    .catch((err) => {
      logStructuredError("dataset-import-failed", err, { total });
      const message = err instanceof Error ? err.message : "Import failed.";
      void failImportState(message);
    });

  return NextResponse.json({ started: true, total });
}

export async function DELETE() {
  const session = await requireReviewerApiSession();

  if (!session) {
    return unauthorizedApiResponse();
  }

  const deleted = await clearDatasetDocuments();
  await resetImportState();

  return NextResponse.json({ reset: true, deleted });
}
