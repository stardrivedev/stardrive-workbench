import type { Metadata } from "next";
import { siteConfig, quoteConfig } from "@/config/site";
import { displayFont, bodyFont } from "@/config/fonts.generated";
import { motionMode, darkMode } from "@/config/design.generated";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import AnnouncementBar from "@/components/layout/AnnouncementBar";
import MotionLayer from "@/components/layout/MotionLayer";
import QuoteModal from "@/components/ui/QuoteModal";
import JsonLd from "@/components/seo/JsonLd";
import { baseUrl, socialImage, iconMetadata, organizationJsonLd, webSiteJsonLd } from "@/lib/seo";
import "./globals.css";

const ogImage = socialImage();

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl()),
  title: {
    default: siteConfig.name,
    template: `%s | ${siteConfig.name}`,
  },
  description: siteConfig.description,
  alternates: { canonical: "/" },
  icons: iconMetadata(),
  openGraph: {
    type: "website",
    siteName: siteConfig.name,
    title: siteConfig.name,
    description: siteConfig.description,
    url: "/",
    ...(ogImage ? { images: [{ url: ogImage }] } : {}),
  },
  twitter: {
    card: ogImage ? "summary_large_image" : "summary",
    title: siteConfig.name,
    description: siteConfig.description,
    ...(ogImage ? { images: [ogImage] } : {}),
  },
};

// Applies the visitor's stored theme before first paint (no flash). Sites
// default to light; dark is opt-in via the header toggle.
const themeScript = `try{if(localStorage.getItem("d4-theme")==="dark")document.documentElement.classList.add("dark")}catch(e){}`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      data-motion={motionMode}
      className={`${displayFont.variable} ${bodyFont.variable}`}
      suppressHydrationWarning={darkMode || undefined}
    >
      <body className="flex min-h-screen flex-col">
        {darkMode && <script dangerouslySetInnerHTML={{ __html: themeScript }} />}
        <JsonLd data={organizationJsonLd()} />
        <JsonLd data={webSiteJsonLd()} />
        <MotionLayer />
        <AnnouncementBar />
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
        {quoteConfig.enabled && <QuoteModal />}
      </body>
    </html>
  );
}
