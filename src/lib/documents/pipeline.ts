import fs from "node:fs/promises";
import path from "node:path";
import { createEmptyExtractedData } from "@/lib/documents/defaults";
import {
  getFileExtension,
  getMimeType,
  isSupportedDocument
} from "@/lib/documents/file-types";
import { extractRawText } from "@/lib/documents/extraction";
import { parseExtractedDocument } from "@/lib/documents/parsing";
import { validateExtractedData } from "@/lib/documents/validation";
import { getUploadDirectory, saveProcessedDocument } from "@/lib/database";
import type {
  DocumentStatus,
  SourceType,
  ValidationIssue
} from "@/lib/documents/types";

function getInitialStatus(hasErrors: boolean): DocumentStatus {
  return hasErrors ? "needs_review" : "uploaded";
}

function buildProcessingErrorIssue(message: string): ValidationIssue[] {
  return [
    {
      code: "processing-failed",
      message,
      severity: "error",
      field: "document"
    }
  ];
}

function sanitizeFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function buildDatasetDocumentId(fileName: string) {
  return `dataset-${sanitizeFileName(fileName).toLowerCase()}`;
}

export async function processDocumentFile(input: {
  sourceName: string;
  sourceType: SourceType;
  filePath: string;
  documentId?: string;
}) {
  const fileExtension = getFileExtension(input.sourceName);
  const mimeType = getMimeType(input.sourceName);

  try {
    const rawText = await extractRawText(input.filePath, fileExtension);
    const extractedData = parseExtractedDocument(
      input.sourceName,
      fileExtension,
      rawText
    );
    const validationIssues = await validateExtractedData(
      extractedData,
      input.documentId
    );
    const hasErrors = validationIssues.some((issue) => issue.severity === "error");

    return saveProcessedDocument({
      id: input.documentId,
      sourceName: input.sourceName,
      sourceType: input.sourceType,
      mimeType,
      fileExtension,
      sourcePath: input.filePath,
      rawText,
      extractedData,
      validationIssues,
      status: getInitialStatus(hasErrors)
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Document processing failed.";

    try {
      return await saveProcessedDocument({
        id: input.documentId,
        sourceName: input.sourceName,
        sourceType: input.sourceType,
        mimeType,
        fileExtension,
        sourcePath: input.filePath,
        rawText: "",
        extractedData: createEmptyExtractedData(),
        validationIssues: buildProcessingErrorIssue(message),
        status: "needs_review",
        processingError: message
      });
    } catch {
      return null;
    }
  }
}

export async function importDatasetDocuments(
  onProgress?: (processed: number, failed: number) => void
) {
  const resourcesDirectory = path.join(process.cwd(), "resources");
  const entries = await fs.readdir(resourcesDirectory, { withFileTypes: true });
  const documentFiles = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        /^(data_|img_|invoice_|po_|text_)/.test(entry.name) &&
        isSupportedDocument(entry.name)
    )
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  const CONCURRENCY = 2;
  const results = [];
  let processed = 0;
  let failed = 0;

  for (let i = 0; i < documentFiles.length; i += CONCURRENCY) {
    const batch = documentFiles.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (fileName) => {
        const result = await processDocumentFile({
          documentId: buildDatasetDocumentId(fileName),
          sourceName: fileName,
          sourceType: "dataset",
          filePath: path.join(resourcesDirectory, fileName)
        });
        if (result?.processingError) failed++;
        else processed++;
        onProgress?.(processed, failed);
        return result;
      })
    );
    results.push(...batchResults);
  }

  return results;
}

export async function storeUploadedFile(file: File) {
  const uploadDirectory = getUploadDirectory();
  const extension = getFileExtension(file.name);

  if (!isSupportedDocument(file.name)) {
    throw new Error(
      `Unsupported file type "${extension || "unknown"}". Upload CSV, TXT, PDF, or image files.`
    );
  }

  const storedName = `${Date.now()}-${sanitizeFileName(file.name)}`;
  const destination = path.join(uploadDirectory, storedName);
  const arrayBuffer = await file.arrayBuffer();

  await fs.writeFile(destination, new Uint8Array(arrayBuffer));

  return {
    storedName,
    destination
  };
}
