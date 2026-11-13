import type { Metadata } from "next";
import type { CSSProperties } from "react";
import palette from "@/lib/palette.json";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "vector1090",
  description: "ADS-B radar and ATC audio dashboard",
  icons: { icon: "/logo.svg" },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className="dark"
      style={
        Object.fromEntries(
          Object.entries(palette).map(([key, value]) => ["--" + key, value]),
        ) as CSSProperties
      }
    >
      <body>{children}</body>
    </html>
  );
}
