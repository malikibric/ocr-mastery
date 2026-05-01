import Papa from "papaparse";
import { createEmptyExtractedData } from "@/lib/documents/defaults";
import type {
  DocumentKind,
  ExtractedDocumentData,
  LineItem
} from "@/lib/documents/types";

const CURRENCIES = ["BAM", "EUR", "USD", "GBP", "CHF"];

function parseAmount(value: string | undefined | null) {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/[^0-9,.-]/g, "").replace(",", ".");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseNumericInput(value: string | null) {
  return parseAmount(value);
}

function normalizeDate(value: string | undefined | null) {
  if (!value) {
    return null;
  }

  const cleaned = value.trim().replace(/[.,]$/, "");
  const isoLike = /^\d{4}-\d{2}-\d{2}$/;
  const european = /^(\d{2})[./-](\d{2})[./-](\d{4})$/;

  if (isoLike.test(cleaned)) {
    return cleaned;
  }

  const match = cleaned.match(european);

  if (!match) {
    return null;
  }

  return `${match[3]}-${match[2]}-${match[1]}`;
}

function inferDocumentType(fileName: string, text: string): DocumentKind {
  const normalized = `${fileName} ${text}`.toLowerCase();

  if (normalized.includes("purchase order") || normalized.includes("po-")) {
    return "purchase_order";
  }

  if (normalized.includes("invoice") || normalized.includes("inv-")) {
    return "invoice";
  }

  return "unknown";
}

function findCurrency(text: string) {
  for (const currency of CURRENCIES) {
    if (text.toUpperCase().includes(currency)) {
      return currency;
    }
  }

  return null;
}

function extractSingleValue(text: string, expressions: RegExp[]) {
  for (const expression of expressions) {
    const match = text.match(expression);

    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return null;
}

function extractNumericValue(text: string, expression: RegExp) {
  const matches = [...text.matchAll(expression)];
  const value = matches.at(-1)?.[1];
  return parseAmount(value);
}

function parseLineItemsFromCsv(rawText: string): LineItem[] {
  const parsed = Papa.parse<Record<string, string>>(rawText, {
    header: true,
    skipEmptyLines: true
  });

  return parsed.data.map((row) => ({
    description: row.desc?.trim() || row.description?.trim() || "Item",
    quantity: parseAmount(row.qty ?? row.quantity),
    unitPrice: parseAmount(row.price ?? row.unitPrice),
    lineTotal: parseAmount(row.total ?? row.lineTotal)
  }));
}

function parseLineItemsFromText(rawText: string): LineItem[] {
  const sectionMatch = rawText.match(
    /Description\s+(.*?)(?:Subtotal|Tax|Total:|Total\s+\d)/is
  );
  const section = sectionMatch?.[1]?.trim();

  if (!section) {
    return [];
  }

  const normalizedSection = section.replace(
    /^(?:Qty\s+Unit\s+Price\s+Total\s*)/i,
    ""
  );

  const items = [...normalizedSection.matchAll(
    /([A-Za-z][A-Za-z0-9 &/.,'-]*?)\s+(\d+(?:[.,]\d+)?)\s+(\d+(?:[.,]\d+)?)\s+(\d+(?:[.,]\d+)?)(?=\s+[A-Za-z]|$)/g
  )].map((match) => ({
    description: match[1].trim(),
    quantity: parseAmount(match[2]),
    unitPrice: parseAmount(match[3]),
    lineTotal: parseAmount(match[4])
  }));

  return items;
}

function buildGenericData(fileName: string, rawText: string): ExtractedDocumentData {
  const text = rawText.replace(/\s+/g, " ").trim();
  const data = createEmptyExtractedData();

  data.documentType = inferDocumentType(fileName, rawText);
  data.supplierName = extractSingleValue(text, [
    /Supplier\s*:\s*(.+?)(?=\s+(?:Number|Date|Due|Total|Subtotal|Tax)\b)/i,
    /Company\s*:\s*(.+?)(?=\s+(?:Number|Date|Due|Total|Subtotal|Tax)\b)/i
  ]);
  data.documentNumber = extractSingleValue(text, [
    /(?:Invoice|Purchase Order)?\s*Number\s*:\s*([A-Z0-9-]+)/i,
    /(?:Invoice|PO)\s*(?:No\.?|#)\s*:\s*([A-Z0-9-]+)/i,
    /\b(PO-\d+|INV-\d+|TXT-\d+)\b/i
  ])?.toUpperCase() ?? null;
  data.issueDate = normalizeDate(
    extractSingleValue(text, [
      /(?:Issue\s+Date|Invoice\s+Date|Date)\s*:\s*([0-9./-]+)/i
    ])
  );
  data.dueDate = normalizeDate(
    extractSingleValue(text, [/Due\s+Date\s*:\s*([0-9./-]+)/i])
  );
  data.currency = findCurrency(text);
  data.subtotal = extractNumericValue(
    text,
    /Subtotal\s*[:\-]?\s*([0-9]+(?:[.,][0-9]+)?)/gi
  );
  data.tax = extractNumericValue(
    text,
    /Tax(?:\s*\([^)]+\))?\s*[:\-]?\s*([0-9]+(?:[.,][0-9]+)?)/gi
  );
  data.total = extractNumericValue(
    text,
    /(?:^|\s)Total\s*[:\-]?\s*([0-9]+(?:[.,][0-9]+)?)/gi
  );
  data.lineItems = parseLineItemsFromText(rawText);

  return data;
}

export function parseExtractedDocument(
  fileName: string,
  fileExtension: string,
  rawText: string
): ExtractedDocumentData {
  if (fileExtension === "csv") {
    const lineItems = parseLineItemsFromCsv(rawText);
    const subtotal = lineItems.reduce(
      (sum, item) => sum + (item.lineTotal ?? 0),
      0
    );

    return {
      ...createEmptyExtractedData(),
      documentType: inferDocumentType(fileName, rawText),
      subtotal: lineItems.length > 0 ? subtotal : null,
      total: lineItems.length > 0 ? subtotal : null,
      currency: findCurrency(rawText),
      lineItems
    };
  }

  return buildGenericData(fileName, rawText);
}

export function parseLineItemsEditorText(rawValue: string): LineItem[] {
  return rawValue
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [description, quantity, unitPrice, lineTotal] = line
        .split("|")
        .map((part) => part.trim());

      return {
        description: description || "Item",
        quantity: parseAmount(quantity),
        unitPrice: parseAmount(unitPrice),
        lineTotal: parseAmount(lineTotal)
      };
    });
}

export function serializeLineItemsEditorText(lineItems: LineItem[]) {
  return lineItems
    .map(
      (lineItem) =>
        `${lineItem.description} | ${lineItem.quantity ?? ""} | ${
          lineItem.unitPrice ?? ""
        } | ${lineItem.lineTotal ?? ""}`
    )
    .join("\n");
}
