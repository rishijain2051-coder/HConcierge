'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Button, Err, Panel, Select } from '../../ui'
import { runImport } from './actions'

type Kind = 'rooms' | 'items' | 'staff' | 'info'

/**
 * The copy here is the documentation. There is no separate page explaining the
 * columns: the template carries the headers and a filled example row, and this
 * screen says the one thing per kind that a filled row cannot.
 */
const KINDS: { value: Kind; label: string; hint: string }[] = [
  {
    value: 'rooms',
    label: 'Rooms',
    hint: 'Only “number” is required, and it has to be unique in the property. Each room gets its own permanent QR the moment it is created.',
  },
  {
    value: 'items',
    label: 'Directory items',
    hint: 'A section that does not exist yet is created. Price is in rupees and may carry paise — 260.50 is fine. Leave “veg” blank for anything that is not food.',
  },
  {
    value: 'staff',
    label: 'Staff',
    hint: 'Every account gets a one-time password, listed once when the import finishes. Copy them then — they are not stored and cannot be shown again.',
  },
  {
    value: 'info',
    label: 'Hotel info pages',
    hint: 'Slug is what appears in the link and has to be unique. Line breaks inside a cell survive if the cell is quoted, which Excel does for you.',
  },
]

type Result =
  | { ok: true; created: number; kind: string; passwords?: { username: string; password: string }[] }
  | { ok: false; error: string; problems?: { line: number; says: string }[] }

export default function ImportManager({
  properties,
  myPropertyId,
}: {
  properties: { id: string; name: string }[]
  myPropertyId: string | null
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [kind, setKind] = useState<Kind>('rooms')
  const [propertyId, setPropertyId] = useState(myPropertyId ?? properties[0]?.id ?? '')
  const [result, setResult] = useState<Result | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)

  const spec = KINDS.find((k) => k.value === kind)!

  function onFile(file: File) {
    setResult(null)
    setFileName(file.name)
    // Read in the browser and send text: a server action taking a File has to
    // be multipart, and these files are small by construction.
    file.text().then((text) =>
      start(async () => {
        const res = await runImport(kind, propertyId, text)
        setResult(res as Result)
        if (res.ok) router.refresh()
      }),
    )
  }

  return (
    <Panel
      title="Import from a spreadsheet"
      description="Set a property up in an afternoon instead of a screen at a time. Download the template for what you are adding, fill it in Excel, and upload it back. Nothing is written unless every row is valid, so a file with a mistake in it changes nothing."
    >
      <div className="grid gap-3.5 sm:grid-cols-2">
        <Select
          label="What are you adding?"
          name="kind"
          defaultValue={kind}
          options={KINDS.map((k) => ({ value: k.value, label: k.label }))}
          onChange={(v) => {
            setKind(v as Kind)
            setResult(null)
            setFileName(null)
          }}
        />
        {properties.length > 1 && (
          <Select
            label="Into which property?"
            name="property"
            defaultValue={propertyId}
            options={properties.map((p) => ({ value: p.id, label: p.name }))}
            onChange={setPropertyId}
          />
        )}
      </div>

      <p className="text-muted mt-4 text-[13px] leading-relaxed">{spec.hint}</p>

      <div className="mt-5 flex flex-wrap items-center gap-2.5">
        {/* A plain anchor, not a Button: this is a download, and the browser
            should treat it as one. */}
        <a
          href={`/api/staff/import/template?kind=${kind}`}
          className="border-line text-muted hover:text-ink hover:border-ink min-h-11 rounded-lg border px-3 py-1.5 text-[12px] font-semibold transition"
        >
          Download the {spec.label.toLowerCase()} template
        </a>

        <label className="bg-ink ease-glide inline-flex min-h-11 cursor-pointer items-center rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white transition hover:opacity-90">
          {pending ? 'Reading…' : 'Choose a filled file'}
          <input
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            disabled={pending || !propertyId}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) onFile(f)
              // Cleared so choosing the same file twice still fires a change.
              e.target.value = ''
            }}
          />
        </label>

        {fileName && <span className="text-faint text-[12px]">{fileName}</span>}
      </div>

      {result && !result.ok && (
        <div className="mt-5">
          <Err>{result.error}</Err>
          {result.problems && result.problems.length > 0 && (
            <div className="border-line divide-line mt-3 divide-y overflow-hidden rounded-xl border">
              {/* Line numbers are the spreadsheet's own, header counted, so
                  they can be typed straight into Excel's go-to box. */}
              {result.problems.slice(0, 40).map((p) => (
                <p key={`${p.line}-${p.says}`} className="px-3.5 py-2 text-[13px]">
                  <span className="text-faint tabular-nums">Line {p.line}</span> · {p.says}
                </p>
              ))}
              {result.problems.length > 40 && (
                <p className="text-faint px-3.5 py-2 text-[13px]">
                  and {result.problems.length - 40} more.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {result?.ok && (
        <div className="border-line bg-surface mt-5 rounded-xl border p-4">
          <p className="text-[14px] font-semibold">
            {result.created} {result.created === 1 ? 'row' : 'rows'} added.
          </p>

          {result.passwords && result.passwords.length > 0 && (
            <>
              <p className="text-muted mt-2 text-[13px] leading-relaxed">
                These are shown once. Copy them now — they are stored as hashes and cannot be read back. Anyone who
                misses theirs can be reset from Manage → Staff.
              </p>
              <pre className="border-line bg-paper mt-3 overflow-x-auto rounded-lg border p-3 text-[13px] leading-relaxed select-all">
                {result.passwords.map((p) => `${p.username}  ${p.password}`).join('\n')}
              </pre>
            </>
          )}

          <Button onClick={() => setResult(null)}>Import something else</Button>
        </div>
      )}
    </Panel>
  )
}
