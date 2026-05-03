import { describe, expect, it } from "vitest";
import {
  selectPreferredImageBlockText,
  shouldUseImageOcrBlocks
} from "@/lib/documents/pipeline";

describe("shouldUseImageOcrBlocks", () => {
  it("keeps likely multi-document OCR splits", () => {
    const blocks = [
      [
        "Invoice",
        "Supplier: Acme Industrial Supplies Ltd",
        "Invoice Number: INV-1001",
        "Date: 2026-05-01",
        "Due Date: 2026-05-15",
        "Subtotal: USD 120.00",
        "Tax: USD 24.00",
        "Total: USD 144.00"
      ].join("\n"),
      [
        "Purchase Order",
        "Supplier: Beta Logistics LLC",
        "Purchase Order Number: PO-2048",
        "Date: 2026-05-03",
        "Subtotal: USD 80.00",
        "Tax: USD 0.00",
        "Total: USD 80.00",
        "Description Widget A 2 40.00 80.00"
      ].join("\n"),
      [
        "Company Details",
        "Organization    Gamma Services GmbH",
        "Customer Number (MCL)    CUST-9921",
        "Last updated    2026-05-04",
        "Contact Email    hello@gamma.example"
      ].join("\n")
    ];

    expect(shouldUseImageOcrBlocks("upload.png", "png", blocks)).toBe(true);
  });

  it("rejects header-and-footer fragments from a single document", () => {
    const blocks = [
      [
        "[Company Name]",
        "[Street Address]",
        "[City, ST ZIP]",
        "[Company Slogan]",
        "[Phone]",
        "[Website]",
        "[Company Name]",
        "[Street Address]",
        "[City, ST ZIP]"
      ].join("\n"),
      [
        "Invoice",
        "Date: 5/13/2011",
        "Invoice # 123456",
        "Customer ID 123",
        "Account Manager",
        "Prepared By",
        "Invoice"
      ].join("\n"),
      [
        "Subtotal 950.00",
        "Taxable 345.00",
        "Tax due 21.56",
        "Total due 971.56",
        "Payment due in 30 days",
        "Subtotal 950.00",
        "Tax due 21.56"
      ].join("\n")
    ];

    expect(shouldUseImageOcrBlocks("invoice.png", "png", blocks)).toBe(false);
  });
});

describe("selectPreferredImageBlockText", () => {
  it("prefers cropped OCR text when it is substantial", () => {
    const layoutText = "LOWE SUPPLY\nEVERTON ENERGY";
    const croppedText = [
      "LOWE SUPPLY",
      "Invoice Date 12/24/18",
      "Invoice Number 12353211-11",
      "Everton Energy Services, Inc"
    ].join("\n");

    expect(
      selectPreferredImageBlockText("upload.png", "png", layoutText, croppedText)
    ).toBe(croppedText);
  });

  it("falls back to layout OCR text when cropped OCR is too weak", () => {
    const layoutText = "STEINS ELECTRIC, INC\nINVOICE";
    const croppedText = "INVOICE";

    expect(
      selectPreferredImageBlockText("upload.png", "png", layoutText, croppedText)
    ).toBe(layoutText);
  });
});
