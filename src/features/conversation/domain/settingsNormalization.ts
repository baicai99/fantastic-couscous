import {
  clampSideCount as clampSideCountInDomain,
  getEffectiveAspectRatio as getEffectiveAspectRatioInDomain,
  getEffectiveSize as getEffectiveSizeInDomain,
  getMultiSideIds as getMultiSideIdsInDomain,
  inferSideCountFromSettings as inferSideCountFromSettingsInDomain,
  normalizeConversation as normalizeConversationInDomain,
  normalizeSettingsBySide as normalizeSettingsBySideInDomain,
  sideIdAt as sideIdAtInDomain,
} from './conversationDomain'

export const clampSideCount = clampSideCountInDomain
export const sideIdAt = sideIdAtInDomain
export const getMultiSideIds = getMultiSideIdsInDomain
export const normalizeSettingsBySide = normalizeSettingsBySideInDomain
export const inferSideCountFromSettings = inferSideCountFromSettingsInDomain
export const normalizeConversation = normalizeConversationInDomain
export const getEffectiveSize = getEffectiveSizeInDomain
export const getEffectiveAspectRatio = getEffectiveAspectRatioInDomain

