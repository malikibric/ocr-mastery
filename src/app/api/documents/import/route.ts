import { NextResponse } from "next/server";
import { importDatasetDocuments } from "@/lib/documents/pipeline";

export async function POST() {
  const documents = await importDatasetDocuments();

  return NextResponse.json({
    imported: documents.length,
    documentIds: documents.map((document) => document?.id)
  });
}
