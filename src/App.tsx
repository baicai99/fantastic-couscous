import { Layout, Typography } from 'antd'
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
    activeSettings,
    modelCatalog,
    channels,
    setDraft,
    createNewConversation,
    switchConversation,
    updateActiveSettings,
    setActiveModel,
    setActiveModelParam,
    setChannels,
    sendDraft,
  } = useConversations()

  const {
    isPreviewOpen,
    previewImages,
    zoom,
    offset,
    isDragging,
    dragOriginRef,
    currentPreviewImage,
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

        <Content className="chat-body">
          <MessageList activeConversation={activeConversation} onOpenPreview={openPreview} />
        </Content>

        <Composer draft={draft} onDraftChange={setDraft} onSend={sendDraft} />
      </Layout>

      <Sider width={320} className="panel panel-right">
        <SettingsPanel
          settings={activeSettings}
          models={modelCatalog.models}
          channels={channels}
          onSettingsChange={updateActiveSettings}
          onModelChange={setActiveModel}
          onModelParamChange={setActiveModelParam}
          onChannelsChange={setChannels}
        />
      </Sider>

      <ImagePreviewModal
        isPreviewOpen={isPreviewOpen}
        closePreview={closePreview}
        goPrevPreview={goPrevPreview}
        goNextPreview={goNextPreview}
        previewImages={previewImages}
        previewHint={previewHint}
        currentPreviewImage={currentPreviewImage}
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
