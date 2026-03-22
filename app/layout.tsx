import type { Metadata, Viewport } from 'next'
import { DM_Mono } from 'next/font/google'

const dmMono = DM_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-dm-mono',
})

export const metadata: Metadata = {
  title: 'ParkIntel',
  description: 'Live Orlando theme park wait times + AI tactical analysis',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'ParkIntel',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#080c14',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="apple-touch-icon" href="/icon-192.png" />
      </head>
      <body className={dmMono.variable} style={{ margin: 0, background: '#080c14' }}>
        {children}
      </body>
    </html>
  )
}
