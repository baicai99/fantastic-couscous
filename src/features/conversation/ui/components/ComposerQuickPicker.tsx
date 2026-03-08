import type { ModelSpec } from '../../../../types/model'
import type { DashCommandOption } from './composerHelpers'

type PickerMode = 'quick-actions' | 'models' | 'commands'

interface ComposerQuickPickerProps {
  isOpen: boolean
  pickerMode: PickerMode
  matchedModels: ModelSpec[]
  matchedDashCommands: DashCommandOption[]
  quickPickerItems: string[]
  quickPickerActiveIndex: number
  setQuickPickerActiveIndex: (index: number) => void
  applyModelShortcutItem: (model: ModelSpec) => void
  applyDashCommandItem: (command: DashCommandOption) => void
  applyQuickPickerItem: (label: string) => void
  isSideConfigLocked: boolean
  comparisonModeQuickAction: string
}

export function ComposerQuickPicker(props: ComposerQuickPickerProps) {
  const {
    isOpen,
    pickerMode,
    matchedModels,
    matchedDashCommands,
    quickPickerItems,
    quickPickerActiveIndex,
    setQuickPickerActiveIndex,
    applyModelShortcutItem,
    applyDashCommandItem,
    applyQuickPickerItem,
    isSideConfigLocked,
    comparisonModeQuickAction,
  } = props

  if (!isOpen) {
    return null
  }

  return (
    <div className="composer-quick-picker" role="listbox" aria-label="快捷功能选择">
      {pickerMode === 'models'
        ? matchedModels.length > 0
          ? matchedModels.map((model, index) => (
            <button
              key={model.id}
              type="button"
              className={`composer-quick-picker-item ${index === quickPickerActiveIndex ? 'is-active' : ''}`}
              onMouseEnter={() => setQuickPickerActiveIndex(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => applyModelShortcutItem(model)}
            >
              {model.name}
            </button>
          ))
          : <div className="composer-quick-picker-empty">未找到匹配模型</div>
        : pickerMode === 'commands'
          ? matchedDashCommands.length > 0
            ? matchedDashCommands.map((item, index) => (
              <button
                key={item.key}
                type="button"
                className={`composer-quick-picker-item ${index === quickPickerActiveIndex ? 'is-active' : ''}`}
                onMouseEnter={() => setQuickPickerActiveIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => applyDashCommandItem(item)}
              >
                {item.label}
              </button>
            ))
            : <div className="composer-quick-picker-empty">未找到匹配命令</div>
          : quickPickerItems.map((item, index) => (
            <button
              key={item}
              type="button"
              className={`composer-quick-picker-item ${index === quickPickerActiveIndex ? 'is-active' : ''} ${isSideConfigLocked && item === comparisonModeQuickAction ? 'is-disabled' : ''}`}
              onMouseEnter={() => setQuickPickerActiveIndex(index)}
              onMouseDown={(event) => event.preventDefault()}
              disabled={isSideConfigLocked && item === comparisonModeQuickAction}
              onClick={() => applyQuickPickerItem(item)}
            >
              {item}
            </button>
          ))}
    </div>
  )
}
