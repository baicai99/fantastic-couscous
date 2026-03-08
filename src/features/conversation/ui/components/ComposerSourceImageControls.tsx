import type { RefObject } from 'react'
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { Button } from 'antd'

interface ComposerSourceImageControlsProps {
  sourceImageInputRef: RefObject<HTMLInputElement | null>
  plusBtnRef: RefObject<HTMLButtonElement | null>
  sourceImages: Array<{ id: string; file: File; previewUrl: string }>
  sourceImagesEnabled: boolean
  onSourceImagesAppend: (files: File[]) => void
  onSourceImageRemove: (id: string) => void
}

export function ComposerSourceImageControls(props: ComposerSourceImageControlsProps) {
  const {
    sourceImageInputRef,
    plusBtnRef,
    sourceImages,
    sourceImagesEnabled,
    onSourceImagesAppend,
    onSourceImageRemove,
  } = props

  return (
    <>
      <input
        ref={sourceImageInputRef}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/jpg,image/webp"
        className="composer-source-image-input"
        disabled={!sourceImagesEnabled}
        onChange={(event) => {
          if (!sourceImagesEnabled) {
            return
          }
          const fileList = event.target.files
          if (!fileList || fileList.length === 0) {
            return
          }
          onSourceImagesAppend(Array.from(fileList))
          event.currentTarget.value = ''
        }}
      />
      {sourceImages.length > 0 ? (
        <div className="composer-source-image-panel">
          <div className="composer-source-image-list" aria-label="参考图列表">
            {sourceImages.map((item) => (
              <div key={item.id} className="composer-source-image-item">
                <img src={item.previewUrl} alt={item.file.name || '参考图'} className="composer-source-image-thumb" />
                <Button
                  type="text"
                  size="small"
                  icon={<DeleteOutlined />}
                  className="composer-source-image-remove-btn"
                  onClick={() => onSourceImageRemove(item.id)}
                  aria-label={`删除参考图 ${item.file.name || ''}`}
                />
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <Button
        ref={plusBtnRef}
        type="text"
        icon={<PlusOutlined />}
        disabled={!sourceImagesEnabled}
        onClick={() => sourceImageInputRef.current?.click()}
        className="composer-plus-btn"
        aria-label={sourceImagesEnabled ? '上传参考图' : '文本模式不支持参考图'}
        title={sourceImagesEnabled ? '上传参考图（最多 6 张）' : '文本模式不支持参考图'}
      />
    </>
  )
}
