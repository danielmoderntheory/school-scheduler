"use client"

import { Toaster as HotToaster } from "react-hot-toast"

export function Toaster() {
  return (
    <HotToaster
      position="bottom-right"
      containerClassName="no-print"
      toastOptions={{
        duration: 10000,
        style: {
          background: "hsl(var(--background))",
          color: "hsl(var(--foreground))",
          border: "1px solid hsl(var(--border))",
          fontSize: "0.875rem", // text-sm equivalent
        },
        success: {
          duration: 10000,
          iconTheme: {
            primary: "hsl(142.1 76.2% 36.3%)",
            secondary: "white",
          },
        },
        error: {
          duration: 10000,
          iconTheme: {
            primary: "hsl(var(--destructive))",
            secondary: "white",
          },
        },
        loading: {
          duration: Infinity,
        },
      }}
    />
  )
}
