"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getActiveDocumentData } from "@/lib/documents/defaults";
import {
  parseLineItemsEditorText,
  parseNumericInput
} from "@/lib/documents/parsing";
import { importDatasetDocuments, processDocumentFile, storeUploadedFile } from "@/lib/documents/pipeline";
import { validateExtractedData } from "@/lib/documents/validation";
import { getDocumentById, saveReviewedDocument } from "@/lib/database";
import type { DocumentKind, DocumentStatus } from "@/lib/documents/types";

function getFormValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function normalizeDocumentType(value: string): DocumentKind {
  if (value === "invoice" || value === "purchase_order") {
    return value;
  }

  return "unknown";
}

function getReviewedStatus(
  action: string,
  hasErrors: boolean
): DocumentStatus {
  if (action === "reject") {
    return "rejected";
  }

  if (action === "validate" && !hasErrors) {
    return "validated";
  }

  return hasErrors ? "needs_review" : "uploaded";
}

export async function importDatasetAction() {
  await importDatasetDocuments();
  revalidatePath("/");
}

export async function uploadDocumentAction(formData: FormData) {
  const file = formData.get("document");

  if (!(file instanceof File) || file.size === 0) {
    throw new Error("Choose a file to upload.");
  }

  const storedFile = await storeUploadedFile(file);
  const document = await processDocumentFile({
    sourceName: file.name,
    sourceType: "upload",
    filePath: storedFile.destination
  });

  if (!document) {
    throw new Error("Document upload did not produce a saved record.");
  }

  revalidatePath("/");
  redirect(`/documents/${document.id}`);
}

export async function saveReviewAction(formData: FormData) {
  const documentId = getFormValue(formData, "documentId");
  const reviewAction = getFormValue(formData, "reviewAction");
  const existingDocument = await getDocumentById(documentId);

  if (!existingDocument) {
    throw new Error("Document not found.");
  }

  const baseData = getActiveDocumentData(existingDocument);
  const correctedData = {
    documentType: normalizeDocumentType(getFormValue(formData, "documentType")),
    supplierName: getFormValue(formData, "supplierName") || null,
    documentNumber: getFormValue(formData, "documentNumber") || null,
    issueDate: getFormValue(formData, "issueDate") || null,
    dueDate: getFormValue(formData, "dueDate") || null,
    currency: getFormValue(formData, "currency").toUpperCase() || null,
    subtotal:
      parseNumericInput(getFormValue(formData, "subtotal")) ?? baseData.subtotal,
    tax: parseNumericInput(getFormValue(formData, "tax")) ?? baseData.tax,
    total: parseNumericInput(getFormValue(formData, "total")) ?? baseData.total,
    lineItems: parseLineItemsEditorText(getFormValue(formData, "lineItems"))
  };
  const validationIssues = await validateExtractedData(correctedData, documentId);
  const hasErrors = validationIssues.some((issue) => issue.severity === "error");

  await saveReviewedDocument({
    id: documentId,
    correctedData,
    status: getReviewedStatus(reviewAction, hasErrors),
    validationIssues
  });

  revalidatePath("/");
  revalidatePath(`/documents/${documentId}`);
  redirect(`/documents/${documentId}`);
}
