export const DOCUMENT_STATUSES = [
  "uploaded",
  "needs_review",
  "validated",
  "rejected"
] as const;

export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const VALIDATION_SEVERITIES = ["error", "warning"] as const;

export type ValidationSeverity = (typeof VALIDATION_SEVERITIES)[number];

export type DocumentKind =
  | "invoice"
  | "purchase_order"
  | "company_details"
  | "unknown";

export type SourceType = "dataset" | "upload";

export type FieldValue = string | number | null;

export interface LineItem {
  description: string;
  quantity: number | null;
  unitPrice: number | null;
  lineTotal: number | null;
}

export interface ExtractedDocumentData {
  documentType: DocumentKind;
  supplierName: string | null;
  documentNumber: string | null;
  issueDate: string | null;
  dueDate: string | null;
  currency: string | null;
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  lineItems: LineItem[];
}

export interface ValidationIssue {
  code: string;
  message: string;
  severity: ValidationSeverity;
  field: keyof ExtractedDocumentData | "lineItems" | "document";
}

export interface PersistedDocument {
  id: string;
  sourceName: string;
  sourceType: SourceType;
  mimeType: string;
  fileExtension: string;
  sourcePath: string;
  status: DocumentStatus;
  rawText: string;
  processingError: string | null;
  extractedData: ExtractedDocumentData;
  correctedData: ExtractedDocumentData | null;
  validationIssues: ValidationIssue[];
  createdAt: string;
  updatedAt: string;
}

export interface PersistedDocumentSummary {
  id: string;
  sourceName: string;
  sourceType: SourceType;
  mimeType: string;
  fileExtension: string;
  status: DocumentStatus;
  processingError: string | null;
  validationIssues: ValidationIssue[];
  createdAt: string;
  updatedAt: string;
  activeData: ExtractedDocumentData;
}

export interface PersistDocumentInput {
  id?: string;
  sourceName: string;
  sourceType: SourceType;
  mimeType: string;
  fileExtension: string;
  sourcePath: string;
  rawText: string;
  extractedData: ExtractedDocumentData;
  validationIssues: ValidationIssue[];
  status: DocumentStatus;
  processingError?: string | null;
}

export interface ReviewUpdateInput {
  id: string;
  correctedData: ExtractedDocumentData;
  status: DocumentStatus;
  validationIssues: ValidationIssue[];
  reviewerEmail: string;
  reviewerName: string | null;
}

export interface ReviewEvent {
  id: number;
  action: string;
  payload_json: object;
  reviewer_email: string | null;
  reviewer_name: string | null;
  created_at: string;
}
