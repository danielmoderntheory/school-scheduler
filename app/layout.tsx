import type { Metadata } from 'next'
import { Inter, Poppins } from 'next/font/google'
import './globals.css'
import { Toaster } from '@/components/ui/toaster'

const inter = Inter({ subsets: ['latin'] })

// Only the poster export uses this face (see components/SchedulePoster.tsx) —
// it matches the printed Canva cards. Exposed as a CSS variable so nothing else
// picks it up by accident.
const poppins = Poppins({
  subsets: ['latin'],
  weight: ['600', '700', '800'],
  variable: '--font-poster',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Journey Schedule',
  description: 'Generate optimized school schedules',
  icons: {
    icon: '/icon.svg',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={poppins.variable}>
      <body className={inter.className}>
        {children}
        <Toaster />
      </body>
    </html>
  )
}
