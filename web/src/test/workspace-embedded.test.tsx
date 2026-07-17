import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { OutputViewer } from '../components/OutputViewer'
import { InboxPanel } from '../components/InboxPanel'

// Phase 2b (spec §6): TerminalView/OutputViewer/InboxPanel gained an optional
// `embedded` prop for the Workbench dock. These tests guard the two things
// the spec requires: the classic modal chrome is untouched by default, and
// embedded mode genuinely drops that chrome rather than just hiding it visually.

function jsonResponse(data: unknown) {
  return { ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve(data) }
}

// jsdom has no scrollIntoView implementation; InboxPanel calls it on every
// message-list update (pre-existing behavior, untouched here) — stub it so
// this (previously untested) component can mount in jsdom at all.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}

describe('OutputViewer embedded mode', () => {
  afterEach(() => vi.restoreAllMocks())

  it('classic (default) mode keeps the modal title, terminal id chip, and close button', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ output: 'hello', mode: 'last' })))
    render(<OutputViewer terminalId="aaaaaaaa" onClose={() => {}} />)
    expect(await screen.findByText('터미널 출력')).toBeInTheDocument()
    expect(screen.getByTitle('닫기')).toBeInTheDocument()
  })

  it('embedded mode drops the modal title/close button but keeps the last/full toggle and content', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ output: 'hello output', mode: 'last' })))
    render(<OutputViewer terminalId="aaaaaaaa" onClose={() => {}} embedded />)
    expect(await screen.findByText('hello output')).toBeInTheDocument()
    expect(screen.queryByText('터미널 출력')).not.toBeInTheDocument()
    expect(screen.queryByTitle('닫기')).not.toBeInTheDocument()
    expect(screen.getByText('마지막 응답')).toBeInTheDocument()
    expect(screen.getByText('전체 출력')).toBeInTheDocument()
  })
})

describe('InboxPanel embedded mode', () => {
  afterEach(() => vi.restoreAllMocks())

  it('classic (default) mode keeps the modal header and close button', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse([])))
    render(<InboxPanel terminalId="aaaaaaaa" onClose={() => {}} />)
    expect(await screen.findByText('에이전트 받은편지함')).toBeInTheDocument()
    expect(screen.getByTitle('닫기')).toBeInTheDocument()
  })

  it('embedded mode drops the modal header/close button but keeps filters and the send form', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse([])))
    render(<InboxPanel terminalId="aaaaaaaa" onClose={() => {}} embedded />)
    await screen.findByText('아직 메시지가 없습니다')
    expect(screen.queryByText('에이전트 받은편지함')).not.toBeInTheDocument()
    expect(screen.queryByTitle('닫기')).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('메시지를 입력하세요...')).toBeInTheDocument()
  })
})
