import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { SettingOutlined } from '@ant-design/icons'
import { Button, Card, Col, Layout, Row } from 'antd'
import { Composer } from '../../../components/chat/Composer'
import { FavoriteModelPill } from '../../../components/chat/FavoriteModelPill'
import { MessageList } from '../../../components/chat/MessageList'
import { ImagePreviewModal } from '../../../components/preview/ImagePreviewModal'
import { SettingsPanel } from '../../../components/settings/SettingsPanel'
import { ConversationList } from '../../../components/sidebar/ConversationList'
import { SidebarShell } from '../../../components/sidebar/SidebarShell'
import { useImagePreview } from '../../../hooks/useImagePreview'
import { useDebouncedCallback } from '../../../hooks/useDebouncedCallback'
import { usePersistentPanelMode } from '../../../hooks/usePersistentPanelMode'
import type { MessageAction } from '../../../types/chat'
import { useConversationController } from './useConversationController'

const { Content } = Layout
const LEFT_PANEL_COLLAPSED_STORAGE_KEY = 'm3:left-panel-collapsed'
const RIGHT_PANEL_COLLAPSED_STORAGE_KEY = 'm3:right-panel-collapsed'
const SETTINGS_SIDER_EXPANDED_WIDTH = 320
const SETTINGS_SIDER_MINI_WIDTH = 56

interface MultiRenderProfile {
  runInitialLimit: number
  runPageSize: number
  imageInitialLimit: number
  imagePageSize: number
  messageWindowSize: number
  messageOverscan: number
}

const COMPOSER_MAX_WIDTH_PX = 920
const COMPOSER_MIN_WIDTH_PX = COMPOSER_MAX_WIDTH_PX / 2

function extractImageFilesFromTransfer(dataTransfer: DataTransfer | null): File[] {
  if (!dataTransfer) {
    return []
  }
  return Array.from(dataTransfer.files ?? []).filter((file) => file.type.toLowerCase().startsWith('image/'))
}

function hasImageFileInTransfer(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) {
    return false
  }
  if (extractImageFilesFromTransfer(dataTransfer).length > 0) {
    return true
  }
  return Array.from(dataTransfer.items ?? []).some(
    (item) => item.kind === 'file' && item.type.toLowerCase().startsWith('image/'),
  )
}

function resolveMultiRenderProfile(sideCount: number): MultiRenderProfile {
  if (sideCount >= 4) {
    return {
      runInitialLimit: 8,
      runPageSize: 8,
      imageInitialLimit: 12,
      imagePageSize: 12,
      messageWindowSize: 16,
      messageOverscan: 6,
    }
  }

  if (sideCount >= 3) {
    return {
      runInitialLimit: 10,
      runPageSize: 10,
      imageInitialLimit: 14,
      imagePageSize: 14,
      messageWindowSize: 18,
      messageOverscan: 7,
    }
  }

  return {
    runInitialLimit: 12,
    runPageSize: 12,
    imageInitialLimit: 16,
    imagePageSize: 16,
    messageWindowSize: 20,
    messageOverscan: 8,
  }
}

function isSourceImageFeatureEnabled(input: {
  sideMode: 'single' | 'multi'
  sideCount: number
  settingsBySide: Record<string, { generationMode?: 'image' | 'text' } | undefined>
}): boolean {
  if (input.sideMode === 'single') {
    return input.settingsBySide.single?.generationMode !== 'text'
  }
  const sides = Array.from({ length: Math.max(2, input.sideCount) }, (_, index) => `win-${index + 1}`)
  return sides.every((side) => input.settingsBySide[side]?.generationMode !== 'text')
}

export function ConversationWorkspace() {
  const { mode: leftPanelMode, setMode: setLeftPanelMode, toggleMode: toggleLeftPanelMode } = usePersistentPanelMode({
    storageKey: LEFT_PANEL_COLLAPSED_STORAGE_KEY,
    defaultMode: 'expanded',
  })
  const { mode: rightPanelMode, setMode: setRightPanelMode, toggleMode: toggleRightPanelMode } = usePersistentPanelMode({
    storageKey: RIGHT_PANEL_COLLAPSED_STORAGE_KEY,
    defaultMode: 'expanded',
  })
  const composerLayerRef = useRef<HTMLDivElement | null>(null)
  const globalImageDragDepthRef = useRef(0)
  const [composerInset, setComposerInset] = useState(170)
  const [composerPreferredWidth, setComposerPreferredWidth] = useState(COMPOSER_MIN_WIDTH_PX)
  const [openAddChannelModalSignal, setOpenAddChannelModalSignal] = useState(0)
  const [isGlobalImageDragging, setIsGlobalImageDragging] = useState(false)
  const debouncedSetComposerInset = useDebouncedCallback((nextInset: number) => {
    setComposerInset((prev) => (prev === nextInset ? prev : nextInset))
  }, 80)

  const {
    summaries,
    activeConversation,
    shouldConfirmCreateConversation,
    activeId,
    draft,
    draftSourceImages,
    sendError,
    isSending,
    showAdvancedVariables,
    dynamicPromptEnabled,
    panelValueFormat,
    panelVariables,
    favoriteModelIds,
    runConcurrency,
    historyVisibleLimit,
    historyPageSize,
    sendScrollTrigger,
    resolvedVariables,
    templatePreview,
    unusedVariableKeys,
    activeSideMode,
    activeSideCount,
    activeSides,
    isSideConfigLocked,
    activeSettingsBySide,
    modelCatalog,
    channels,
    setDraft,
    appendDraftSourceImages,
    removeDraftSourceImage,
    clearDraftSourceImages,
    setShowAdvancedVariables,
    setDynamicPromptEnabled,
    setPanelValueFormat,
    setPanelVariables,
    setFavoriteModelIds,
    setRunConcurrency,
    createNewConversation,
    clearAllConversations,
    removeConversation,
    renameConversation,
    togglePinConversation,
    switchConversation,
    updateSideMode,
    updateSideCount,
    updateSideSettings,
    setGenerationMode,
    setSideModel,
    applyModelShortcut,
    setSideModelParam,
    setChannels,
    sendDraft,
    loadOlderMessages,
    isSendBlocked,
    panelBatchError,
    panelMismatchRowIds,
    retryRun,
    replayRunAsNewMessage,
    downloadAllRunImages,
    downloadMessageRunImages,
    downloadSingleRunImage,
    downloadBatchRunImages,
    replayingRunIds,
  } = useConversationController()

  const {
    isPreviewOpen,
    previewMode,
    previewImages,
    previewPairs,
    interactionMode,
    zoom,
    offset,
    isDragging,
    dragOriginRef,
    currentPreviewImage,
    currentPreviewPair,
    previewHint,
    openPreview,
    closePreview,
    goPrevPreview,
    goNextPreview,
    goFirstPreview,
    goLastPreview,
    resetTransform,
    zoomBy,
    panBy,
    panTo,
    toggleFitMode,
    setIsDragging,
  } = useImagePreview()

  const modelNameById = useMemo(() => {
    return new Map(modelCatalog.models.map((model) => [model.id, model.name]))
  }, [modelCatalog.models])
  const multiRenderProfile = useMemo(() => resolveMultiRenderProfile(activeSideCount), [activeSideCount])
  const currentFavoriteModelId = useMemo(() => {
    const primarySide = activeSideMode === 'single' ? 'single' : activeSides[0]
    return primarySide ? activeSettingsBySide[primarySide]?.modelId ?? '' : ''
  }, [activeSettingsBySide, activeSideMode, activeSides])
  const isEmptyConversation = !activeConversation || activeConversation.messages.length === 0
  const sourceImagesEnabled = useMemo(
    () =>
      isSourceImageFeatureEnabled({
        sideMode: activeSideMode,
        sideCount: activeSideCount,
        settingsBySide: activeSettingsBySide as Record<string, { generationMode?: 'image' | 'text' } | undefined>,
      }),
    [activeSettingsBySide, activeSideCount, activeSideMode],
  )
  const activeGenerationMode = sourceImagesEnabled ? 'image' : 'text'
  const chatStageStyle = useMemo(
    () =>
      ({
        '--chat-composer-safe-area': `${composerInset}px`,
        '--chat-composer-target-width': `${composerPreferredWidth}px`,
        '--chat-composer-min-width': `${COMPOSER_MIN_WIDTH_PX}px`,
        '--chat-composer-max-width': `${COMPOSER_MAX_WIDTH_PX}px`,
      }) as CSSProperties,
    [composerInset, composerPreferredWidth],
  )

  useEffect(() => {
    const node = composerLayerRef.current
    if (!node) {
      return undefined
    }

    const measureInset = () => Math.ceil(node.getBoundingClientRect().height) + 24
    const updateInsetImmediate = () => {
      const nextInset = measureInset()
      setComposerInset((prev) => (prev === nextInset ? prev : nextInset))
    }
    const updateInset = () => {
      debouncedSetComposerInset(measureInset())
    }

    updateInsetImmediate()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateInset)
      return () => {
        window.removeEventListener('resize', updateInset)
        debouncedSetComposerInset.cancel()
      }
    }

    const observer = new ResizeObserver(() => {
      updateInset()
    })
    observer.observe(node)
    window.addEventListener('resize', updateInset)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateInset)
      debouncedSetComposerInset.cancel()
    }
  }, [debouncedSetComposerInset])

  useEffect(() => {
    const resetGlobalImageDragState = () => {
      globalImageDragDepthRef.current = 0
      setIsGlobalImageDragging(false)
    }

    const handleDragEnter = (event: DragEvent) => {
      if (!hasImageFileInTransfer(event.dataTransfer)) {
        return
      }
      event.preventDefault()
      globalImageDragDepthRef.current += 1
      setIsGlobalImageDragging(true)
    }

    const handleDragOver = (event: DragEvent) => {
      if (!hasImageFileInTransfer(event.dataTransfer)) {
        return
      }
      event.preventDefault()
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy'
      }
      setIsGlobalImageDragging(true)
    }

    const handleDragLeave = (event: DragEvent) => {
      if (hasImageFileInTransfer(event.dataTransfer)) {
        globalImageDragDepthRef.current = Math.max(0, globalImageDragDepthRef.current - 1)
      } else {
        globalImageDragDepthRef.current = 0
      }
      if (globalImageDragDepthRef.current === 0) {
        setIsGlobalImageDragging(false)
      }
    }

    const handleDrop = (event: DragEvent) => {
      const imageFiles = extractImageFilesFromTransfer(event.dataTransfer)
      if (imageFiles.length === 0) {
        resetGlobalImageDragState()
        return
      }
      event.preventDefault()
      appendDraftSourceImages(imageFiles)
      resetGlobalImageDragState()
    }

    window.addEventListener('dragenter', handleDragEnter)
    window.addEventListener('dragover', handleDragOver)
    window.addEventListener('dragleave', handleDragLeave)
    window.addEventListener('drop', handleDrop)
    window.addEventListener('dragend', resetGlobalImageDragState)

    return () => {
      window.removeEventListener('dragenter', handleDragEnter)
      window.removeEventListener('dragover', handleDragOver)
      window.removeEventListener('dragleave', handleDragLeave)
      window.removeEventListener('drop', handleDrop)
      window.removeEventListener('dragend', resetGlobalImageDragState)
    }
  }, [appendDraftSourceImages])

  const handleTopSettingsClick = () => {
    toggleRightPanelMode()
  }

  const openSettingsPanel = () => {
    setRightPanelMode('expanded')
  }

  const handleAssistantMessageAction = (action: MessageAction) => {
    openSettingsPanel()
    if (action.type === 'add-api') {
      setOpenAddChannelModalSignal((prev) => prev + 1)
    }
  }

  return (
    <Layout className="app-shell">
      <SidebarShell
        side="left"
        mode={leftPanelMode}
        expandedWidth={280}
        collapsedWidth={52}
        onModeChange={setLeftPanelMode}
        breakpoint="lg"
        autoModeByBreakpoint
        expandedContent={
          <ConversationList
            summaries={summaries}
            activeId={activeId}
            viewMode="expanded"
            onToggleCollapse={toggleLeftPanelMode}
            shouldConfirmCreateConversation={shouldConfirmCreateConversation}
            onCreateConversation={createNewConversation}
            onClearAllConversations={clearAllConversations}
            onDeleteConversation={removeConversation}
            onRenameConversation={renameConversation}
            onTogglePinConversation={togglePinConversation}
            onSwitchConversation={switchConversation}
          />
        }
        collapsedContent={
          <ConversationList
            summaries={summaries}
            activeId={activeId}
            viewMode="collapsed"
            onToggleCollapse={toggleLeftPanelMode}
            shouldConfirmCreateConversation={shouldConfirmCreateConversation}
            onCreateConversation={createNewConversation}
            onClearAllConversations={clearAllConversations}
            onDeleteConversation={removeConversation}
            onRenameConversation={renameConversation}
            onTogglePinConversation={togglePinConversation}
            onSwitchConversation={switchConversation}
          />
        }
      />

      <Layout className="panel-center">
        <div className={`chat-stage ${isEmptyConversation ? 'chat-stage-empty' : ''}`} style={chatStageStyle}>
          {isGlobalImageDragging ? (
            <div className="chat-image-drop-overlay" role="status" aria-live="polite">
              <div className="chat-image-drop-overlay-card">拖拽图片到任意位置即可上传（最多 6 张）</div>
            </div>
          ) : null}
          <div className="chat-favorite-model-layer">
            <FavoriteModelPill
              currentModelId={currentFavoriteModelId}
              models={modelCatalog.models}
              favoriteModelIds={favoriteModelIds}
              onSelectModel={applyModelShortcut}
              onFavoriteModelIdsChange={setFavoriteModelIds}
            />
          </div>
          <Content className={`chat-body ${activeSideMode === 'multi' ? 'chat-body-multi' : ''}`}>
            {activeSideMode === 'multi' ? (
              <Row gutter={[12, 12]} wrap={false} className="ab-windows-row">
                {activeSides.map((sideId, index) => (
                  <Col key={sideId} flex={`0 0 ${100 / activeSideCount}%`} className="ab-window-col">
                    <Card
                      title={modelNameById.get(activeSettingsBySide[sideId]?.modelId) ?? `Window ${index + 1}`}
                      size="small"
                      className="ab-window-card"
                    >
                      <MessageList
                        activeConversation={activeConversation}
                        sideView={sideId}
                        onOpenPreview={openPreview}
                        onUseUserPrompt={setDraft}
                        onRetryRun={retryRun}
                        onReplayRun={replayRunAsNewMessage}
                        onDownloadAllRun={downloadAllRunImages}
                        onDownloadMessageImages={downloadMessageRunImages}
                        onDownloadSingleImage={downloadSingleRunImage}
                        onDownloadBatchRun={downloadBatchRunImages}
                        replayingRunIds={replayingRunIds}
                        initialMessageLimit={historyVisibleLimit}
                        messagePageSize={historyPageSize}
                        windowSize={multiRenderProfile.messageWindowSize}
                        overscan={multiRenderProfile.messageOverscan}
                        multiRunInitialLimit={multiRenderProfile.runInitialLimit}
                        multiRunPageSize={multiRenderProfile.runPageSize}
                        multiImageInitialLimit={multiRenderProfile.imageInitialLimit}
                        multiImagePageSize={multiRenderProfile.imagePageSize}
                        autoScrollTrigger={sendScrollTrigger}
                        onLoadOlderMessages={loadOlderMessages}
                        onAssistantMessageAction={handleAssistantMessageAction}
                      />
                    </Card>
                  </Col>
                ))}
              </Row>
            ) : (
              <MessageList
                activeConversation={activeConversation}
                sideView="single"
                onOpenPreview={openPreview}
                onUseUserPrompt={setDraft}
                onRetryRun={retryRun}
                onReplayRun={replayRunAsNewMessage}
                onDownloadAllRun={downloadAllRunImages}
                onDownloadMessageImages={downloadMessageRunImages}
                onDownloadSingleImage={downloadSingleRunImage}
                onDownloadBatchRun={downloadBatchRunImages}
                replayingRunIds={replayingRunIds}
                initialMessageLimit={historyVisibleLimit}
                messagePageSize={historyPageSize}
                autoScrollTrigger={sendScrollTrigger}
                onLoadOlderMessages={loadOlderMessages}
                onAssistantMessageAction={handleAssistantMessageAction}
              />
            )}
          </Content>

          <div
            ref={composerLayerRef}
            className={`chat-composer-layer ${isEmptyConversation ? 'chat-composer-layer-empty' : ''}`}
          >
            <Composer
              draft={draft}
              sourceImages={draftSourceImages}
              sendError={sendError}
              models={modelCatalog.models}
              isSending={isSending}
              isSendBlocked={isSendBlocked}
              panelBatchError={panelBatchError}
              panelMismatchRowIds={panelMismatchRowIds}
              sideMode={activeSideMode}
              isSideConfigLocked={isSideConfigLocked}
              showAdvancedVariables={showAdvancedVariables}
              dynamicPromptEnabled={dynamicPromptEnabled}
              generationMode={activeGenerationMode}
              panelValueFormat={panelValueFormat}
              panelVariables={panelVariables}
              resolvedVariables={resolvedVariables}
              finalPromptPreview={templatePreview.ok ? templatePreview.finalPrompt : ''}
              missingKeys={templatePreview.missingKeys}
              unusedVariableKeys={unusedVariableKeys}
              onDraftChange={setDraft}
              onSourceImagesAppend={appendDraftSourceImages}
              onSourceImageRemove={removeDraftSourceImage}
              onSourceImagesClear={clearDraftSourceImages}
              onPanelValueFormatChange={setPanelValueFormat}
              onPanelVariablesChange={setPanelVariables}
              onDynamicPromptEnabledChange={setDynamicPromptEnabled}
              onGenerationModeChange={setGenerationMode}
              onSideModeChange={updateSideMode}
              sourceImagesEnabled={sourceImagesEnabled}
              isAtMaxWidth={composerPreferredWidth >= COMPOSER_MAX_WIDTH_PX}
              onPreferredWidthChange={(nextWidth) => {
                const clampedWidth = Math.max(COMPOSER_MIN_WIDTH_PX, Math.min(COMPOSER_MAX_WIDTH_PX, nextWidth))
                setComposerPreferredWidth((prev) => (prev === clampedWidth ? prev : clampedWidth))
              }}
              onSend={sendDraft}
            />
          </div>
        </div>
      </Layout>

      <SidebarShell
        side="right"
        mode={rightPanelMode}
        expandedWidth={SETTINGS_SIDER_EXPANDED_WIDTH}
        collapsedWidth={SETTINGS_SIDER_MINI_WIDTH}
        onModeChange={setRightPanelMode}
        className="settings-sider"
        expandedContent={
          <SettingsPanel
            sideMode={activeSideMode}
            sideCount={activeSideCount}
            sideIds={activeSides.filter((side) => side !== 'single')}
            isSideConfigLocked={isSideConfigLocked}
            settingsBySide={activeSettingsBySide}
            models={modelCatalog.models}
            channels={channels}
            showAdvancedVariables={showAdvancedVariables}
            dynamicPromptEnabled={dynamicPromptEnabled}
            runConcurrency={runConcurrency}
            onSideModeChange={updateSideMode}
            onSideCountChange={updateSideCount}
            onSettingsChange={updateSideSettings}
            onModelChange={setSideModel}
            onModelParamChange={setSideModelParam}
            onChannelsChange={setChannels}
            onShowAdvancedVariablesChange={setShowAdvancedVariables}
            onDynamicPromptEnabledChange={setDynamicPromptEnabled}
            onRunConcurrencyChange={setRunConcurrency}
            onTogglePanelMode={handleTopSettingsClick}
            openAddChannelModalSignal={openAddChannelModalSignal}
          />
        }
        collapsedContent={
          <div className="settings-mini-content">
            <Button
              className="settings-header-btn"
              type="text"
              icon={<SettingOutlined />}
              onClick={handleTopSettingsClick}
              title="Settings"
              aria-label="Settings"
            />
          </div>
        }
      />

      <ImagePreviewModal
        isPreviewOpen={isPreviewOpen}
        previewMode={previewMode}
        closePreview={closePreview}
        goPrevPreview={goPrevPreview}
        goNextPreview={goNextPreview}
        previewImages={previewImages}
        previewPairs={previewPairs}
        previewHint={previewHint}
        currentPreviewImage={currentPreviewImage}
        currentPreviewPair={currentPreviewPair}
        interactionMode={interactionMode}
        zoom={zoom}
        offset={offset}
        goFirstPreview={goFirstPreview}
        goLastPreview={goLastPreview}
        resetTransform={resetTransform}
        zoomBy={zoomBy}
        panBy={panBy}
        panTo={panTo}
        toggleFitMode={toggleFitMode}
        isDragging={isDragging}
        setIsDragging={setIsDragging}
        dragOriginRef={dragOriginRef}
      />
    </Layout>
  )
}
