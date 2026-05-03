import Papa from "papaparse";
import { createEmptyExtractedData } from "@/lib/documents/defaults";
import type {
  DocumentKind,
  ExtractedDocumentData,
  LineItem
} from "@/lib/documents/types";

const CURRENCIES = [
  "BAM", "EUR", "USD", "GBP", "CHF",
  "AED", "SAR", "QAR", "KWD", "BHD", "OMR",  // Gulf
  "JPY", "CNY", "HKD", "SGD", "KRW",           // Asia-Pacific
  "CAD", "AUD", "NZD",                          // Commonwealth
  "INR", "PKR", "BDT",                          // South Asia
  "TRY", "RUB", "PLN", "CZK", "HUF", "SEK", "NOK", "DKK",  // Other EU/Europe
];

const SYMBOL_TO_CURRENCY: Record<string, string> = {
  "$": "USD",
  "€": "EUR",
  "£": "GBP",
  "¥": "JPY",
  "₹": "INR",
  "₽": "RUB",
  "₩": "KRW"
};

const CURRENCY_NAME_ALIASES: Array<[string, string]> = [
  ["indian rupees", "INR"],
  ["rupees", "INR"],
  ["rupee", "INR"]
];

const COMPANY_SUFFIX_PATTERN = String.raw`(?:Ltd\.?|Inc\.?|LLC|Corp\.?|GmbH|AG|KG|AB|A[.\s]?[ŞS]\.?|S\.?r\.?l\.?|S\.?p\.?A\.?|Co\.?|Limited|Incorporated|Private\s+Limited)`;
const COMPANY_SUFFIX_RE = new RegExp(String.raw`\b${COMPANY_SUFFIX_PATTERN}\b`, "i");
const COMPANY_PREFIX_TO_SUFFIX_RE = new RegExp(
  String.raw`^(.+?\b${COMPANY_SUFFIX_PATTERN}(?:\b|$))`,
  "i"
);
const TRAILING_COMPANY_SEGMENT_RE = new RegExp(
  String.raw`([A-Za-z][A-Za-z&.,/-]*(?:\s+[A-Za-z&.,/-]+){0,4}\s+\b${COMPANY_SUFFIX_PATTERN}\b\.?)$`,
  "i"
);
const COMPANY_SEGMENT_RE = new RegExp(
  String.raw`([A-Za-z][A-Za-z0-9&.,/-]*(?:\s+[A-Za-z0-9&.,/-]+){0,6}\s+\b${COMPANY_SUFFIX_PATTERN}\b\.?)`,
  "ig"
);
const SUPPLIER_LABEL_RE =
  /\b(?:invoice|purchase\s+order|company\s+details|date|due|subtotal|tax|tota(?:l)?|currency|customer|number|amount|description|page|qty|payment|buyer|buyers|bill(?:ed)?|ship|portal|contact|created|updated|verification)\b/i;

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
  let normalized: string;
  if (stripped.includes(",") && stripped.includes(".")) {
    // Both separators: comma is thousands ("1,234.56" or "1.234,56")
    if (stripped.indexOf(",") < stripped.indexOf(".")) {
      normalized = stripped.replace(/,/g, ""); // 1,234.56 → 1234.56
    } else {
      normalized = stripped.replace(/\./g, "").replace(",", "."); // 1.234,56 → 1234.56
    }
  } else if (/^\d{1,3}(,\d{3})+$/.test(stripped)) {
    // Comma as thousands separator: "3,400" / "1,234,567"
    normalized = stripped.replace(/,/g, "");
  } else {
    normalized = stripped.replace(",", ".");
  }
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

  // DD.MM.YYYY / DD/MM/YYYY / DD-MM-YYYY (or M/D/YYYY US format when middle > 12)
  const european = cleaned.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (european) {
    const [, a, b, year] = european;
    // If middle value > 12 it can't be a month → M/D/YYYY (US format)
    if (parseInt(b, 10) > 12) {
      return `${year}-${a.padStart(2, "0")}-${b.padStart(2, "0")}`;
    }
    return `${year}-${b.padStart(2, "0")}-${a.padStart(2, "0")}`;
  }

  const shortYear = cleaned.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2})$/);
  if (shortYear) {
    const [, a, b, short] = shortYear;
    const year = Number.parseInt(short, 10) >= 70 ? `19${short}` : `20${short}`;
    if (parseInt(b, 10) > 12) {
      return `${year}-${a.padStart(2, "0")}-${b.padStart(2, "0")}`;
    }
    return `${year}-${b.padStart(2, "0")}-${a.padStart(2, "0")}`;
  }

  // "15 March 2026" / "15 Mar 2026" / "1-Jan-2018" (space or hyphen separator)
  const dayMonthYear = cleaned.match(/^(\d{1,2})[\s-]+([a-zA-Z]+)[\s-]+(\d{4})$/);
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

  if (
    normalized.includes("company details") ||
    (normalized.includes("organization") &&
      (normalized.includes("contact email") ||
        normalized.includes("customer number") ||
        normalized.includes("implementation type")))
  ) {
    return "company_details";
  }

  if (normalized.includes("purchase order") || normalized.includes("po-") || normalized.includes("po_")) {
    return "purchase_order";
  }

  if (
    normalized.includes("invoice") || normalized.includes("inv-") ||
    normalized.includes("facture") ||   // FR
    normalized.includes("rechnung") ||  // DE
    normalized.includes("fattura") ||   // IT
    normalized.includes("factura") ||   // ES
    normalized.includes("fatura") ||    // TR
    normalized.includes("faktura")      // SE/NO/PL
  ) {
    return "invoice";
  }

  return "unknown";
}

function findCurrency(text: string) {
  // Explicit currency codes first
  for (const currency of CURRENCIES) {
    if (new RegExp(`\\b${currency}\\b`, "i").test(text)) {
      return currency;
    }
  }

  const normalizedText = text.toLowerCase();

  for (const [alias, currency] of CURRENCY_NAME_ALIASES) {
    if (normalizedText.includes(alias)) {
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

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeSupplierCandidate(value: string) {
  const normalized = normalizeWhitespace(
    value
      .replace(/^(?:Supplier|Company|From)\s*:\s*/i, "")
      .replace(/^Bill(?:ed)?\s+(?:from|by)\s*:\s*/i, "")
      .replace(/^[^A-Za-z]+/, "")
      .replace(/[^\w).,&/-]+$/g, "")
  );
  const trailingCompanyMatch = normalized.match(TRAILING_COMPANY_SEGMENT_RE);

  if (trailingCompanyMatch?.[1]) {
    return normalizeWhitespace(trailingCompanyMatch[1]);
  }

  const companySegments = [...normalized.matchAll(COMPANY_SEGMENT_RE)]
    .map((match) => normalizeWhitespace(match[1]))
    .filter((match) => match.length >= 8);

  if (companySegments.length > 0) {
    return companySegments.at(-1) ?? normalized;
  }

  const suffixMatch = normalized.match(COMPANY_PREFIX_TO_SUFFIX_RE);
  return suffixMatch ? normalizeWhitespace(suffixMatch[1]) : normalized;
}

function scoreSupplierCandidate(value: string, lineIndex?: number) {
  const rawValue = normalizeWhitespace(value);
  const candidate = normalizeSupplierCandidate(value);

  if (candidate.length < 8) {
    return -1;
  }

  const words = candidate.split(/\s+/);
  if (words.length < 2) {
    return -1;
  }

  const letters = (candidate.match(/[A-Za-z]/g) || []).length;
  if (letters === 0) {
    return -1;
  }

  const uppercaseLetters = (candidate.match(/[A-Z]/g) || []).length;
  const digits = (rawValue.match(/[0-9]/g) || []).length;
  const longAlphaWords = words.filter((word) => {
    const alphaOnly = word.replace(/[^A-Za-z]/g, "");
    return alphaOnly.length >= 4;
  }).length;

  let score = 0;

  if (COMPANY_SUFFIX_RE.test(candidate)) {
    score += 6;
  }

  if (uppercaseLetters / letters >= 0.55) {
    score += 2;
  }

  if (longAlphaWords >= 2) {
    score += 2;
  }

  if (words.length <= 8) {
    score += 2;
  } else if (words.length <= 12) {
    score += 1;
  } else {
    score -= 1;
  }

  if (lineIndex !== undefined && lineIndex <= 12) {
    score += 1;
  }

  if (/[,&]/.test(candidate)) {
    score += 1;
  }

  if (digits / letters < 0.2) {
    score += 1;
  }

  if (/^[^A-Za-z]*\d/.test(rawValue)) {
    score -= 4;
  }

  if (SUPPLIER_LABEL_RE.test(candidate)) {
    score -= 4;
  }

  if (candidate.length > 80) {
    score -= 2;
  }

  return score;
}

function findBestSupplierName(rawText: string, text: string) {
  const candidates: Array<{ value: string; score: number }> = [];
  const regexCandidate = extractSingleValue(text, [
    /Supplier\s*:\s*(.+?)(?=\s+(?:Number|Date|Due|Total|Subtotal|Tax)\b)/i,
    /Company\s*:\s*(.+?)(?=\s+(?:Number|Date|Due|Total|Subtotal|Tax)\b)/i,
    /From\s*:\s*(.+?)(?=\s+(?:Number|Date|Due|Total|Subtotal|Tax)\b)/i,
    /Bill(?:ed)?\s+(?:from|by)\s*:\s*(.+?)(?=\s+(?:Number|Date|Due|Total)\b)/i,
    /\bfor\s+([A-Z][A-Za-z0-9 &,]+(?:Ltd\.?|Inc\.?|LLC|Corp\.?|GmbH|AG|KG|AB|A[.\s]?[ŞS]\.?|S\.?r\.?l\.?|S\.?p\.?A\.?|Co\.?|Limited|Incorporated))/i,
    /\b(?!(?:Tax\s+)?Invoice\b|Purchase\s+Order\b|Receipt\b|Proforma\b)([A-Z][A-Za-z0-9 &,]+(?:Ltd\.?|Inc\.?|LLC|Corp\.?|GmbH|AG|KG|AB|A[.\s]?[ŞS]\.?|S\.?r\.?l\.?|S\.?p\.?A\.?|Co\.?|Limited|Incorporated))/
  ]);

  if (regexCandidate) {
    candidates.push({
      value: normalizeSupplierCandidate(regexCandidate),
      score: scoreSupplierCandidate(regexCandidate)
    });
  }

  rawText
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean)
    .forEach((line, lineIndex) => {
      const score = scoreSupplierCandidate(line, lineIndex);

      if (score >= 5) {
        candidates.push({
          value: normalizeSupplierCandidate(line),
          score
        });
      }
    });

  const bestCandidate = candidates.sort((left, right) => right.score - left.score)[0];
  return bestCandidate?.value ?? null;
}

function extractSupplierFromLabel(rawText: string) {
  const labeledValue = extractSingleValue(rawText, [
    /(?:^|\n)\s*Supplier\s*:?\s*(.+?)(?=\n|$)/i,
    /(?:^|\n)\s*Company\s*:\s*(.+?)(?=\n|$)/i,
    /(?:^|\n)\s*From\s*:\s*(.+?)(?=\n|$)/i,
    /(?:^|\n)\s*Bill(?:ed)?\s+(?:from|by)\s*:?\s*(.+?)(?=\n|$)/i
  ]);

  if (!labeledValue) {
    return null;
  }

  const normalized = normalizeWhitespace(labeledValue);
  return normalized.length > 1 ? normalized : null;
}

function extractStandaloneDocumentNumber(rawText: string) {
  return extractSingleValue(rawText, [
    /(?:^|\n)\s*(?:Tax\s+|Proforma\s+)?Invoice(?:\s*:\s*|\s+)(?!No\b|Number\b|#|Date\b)([A-Z0-9][A-Z0-9 -]*\d)\s*(?=\n|$)/i,
    /(?:^|\n)\s*Purchase\s+Order(?:\s*:\s*|\s+)(?!No\b|Number\b|#|Date\b)([A-Z0-9][A-Z0-9 -]*\d)\s*(?=\n|$)/i
  ]);
}

function splitColumns(line: string) {
  return line
    .trim()
    .split(/\s{2,}/)
    .map((part) => normalizeWhitespace(part))
    .filter(Boolean);
}

function extractTableColumnValue(rawText: string, labelPattern: RegExp) {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);

  for (let i = 0; i < lines.length; i++) {
    const headers = splitColumns(lines[i]);
    const headerIndex = headers.findIndex((header) => labelPattern.test(header));

    if (headerIndex === -1) {
      continue;
    }

    for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
      const values = splitColumns(lines[j]);

      if (values.length > headerIndex) {
        return values[headerIndex];
      }
    }
  }

  return null;
}

function parseCompanyDetailsData(rawText: string): Partial<ExtractedDocumentData> {
  const organization =
    extractTableColumnValue(rawText, /^Organization$/i) ??
    extractTableColumnValue(rawText, /^Company$/i);
  const customerNumber = extractTableColumnValue(
    rawText,
    /^Customer Number(?: \(MCL\))?$/i
  );
  const lastUpdated = extractTableColumnValue(rawText, /^Last updated$/i);
  const createdAt = extractTableColumnValue(rawText, /^Created at$/i);

  return {
    supplierName: organization ? normalizeWhitespace(organization) : null,
    documentNumber: customerNumber
      ? normalizeWhitespace(customerNumber).replace(/\s+/g, "").toUpperCase()
      : null,
    issueDate: normalizeDate(lastUpdated) ?? normalizeDate(createdAt)
  };
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

function extractNumericMatch(text: string, expression: RegExp) {
  const matches = [...text.matchAll(expression)];
  const raw = matches.at(-1)?.[1];

  if (!raw) {
    return null;
  }

  return {
    raw,
    value: parseAmount(raw)
  };
}

function isImageFileName(fileName: string) {
  return /\.(?:png|jpe?g)$/i.test(fileName);
}

function hasExplicitDecimalAmount(rawText: string) {
  return /\b\d+(?:,\d{3})*\.\d{2}\b/.test(rawText);
}

function isLikelyMissingMoneyDecimal(
  rawValue: string,
  parsedValue: number | null,
  rawText: string,
  fileName: string
) {
  if (
    !isImageFileName(fileName) ||
    parsedValue === null ||
    !hasExplicitDecimalAmount(rawText) ||
    /[.,]/.test(rawValue)
  ) {
    return false;
  }

  const digitsOnly = rawValue.replace(/\D/g, "");
  return digitsOnly.length >= 5 && digitsOnly.endsWith("00") && parsedValue >= 10000;
}

function repairOcrMoneyValue(
  match: { raw: string; value: number | null } | null,
  rawText: string,
  fileName: string
) {
  if (!match) {
    return null;
  }

  if (isLikelyMissingMoneyDecimal(match.raw, match.value, rawText, fileName)) {
    return match.value === null ? null : match.value / 100;
  }

  return match.value;
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

  if (data.documentType === "company_details") {
    const companyDetailsData = parseCompanyDetailsData(rawText);

    data.supplierName = companyDetailsData.supplierName ?? null;
    data.documentNumber = companyDetailsData.documentNumber ?? null;
    data.issueDate = companyDetailsData.issueDate ?? null;
    data.currency = null;
    data.subtotal = null;
    data.tax = null;
    data.total = null;
    data.lineItems = [];
    return data;
  }

  data.supplierName = extractSupplierFromLabel(rawText) ?? findBestSupplierName(rawText, text);

  data.documentNumber =
    (
        extractSingleValue(rawText, [
          /(?:^|\n)\s*(?:INVOICE|PURCHASE\s+ORDER)\s+(?:NO\.?|NUMBER)\s*:?\s*([A-Z0-9-]{3,})\s*(?=\n|$)/i,
          /(?:^|\n)\s*(?:INVOICE|PURCHASE\s*ORDER)\s*(?:NO\.?|NUMBER|#)\s*:?\s*([A-Z0-9-]{4,})\s*(?=\n|$)/i,
          /(?:^|\n)\s*(?:Invoice|Purchase\s+Order)\s+(?:No\.?|Number)\s*:?\s*([A-Z0-9-]{3,})\s*(?=\n|$)/i
        ]) ??
        extractStandaloneDocumentNumber(rawText) ??
        extractSingleValue(text, [
          // EN: "Invoice No: INV-001" / "Invoice Number: 123" / "INVOICE # [123456]"
          /(?:Invoice|Purchase\s+Order)\s+(?:No\.?|Number|#)\s*:?\s*\[?([A-Z0-9#][A-Z0-9#\s-]*\d)\]?(?=\s+(?:Invoice\s+Date|Date|Account(?:\s+No\.?)?|Due|Total|Subtotal|Tax|Currency)\b|$)/i,
          /(?:Invoice|Purchase\s*Order)\s*(?:No\.?|Number|#)\s*:?\s*([A-Z0-9-]{4,})/i,
          // DE: "Rechnungsnummer" / "Re.-Nr."
        /(?:Rechnungs(?:nummer)?|Re\.\s*-?\s*Nr\.?)\s*:?\s*([A-Z0-9][A-Z0-9\s-]*\d)/i,
        // SE: "Fakturanummer" / "Faktura nr"
        /(?:Faktura(?:nummer)?(?:\s+nr\.?)?)\s*:?\s*([A-Z0-9][A-Z0-9\s-]*\d)/i,
        // TR: "Fatura No"
        /(?:Fatura\s+No\.?)\s*:?\s*([A-Z0-9][A-Z0-9\s-]*\d)/i,
        // IT: "Numero Fattura" / "N° Fattura" / "N. Fattura"
        /(?:Numero\s+Fattura|N[°.]\s*Fattura)\s*:?\s*([A-Z0-9][A-Z0-9\s-]*\d)/i,
        // Generic: "Reference: INV-001" / "Ref No: 12345" / "Order Ref: PO-001"
        /(?:Order\s+)?Ref(?:erence)?\s*(?:No\.?|Number|#)?\s*:?\s*\[?([A-Z0-9][A-Z0-9\s-]*\d)\]?/i,
        // Generic: "No. 143999" / "# INV-001" / "N° #32"
        /(?:No\.?|Number|#|N[°º])\s*:?\s*\[?([A-Z0-9-]+\d)\]?/i,
        // "INV #143999" / "INV-001"
        /\bINV\s*[#-]?\s*(\d+)/i,
        /\b(PO-\d+|INV-\d+|TXT-\d+)\b/i,
        /(?:Customer|Account)\s+Number(?:\s*\([^)]+\))?\s*:?\s*([A-Z0-9][A-Z0-9\s-]*\d)/i
      ])
    )?.replace(/\s+/g, "").replace(/#/g, "-").toUpperCase() ?? null;

  // Dates — specific date patterns prevent fuzzy over-capture
  const DATE_PATS = [
    /\d{4}-\d{2}-\d{2}/,
    /\d{1,2}[./-]\d{2}[./-]\d{4}/,
    /\d{1,2}[./-]\d{1,2}[./-]\d{2}/,
    /\d{1,2}[\s-]+[A-Za-z]{3,9}[\s-]+\d{4}/,  // "1-Jan-2018" / "15 Mar 2026"
    /[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}/,
  ] as const;

  function extractDate(labelSrc: string, src: string): string | null {
    const grp = `(?:${labelSrc})`;
    for (const dp of DATE_PATS) {
      const m = src.match(new RegExp(`${grp}\\s*:?\\s*(${dp.source})`, "i"));
      if (m?.[1]) return m[1].trim();
    }
    // Tabular layout: value may be columns away — scan up to 120 chars ahead
    for (const dp of DATE_PATS.slice(1)) {
      const m = src.match(new RegExp(`${grp}.{0,120}?(${dp.source})`, "is"));
      if (m?.[1]) return m[1].trim();
    }
    return null;
  }

  data.issueDate = normalizeDate(
    extractDate([
      "Issue\\s+Date|Invoice\\s+Date|Date\\s+of\\s+Issue",  // EN
      "Dated?",                                              // EN "Dated:" / "Date:"
      "Date\\s+de\\s+Facturation|Date\\s+d.?émission",      // FR
      "Rechnungsdatum|Ausstellungsdatum",                    // DE
      "Data\\s+Fattura|Data\\s+Emissione",                  // IT
      "Fatura\\s+Tarihi|Düzenleme\\s+Tarihi",               // TR
      "Fakturadatum|Utfärdandedatum",                        // SE
    ].join("|"), text)
    ?? extractDate("(?<!Due\\s|échéance\\s|[Vv]ade\\s|[Ff]örfall\\s)\\bDate|Datum\\b", text)
  );

  data.dueDate = normalizeDate(
    extractDate([
      "Due\\s+Date|Payment\\s+Due",                          // EN
      "Date\\s+d.?[eé]ch[eé]ance|[EÉ]ch[eé]ance",          // FR
      "F[äa]lligkeits?datum|Zahlungsziel|F[äa]lligkeit",    // DE
      "Scadenza|Data\\s+Scadenza",                           // IT
      "Vade\\s+Tarihi|Son\\s+[OÖ]deme\\s+Tarihi",           // TR
      "F[öo]rfallodatum|Betalas\\s+senast",                  // SE
    ].join("|"), text)
  );

  data.currency = findCurrency(text);

  // Currency symbol prefix shared by all amount patterns
  const CCY = String.raw`(?:[£€$¥₹]|[A-Z]{3}\s+)?`;
  const AMOUNT = String.raw`([0-9]+(?:[.,][0-9]+)*)(?![A-Za-z])`;

  // Subtotal (excl. tax) — EN + FR/IT/DE/TR/SE equivalents
  const subtotalMatch =
    extractNumericMatch(text, new RegExp(String.raw`Sub\s*[Tt]otal\s*[:\-]?\s*${CCY}\s*${AMOUNT}`, "gi")) ??
    extractNumericMatch(text, new RegExp(String.raw`(?:Total\s+HT|Montant\s+HT|Imponibile|Netto(?:betrag)?|Zwischensumme|Ara\s+Toplam|Netto(?:\s+summa)?|Taxable\s+Value)\s*[:\-]?\s*${CCY}\s*${AMOUNT}(?!\s*%)`, "gi"));

  // Tax — EN + FR/DE/IT/TR/SE equivalents
  // Rate qualifier must contain %; plain number without % is the tax amount itself
  const taxMatch = extractNumericMatch(
    text,
    new RegExp(String.raw`(?:Tax\b|VAT\b|TVA|MwSt\.?|USt\.?|IVA|KDV|Moms)\s*(?:[A-Za-z.:]*\s*)?(?:(?:%[0-9]+|[0-9]+%)\s*)?[.:\-]?\s*${CCY}\s*${AMOUNT}(?!\s*%)`, "gi")
  );

  // Grand total — EN + FR/IT/DE/TR/SE equivalents
  const totalMatch =
    extractNumericMatch(text, new RegExp(String.raw`(?:Grand\s+Total|Total\s+Due|Amount\s+Due|Balance\s+Due)\s*[:\-]?\s*${CCY}\s*${AMOUNT}(?!\s*%)`, "gi")) ??
    extractNumericMatch(text, new RegExp(String.raw`(?:Total\s+TTC|Montant\s+TTC|Gesamtbetrag|Rechnungsbetrag|Totale\s+Fattura|Genel\s+Toplam|Att\s+betala|Summa\s+inkl)\s*[:\-]?\s*${CCY}\s*${AMOUNT}(?!\s*%)`, "gi")) ??
    extractNumericMatch(text, new RegExp(String.raw`(?<!\bSub[\s]*)\bTota(?:l)?\b\s*[:\-]?\s*${CCY}\s*${AMOUNT}(?!\s*%)`, "gi")) ??
    extractNumericMatch(text, new RegExp(String.raw`(?<!\bSub[\s]*)\bTotal\b\s*[:\-]?\s*${CCY}\s*${AMOUNT}(?!\s*%)`, "gi")) ??
    // Fallback: "Total" followed by non-numeric tokens then a 3+ digit amount (handles bracket/pipe OCR artifacts)
    extractNumericMatch(text, new RegExp(String.raw`(?<!\bSub[\s]*)\bTota(?:l)?\b[\s\S]{0,60}?((?:\d{4,}|\d{1,3}[.,]\d+))(?![A-Za-z])`, "gi")) ??
    extractNumericMatch(text, new RegExp(String.raw`(?<!\bSub[\s]*)\bTotal\b[\s\S]{0,60}?((?:\d{4,}|\d{1,3}[.,]\d+))(?![A-Za-z])`, "gi"));

  data.subtotal = repairOcrMoneyValue(subtotalMatch, rawText, fileName);
  data.tax = repairOcrMoneyValue(taxMatch, rawText, fileName);
  data.total = repairOcrMoneyValue(totalMatch, rawText, fileName);

  if (
    data.subtotal !== null &&
    data.total !== null &&
    data.total >= data.subtotal
  ) {
    const derivedTax = Number.parseFloat((data.total - data.subtotal).toFixed(2));
    const taxLooksSuspicious =
      data.tax === null ||
      data.tax < 0 ||
      data.tax > data.total ||
      Math.abs(data.subtotal + data.tax - data.total) > 0.01;

    if (taxLooksSuspicious && derivedTax >= 0) {
      data.tax = derivedTax;
    }
  }

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

// Matches a standalone document header on its own line (not a field like "Invoice No:")
const DOCUMENT_HEADER_RE = /(?:^|\n)[ \t]*(?:(?:TAX|PROFORMA)\s+)?(?:INVOICE|PURCHASE[\s_-]?ORDER)[ \t]*(?:\n|$)/gi;

export function splitDocumentBlocks(rawText: string): string[] {
  const matches = [...rawText.matchAll(DOCUMENT_HEADER_RE)];

  if (matches.length < 2) return [rawText];

  const positions = matches.map((m) => m.index!);
  const blocks: string[] = [];

  for (let i = 0; i < positions.length; i++) {
    const start = positions[i];
    const end = positions[i + 1] ?? rawText.length;
    const block = rawText.slice(start, end).trim();
    if (block.length > 100) blocks.push(block);
  }

  // Prepend any substantial content before the first header
  const beforeFirst = rawText.slice(0, positions[0]).trim();
  if (beforeFirst.length > 200) blocks.unshift(beforeFirst);

  return blocks.length >= 2 ? blocks : [rawText];
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
