import path from "node:path";

export const SUPPORTED_EXTENSIONS = ["csv", "txt", "pdf", "png", "jpg", "jpeg"];

export function getFileExtension(fileName: string) {
  return path.extname(fileName).replace(".", "").toLowerCase();
}

export function isSupportedDocument(fileName: string) {
  return SUPPORTED_EXTENSIONS.includes(getFileExtension(fileName));
}

export function getMimeType(fileName: string) {
  const extension = getFileExtension(fileName);

  switch (extension) {
    case "csv":
      return "text/csv";
    case "txt":
      return "text/plain";
    case "pdf":
      return "application/pdf";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    default:
      return "application/octet-stream";
  }
}
