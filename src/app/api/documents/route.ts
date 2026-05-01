import { NextResponse } from "next/server";
import { getActiveDocumentData } from "@/lib/documents/defaults";
import { listDocuments } from "@/lib/database";

export async function GET() {
  const documents = (await listDocuments()).map((document) => ({
    ...document,
    activeData: getActiveDocumentData(document)
  }));

  return NextResponse.json({ documents });
}
