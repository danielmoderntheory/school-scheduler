import { Navigation } from '@/components/Navigation'
import { EnvIndicator } from '@/components/EnvIndicator'
import { GenerationProvider } from '@/lib/generation-context'

export default function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <GenerationProvider>
      <Navigation />
      <main className="min-h-[calc(100vh-4rem)]">
        {children}
      </main>
      <EnvIndicator />
    </GenerationProvider>
  )
}
