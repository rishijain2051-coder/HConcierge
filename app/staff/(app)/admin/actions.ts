'use server'

import { revalidatePath } from 'next/cache'
import { requireManager, type Department, type Role } from '@/lib/auth'
import * as admin from '@/lib/admin'
import * as escalation from '@/lib/escalation'
import * as orgs from '@/lib/organisations'
import * as teams from '@/lib/departments'
import { enterOrganisation as setOrganisation, requirePlatform } from '@/lib/auth'

/**
 * Thin wrappers: every one re-reads the session server-side, so the panel's
 * own UI state can never be the thing that decides what someone may do.
 * The real rules live in lib/admin.ts.
 */

const touched = () => {
  revalidatePath('/staff/admin', 'layout')
  revalidatePath('/staff/board')
}

/* -------------------------------------------------------------------- staff */

export async function createStaff(input: {
  name: string
  username: string
  role: Role
  department: Department
  extraTeams?: string[]
  propertyId: string | null
  phone: string | null
  password?: string
}) {
  const actor = await requireManager()
  const res = await admin.createStaff(actor, input)
  if (res.ok) touched()
  return res
}

export async function updateStaff(
  id: string,
  input: {
    name: string
    role: Role
    department: Department
    extraTeams?: string[]
    propertyId: string | null
    phone: string | null
  },
) {
  const actor = await requireManager()
  const res = await admin.updateStaff(actor, id, input)
  if (res.ok) touched()
  return res
}

export async function setStaffActive(id: string, active: boolean) {
  const actor = await requireManager()
  const res = await admin.setStaffActive(actor, id, active)
  if (res.ok) touched()
  return res
}

export async function resetStaffPassword(id: string) {
  const actor = await requireManager()
  const res = await admin.resetStaffPassword(actor, id)
  if (res.ok) touched()
  return res
}

export async function unlockStaff(id: string) {
  const actor = await requireManager()
  const res = await admin.unlockStaff(actor, id)
  if (res.ok) touched()
  return res
}

export async function sendPhoneCode(id: string) {
  const actor = await requireManager()
  const res = await admin.requestPhoneVerification(actor, id)
  if (res.ok) touched()
  return res
}

/* --------------------------------------------------------------- properties */

export async function createProperty(input: admin.PropertyInput, copyCatalogFrom: string | null) {
  const actor = await requireManager()
  const res = await admin.createProperty(actor, input, copyCatalogFrom)
  if (res.ok) touched()
  return res
}

export async function updateProperty(id: string, input: admin.PropertyInput) {
  const actor = await requireManager()
  const res = await admin.updateProperty(actor, id, input)
  if (res.ok) touched()
  return res
}

/* ------------------------------------------------------------------ catalog */

export async function createItem(categoryId: string, input: admin.ItemInput) {
  const actor = await requireManager()
  const res = await admin.createItem(actor, categoryId, input)
  if (res.ok) touched()
  return res
}

export async function updateItem(id: string, input: admin.ItemInput) {
  const actor = await requireManager()
  const res = await admin.updateItem(actor, id, input)
  if (res.ok) touched()
  return res
}

export async function deleteItem(id: string) {
  const actor = await requireManager()
  const res = await admin.deleteItem(actor, id)
  if (res.ok) touched()
  return res
}

export async function createCategory(propertyId: string, input: { kind: string; name: string; icon: string | null }) {
  const actor = await requireManager()
  const res = await admin.createCategory(actor, propertyId, input)
  if (res.ok) touched()
  return res
}

export async function updateCategory(
  id: string,
  input: { kind: string; name: string; icon: string | null; active: boolean },
) {
  const actor = await requireManager()
  const res = await admin.updateCategory(actor, id, input)
  if (res.ok) touched()
  return res
}

export async function deleteCategory(id: string) {
  const actor = await requireManager()
  const res = await admin.deleteCategory(actor, id)
  if (res.ok) touched()
  return res
}

/* --------------------------------------------------------------- info pages */

export async function saveInfoPage(
  propertyId: string,
  input: { id?: string | null; slug: string; title: string; body: string; icon: string | null; active: boolean },
) {
  const actor = await requireManager()
  const res = await admin.saveInfoPage(actor, propertyId, input)
  if (res.ok) touched()
  return res
}

export async function deleteInfoPage(id: string) {
  const actor = await requireManager()
  const res = await admin.deleteInfoPage(actor, id)
  if (res.ok) touched()
  return res
}

/* --------------------------------------------------------------- escalation */

export async function saveEscalationRule(propertyId: string, input: escalation.EscalationInput) {
  const actor = await requireManager()
  const res = await escalation.saveEscalationRule(actor, propertyId, input)
  if (res.ok) touched()
  return res
}

export async function deleteEscalationRule(id: string) {
  const actor = await requireManager()
  const res = await escalation.deleteEscalationRule(actor, id)
  if (res.ok) touched()
  return res
}

export async function setWarnThreshold(propertyId: string, percent: number) {
  const actor = await requireManager()
  const res = await escalation.setWarnThreshold(actor, propertyId, percent)
  if (res.ok) touched()
  return res
}

/* ------------------------------------------------------------ organisations */

export async function createOrganisation(input: {
  name: string
  slug: string
  adminName: string
  adminUsername: string
}) {
  const actor = await requirePlatform()
  const res = await orgs.createOrganisation(actor, input)
  if (res.ok) touched()
  return res
}

/**
 * Step into a customer, or back out to the list. Everything else in the panel
 * reads the session, so this one cookie is all it takes for HConcierge to work
 * inside an organisation instead of across all of them.
 */
export async function enterOrganisation(id: string | null) {
  await requirePlatform()
  await setOrganisation(id)
  touched()
  return { ok: true as const }
}

export async function updateOrganisation(id: string, name: string) {
  const actor = await requirePlatform()
  const res = await orgs.updateOrganisation(actor, id, name)
  if (res.ok) touched()
  return res
}

/* ------------------------------------------------------------------ teams */

export async function createTeam(name: string) {
  const actor = await requireManager()
  const res = await teams.createTeam(actor, name)
  if (res.ok) touched()
  return res
}

export async function renameTeam(id: string, name: string) {
  const actor = await requireManager()
  const res = await teams.renameTeam(actor, id, name)
  if (res.ok) touched()
  return res
}

export async function setTeamActive(id: string, active: boolean) {
  const actor = await requireManager()
  const res = await teams.setTeamActive(actor, id, active)
  if (res.ok) touched()
  return res
}
