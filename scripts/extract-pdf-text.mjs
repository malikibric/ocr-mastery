import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const filePath = process.argv[2];

if (!filePath) {
  throw new Error("A PDF file path is required.");
}

const standardFontDataUrl = pathToFileURL(
  path.join(process.cwd(), "node_modules/pdfjs-dist/standard_fonts/")
).toString();

const bytes = new Uint8Array(await fs.readFile(filePath));
const pdf = await getDocument({
  data: bytes,
  standardFontDataUrl
}).promise;
const pages = [];

for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
  const page = await pdf.getPage(pageNumber);
  const content = await page.getTextContent();
  const pageText = content.items
    .map((item) => ("str" in item ? item.str : ""))
    .join(" ");
  pages.push(pageText);
}

process.stdout.write(pages.join("\n"));
