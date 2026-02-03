"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Navigation } from "@/components/Navigation"
import { GenerationProvider } from "@/lib/generation-context"

export default function NoAccessPage() {
  return (
    <GenerationProvider>
      <Navigation />
      <div className="min-h-[calc(100vh-56px)] flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="text-xl">Page Not Available</CardTitle>
          </CardHeader>
          <CardContent className="text-center text-sm text-muted-foreground">
            <p>This page does not exist or you don't have access to it.</p>
            <p className="mt-4">Please request a new schedule link.</p>
          </CardContent>
        </Card>
      </div>
    </GenerationProvider>
  )
}
