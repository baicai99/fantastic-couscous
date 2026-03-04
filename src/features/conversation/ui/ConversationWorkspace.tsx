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
    variableMode,
    tableVariables,
    inlineVariablesText,
    panelVariables,
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
    setVariableMode,
    setTableVariables,
    setInlineVariablesText,
    setPanelVariables,
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
    zoom,
    offset,
    isDragging,
    dragOriginRef,
    currentPreviewImage,
    currentPreviewPair,
    previewHint,
    setZoom,
    setOffset,
    setIsDragging,
    openPreview,
    closePreview,
    goPrevPreview,
    goNextPreview,
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
                    {isLeftPanelCollapsed ? '展开历史栏' : '收起历史栏'}
                  </Button>
                  <Button icon={<SettingOutlined />} onClick={() => setIsRightPanelCollapsed((prev) => !prev)}>
                    {isRightPanelCollapsed ? '展开设置栏' : '收起设置栏'}
                  </Button>
                </Space>
                <Space size={10} wrap>
                  <Text type="secondary">当前会话</Text>
                  <Tag color="blue">{activeConversation ? '已选择' : '未选择'}</Tag>
                  <Title level={5} className="panel-title">
                    {activeConversation?.title ?? '未选择对话'}
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
                  <Card title={`窗口 ${index + 1}`} size="small" className="ab-window-card">
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
          showAdvancedVariables={showAdvancedVariables}
          variableMode={variableMode}
          tableVariables={tableVariables}
          inlineVariablesText={inlineVariablesText}
          panelVariables={panelVariables}
          resolvedVariables={resolvedVariables}
          finalPromptPreview={templatePreview.ok ? templatePreview.finalPrompt : ''}
          missingKeys={templatePreview.missingKeys}
          unusedVariableKeys={unusedVariableKeys}
          onDraftChange={setDraft}
          onVariableModeChange={setVariableMode}
          onTableVariablesChange={setTableVariables}
          onInlineVariablesTextChange={setInlineVariablesText}
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
            onSideModeChange={updateSideMode}
            onSideCountChange={updateSideCount}
            onSettingsChange={updateSideSettings}
            onModelChange={setSideModel}
            onModelParamChange={setSideModelParam}
            onChannelsChange={setChannels}
            onShowAdvancedVariablesChange={setShowAdvancedVariables}
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
        zoom={zoom}
        offset={offset}
        setZoom={setZoom}
        setOffset={setOffset}
        isDragging={isDragging}
        setIsDragging={setIsDragging}
        dragOriginRef={dragOriginRef}
      />
    </Layout>
  )
}
