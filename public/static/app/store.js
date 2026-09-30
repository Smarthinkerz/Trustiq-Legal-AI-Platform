import { getLang } from './i18n.js'

// Global client state. `me` is the /api/auth/me payload; `ref` is /api/reference.
export const store = {
  me: null,
  ref: null
}

export const role = () => store.me?.user.role
export const can = (...roles) => roles.includes(role())
export const canManageTeam = () => can('owner', 'admin')
export const canDelete = () => can('owner', 'admin', 'lawyer')

export function refLabel(listName, id) {
  if (!id) return ''
  const item = store.ref?.[listName]?.find((x) => (x.code ?? x.id) === id)
  if (!item) return id
  return getLang() === 'ar' ? item.name_ar : item.name
}

export function refOptions(listName) {
  return (store.ref?.[listName] ?? []).map((x) => ({ value: x.code ?? x.id, label: getLang() === 'ar' ? x.name_ar : x.name }))
}

export const aiEnabled = () => !!store.me?.features.ai
export const readOnly = () => !!(store.me?.org.trial_expired || store.me?.org.subscription_expired)
export const isClient = () => role() === 'client'
export const isStaff = () => !!store.me && role() !== 'client'
