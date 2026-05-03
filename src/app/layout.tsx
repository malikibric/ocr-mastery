import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
  preload: false
});

export const metadata: Metadata = {
  title: "Smart Document Processing System",
  description:
    "Ingest, extract, validate, and review business documents and OCR screenshots.",
  icons: {
    icon: "/favicon.svg"
  }
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <div className="site-wrapper">
          <div className="site-content">{children}</div>
          <footer className="site-footer">
            <div className="site-footer__inner">
              <p className="site-footer__credit">
                Built by{" "}
                <a
                  className="site-footer__author"
                  href="https://github.com/malikibric"
                  rel="noreferrer"
                  target="_blank"
                >
                  Malik
                </a>
              </p>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
