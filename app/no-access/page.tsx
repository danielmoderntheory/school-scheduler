import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export default function NoAccessPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
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
  )
}
