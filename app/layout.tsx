import type { ReactNode } from 'react'
import './globals.css'

export const metadata = {
  title: 'MyLearnTool',
  description: 'AI-ready learning app built with Next.js and Supabase'
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  )
}
