import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import MotionRoot from "@/components/motion/MotionRoot";
import { getMetadataBase, SITE_METADATA } from "@/lib/public-branding";
import "./globals.css";
import "./landing-light.css";
import "./zelta-ui.css";
import "./workflow-canvas.css";
import "./studio-flow.css";
import "./wave-saas.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: getMetadataBase(),
  title: {
    default: SITE_METADATA.title,
    template: `%s | ${SITE_METADATA.siteName}`,
  },
  description: SITE_METADATA.description,
  applicationName: SITE_METADATA.siteName,
  openGraph: SITE_METADATA.openGraph,
  twitter: SITE_METADATA.twitter,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col app-bg" suppressHydrationWarning>
        <MotionRoot>{children}</MotionRoot>
      </body>
    </html>
  );
}
