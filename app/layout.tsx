export const metadata = {
  title: 'MyLearnTool',
  description: 'Supabase + Next.js starter'
}

import './globals.css'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
