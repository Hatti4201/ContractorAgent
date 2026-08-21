import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Contractor Agent",
  description: "Human-reviewed contractor job workflow and CRM.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
