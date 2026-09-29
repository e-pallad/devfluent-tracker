import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import { Toaster } from "sonner"
import { ThemeProvider } from "@/components/theme-provider"
import { ServiceWorkerRegister } from "@/components/service-worker-register"
import { getLocale } from "@/lib/i18n"
import "./globals.css"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

export const metadata: Metadata = {
  metadataBase: new URL("https://devfluent.de"),
  title: "Devfluent",
  description: "ADHD-friendly developer learning tracker — roadmaps, curriculum, and gamified progress",
  manifest: "/manifest.webmanifest",
  openGraph: {
    title: "Devfluent",
    description: "ADHD-friendly developer learning tracker — roadmaps, curriculum, and gamified progress",
    type: "website",
    siteName: "Devfluent",
  },
  twitter: {
    card: "summary_large_image",
    title: "Devfluent",
    description: "ADHD-friendly developer learning tracker — roadmaps, curriculum, and gamified progress",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Devfluent",
  },
}

// themeColor belongs in the viewport export since Next.js 14
export const viewport: Viewport = {
  themeColor: "#4f46e5",
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale()
  return (
    <html lang={locale} className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="h-full text-gray-900">
        <ThemeProvider>
          {children}
          <Toaster position="bottom-right" richColors />
          <ServiceWorkerRegister />
        </ThemeProvider>
      </body>
    </html>
  )
}
