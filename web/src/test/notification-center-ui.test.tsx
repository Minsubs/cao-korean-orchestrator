import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { NotificationCenter } from '../components/NotificationCenter'

describe('notification center UI', () => {
  afterEach(() => window.localStorage.clear())

  it('opens a persistent in-app notification panel from the header button', () => {
    render(<NotificationCenter sessions={[]} />)

    fireEvent.click(screen.getByRole('button', { name: '알림 센터 열기' }))

    expect(screen.getByRole('dialog', { name: '알림 센터' })).toBeInTheDocument()
    expect(screen.getByText('아직 알림이 없습니다.')).toBeInTheDocument()
    expect(screen.getByText('앱 내 알림 내역은 항상 저장됩니다.')).toBeInTheDocument()
  })
})
