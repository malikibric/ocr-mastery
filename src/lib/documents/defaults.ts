import {
  type ExtractedDocumentData,
  type PersistedDocument
} from "@/lib/documents/types";

export function createEmptyExtractedData(): ExtractedDocumentData {
  return {
    documentType: "unknown",
    supplierName: null,
    documentNumber: null,
    issueDate: null,
    dueDate: null,
    currency: null,
    subtotal: null,
    tax: null,
    total: null,
    lineItems: []
  };
}

export function getActiveDocumentData(document: PersistedDocument) {
  return document.correctedData ?? document.extractedData;
}
