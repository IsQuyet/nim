import type { Metadata } from 'next'
import { WritingSessionsProvider } from './writing-sessions'

export const metadata: Metadata = {
  title: 'Admin',
  robots: { index: false, follow: false },
  alternates: { canonical: null },
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <WritingSessionsProvider>{children}</WritingSessionsProvider>
}
