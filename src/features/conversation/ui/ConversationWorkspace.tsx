import { useEffect, useState } from 'react'
import { HistoryOutlined, SettingOutlined } from '@ant-design/icons'
import { Button, Card, Col, Layout, Row, Space, Tag, Typography } from 'antd'
import { Composer } from '../../../components/chat/Composer'
import { MessageList } from '../../../components/chat/MessageList'
import { ImagePreviewModal } from '../../../components/preview/ImagePreviewModal'
import { SettingsPanel } from '../../../components/settings/SettingsPanel'
import { ConversationList } from '../../../components/sidebar/ConversationList'
import { useImagePreview } from '../../../hooks/useImagePreview'
import { useConversationController } from './useConversationController'

const { Header, Sider, Content } = Layout
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
    isSendBlocked,
    panelBatchError,
    panelMismatchRowIds,
    retryRun,
    editRunTemplate,
    replayRunAsNewMessage,
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

  return (
    <Layout className="app-shell">
      {!isLeftPanelCollapsed ? (
        <Sider width={280} className="panel">
          <ConversationList
            summaries={summaries}
            activeId={activeId}
            onCreateConversation={createNewConversation}
            onClearAllConversations={clearAllConversations}
            onDeleteConversation={removeConversation}
            onSwitchConversation={switchConversation}
          />
        </Sider>
      ) : null}

      <Layout className="panel-center">
        <Header className="chat-header">
          <div className="chat-header-row chat-header-ant">
            <Card size="small" className="chat-header-card" bordered={false}>
              <div className="chat-header-card-content">
                <Space size={8} wrap>
                  <Button icon={<HistoryOutlined />} onClick={() => setIsLeftPanelCollapsed((prev) => !prev)}>
                    {isLeftPanelCollapsed ? '展开左侧面板' : '收起左侧面板'}
                  </Button>
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
        </Header>

        <Content className={`chat-body ${activeSideMode === 'multi' ? 'chat-body-multi' : ''}`}>
          {activeSideMode === 'multi' ? (
            <Row gutter={[12, 12]} wrap={false} className="ab-windows-row">
              {activeSides.map((sideId, index) => (
                <Col key={sideId} flex={`0 0 ${100 / activeSideCount}%`} className="ab-window-col">
                  <Card title={`Window ${index + 1}`} size="small" className="ab-window-card">
                    <MessageList
                      activeConversation={activeConversation}
                      sideView={sideId}
                      onOpenPreview={openPreview}
                      onRetryRun={retryRun}
                      onEditRunTemplate={editRunTemplate}
                      onReplayRun={replayRunAsNewMessage}
                      replayingRunIds={replayingRunIds}
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
              onRetryRun={retryRun}
              onEditRunTemplate={editRunTemplate}
              onReplayRun={replayRunAsNewMessage}
              replayingRunIds={replayingRunIds}
            />
          )}
        </Content>

        <Composer
          draft={draft}
          sendError={sendError}
          isSending={isSending}
          isSendBlocked={isSendBlocked}
          panelBatchError={panelBatchError}
          panelMismatchRowIds={panelMismatchRowIds}
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
          onSend={sendDraft}
        />
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




