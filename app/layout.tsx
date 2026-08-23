import type { Metadata, Viewport } from "next";
import { Noto_Sans_Mono } from "next/font/google";
import { PwaRegistration } from "@/components/PwaRegistration";
import "katex/dist/katex.min.css";
import "./globals.css";
import "./settings.css";
import "./fleet-themes.css";

const notoSansMono = Noto_Sans_Mono({
  subsets: ["latin", "cyrillic"],
  variable: "--font-noto-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Pi Web",
  description: "Pi Web interface for the pi coding agent",
  applicationName: "Pi Web",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      {
        url: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
    ],
    apple: [
      {
        url: "/icons/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Pi Web",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: "#ffffff",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" translate="no" className={`${notoSansMono.variable} notranslate`} suppressHydrationWarning>
      <head>
        <meta name="google" content="notranslate" />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("pi-theme");var d=window.matchMedia("(prefers-color-scheme: dark)").matches;var m={light:"default-light",dark:"default-dark"};t=m[t]||t;if(!/^(default|github|one-half)-(light|dark)$/.test(t||""))t=d?"default-dark":"default-light";document.documentElement.dataset.theme=t;document.documentElement.classList.toggle("dark",t.endsWith("-dark"));var c={"default-light":"#ffffff","default-dark":"#1a1a1a","github-light":"#ffffff","github-dark":"#0d1117","one-half-light":"#fafafa","one-half-dark":"#282c34"}[t];document.querySelector('meta[name="theme-color"]')?.setAttribute("content",c)}catch(e){}})();`,
          }}
        />
      </head>
      <body translate="no" className="notranslate" suppressHydrationWarning>
        {children}
        <PwaRegistration />
      </body>
    </html>
  );
}
