import {
  applyChannelImport,
  buildChannelImportPreview,
  parseApiChannelsFromText,
} from '../../../services/channelImport'
import {
  getAspectRatioOptions,
  getComputedPresetResolution,
  getSizeTierOptions,
  normalizeSizeTier,
} from '../../../services/imageSizing'
import { isSaveDirectoryReady, pickSaveDirectory } from '../../../services/imageSave'
import { resolveProviderId } from '../../../services/providers/providerId'
import { makeId } from '../../../utils/chat'
import { conversationModelCatalogPort } from './ports/modelCatalogPort'
export type { ChannelModelEntry } from '../../../services/channelModels'
export type { ChannelImportPreviewItem } from '../../../services/channelImport'

export interface SettingsPanelService {
  fetchChannelModels: typeof conversationModelCatalogPort.fetchChannelModels
  fetchChannelModelEntries: typeof conversationModelCatalogPort.fetchChannelModelEntries
  resolveProviderId: typeof resolveProviderId
  parseApiChannelsFromText: typeof parseApiChannelsFromText
  buildChannelImportPreview: typeof buildChannelImportPreview
  applyChannelImport: typeof applyChannelImport
  getAspectRatioOptions: typeof getAspectRatioOptions
  getComputedPresetResolution: typeof getComputedPresetResolution
  getSizeTierOptions: typeof getSizeTierOptions
  normalizeSizeTier: typeof normalizeSizeTier
  isSaveDirectoryReady: typeof isSaveDirectoryReady
  pickSaveDirectory: typeof pickSaveDirectory
  makeId: typeof makeId
}

export function createSettingsPanelService(): SettingsPanelService {
  return {
    fetchChannelModels: conversationModelCatalogPort.fetchChannelModels,
    fetchChannelModelEntries: conversationModelCatalogPort.fetchChannelModelEntries,
    resolveProviderId,
    parseApiChannelsFromText,
    buildChannelImportPreview,
    applyChannelImport,
    getAspectRatioOptions,
    getComputedPresetResolution,
    getSizeTierOptions,
    normalizeSizeTier,
    isSaveDirectoryReady,
    pickSaveDirectory,
    makeId,
  }
}

export const settingsPanelService = createSettingsPanelService()
