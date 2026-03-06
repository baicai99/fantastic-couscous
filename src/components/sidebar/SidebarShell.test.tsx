import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SidebarShell } from './SidebarShell'

describe('SidebarShell', () => {
  it('shows expanded layer when mode is expanded', () => {
    render(
      <SidebarShell
        side="left"
        mode="expanded"
        expandedWidth={280}
        collapsedWidth={52}
        onModeChange={() => {}}
        expandedContent={<div>expanded-content</div>}
        collapsedContent={<div>collapsed-content</div>}
      />,
    )

    expect(screen.getByText('expanded-content')).toBeInTheDocument()
    expect(screen.getByText('collapsed-content')).toBeInTheDocument()
    expect(document.querySelector('.sidebar-shell-layer-expanded')?.className).toContain('is-active')
    expect(document.querySelector('.sidebar-shell-layer-collapsed')?.className).toContain('is-inactive')
  })

  it('shows collapsed layer when mode is collapsed', () => {
    render(
      <SidebarShell
        side="right"
        mode="collapsed"
        expandedWidth={320}
        collapsedWidth={56}
        onModeChange={() => {}}
        expandedContent={<div>expanded-content</div>}
        collapsedContent={<div>collapsed-content</div>}
      />,
    )

    expect(screen.getByText('expanded-content')).toBeInTheDocument()
    expect(screen.getByText('collapsed-content')).toBeInTheDocument()
    expect(document.querySelector('.sidebar-shell-layer-expanded')?.className).toContain('is-inactive')
    expect(document.querySelector('.sidebar-shell-layer-collapsed')?.className).toContain('is-active')
  })
})
