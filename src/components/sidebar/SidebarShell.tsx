import type { ReactNode } from 'react'
import { Layout } from 'antd'
import type { PanelMode } from '../../hooks/usePersistentPanelMode'

const { Sider } = Layout

type SidebarSide = 'left' | 'right'

interface SidebarShellProps {
  side: SidebarSide
  mode: PanelMode
  expandedWidth: number
  collapsedWidth: number
  onModeChange: (mode: PanelMode) => void
  expandedContent: ReactNode
  collapsedContent: ReactNode
  className?: string
  breakpoint?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'xxl'
  autoModeByBreakpoint?: boolean
}

export function SidebarShell(props: SidebarShellProps) {
  const {
    side,
    mode,
    expandedWidth,
    collapsedWidth,
    onModeChange,
    expandedContent,
    collapsedContent,
    className,
    breakpoint,
    autoModeByBreakpoint = false,
  } = props

  return (
    <Sider
      width={expandedWidth}
      collapsedWidth={collapsedWidth}
      collapsible
      trigger={null}
      collapsed={mode === 'collapsed'}
      breakpoint={breakpoint}
      onBreakpoint={
        autoModeByBreakpoint
          ? (broken) => {
              onModeChange(broken ? 'collapsed' : 'expanded')
            }
          : undefined
      }
      className={`panel panel-${side} sidebar-shell ${className ?? ''} ${mode === 'collapsed' ? 'is-collapsed' : 'is-expanded'}`.trim()}
    >
      <div className="sidebar-shell-inner">
        <div className={`sidebar-shell-layer sidebar-shell-layer-expanded ${mode === 'expanded' ? 'is-active' : 'is-inactive'}`}>
          {expandedContent}
        </div>
        <div className={`sidebar-shell-layer sidebar-shell-layer-collapsed ${mode === 'collapsed' ? 'is-active' : 'is-inactive'}`}>
          {collapsedContent}
        </div>
      </div>
    </Sider>
  )
}
