"use client"

import { createContext, useContext, useState, useCallback, ReactNode } from "react"

interface GenerationContextType {
  isGenerating: boolean
  setIsGenerating: (value: boolean) => void
  confirmNavigation: () => boolean
}

const GenerationContext = createContext<GenerationContextType | null>(null)

export function GenerationProvider({ children }: { children: ReactNode }) {
  const [isGenerating, setIsGenerating] = useState(false)

  const confirmNavigation = useCallback(() => {
    if (isGenerating) {
      return window.confirm("A schedule is being generated. Are you sure you want to leave? Progress will be lost.")
    }
    return true
  }, [isGenerating])

  return (
    <GenerationContext.Provider value={{ isGenerating, setIsGenerating, confirmNavigation }}>
      {children}
    </GenerationContext.Provider>
  )
}

export function useGeneration() {
  const context = useContext(GenerationContext)
  if (!context) {
    throw new Error("useGeneration must be used within GenerationProvider")
  }
  return context
}
