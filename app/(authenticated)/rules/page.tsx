"use client"

import { useState, useEffect } from "react"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Loader2, ChevronDown, ChevronRight, Lock } from "lucide-react"
import { cn } from "@/lib/utils"
import toast from "@/lib/toast"

// Rules that are always enforced and cannot be toggled
const LOCKED_RULES = new Set([
  'no_teacher_conflicts',  // Teacher can't be in two places
  'no_grade_conflicts',    // Grade can't have two classes at once
  'teacher_availability',  // Must respect day/block availability
  'fixed_slots',           // Fixed time slots are always honored
  'cotaught_classes',      // Co-taught classes always scheduled together (rename class to avoid)
])

// Rules that aren't implemented yet (config not read by solver)
const UNIMPLEMENTED_RULES = new Set<string>([
  // All rules are now implemented
])

interface Grade {
  id: string
  name: string
  display_name: string
  sort_order: number
}

interface Rule {
  id: string
  name: string
  description: string
  rule_key: string
  rule_type: "hard" | "soft" | "medium"
  priority: number
  enabled: boolean
  config: Record<string, unknown> | null
}

export default function RulesPage() {
  const [rules, setRules] = useState<Rule[]>([])
  const [grades, setGrades] = useState<Grade[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [hardCollapsed, setHardCollapsed] = useState(true)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    try {
      const [rulesRes, gradesRes] = await Promise.all([
        fetch("/api/rules"),
        fetch("/api/grades"),
      ])
      if (rulesRes.ok) {
        const rulesData = await rulesRes.json()
        setRules(rulesData)
      }
      if (gradesRes.ok) {
        const gradesData = await gradesRes.json()
        // Sort by sort_order
        setGrades(gradesData.sort((a: Grade, b: Grade) => a.sort_order - b.sort_order))
      }
    } catch (error) {
      toast.error("Failed to load data")
    } finally {
      setLoading(false)
    }
  }

  async function toggleRule(id: string, enabled: boolean) {
    setSavingId(id)
    try {
      const res = await fetch(`/api/rules/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      })
      if (res.ok) {
        const updated = await res.json()
        setRules((prev) => prev.map((r) => (r.id === id ? updated : r)))
      } else {
        toast.error("Failed to update rule")
      }
    } catch (error) {
      toast.error("Failed to update rule")
    } finally {
      setSavingId(null)
    }
  }

  async function updateRuleConfig(id: string, config: Record<string, unknown>) {
    setSavingId(id)
    try {
      const res = await fetch(`/api/rules/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config }),
      })
      if (res.ok) {
        const updated = await res.json()
        setRules((prev) => prev.map((r) => (r.id === id ? updated : r)))
        toast.success("Settings saved")
      } else {
        toast.error("Failed to save settings")
      }
    } catch (error) {
      toast.error("Failed to save settings")
    } finally {
      setSavingId(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const hardRules = rules.filter((r) => r.rule_type === "hard")
  const softRules = rules.filter((r) => r.rule_type === "soft")
  const mediumRules = rules.filter((r) => r.rule_type === "medium")

  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-1">Scheduling Rules</h1>
        <p className="text-sm text-muted-foreground">
          Configure constraints and preferences for schedule generation.
        </p>
      </div>

      <div className="space-y-6">
        {/* Soft Constraints */}
        <section>
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3 flex items-center gap-2">
            Preferences
            <Badge variant="secondary" className="text-xs font-normal">Soft</Badge>
          </h2>
          <div className="space-y-2">
            {softRules.map((rule) => (
              <CompactRuleCard
                key={rule.id}
                rule={rule}
                onToggle={(enabled) => toggleRule(rule.id, enabled)}
                saving={savingId === rule.id}
              />
            ))}
          </div>
        </section>

        {/* Medium Constraints - Study Hall Settings */}
        {mediumRules.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3 flex items-center gap-2">
              Study Hall Settings
              <Badge variant="outline" className="text-xs font-normal border-sky-300 text-sky-600">Configurable</Badge>
            </h2>
            <div className="space-y-2">
              {mediumRules.map((rule) => (
                <ConfigurableRuleCard
                  key={rule.id}
                  rule={rule}
                  grades={grades}
                  onToggle={(enabled) => toggleRule(rule.id, enabled)}
                  onConfigChange={(config) => updateRuleConfig(rule.id, config)}
                  saving={savingId === rule.id}
                />
              ))}
            </div>
          </section>
        )}

        {/* Hard Constraints - Collapsed */}
        <section>
          <button
            onClick={() => setHardCollapsed(!hardCollapsed)}
            className="w-full text-left text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3 flex items-center gap-2 hover:text-slate-700"
          >
            {hardCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            Hard Constraints
            <Badge variant="outline" className="text-xs font-normal border-slate-300 text-slate-500">
              {hardRules.length} rules
            </Badge>
            <span className="text-xs font-normal normal-case text-slate-400 ml-auto">
              rarely need changes
            </span>
          </button>
          {!hardCollapsed && (
            <div className="space-y-2">
              {hardRules.map((rule) => (
                <CompactRuleCard
                  key={rule.id}
                  rule={rule}
                  onToggle={(enabled) => toggleRule(rule.id, enabled)}
                  saving={savingId === rule.id}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

interface CompactRuleCardProps {
  rule: Rule
  onToggle: (enabled: boolean) => void
  saving: boolean
}

function CompactRuleCard({ rule, onToggle, saving }: CompactRuleCardProps) {
  const isLocked = LOCKED_RULES.has(rule.rule_key)
  const isUnimplemented = UNIMPLEMENTED_RULES.has(rule.rule_key)

  return (
    <div className={cn(
      "flex items-center justify-between p-3 rounded-lg border bg-white",
      !rule.enabled && !isLocked && !isUnimplemented && "opacity-50",
      isUnimplemented && "opacity-50"
    )}>
      <div className="min-w-0 flex-1 mr-3">
        <div className="font-medium text-sm flex items-center gap-2">
          {rule.name}
          {isLocked && (
            <span title="Always enforced">
              <Lock className="h-3.5 w-3.5 text-slate-400" />
            </span>
          )}
        </div>
        <div className="text-xs text-muted-foreground truncate">{rule.description}</div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {saving && <Loader2 className="h-3 w-3 animate-spin" />}
        {isLocked ? (
          <span className="text-xs text-slate-400 italic">Always on</span>
        ) : isUnimplemented ? (
          <span className="text-xs text-slate-400 italic">Not implemented</span>
        ) : (
          <Switch
            checked={rule.enabled}
            onCheckedChange={onToggle}
            disabled={saving}
            className="scale-90"
          />
        )}
      </div>
    </div>
  )
}

interface ConfigurableRuleCardProps {
  rule: Rule
  grades: Grade[]
  onToggle: (enabled: boolean) => void
  onConfigChange: (config: Record<string, unknown>) => void
  saving: boolean
}

function ConfigurableRuleCard({ rule, grades, onToggle, onConfigChange, saving }: ConfigurableRuleCardProps) {
  const config = rule.config || {}
  const isUnimplemented = UNIMPLEMENTED_RULES.has(rule.rule_key)

  // Show simple card for unimplemented rules
  if (isUnimplemented) {
    return (
      <div className="p-3 rounded-lg border bg-white opacity-50">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium text-sm">{rule.name}</div>
            <div className="text-xs text-muted-foreground">{rule.description}</div>
          </div>
          <span className="text-xs text-slate-400 italic">Not implemented</span>
        </div>
      </div>
    )
  }

  if (rule.rule_key === "study_hall_grades") {
    const selectedGrades = (config.grades as string[]) || []

    return (
      <div className={cn(
        "p-3 rounded-lg border bg-white",
        !rule.enabled && "opacity-50"
      )}>
        <div className="flex items-center justify-between mb-2">
          <div>
            <div className="font-medium text-sm">{rule.name}</div>
            <div className="text-xs text-muted-foreground">{rule.description}</div>
          </div>
          <div className="flex items-center gap-2">
            {saving && <Loader2 className="h-3 w-3 animate-spin" />}
            <Switch
              checked={rule.enabled}
              onCheckedChange={onToggle}
              disabled={saving}
              className="scale-90"
            />
          </div>
        </div>
        {rule.enabled && (
          <div className="mt-3 pt-3 border-t">
            <p className="text-xs text-muted-foreground mb-2">
              Select which grades should have study halls assigned. Uncheck all to skip study hall assignment.
            </p>
            <div className="flex flex-wrap gap-2">
              {grades.map((grade) => (
                <label
                  key={grade.id}
                  className={cn(
                    "flex items-center gap-1.5 px-2 py-1 rounded border text-xs cursor-pointer transition-colors",
                    selectedGrades.includes(grade.display_name)
                      ? "bg-sky-50 border-sky-300 text-sky-700"
                      : "bg-slate-50 border-slate-200 text-slate-500 hover:border-slate-300"
                  )}
                >
                  <Checkbox
                    checked={selectedGrades.includes(grade.display_name)}
                    onCheckedChange={(checked) => {
                      const newGrades = checked
                        ? [...selectedGrades, grade.display_name]
                        : selectedGrades.filter((g) => g !== grade.display_name)
                      onConfigChange({ ...config, grades: newGrades })
                    }}
                    disabled={saving}
                    className="h-3 w-3"
                  />
                  {grade.display_name.replace(" Grade", "")}
                </label>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  if (rule.rule_key === "study_hall_teacher_eligibility") {
    // Default: full-time allowed, part-time not allowed
    const allowFullTime = config.allow_full_time !== false
    const allowPartTime = config.allow_part_time === true

    return (
      <div className={cn(
        "p-3 rounded-lg border bg-white",
        !rule.enabled && "opacity-50"
      )}>
        <div className="flex items-center justify-between mb-2">
          <div>
            <div className="font-medium text-sm">{rule.name}</div>
            <div className="text-xs text-muted-foreground">{rule.description}</div>
          </div>
          <div className="flex items-center gap-2">
            {saving && <Loader2 className="h-3 w-3 animate-spin" />}
            <Switch
              checked={rule.enabled}
              onCheckedChange={onToggle}
              disabled={saving}
              className="scale-90"
            />
          </div>
        </div>
        {rule.enabled && (
          <div className="mt-3 pt-3 border-t">
            <p className="text-xs text-muted-foreground mb-2">
              Select which teacher types can supervise study halls:
            </p>
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={allowFullTime}
                  onCheckedChange={(checked) => {
                    // Don't allow unchecking both - if unchecking full-time, ensure part-time is checked
                    if (!checked && !allowPartTime) {
                      onConfigChange({ ...config, allow_full_time: false, allow_part_time: true })
                    } else {
                      onConfigChange({ ...config, allow_full_time: checked })
                    }
                  }}
                  disabled={saving}
                />
                <span>Full-time teachers</span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={allowPartTime}
                  onCheckedChange={(checked) => {
                    // Don't allow unchecking both - if unchecking part-time, ensure full-time is checked
                    if (!checked && !allowFullTime) {
                      onConfigChange({ ...config, allow_part_time: false, allow_full_time: true })
                    } else {
                      onConfigChange({ ...config, allow_part_time: checked })
                    }
                  }}
                  disabled={saving}
                />
                <span>Part-time teachers</span>
              </label>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Individual teachers can also be excluded via the &quot;Exclude from Study Hall&quot; checkbox on their teacher record.
            </p>
          </div>
        )}
      </div>
    )
  }

  // Default card for other medium rules
  return (
    <CompactRuleCard
      rule={rule}
      onToggle={onToggle}
      saving={saving}
    />
  )
}
