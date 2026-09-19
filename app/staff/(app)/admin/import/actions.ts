'use server'

import { revalidatePath } from 'next/cache'
import { requireManager } from '@/lib/auth'
import { importCsv, importStaffCsv, type ImportKind } from '@/lib/bulk'

/**
 * One action for every kind. The file arrives as text rather than as FormData
 * because a server action receiving a File would have to be multipart, and a
 * spreadsheet a hotel is willing to paste into Excel is small enough to send
 * as a string - the importers cap the row count anyway.
 */
export async function runImport(kind: ImportKind, propertyId: string, text: string) {
  const actor = await requireManager()

  // A megabyte of CSV is roughly ten thousand directory rows, well past the
  // limits the importers enforce. Refusing here keeps a pasted binary from
  // being parsed character by character first.
  if (text.length > 1_000_000) {
    return { ok: false as const, error: 'That file is too large. Split it, or check it is really a CSV.' }
  }

  const res = kind === 'staff' ? await importStaffCsv(actor, propertyId, text) : await importCsv(actor, kind, propertyId, text)

  if (res.ok) {
    revalidatePath('/staff/admin', 'layout')
    revalidatePath('/staff/rooms')
    revalidatePath('/staff/board')
  }
  return res
}
