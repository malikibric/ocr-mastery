import path from "node:path";
import { fileTypeFromBuffer } from "file-type";

export const SUPPORTED_EXTENSIONS = ["csv", "txt", "pdf", "png", "jpg", "jpeg"];
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const MIME_TYPES_BY_EXTENSION = {
  csv: "text/csv",
  txt: "text/plain",
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg"
} as const;

export function getFileExtension(fileName: string) {
  return path.extname(fileName).replace(".", "").toLowerCase();
}

export function isSupportedDocument(fileName: string) {
  return SUPPORTED_EXTENSIONS.includes(getFileExtension(fileName));
}

export function getMimeType(fileName: string) {
  const extension = getFileExtension(fileName);

  return MIME_TYPES_BY_EXTENSION[
    extension as keyof typeof MIME_TYPES_BY_EXTENSION
  ] ?? "application/octet-stream";
}

function isBinaryDocumentExtension(extension: string) {
  return extension === "pdf" || extension === "png" || extension === "jpg" || extension === "jpeg";
}

function isMimeTypeAllowedForExtension(extension: string, mimeType: string) {
  switch (extension) {
    case "pdf":
      return mimeType === "application/pdf";
    case "png":
      return mimeType === "image/png";
    case "jpg":
    case "jpeg":
      return mimeType === "image/jpeg";
    default:
      return false;
  }
}

function isLikelyTextFile(bytes: Uint8Array) {
  return !bytes.subarray(0, 4096).includes(0);
}

export async function detectUploadedDocumentType(
  fileName: string,
  bytes: Uint8Array
) {
  const extension = getFileExtension(fileName);

  if (!isSupportedDocument(fileName)) {
    throw new Error(
      `Unsupported file type "${extension || "unknown"}". Upload CSV, TXT, PDF, or image files.`
    );
  }

  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new Error("Upload exceeds the 10 MB limit.");
  }

  const detectedType = await fileTypeFromBuffer(bytes);

  if (detectedType) {
    if (!isMimeTypeAllowedForExtension(extension, detectedType.mime)) {
      throw new Error(
        `Uploaded file content does not match the ".${extension}" extension.`
      );
    }

    return {
      fileExtension: extension,
      mimeType: detectedType.mime
    };
  }

  if (isBinaryDocumentExtension(extension)) {
    throw new Error(
      `Uploaded file content could not be verified as a valid ${extension.toUpperCase()} file.`
    );
  }

  if (!isLikelyTextFile(bytes)) {
    throw new Error(
      `Uploaded file content does not match the ".${extension}" extension.`
    );
  }

  return {
    fileExtension: extension,
    mimeType: getMimeType(fileName)
  };
}
