import { useEffect, useRef } from 'react'

interface AutoRefreshOptions {
  enabled?: boolean
  intervalMs?: number
  runImmediately?: boolean
}

export function useAutoRefresh(
  refresh: () => void | Promise<unknown>,
  deps: unknown[] = [],
  options: AutoRefreshOptions = {},
) {
  const {
    enabled = true,
    intervalMs = 10000,
    runImmediately = true,
  } = options

  const refreshRef = useRef(refresh)

  useEffect(() => {
    refreshRef.current = refresh
  }, [refresh])

  useEffect(() => {
    if (!enabled) return

    const run = () => {
      void refreshRef.current()
    }

    if (runImmediately) run()

    const handleFocus = () => run()
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') run()
    }
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') run()
    }, intervalMs)

    window.addEventListener('focus', handleFocus)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [enabled, intervalMs, runImmediately, ...deps])
}
