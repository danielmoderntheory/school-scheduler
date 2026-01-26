import { Navigation } from '@/components/Navigation'

export default function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      <Navigation />
      <main className="min-h-[calc(100vh-4rem)]">
        {children}
      </main>
    </>
  )
}
