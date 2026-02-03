"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import { QuarterSelector } from "./QuarterSelector"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Settings, Users, History, Cog, Heart, GraduationCap, BookOpen, LogIn, LogOut } from "lucide-react"
import { DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { useGeneration } from "@/lib/generation-context"

const mainNavItems = [
  { href: "/classes", label: "Classes" },
  { href: "/generate", label: "Schedules" },
]

const moreItems = [
  { href: "/teachers", label: "Teachers", icon: Users },
  { href: "/settings/grades", label: "Grades", icon: GraduationCap },
  { href: "/settings/subjects", label: "Subjects", icon: BookOpen },
  { href: "/rules", label: "Rules", icon: Cog },
  { href: "/history", label: "History", icon: History },
]

export function Navigation() {
  const pathname = usePathname()
  const router = useRouter()
  const { confirmNavigation } = useGeneration()
  const [authState, setAuthState] = useState<{ checked: boolean; isAdmin: boolean }>({ checked: false, isAdmin: false })

  // Check auth status for view mode
  useEffect(() => {
    async function checkAuth() {
      try {
        const res = await fetch('/api/auth')
        const data = await res.json()
        setAuthState({ checked: true, isAdmin: data.role === 'admin' })
      } catch {
        setAuthState({ checked: true, isAdmin: false })
      }
    }
    checkAuth()
  }, [])

  const handleNavClick = (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    if (pathname === href) return // Already on this page
    if (!confirmNavigation()) {
      e.preventDefault()
    }
  }

  const handleLogout = async () => {
    await fetch('/api/auth', { method: 'DELETE' })
    router.push('/login')
    router.refresh()
  }

  // Show minimal header while checking auth status
  if (!authState.checked) {
    return (
      <header className="border-b no-print">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex h-14 items-center" />
        </div>
      </header>
    )
  }

  // Public/readonly view navigation - simplified header (non-admin users)
  if (!authState.isAdmin) {
    return (
      <header className="border-b no-print">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex h-14 items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-lg font-semibold text-foreground">Journey Schedule</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => alert("fueled by love for emily")}
                className="text-rose-400 hover:text-rose-500 hover:scale-110 transition-transform"
              >
                <Heart className="h-3.5 w-3.5 fill-current" />
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="text-muted-foreground h-8 px-3">
                    <Settings className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem asChild>
                    <Link
                      href={`/login?returnTo=${encodeURIComponent(pathname)}`}
                      className="flex items-center gap-2"
                    >
                      <LogIn className="h-4 w-4" />
                      Login
                    </Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </header>
    )
  }

  return (
    <header className="border-b no-print">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-14 items-center justify-between">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Quarter</span>
              <QuarterSelector />
            </div>
            <nav className="flex items-center gap-1">
              {mainNavItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={(e) => handleNavClick(e, item.href)}
                  className={cn(
                    "px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
                    pathname === item.href
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  )}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => alert("fueled by love for emily")}
              className="text-rose-400 hover:text-rose-500 hover:scale-110 transition-transform"
            >
              <Heart className="h-3.5 w-3.5 fill-current" />
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="text-muted-foreground h-8 px-3">
                  <Settings className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {moreItems.map((item) => (
                  <DropdownMenuItem key={item.href} asChild>
                    <Link
                      href={item.href}
                      onClick={(e) => handleNavClick(e, item.href)}
                      className="flex items-center gap-2"
                    >
                      <item.icon className="h-4 w-4" />
                      {item.label}
                    </Link>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout} className="flex items-center gap-2">
                  <LogOut className="h-4 w-4" />
                  Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </header>
  )
}
