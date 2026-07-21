# Multi-Block Schedule Plan

**Status:** Planning. No code changed.
**Date:** 2026-07-21
**Supersedes:** `MULTI_BLOCK_SCOPE.md`

---

## Recommendation

Adopt **one shared bell schedule** for the whole school — uniform 40-minute periods on common boundaries — where each group uses as many periods as it needs (Primaria 7, MS/HS 8, Kindergarten fewer).

This costs **10 minutes of instruction per band and 5 minutes of lunch**. It returns roughly **24 hours a week of specialist teacher availability**, and it keeps the scheduler's conflict detection correct instead of silently wrong.

It also cuts the software work from roughly **8–10 weeks to 3–4**.

If the school cannot align the bells, the work is still possible — see §5 — but it requires rewriting the solver's core constraint model.

---

## 1. The problem

### 1.1 In one sentence

> Primaria and MS/HS ring their bells 15 minutes apart, so a teacher working across both can be booked into two classes that have **different period numbers** but **overlap on the clock**. Our scheduler only checks period numbers — so it sees no conflict, and prints a schedule that looks correct and cannot be taught.

### 1.2 Why the bells drift

Both draft schedules use 40-minute classes. But:

- **Primaria** starts its first class at **8:20** (after a 20-minute morning meeting)
- **MS/HS** starts its first class at **8:05** (after a 5-minute one)

That 15-minute head start is never recovered, and the two take their breaks at different points, so they drift further apart all day.

**Of Primaria's 7 periods, only the last one (1:45–2:30) starts *and* ends together with an MS/HS period.** The other 6 each straddle two.

### 1.3 A concrete failure

Oscar, our music teacher:

| Class | Slot | Clock time |
|---|---|---|
| 1st Grade Music | Primaria **Period 1** | 8:20–9:00 |
| 7th Grade Music | MS **Period 2** | 8:45–9:25 |

Period 1 and Period 2 are different numbers, so the scheduler books both without complaint. On the clock, **from 8:45 to 9:00 Oscar is in two rooms at once.**

The failure mode is not "generation fails." It is "generation succeeds and produces something impossible, and nobody can see it on the printout."

### 1.4 Who it affects

**15 of our 19 teachers: not at all.** They teach entirely inside one group and their schedules work exactly as today.

**4 are affected — and precisely because of their role:**

| Teacher | Subject | Why they cross |
|---|---|---|
| Josh | Science / Math | Elementary science *and* 6th–8th science |
| Oscar | Music | Only music teacher, K–11 |
| Isa | PE / Sports / CAS | Only PE teacher |
| Romina | Art | Only art teacher |

These cannot be split by band. Covering the whole school **is** the job.

### 1.5 The cost even when it doesn't break

With misaligned bells, each Primaria class a specialist teaches makes **two** MS/HS periods unavailable instead of one:

| Teacher | Classes/wk | Periods consumed — misaligned | aligned | Lost |
|---|---|---|---|---|
| Josh | 21 | 29.5 / 40 (74%) | 21 / 40 (53%) | 8.5 |
| Oscar | 20 | 28.5 / 40 (71%) | 20 / 40 (50%) | 8.5 |
| Isa | 20 | 29.9 / 40 (75%) | 20 / 40 (50%) | 9.9 |
| Romina | 15 | 23.5 / 40 (59%) | 15 / 40 (38%) | 8.5 |

**~36 periods a week — roughly 24 hours — neither taught nor usable.**

> *Directional, not exact.* Based on the average overlap rate (1.71). Clustering a specialist's Primaria classes back-to-back recovers some of it. The direction and rough magnitude hold.

---

## 2. Recommended solution: one shared bell schedule

The key arithmetic: **MS/HS teaches exactly 40 minutes more than Primaria, and Primaria breaks exactly 40 minutes more than MS/HS.** Both days total 390 minutes. Primaria's "missing" 8th period *is* its extra break time.

Nothing needs to be added or removed. That extra 40 minutes just has to be spent as **one whole period** instead of scattered in 15- and 20-minute pieces that push everything out of phase.

### 2.1 The shared grid

Uniform 40-minute periods. Day still ends 2:30.

| Time | Min | Window |
|---|---|---|
| 8:00–8:20 | 20 | **Morning Meeting** (all bands) |
| 8:20–9:00 | 40 | S1 |
| 9:00–9:40 | 40 | S2 |
| 9:40–9:50 | 10 | *shared break* |
| 9:50–10:30 | 40 | S3 |
| 10:30–11:10 | 40 | S4 |
| 11:10–11:50 | 40 | S5 |
| 11:50–12:30 | 40 | S6 |
| 12:30–1:10 | 40 | *lunch window* |
| 1:10–1:50 | 40 | S7 |
| 1:50–2:30 | 40 | S8 |

Eight teaching windows. MS/HS uses all 8. Primaria uses 7 and spends the spare one on snack/recess.

### 2.2 Primaria's reading

| Time | Min | |
|---|---|---|
| 8:00–8:20 | 20 | **Morning Meeting — unchanged** |
| 8:20–9:00 | 40 | P1 |
| 9:00–9:40 | 40 | P2 |
| 9:40–9:50 | 10 | *shared break* |
| 9:50–10:30 | 40 | P3 |
| **10:30–11:10** | **40** | **Snack + recess** |
| 11:10–11:50 | 40 | P4 |
| 11:50–12:30 | 40 | Lunch |
| 12:30–1:10 | 40 | P5 |
| 1:10–1:50 | 40 | P6 |
| 1:50–2:30 | 40 | P7 |

Morning meeting stays at 20 minutes. The spare window becomes a real 40-minute snack and recess — *more* break time than today, in one usable chunk rather than a 20-minute snack plus a 15-minute afternoon break.

### 2.3 What it costs

| | Now | Proposed | Δ |
|---|---|---|---|
| Primaria morning meeting | 20 min | 20 min | — |
| Primaria instruction | 290 min | 280 min | **−10** |
| Primaria snack / breaks | 35 min | 40 min | **+5** |
| Primaria lunch | 45 min | 40 min | −5 |
| MS/HS instruction | 330 min | 320 min | **−10** |
| MS/HS morning meeting | 5 min | 20 min | +15 |
| MS/HS lunch | 45 min | 40 min | −5 |
| Day ends | 2:30 | 2:30 | — |

MS/HS moving to a 20-minute morning routine is not new: the **current live** 5-block template already runs an 8:00–8:05 morning meeting *plus* an 8:05–8:20 SEL / homeroom check-in. Twenty minutes is existing practice — only the new draft trimmed it to 5.

### 2.4 Variant — keep the 45-minute lunch

Identical grid with a 45-minute lunch window ends the day at **2:35** instead of 2:30. Everything else unchanged.

### 2.5 Verified

With this grid, **no period on any band ever straddles two on another — overlap cost is exactly 1.00 across all three bands.** A class blocks the one period it occupies and nothing else. The scheduler's existing period-number conflict check becomes correct again.

### 2.6 Still Primaria's free choice

- **Which window to give up.** Shown as S4 (mid-morning snack/recess). Could equally be S8 — teaching ends 1:50 with a 40-minute afternoon activity block. Both align equally well; purely pedagogical.
- **Lunch sittings.** Primaria + MS at 11:50 with HS at 12:30, or any other split. The windows are shared, so the cafeteria can sequence however suits.

---

## 3. Decisions needed from the school

| # | Decision | Why it matters |
|---|---|---|
| 1 | **Adopt the shared grid?** | Drives everything below. Aligned ≈ 3–4 weeks of work; misaligned ≈ 8–10. |
| 2 | 40-minute lunch (end 2:30) or 45-minute (end 2:35)? | Cosmetic to the software; real to families and buses. |
| 3 | Which window does Primaria give up — mid-morning snack, or early finish? | Pedagogical only. No software impact. |
| 4 | **Which grid does Kindergarten follow?** | K is at **25/25 — completely full** today. Isa, Oscar and Romina all teach K. See §3.1. |
| 5 | Confirm MS vs HS differ only in the P6/lunch swap, not in any teaching constraint. | If so, they are one band for scheduling and differ only on the printout. |
| 6 | Should teacher availability be expressed in clock times or period numbers? | Affects how restrictions are stored and edited. |

### 3.1 Kindergarten

The "Primaria 1° a 5°" draft doesn't cover K, so by default K stays on the current 5-block grid. **That is the worst option available.**

The current grid uses **60-minute** blocks and aligns with *nothing* — zero exact matches against any of the three new grids, and the highest friction in the matrix (2.00 against MS). If K keeps it, Isa, Oscar and Romina straddle **three** mutually misaligned grids instead of two.

**Recommendation: move K onto the shared grid**, using however many of the 8 windows it needs.

---

## 4. Software implementation plan (aligned grid)

Ordered so each phase ships independently. Phase 1 has no dependency on the solver and can start immediately.

### Phase 0 — Harden elective detection (pre-work) — 0.5 d

Not caused by this project, but it sits directly under the grade-conflict logic that Phases 2–4 build on. Worth doing first so a false-conflict report during migration isn't misattributed to the new block handling.

**The issue.** `isClassElective(teacher, subject, snapshot, gradeDisplay?)` resolves by matching teacher + subject. When more than one class row matches, it needs `gradeDisplay` to disambiguate; without it, it returns `false` (as of `823e91d`, which correctly made this fail closed rather than fail silent).

Only 2 of 7 call sites pass `gradeDisplay`. The one that affects correctness:

```
canClassesShareSlot()             grade-utils.ts:413-414   ← no gradeDisplay
  ← shouldIgnoreGradeConflict()   grade-utils.ts:447
      ← history/[id]/page.tsx:4551, :4694                  ← both have grade context in scope
```

The other three (`ScheduleGrid.tsx:528`, `:537`, `history/[id]/page.tsx:9058`) only drive elective badge styling — cosmetic.

**Current risk: none, and that is the concern.** In the active quarter, 29 teacher+subject pairs hit the ambiguous branch (Oscar/Music has 10 rows, Isa/PE and Josh/Science 6 each) — but all 29 are entirely regular classes, so `false` is correct every time. All 6 electives have exactly one row each and never reach the fallback.

They stay that way because electives are given **distinct subject names** — "Robotics A", "TedEd A", "TedEd B", "Art 101". Correctness here rests on a naming convention, not on code. The first time someone adds a regular class sharing a subject name with an elective, two genuine electives get reported as a grade conflict.

**The work:**

- Add optional `gradeDisplayA` / `gradeDisplayB` params to `canClassesShareSlot()` and `shouldIgnoreGradeConflict()`; pass what `history/[id]/page.tsx:4551` and `:4694` already have in scope.
- Optionally pass `gradeDisplay` at the three cosmetic sites.
- Replace the disambiguation heuristic. It currently matches on grade **count**:
  ```ts
  if (matchGradeCount === gradeNums.length) return m.is_elective === true
  ```
  Two classes with the same number of grades but different grades match the wrong row. Snapshot entries carry `grade_ids`, so exact matching is available and strictly better — and grade groups make displays more varied, which degrades a count-based match further.

**Priority: low but cheap.** Zero triggering cases in any quarter today, and the failure mode is a visible false conflict rather than a silent bad schedule. Defensible to defer until something trips it — but it is an hour's work against a primitive that Phases 2–4 lean on heavily.

### Phase 1 — Timetable data model & display — 4–6 d

The timetable feature is already closest to ready: `timetable_templates.rows` supports per-grade scoping via `grade_ids`, and `resolveRowsForGrade` filters per grade. Production already uses this for the 6th–11th lunch row.

- Add `grade_ids UUID[]` to `timetable_templates` so each grade resolves to exactly one template. Keep row-level `grade_ids` for *within*-band variation — the MS/HS P6/lunch swap is exactly that case and already works.
- New helper `resolveTemplateForGrade()` in `lib/timetable-utils.ts`; route all three call sites through it (`history/[id]/page.tsx` ×2, `lib/export.ts`). Note `app/api/export/route.ts:19` currently does `SELECT ... LIMIT 1`.
- Add structured `start_time` / `end_time` to rows; keep `time` as display override; backfill by parsing existing strings.
- Remove the `max={5}` cap on `blockNumber` (`settings/timetable/page.tsx:345`); bound it by the template's block count. Update copy at `:239`.
- Editor: template switcher / tabs.

**Validation — including one live data-loss risk.** `GradeTimetable.tsx` renders by iterating template rows and pulling `gradeSchedule[day][row.blockNumber]`. Anything the solver placed in a block with no matching row is **silently dropped from the printout**. Invisible today because every grade has all 5 blocks; once counts vary, a mis-scoped row means a class quietly disappears. Add editor warnings for:

- **Coverage** — every block a grade can be assigned has exactly one row *(the important one)*
- **Uniqueness** — no duplicate `blockNumber` within a grade's resolved rows
- **Overlap** — no two resolved rows overlapping in time
- **Orphans** — every grade resolves to exactly one template

### Phase 2 — Variable block count in the solver — 3–4 d

`backend/solver.py`:

- `BLOCKS`/`NUM_SLOTS` become parameters (`:14-16`); slot math `dayIdx*N+blockIdx` (`:147-155`)
- Day extraction: `AddDivisionEquality(day1, slot_vars[...], 5)` → `N` (`:934`)
- Per-grade valid-block masks — grades restrict session domains to their own periods
- Preflight caps: hardcoded "max is 25 (5 days × 5 blocks)" → per-band (`:1878`, `:1900`)

The `AllDifferent` formulation for teacher and grade conflicts (`:851`, `:892`) **survives intact** on an aligned grid — same slot integer still means same wall-clock time. This is the whole reason alignment is cheap.

### Phase 3 — Config UI — 2–3 d

- `classes/page.tsx:97` fixed-slot grid → band-aware
- `components/AddClassModal.tsx:37`, `RestrictionPopover.tsx:12`, `TeacherAvailabilityPopover.tsx:12` — all hardcode `[1,2,3,4,5]`
- Teacher availability semantics per decision #6

### Phase 4 — Display & export — 3–5 d

- `components/ScheduleGrid.tsx:14`, `ScheduleStats.tsx:71` — variable columns
- `lib/export.ts:8`, `lib/png-export.ts`
- `lib/schedule-utils.ts:272` — `BLOCKS_ORDER` drives open-block label indexing
- **Teacher merged timetable view** — new. A specialist's row-set is the union of blocks they actually teach. Straightforward on an aligned grid; much harder if not.

### Phase 5 — Migration & back-compat — 2–3 d

Existing saved 5-block schedules must keep rendering. Version-stamp saved options; old quarters stay on the old path.

### Phase 6 — Testing — 2–3 d

Cross-band specialists are the cases that matter.

### Phase 7 — Deprecate the JS fallback solver

`lib/scheduler.ts` (1,898 lines) duplicates the solver in JS. Porting it doubles the hardest work for a rarely-exercised path. **Recommend leaving it 5-block-only for legacy quarters and routing new work to Cloud Run.**

### Total — 16.5–24.5 days ≈ **3–4 weeks**

> **Correction to an earlier estimate.** I previously quoted "1–1.5 weeks" for the aligned path. That figure covered the *solver* change alone (Phase 2). The full feature — timetable model, config UI, export, teacher view, migration — is 3–4 weeks. The 1-week figure was misleading and is withdrawn.

---

## 5. If the bells cannot be aligned

Two fallbacks, both materially worse.

### 5.1 Sequential band solve — ~6–8 weeks

The bands are coupled by **teachers and nothing else**. Verified against the active quarter: 0 of 16 multi-grade classes span the elem/MS boundary; combined grades are all inside MS/HS; study halls are 6th–11th only; co-taught classes are same-grade; no room/resource modelling exists.

So: solve band A, map each shared teacher's assignments onto band B by wall-clock overlap, feed those in as blocked cells, solve band B.

The solver already has this machinery — it's the partial-regen path (`locked_teachers`, `locked_grade_slots`, `locked_grade_subject_days` at `solver.py:272-284, 396-415`). The new code is a time-overlap mapper plus orchestration, not a constraint rewrite.

**Risk:** each band-A session of a shared teacher blocks up to *two* band-B periods. Josh and Oscar get tight enough that solve order matters and a first pass may return infeasible. Budget a feasibility spike on real data before committing.

### 5.2 Full wall-clock model — ~8–10 weeks

Model time properly: split the day at every boundary from every band into atomic intervals; each period covers a set of intervals; a teacher occupies each interval at most once.

The CP-SAT model moves from integer-slot + `AllDifferent` to boolean assignment with per-(teacher, interval) "at most one." A more standard formulation and the model stays small (265 sessions × ~40 slots) — but it is a rewrite of the constraint layer, and it drags the 9,816-line editing UI (`history/[id]/page.tsx`, 692 block references) with it, since freeform edits, swaps, transfers and regen validation all key off `{day, block}` equality.

---

## Appendix A — Current state (active quarter, Q4 Summer 2025-26)

### Capacity per group

| Group | Blocks/day | Slots/wk | Regular sessions | Electives | Free |
|---|---|---|---|---|---|
| **Kindergarten** | 5 | 25 | 25 | 0 | **0 — full** |
| **Primaria 1st–5th** | 7 | 35 | 25 | 0 | 10 |
| **MS/HS 6th–11th** | 8 | 40 | 21 | 7–8 | ~19 |

Heaviest teacher load is Josh at 21 sessions against 35–40 slots. **Capacity is not the constraint** — the overlap structure for the 4 specialists is. Except Kindergarten, which is full today.

### Teacher load by band (sessions = days/week)

| Teacher | Status | K–5 | 6–11 | Total | Band |
|---|---|---|---|---|---|
| Josh | full-time | 12 | 9 | 21 | **both** |
| Karla | full-time | 20 | 0 | 20 | Primaria |
| Carolina | full-time | 20 | 0 | 20 | Primaria |
| Oscar | full-time | 12 | 8 | 20 | **both** |
| Isa | full-time | 14 | 6 | 20 | **both** |
| Shary | full-time | 0 | 20 | 20 | MS/HS |
| Daniela S | full-time | 20 | 0 | 20 | Primaria |
| Eugenia | full-time | 19 | 0 | 19 | Primaria |
| Miguel | full-time | 0 | 19 | 19 | MS/HS |
| Jostin | full-time | 18 | 0 | 18 | Primaria |
| Romina | part-time | 12 | 3 | 15 | **both** |
| Emily | part-time | 0 | 12 | 12 | MS/HS |
| Ricardo | full-time | 0 | 10 | 10 | MS/HS |
| Britt | part-time | 0 | 9 | 9 | MS/HS |
| Tenie | part-time | 0 | 8 | 8 | MS/HS |
| Daniela CR | part-time | 0 | 4 | 4 | MS/HS |
| Aurora | part-time | 0 | 4 | 4 | MS/HS |
| Mandy | part-time | 0 | 4 | 4 | MS/HS |
| Sydney | full-time | 2 | 0 | 2 | Primaria |

---

## Appendix B — Alignment analysis of the drafted grids

### Unified wall-clock timeline (as drafted, before alignment)

```
time          CURRENT 5   PRIMARIA 7  MS 8        HS 8
8:05-8:20     ·           ·           P1          P1
8:20-8:45     B1          P1          P1          P1
8:45-9:00     B1          P1          P2          P2
9:00-9:20     B1          P2          P2          P2
9:20-9:25     ·           P2          P2          P2
9:25-9:35     B2          P2          ·           ·
9:35-9:40     B2          P2          P3          P3
9:40-10:15    B2          P3          P3          P3
10:15-10:20   B2          P3          P4          P4
10:20-10:30   B2          ·           P4          P4
10:30-10:40   B3          ·           P4          P4
10:40-10:55   B3          P4          P4          P4
10:55-11:20   B3          P4          P5          P5
11:20-11:35   B3          P5          P5          P5
11:35-12:00   ·           P5          ·           P6
12:00-12:20   ·           ·           ·           P6
12:20-12:30   ·           ·           P6          ·
12:30-12:45   B4          ·           P6          ·
12:45-1:05    B4          P6          P6          ·
1:05-1:30     B4          P6          P7          P7
1:30-1:45     ·           ·           P7          P7
1:45-2:30     B5          P7          P8          P8   ← only universally shared slot
2:30-2:40     B5          ·           ·           ·
```

### Exact period matches (same start *and* end)

| Pair | Matches | Which |
|---|---|---|
| **MS vs HS** | **7 / 8** | P1–P5, P7, P8 — only **P6** differs (swaps with lunch) |
| Primaria vs MS | 1 / 7 | P7 = P8 |
| Primaria vs HS | 1 / 7 | P7 = P8 |
| Current 5 vs Primaria | **0 / 5** | none |
| Current 5 vs MS | **0 / 5** | none |
| Current 5 vs HS | **0 / 5** | none |

### Friction — teach one period in the row grid, lose how many in the column grid

`1.00` = perfectly aligned. `2.00` = every class costs two periods on the other grid.

| from ↓ / to → | Current 5 | Primaria 7 | MS 8 | HS 8 |
|---|---|---|---|---|
| **Current 5** | — | 1.60 | **2.00** | 1.80 |
| **Primaria 7** | 1.14 | — | 1.71 | 1.71 |
| **MS 8** | 1.25 | 1.50 | — | **0.88** |
| **HS 8** | 1.13 | 1.50 | 0.88 | — |

**MS and HS are one grid, not two.** Friction 0.88 — below 1.0 because HS's P6 falls during MS's lunch and so costs nothing. Treat them as a single 8-block band with a P6/lunch display variant, which row-level `grade_ids` scoping already handles.

### Time budgets (as drafted)

| | Primaria | MS/HS |
|---|---|---|
| Periods | 7 | 8 |
| Instruction | 290 min | 330 min |
| Non-teaching | 100 min | 60 min |
| **Total 8:00–2:30** | **390 min** | **390 min** |

MS/HS teaches exactly 40 minutes more; Primaria breaks exactly 40 minutes more. Exactly one period. This is why the shared-grid solution works with no net change to anyone's day length.

---

## Appendix C — Code touchpoints

Hardcoded 5-block assumptions:

| File | Lines |
|---|---|
| `backend/solver.py` | `:14-16` constants, `:147-155` slot math, `:934` day extraction, `:851`/`:892` AllDifferent, `:1253`/`:1536` back-to-back, `:1878`/`:1900` preflight caps — 41 `BLOCKS` references |
| `lib/scheduler.ts` | `:17-35` — JS fallback, recommend deprecating |
| `app/(authenticated)/history/[id]/page.tsx` | 9,816 lines, 692 `block` refs, 8 × `[1,2,3,4,5]` literals |
| `app/(authenticated)/classes/page.tsx` | `:97` |
| `components/ScheduleGrid.tsx` | `:14` |
| `components/ScheduleStats.tsx` | `:71` |
| `components/AddClassModal.tsx` | `:37` |
| `components/RestrictionPopover.tsx` | `:12` |
| `components/TeacherAvailabilityPopover.tsx` | `:12` |
| `lib/export.ts` | `:8` |
| `lib/schedule-utils.ts` | `:272` `BLOCKS_ORDER` |
| `lib/types.ts` | `:161`, `:176` |
| `lib/snapshot-utils.ts` | `:89` |
| `app/(authenticated)/settings/timetable/page.tsx` | `:239` copy, `:345` `max={5}` |
