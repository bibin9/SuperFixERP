import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "AUTOVIQO for Superfix", description: "Superfix garage ERP (local build)" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
