"use client";

import Image from "next/image";

interface FilePreviewProps {
  fileUrl: string;
  mimeType: string;
  name: string;
}

export function FilePreview({ fileUrl, mimeType, name }: FilePreviewProps) {
  if (mimeType.startsWith("image/")) {
    return (
      <div className="file-preview file-preview--image">
        <Image
          alt={name}
          height={1600}
          src={fileUrl}
          unoptimized
          width={1200}
        />
      </div>
    );
  }

  if (mimeType === "application/pdf") {
    return (
      <div className="file-preview file-preview--pdf">
        <iframe src={fileUrl} title={name} />
      </div>
    );
  }

  if (mimeType === "text/csv" || mimeType === "text/plain") {
    return (
      <div className="file-preview file-preview--text">
        <a className="button-secondary" download={name} href={fileUrl}>
          Download {name}
        </a>
        <TextPreview src={fileUrl} />
      </div>
    );
  }

  return (
    <p className="muted">Preview not available for this file type ({mimeType}).</p>
  );
}

function TextPreview({ src }: { src: string }) {
  return (
    <iframe
      className="file-preview__text-frame"
      src={src}
      title="File contents"
    />
  );
}
