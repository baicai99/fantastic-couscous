import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { SettingOutlined } from '@ant-design/icons'
import { Button, Card, Col, Layout, Row, Space, Tag, Typography } from 'antd'
import { Composer } from '../../../components/chat/Composer'
import { MessageList } from '../../../components/chat/MessageList'
import { ImagePreviewModal } from '../../../components/preview/ImagePreviewModal'
import { SettingsPanel } from '../../../components/settings/SettingsPanel'
import { ConversationList } from '../../../components/sidebar/ConversationList'
import { useImagePreview } from '../../../hooks/useImagePreview'
import { useConversationController } from './useConversationController'

const { Sider, Content } = Layout
const { Text, Title } = Typography
const RIGHT_PANEL_COLLAPSED_STORAGE_KEY = 'm3:right-panel-collapsed'

export function ConversationWorkspace() {
  const [isLeftPanelCollapsed, setIsLeftPanelCollapsed] = useState(false)
  const [isRightPanelCollapsed, setIsRightPanelCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(RIGHT_PANEL_COLLAPSED_STORAGE_KEY) === '1'
    } catch {
      return false
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(RIGHT_PANEL_COLLAPSED_STORAGE_KEY, isRightPanelCollapsed ? '1' : '0')
    } catch {
      // Ignore storage errors in restricted environments.
    }
  }, [isRightPanelCollapsed])
  const composerLayerRef = useRef<HTMLDivElement | null>(null)
  const headerLayerRef = useRef<HTMLDivElement | null>(null)
  const [composerInset, setComposerInset] = useState(170)
  const [headerInset, setHeaderInset] = useState(96)

  const {
    summaries,
    activeConversation,
    activeId,
    draft,
    sendError,
    isSending,
    showAdvancedVariables,
    dynamicPromptEnabled,
    panelValueFormat,
    panelVariables,
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
    setShowAdvancedVariables,
    setDynamicPromptEnabled,
    setPanelValueFormat,
    setPanelVariables,
    setRunConcurrency,
    createNewConversation,
    clearAllConversations,
    removeConversation,
    switchConversation,
    updateSideMode,
    updateSideCount,
    updateSideSettings,
    setSideModel,
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
  const chatStageStyle = useMemo(
    () =>
      ({
        '--chat-composer-safe-area': `${composerInset}px`,
        '--chat-header-safe-area': `${headerInset}px`,
      }) as CSSProperties,
    [composerInset, headerInset],
  )

  useEffect(() => {
    const node = composerLayerRef.current
    if (!node) {
      return undefined
    }

    const updateInset = () => {
      setComposerInset(Math.ceil(node.getBoundingClientRect().height) + 24)
    }

    updateInset()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateInset)
      return () => window.removeEventListener('resize', updateInset)
    }

    const observer = new ResizeObserver(() => {
      updateInset()
    })
    observer.observe(node)
    window.addEventListener('resize', updateInset)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateInset)
    }
  }, [])

  useEffect(() => {
    const node = headerLayerRef.current
    if (!node) {
      return undefined
    }

    const updateInset = () => {
      setHeaderInset(Math.ceil(node.getBoundingClientRect().height) + 24)
    }

    updateInset()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateInset)
      return () => window.removeEventListener('resize', updateInset)
    }

    const observer = new ResizeObserver(() => {
      updateInset()
    })
    observer.observe(node)
    window.addEventListener('resize', updateInset)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateInset)
    }
  }, [])

  return (
    <Layout className="app-shell">
      <Sider
        width={280}
        collapsedWidth={72}
        collapsible
        trigger={null}
        collapsed={isLeftPanelCollapsed}
        breakpoint="lg"
        onBreakpoint={(broken) => setIsLeftPanelCollapsed(broken)}
        className="panel panel-left"
      >
        <ConversationList
          summaries={summaries}
          activeId={activeId}
          isCollapsed={isLeftPanelCollapsed}
          onToggleCollapse={() => setIsLeftPanelCollapsed((prev) => !prev)}
          onCreateConversation={createNewConversation}
          onClearAllConversations={clearAllConversations}
          onDeleteConversation={removeConversation}
          onSwitchConversation={switchConversation}
        />
      </Sider>

      <Layout className="panel-center">
        <div className="chat-stage" style={chatStageStyle}>
          <div ref={headerLayerRef} className="chat-header-layer">
            <div className="chat-header-row chat-header-ant">
              <Card size="small" className="chat-header-card" bordered={false}>
                <div className="chat-header-card-content">
                  <Space size={8} wrap>
                    <Button icon={<SettingOutlined />} onClick={() => setIsRightPanelCollapsed((prev) => !prev)}>
                      {isRightPanelCollapsed ? '展开右侧面板' : '收起右侧面板'}
                    </Button>
                  </Space>
                  <Space size={10} wrap>
                    <Text type="secondary">当前会话</Text>
                    <Tag color="blue">{activeConversation ? '已选中' : '未选择'}</Tag>
                    <Title level={5} className="panel-title">
                      {activeConversation?.title ?? '未选择会话'}
                    </Title>
                  </Space>
                </div>
              </Card>
            </div>
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
                        onDownloadSingleImage={downloadSingleRunImage}
                        onDownloadBatchRun={downloadBatchRunImages}
                        replayingRunIds={replayingRunIds}
                        initialMessageLimit={historyVisibleLimit}
                        messagePageSize={historyPageSize}
                        initialImagesPerRun={6}
                        autoScrollTrigger={sendScrollTrigger}
                        onLoadOlderMessages={loadOlderMessages}
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
                onDownloadSingleImage={downloadSingleRunImage}
                onDownloadBatchRun={downloadBatchRunImages}
                replayingRunIds={replayingRunIds}
                initialMessageLimit={historyVisibleLimit}
                messagePageSize={historyPageSize}
                initialImagesPerRun={6}
                autoScrollTrigger={sendScrollTrigger}
                onLoadOlderMessages={loadOlderMessages}
              />
            )}
          </Content>

          <div ref={composerLayerRef} className="chat-composer-layer">
            <Composer
              draft={draft}
              sendError={sendError}
              isSending={isSending}
              isSendBlocked={isSendBlocked}
              panelBatchError={panelBatchError}
              panelMismatchRowIds={panelMismatchRowIds}
              sideMode={activeSideMode}
              showAdvancedVariables={showAdvancedVariables}
              dynamicPromptEnabled={dynamicPromptEnabled}
              panelValueFormat={panelValueFormat}
              panelVariables={panelVariables}
              resolvedVariables={resolvedVariables}
              finalPromptPreview={templatePreview.ok ? templatePreview.finalPrompt : ''}
              missingKeys={templatePreview.missingKeys}
              unusedVariableKeys={unusedVariableKeys}
              onDraftChange={setDraft}
              onPanelValueFormatChange={setPanelValueFormat}
              onPanelVariablesChange={setPanelVariables}
              onDynamicPromptEnabledChange={setDynamicPromptEnabled}
              onSideModeChange={updateSideMode}
              onSend={sendDraft}
            />
          </div>
        </div>
      </Layout>

      {!isRightPanelCollapsed ? (
        <Sider width={320} className="panel panel-right">
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
          />
        </Sider>
      ) : null}

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
