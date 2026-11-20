import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agentic Traffic Studio",
  description:
    "Network, LLM and L7 observability for the agentic AI platform on EKS — eBPF (Beyla), vLLM and AWS Network Flow Monitor metrics.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-page text-ink antialiased">{children}</body>
    </html>
  );
}
