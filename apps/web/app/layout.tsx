import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "All-in-One",
  description: "Personal tool library",
};

export const viewport: Viewport = {
  themeColor: "#0a0a0b",
  // The viewer is used one-handed on a phone; a zoomable page fights the
  // pinch-to-zoom gesture we want to route to the camera instead.
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
