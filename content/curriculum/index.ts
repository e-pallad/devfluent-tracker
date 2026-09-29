import type { Month, Track, TrackMeta, Week, LearningBlock } from "./types"

// JavaScript track — all 12 months
import jsMeta from "./tracks/javascript/meta.json"
import jsMonth01 from "./tracks/javascript/month-01.json"
import jsMonth02 from "./tracks/javascript/month-02.json"
import jsMonth03 from "./tracks/javascript/month-03.json"
import jsMonth04 from "./tracks/javascript/month-04.json"
import jsMonth05 from "./tracks/javascript/month-05.json"
import jsMonth06 from "./tracks/javascript/month-06.json"
import jsMonth07 from "./tracks/javascript/month-07.json"
import jsMonth08 from "./tracks/javascript/month-08.json"
import jsMonth09 from "./tracks/javascript/month-09.json"
import jsMonth10 from "./tracks/javascript/month-10.json"
import jsMonth11 from "./tracks/javascript/month-11.json"
import jsMonth12 from "./tracks/javascript/month-12.json"

// Python track
import pyMeta from "./tracks/python/meta.json"
import pyMonth01 from "./tracks/python/month-01.json"

const jsMonths: Month[] = [
  jsMonth01,
  jsMonth02,
  jsMonth03,
  jsMonth04,
  jsMonth05,
  jsMonth06,
  jsMonth07,
  jsMonth08,
  jsMonth09,
  jsMonth10,
  jsMonth11,
  jsMonth12,
] as Month[]

const pyMonths: Month[] = [pyMonth01] as Month[]

export const TRACKS: Track[] = [
  { meta: jsMeta as TrackMeta, months: jsMonths },
  { meta: pyMeta as TrackMeta, months: pyMonths },
]

// Backward-compatible export — existing code that imports CURRICULUM still works
export const CURRICULUM: Month[] = jsMonths

export function getTrackById(id: string): Track | undefined {
  return TRACKS.find((t) => t.meta.id === id)
}

export function getMonth(trackId: string, month: number): Month | undefined {
  const months = getTrackById(trackId)?.months ?? CURRICULUM
  return months.find((m) => m.month === month)
}

export function getWeek(trackId: string, month: number, week: number): Week | undefined {
  return getMonth(trackId, month)?.weeks.find((w) => w.week === week)
}

export function getAllBlocks(): LearningBlock[] {
  return TRACKS.flatMap((t) => t.months.flatMap((m) => m.weeks.flatMap((w) => w.blocks)))
}

// Built once — getBlock runs on every progress/quiz request. First occurrence
// wins, matching the previous Array.find lookup.
const BLOCKS_BY_ID = new Map<string, LearningBlock>()
for (const block of getAllBlocks()) {
  if (!BLOCKS_BY_ID.has(block.id)) BLOCKS_BY_ID.set(block.id, block)
}

export function getBlock(blockId: string): LearningBlock | undefined {
  return BLOCKS_BY_ID.get(blockId)
}

export const BLOCK_TYPE_COLORS: Record<LearningBlock["type"], string> = {
  theory: "bg-blue-100 text-blue-800",
  practice: "bg-green-100 text-green-800",
  project: "bg-purple-100 text-purple-800",
  review: "bg-orange-100 text-orange-800",
}

export const BLOCK_TYPE_LABELS: Record<LearningBlock["type"], string> = {
  theory: "Theory",
  practice: "Practice",
  project: "Project",
  review: "Review",
}

// Re-export types
export type {
  QuizQuestion,
  Exercise,
  ExerciseTest,
  LearningBlock,
  Week,
  AlternativeProject,
  Month,
  TrackMeta,
  Track,
} from "./types"
