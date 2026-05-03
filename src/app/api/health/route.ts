import { execFile } from "node:child_process";
import { NextResponse } from "next/server";
import { getDocumentCountsByStatus } from "@/lib/database";

function getTesseractVersion() {
  return new Promise<string>((resolve, reject) => {
    execFile("tesseract", ["--version"], { encoding: "utf8" }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(stdout);
    });
  });
}

export async function GET() {
  const checks = {
    database: {
      ok: false as boolean,
      detail: null as string | null
    },
    tesseract: {
      ok: false as boolean,
      detail: null as string | null
    }
  };

  try {
    await getDocumentCountsByStatus();
    checks.database = {
      ok: true,
      detail: "reachable"
    };
  } catch (error) {
    checks.database = {
      ok: false,
      detail: error instanceof Error ? error.message : "Database check failed."
    };
  }

  try {
    const stdout = await getTesseractVersion();
    const firstLine = stdout.split(/\r?\n/)[0]?.trim() || "available";
    checks.tesseract = {
      ok: true,
      detail: firstLine
    };
  } catch (error) {
    checks.tesseract = {
      ok: false,
      detail: error instanceof Error ? error.message : "Tesseract check failed."
    };
  }

  const healthy = checks.database.ok && checks.tesseract.ok;

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      checks
    },
    { status: healthy ? 200 : 503 }
  );
}
