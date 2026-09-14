'use server'

import { requireStaff } from '@/lib/auth'
import {
  assignRequest,
  loadRoomThread,
  markThreadRead,
  replyToRoom,
  setRequestStatus,
} from '@/lib/board'
import type { RequestStatus } from '@/lib/types'

export async function updateStatus(requestId: string, status: RequestStatus, reason?: string) {
  const staff = await requireStaff()
  return setRequestStatus(staff, requestId, status, reason)
}

export async function assign(requestId: string, toStaffId: string | null) {
  const staff = await requireStaff()
  return assignRequest(staff, requestId, toStaffId)
}

export async function openThread(roomId: string) {
  const staff = await requireStaff()
  const messages = await loadRoomThread(staff, roomId)
  await markThreadRead(staff, roomId)
  return messages
}

export async function reply(roomId: string, body: string) {
  const staff = await requireStaff()
  return replyToRoom(staff, roomId, body)
}
