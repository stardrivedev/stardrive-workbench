import type { Metadata } from "next";
import { siteConfig, quoteConfig } from "@/config/site";
import { displayFont, bodyFont } from "@/config/fonts.generated";
import { motionMode, darkMode } from "@/config/design.generated";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import AnnouncementBar from "@/components/layout/AnnouncementBar";
import MotionLayer from "@/components/layout/MotionLayer";
import QuoteModal from "@/components/ui/QuoteModal";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: siteConfig.name,
    template: `%s | ${siteConfig.name}`,
  },
  description: siteConfig.description,
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
