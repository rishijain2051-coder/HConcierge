'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import type { Team } from '@/lib/departments'
import { createTeam, renameTeam, setTeamActive } from '../actions'
import { Button, Confirm, Err, Field, Modal, Panel, Tag } from '../../ui'

export default function TeamManager({ teams, usage }: { teams: Team[]; usage: Record<string, number> }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Team | null>(null)
  const [closing, setClosing] = useState<Team | null>(null)
  const [error, setError] = useState<string | null>(null)

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) {
    setError(null)
    start(async () => {
      const res = await fn()
      if (!res.ok) setError(res.error ?? 'That did not work.')
      else {
        after?.()
        router.refresh()
      }
    })
  }

  return (
    <Panel
      title="Teams"
      description="Who a request goes to. Every item in the directory names one, every staff account belongs to one, and the escalation ladder can single one out. Add the ones this hotel actually has."
      action={
        <Button variant="primary" onClick={() => setAdding(true)}>
          + Add a team
        </Button>
      }
    >
      {error && <div className="mb-3">{<Err>{error}</Err>}</div>}

      <div className="bg-surface border-line divide-line divide-y overflow-hidden rounded-2xl border">
        {teams.map((t) => {
          const used = usage[t.slug] ?? 0
          return (
            <div key={t.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5">
              <div className="min-w-[12rem] flex-1">
                <p className="text-[14px] font-semibold">
                  {t.name}
                  {!t.active && <Tag tone="late"> Closed</Tag>}
                </p>
                <p className="text-faint text-[12px]">
                  {used === 0
                    ? 'Nothing routed here yet'
                    : `${used} item${used === 1 ? '' : 's'}, account${used === 1 ? '' : 's'} and rules route here`}
                </p>
              </div>

              <div className="flex shrink-0 flex-wrap gap-1.5">
                <Button onClick={() => setEditing(t)}>Rename</Button>
                {t.active ? (
                  <Button variant="danger" onClick={() => setClosing(t)} disabled={pending}>
                    Close
                  </Button>
                ) : (
                  <Button onClick={() => run(() => setTeamActive(t.id, true))} disabled={pending}>
                    Reopen
                  </Button>
                )}
              </div>
            </div>
          )
        })}
        {teams.length === 0 && <p className="text-faint px-4 py-12 text-center text-sm">No teams yet.</p>}
      </div>

      <p className="text-faint mt-3 text-[12px] leading-relaxed">
        A team is never deleted, because four tables point at it and last month&rsquo;s requests still have to read
        correctly. Closing one takes it off the directory&rsquo;s &ldquo;goes to&rdquo;, the staff form and the
        escalation ladder, and leaves everything already routed to it alone.
      </p>

      {(adding || editing) && (
        <Modal
          title={editing ? `Rename ${editing.name}` : 'Add a team'}
          onClose={() => (setAdding(false), setEditing(null))}
        >
          <form
            className="space-y-3.5"
            action={(form) => {
              const name = String(form.get('name') ?? '')
              if (editing) run(() => renameTeam(editing.id, name), () => setEditing(null))
              else run(() => createTeam(name), () => setAdding(false))
            }}
          >
            <Field
              label="Team name"
              name="name"
              defaultValue={editing?.name}
              required
              autoFocus
              placeholder="Spa & wellness"
              hint={
                editing
                  ? 'Only the name changes. Everything already routed to this team stays with it.'
                  : 'Anything a guest can ask for that a different set of people handles — a spa, a valet desk, a business centre.'
              }
            />
            <Button type="submit" variant="primary" full disabled={pending}>
              {pending ? 'Saving…' : editing ? 'Save changes' : 'Add team'}
            </Button>
          </form>
        </Modal>
      )}

      {closing && (
        <Confirm
          title={`Close ${closing.name}?`}
          body={
            (usage[closing.slug] ?? 0) > 0
              ? `Nothing routed to ${closing.name} is touched — the requests, the menu items and the people stay exactly as they are. It simply stops being offered when someone sets up something new. You can reopen it at any time.`
              : `${closing.name} stops being offered on the directory, the staff form and the escalation ladder. You can reopen it at any time.`
          }
          confirmLabel="Close the team"
          onConfirm={() => run(() => setTeamActive(closing.id, false))}
          onClose={() => setClosing(null)}
        />
      )}
    </Panel>
  )
}
