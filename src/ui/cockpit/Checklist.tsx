import { useContext } from 'react'

import { isTicked, tickedCount } from '../../cockpitLogic'
import { LinkedText } from '../../RichText'
import type { Task } from '../../types'
import { Checkbox, SectionLabel } from '../atoms'
import { CockpitContext, useCockpit } from './context'

// The acceptance criteria, each one tickable. Ticks stay in this browser and
// clear when the item closes.
export function Checklist({ task }: { task: Task }) {
  const { ticks, toggleTick } = useCockpit()
  const items = task.acceptanceCriteria ?? []
  if (items.length === 0) return null
  return (
    <div>
      <SectionLabel count={`${tickedCount(ticks, task)}/${items.length}`}>ACCEPTANCE CRITERIA</SectionLabel>
      {items.map((text, i) => {
        const ticked = isTicked(ticks, task.id, text)
        return (
          <div key={i} className="flex items-start gap-2 border-b border-line-soft py-1.5 last:border-b-0">
            <span className="mt-0.5">
              <Checkbox checked={ticked} onChange={() => toggleTick(task, text)} label={`${ticked ? 'Untick' : 'Tick'}: ${text}`} />
            </span>
            <span className={`text-body ${ticked ? 'text-muted line-through' : 'text-fg'}`}><LinkedText text={text} /></span>
          </div>
        )
      })}
      <div className="mt-1.5 text-meta text-muted">Ticks stay in this browser and clear when the item closes.</div>
    </div>
  )
}

// How many criteria are ticked, for a board card.
export function AcceptanceProgress({ task }: { task: Task }) {
  const value = useContext(CockpitContext)
  const total = task.acceptanceCriteria?.length ?? 0
  if (!value || total === 0) return null
  const done = tickedCount(value.ticks, task)
  return <span className={`chip ${done === total ? 'text-ok' : ''}`} title="Acceptance criteria ticked">AC {done}/{total}</span>
}
