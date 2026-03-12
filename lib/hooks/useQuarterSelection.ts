"use client"

import { useState, useEffect, useCallback, useRef } from "react"

const STORAGE_KEY = "scheduler_selected_quarter"

export interface Quarter {
  id: string
  name: string
  year: number
  quarter_num: number
  is_active: boolean
}

interface UseQuarterSelectionOptions {
  onQuarterChange?: (quarterId: string) => void
}

interface UseQuarterSelectionReturn {
  quarters: Quarter[]
  selectedQuarter: Quarter | null
  selectedQuarterId: string | null
  setSelectedQuarterId: (id: string) => void
  isLoading: boolean
  refetchQuarters: () => Promise<Quarter[]>
  error: string | null
}

export function useQuarterSelection(
  options?: UseQuarterSelectionOptions
): UseQuarterSelectionReturn {
  const [quarters, setQuarters] = useState<Quarter[]>([])
  const [selectedQuarterId, setSelectedQuarterIdState] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  const fetchQuarters = useCallback(async (signal?: AbortSignal): Promise<Quarter[]> => {
    try {
      const res = await fetch("/api/quarters", { signal })
      if (res.ok) {
        const data: Quarter[] = await res.json()
        setQuarters(data)
        setError(null)
        return data
      } else {
        const errText = await res.text()
        console.error("Failed to load quarters:", res.status, errText)
        setError(`Failed to load quarters: ${res.status}`)
      }
    } catch (err) {
      // Ignore abort errors (component unmounted)
      if (err instanceof Error && err.name === "AbortError") {
        return []
      }
      console.error("Failed to load quarters:", err)
      setError(`Failed to load quarters: ${err instanceof Error ? err.message : "Unknown error"}`)
    }
    return []
  }, [])

  // Initialize: fetch quarters, read localStorage, validate or fall back
  useEffect(() => {
    // Create abort controller for this effect
    abortControllerRef.current = new AbortController()
    const signal = abortControllerRef.current.signal

    async function init() {
      setIsLoading(true)
      try {
        const quartersData = await fetchQuarters(signal)

        // If aborted, don't update state
        if (signal.aborted) return

        // Read from localStorage
        const storedId = localStorage.getItem(STORAGE_KEY)

        // Validate stored ID exists in quarters list
        const storedQuarterExists = storedId && quartersData.some((q) => q.id === storedId)

        if (storedQuarterExists) {
          setSelectedQuarterIdState(storedId)
        } else {
          // Fall back: prefer is_active quarter, else most recent (first in list)
          const activeQuarter = quartersData.find((q) => q.is_active)
          const fallbackId = activeQuarter?.id || quartersData[0]?.id || null
          if (fallbackId) {
            localStorage.setItem(STORAGE_KEY, fallbackId)
            setSelectedQuarterIdState(fallbackId)
          }
        }
      } finally {
        if (!signal.aborted) {
          setIsLoading(false)
        }
      }
    }

    init()

    // Cleanup: abort fetch if component unmounts
    return () => {
      abortControllerRef.current?.abort()
    }
  }, [fetchQuarters])

  // Cross-tab sync via storage event
  useEffect(() => {
    function handleStorageChange(e: StorageEvent) {
      if (e.key === STORAGE_KEY && e.newValue) {
        // Validate the new value exists in our quarters list
        if (quarters.some((q) => q.id === e.newValue)) {
          setSelectedQuarterIdState(e.newValue)
          options?.onQuarterChange?.(e.newValue)
        }
      }
    }

    window.addEventListener("storage", handleStorageChange)
    return () => window.removeEventListener("storage", handleStorageChange)
  }, [quarters, options])

  // Set quarter ID - updates localStorage and state
  const setSelectedQuarterId = useCallback(
    (id: string) => {
      // Validate ID exists
      if (!quarters.some((q) => q.id === id)) {
        console.warn("Attempted to select invalid quarter ID:", id)
        return
      }

      localStorage.setItem(STORAGE_KEY, id)
      setSelectedQuarterIdState(id)
      options?.onQuarterChange?.(id)
    },
    [quarters, options]
  )

  // Refetch quarters (e.g., after creating a new one)
  // Returns the new quarters list so caller can select a specific quarter after refetch
  const refetchQuarters = useCallback(async (): Promise<Quarter[]> => {
    const quartersData = await fetchQuarters()
    // If current selection is no longer valid, reset to fallback
    if (selectedQuarterId && !quartersData.some((q) => q.id === selectedQuarterId)) {
      const activeQuarter = quartersData.find((q) => q.is_active)
      const fallbackId = activeQuarter?.id || quartersData[0]?.id || null
      if (fallbackId) {
        localStorage.setItem(STORAGE_KEY, fallbackId)
        setSelectedQuarterIdState(fallbackId)
        options?.onQuarterChange?.(fallbackId)
      }
    }
    return quartersData
  }, [fetchQuarters, selectedQuarterId, options?.onQuarterChange])

  // Derive selected quarter object from ID
  const selectedQuarter = quarters.find((q) => q.id === selectedQuarterId) || null

  return {
    quarters,
    selectedQuarter,
    selectedQuarterId,
    setSelectedQuarterId,
    isLoading,
    refetchQuarters,
    error,
  }
}
