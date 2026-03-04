import { Card, Col, Layout, Row, Typography } from 'antd'
import { Composer } from './components/chat/Composer'
import { MessageList } from './components/chat/MessageList'
import { ImagePreviewModal } from './components/preview/ImagePreviewModal'
import { SettingsPanel } from './components/settings/SettingsPanel'
import { ConversationList } from './components/sidebar/ConversationList'
import { useConversations } from './hooks/useConversations'
import { useImagePreview } from './hooks/useImagePreview'
import './App.css'

const { Header, Sider, Content } = Layout
const { Title } = Typography

export default function App() {
  const {
    summaries,
    activeConversation,
    activeId,
    draft,
    sendError,
    showAdvancedVariables,
    variableMode,
    tableVariables,
    inlineVariablesText,
    panelVariables,
    resolvedVariables,
    templatePreview,
    unusedVariableKeys,
    activeSideMode,
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
    switchConversation,
    updateSideMode,
    updateSideSettings,
    setSideModel,
    setSideModelParam,
    setChannels,
    sendDraft,
    retryRun,
  } = useConversations()

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
      <Sider width={280} className="panel">
        <ConversationList
          summaries={summaries}
          activeId={activeId}
          onCreateConversation={createNewConversation}
          onSwitchConversation={switchConversation}
        />
      </Sider>

      <Layout className="panel-center">
        <Header className="chat-header">
          <Title level={5} className="panel-title">
            {activeConversation?.title ?? '未选择对话'}
          </Title>
        </Header>

        <Content className={`chat-body ${activeSideMode === 'ab' ? 'chat-body-ab' : ''}`}>
          {activeSideMode === 'ab' ? (
            <Row gutter={12} className="ab-windows-row">
              <Col span={12} className="ab-window-col">
                <Card title="A" size="small" className="ab-window-card">
                  <MessageList
                    activeConversation={activeConversation}
                    sideView="A"
                    onOpenPreview={openPreview}
                    onRetryRun={retryRun}
                  />
                </Card>
              </Col>
              <Col span={12} className="ab-window-col">
                <Card title="B" size="small" className="ab-window-card">
                  <MessageList
                    activeConversation={activeConversation}
                    sideView="B"
                    onOpenPreview={openPreview}
                    onRetryRun={retryRun}
                  />
                </Card>
              </Col>
            </Row>
          ) : (
            <MessageList
              activeConversation={activeConversation}
              sideView="single"
              onOpenPreview={openPreview}
              onRetryRun={retryRun}
            />
          )}
        </Content>

        <Composer
          draft={draft}
          sendError={sendError}
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

      <Sider width={320} className="panel panel-right">
        <SettingsPanel
          sideMode={activeSideMode}
          settingsBySide={activeSettingsBySide}
          models={modelCatalog.models}
          channels={channels}
          showAdvancedVariables={showAdvancedVariables}
          onSideModeChange={updateSideMode}
          onSettingsChange={updateSideSettings}
          onModelChange={setSideModel}
          onModelParamChange={setSideModelParam}
          onChannelsChange={setChannels}
          onShowAdvancedVariablesChange={setShowAdvancedVariables}
        />
      </Sider>

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
        isDragging={isDragging}
        setZoom={setZoom}
        setOffset={setOffset}
        setIsDragging={setIsDragging}
        dragOriginRef={dragOriginRef}
      />
    </Layout>
  )
}
