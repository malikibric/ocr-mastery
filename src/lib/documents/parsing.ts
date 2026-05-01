import Papa from "papaparse";
import { createEmptyExtractedData } from "@/lib/documents/defaults";
import type {
  DocumentKind,
  ExtractedDocumentData,
  LineItem
} from "@/lib/documents/types";

const CURRENCIES = ["BAM", "EUR", "USD", "GBP", "CHF"];

const SYMBOL_TO_CURRENCY: Record<string, string> = {
  "$": "USD",
  "€": "EUR",
  "£": "GBP",
  "¥": "JPY",
  "₹": "INR",
  "₽": "RUB",
  "₩": "KRW"
};

const MONTH_NAMES: Record<string, string> = {
  january: "01", february: "02", march: "03", april: "04",
  may: "05", june: "06", july: "07", august: "08",
  september: "09", october: "10", november: "11", december: "12",
  jan: "01", feb: "02", mar: "03", apr: "04", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12"
};

function parseAmount(value: string | undefined | null) {
  if (!value) {
    return null;
  }

  const stripped = value.replace(/[^0-9,.-]/g, "");
  const normalized = stripped.includes(",") && stripped.includes(".")
    ? stripped.replace(/,/g, "")
    : stripped.replace(",", ".");
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

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
    return cleaned;
  }

  // DD.MM.YYYY / DD/MM/YYYY / DD-MM-YYYY
  const european = cleaned.match(/^(\d{1,2})[./-](\d{2})[./-](\d{4})$/);
  if (european) {
    return `${european[3]}-${european[2]}-${european[1].padStart(2, "0")}`;
  }

  // "15 March 2026" / "15 Mar 2026"
  const dayMonthYear = cleaned.match(/^(\d{1,2})\s+([a-zA-Z]+)\s+(\d{4})$/);
  if (dayMonthYear) {
    const month = MONTH_NAMES[dayMonthYear[2].toLowerCase()];
    if (month) return `${dayMonthYear[3]}-${month}-${dayMonthYear[1].padStart(2, "0")}`;
  }

  // "March 15, 2026" / "Mar 15 2026"
  const monthDayYear = cleaned.match(/^([a-zA-Z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (monthDayYear) {
    const month = MONTH_NAMES[monthDayYear[1].toLowerCase()];
    if (month) return `${monthDayYear[3]}-${month}-${monthDayYear[2].padStart(2, "0")}`;
  }

  return null;
}

function inferDocumentType(fileName: string, text: string): DocumentKind {
  const normalized = `${fileName} ${text}`.toLowerCase();

  if (normalized.includes("purchase order") || normalized.includes("po-") || normalized.includes("po_")) {
    return "purchase_order";
  }

  if (normalized.includes("invoice") || normalized.includes("inv-")) {
    return "invoice";
  }

  return "unknown";
}

function findCurrency(text: string) {
  // Explicit currency codes first
  for (const currency of CURRENCIES) {
    if (text.toUpperCase().includes(currency)) {
      return currency;
    }
  }

  // Fall back to currency symbols
  for (const [symbol, code] of Object.entries(SYMBOL_TO_CURRENCY)) {
    if (text.includes(symbol)) {
      return code;
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
    /Description\s+(.*?)(?:Sub\s*Total|Subtotal|Tax|Total:|Total\s+\d)/is
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
    /Company\s*:\s*(.+?)(?=\s+(?:Number|Date|Due|Total|Subtotal|Tax)\b)/i,
    /From\s*:\s*(.+?)(?=\s+(?:Number|Date|Due|Total|Subtotal|Tax)\b)/i,
    /Bill(?:ed)?\s+(?:from|by)\s*:\s*(.+?)(?=\s+(?:Number|Date|Due|Total)\b)/i,
    // Company name by suffix: "Acme Corp", "Acme, Ltd.", "Acme Inc." etc.
    /\b([A-Z][A-Za-z0-9 &,]+(?:Ltd\.?|Inc\.?|LLC|Corp\.?|GmbH|Co\.?|Limited|Incorporated))/
  ]);

  data.documentNumber = extractSingleValue(text, [
    /(?:Invoice|Purchase Order)?\s*(?:No\.?|Number|#)\s*:?\s*([A-Z0-9-]+)/i,
    /(?:Invoice|PO)\s*(?:No\.?|#)\s*:?\s*([A-Z0-9-]+)/i,
    /\b(PO-\d+|INV-\d+|TXT-\d+)\b/i
  ])?.toUpperCase() ?? null;

  // Dates — support both numeric and text month formats
  data.issueDate = normalizeDate(
    extractSingleValue(text, [
      /(?:Issue\s+Date|Invoice\s+Date|Date\s+of\s+Issue|Date)\s*:\s*([0-9A-Za-z ,\/./-]+?)(?=\s{2,}|\s*(?:Due|Number|Invoice|Total)|$)/i
    ])
  );

  data.dueDate = normalizeDate(
    extractSingleValue(text, [
      /Due\s+Date\s*:\s*([0-9A-Za-z ,\/./-]+?)(?=\s{2,}|\s*(?:Payment|Invoice|Total|Number)|$)/i
    ])
  );

  data.currency = findCurrency(text);

  // Sub Total / Subtotal (with or without space)
  data.subtotal = extractNumericValue(
    text,
    /Sub\s*[Tt]otal\s*[:\-]?\s*\$?\s*([0-9]+(?:[.,][0-9]+)?)/gi
  );

  // Tax — skip percentage value, capture the actual amount
  data.tax = extractNumericValue(
    text,
    /Tax(?:\s*\([^)]+\))?(?:\s+[0-9]+%)?\s*[:\-]?\s*\$?\s*([0-9]+(?:[.,][0-9]+)?)(?!\s*%)/gi
  );

  // Grand Total / Total
  data.total = extractNumericValue(
    text,
    /(?:Grand\s+)?Total\s*[:\-]?\s*\$?\s*([0-9]+(?:[.,][0-9]+)?)(?!\s*%)/gi
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
