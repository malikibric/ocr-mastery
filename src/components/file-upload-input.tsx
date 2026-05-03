"use client";

import { useRef, useState } from "react";

export function FileUploadInput() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setFileName(e.target.files?.[0]?.name ?? null);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (!file || !inputRef.current) return;
    const dt = new DataTransfer();
    dt.items.add(file);
    inputRef.current.files = dt.files;
    setFileName(file.name);
  }

  return (
    <div
      className={`file-drop-zone${dragging ? " file-drop-zone--active" : ""}${fileName ? " file-drop-zone--filled" : ""}`}
      onClick={() => inputRef.current?.click()}
      onDragEnter={() => setDragging(true)}
      onDragLeave={() => setDragging(false)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      <input
        accept=".csv,.txt,.pdf,.png,.jpg,.jpeg"
        id="document"
        name="document"
        onChange={handleChange}
        ref={inputRef}
        required
        style={{ display: "none" }}
        type="file"
      />

      <div className="file-drop-icon" aria-hidden="true">
        {fileName ? (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <polyline points="9 15 12 18 15 15"/>
          </svg>
        ) : (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="16 16 12 12 8 16"/>
            <line x1="12" y1="12" x2="12" y2="21"/>
            <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
          </svg>
        )}
      </div>

      <div className="file-drop-text">
        {fileName ? (
          <>
            <span className="file-drop-name">{fileName}</span>
            <span className="file-drop-hint">Click to change</span>
          </>
        ) : (
          <>
            <span className="file-drop-label">Drop file here or <u>browse</u></span>
            <span className="file-drop-hint">PDF, image, CSV, TXT</span>
          </>
        )}
      </div>
    </div>
  );
}
