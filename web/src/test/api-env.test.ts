import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { envApi } from '../api.env'

describe('envApi', () => {
  const mockFetch = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function mockResponse(data: unknown, status = 200) {
    mockFetch.mockResolvedValueOnce({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      json: () => Promise.resolve(data),
    })
  }

  it('getInventory() GETs /env/inventory?cli=all and returns {clis:[…]}', async () => {
    const inventory = { clis: [{ cli: 'claude_code', present: true, items: [], counts: {}, note: null }] }
    mockResponse(inventory)
    const result = await envApi.getInventory()
    expect(result).toEqual(inventory)
    expect(mockFetch).toHaveBeenCalledWith('/env/inventory?cli=all', expect.objectContaining({ signal: expect.any(AbortSignal) }))
  })

  it('getInventory("codex") GETs /env/inventory?cli=codex and returns the bare EnvInventoryCli', async () => {
    const cli = { cli: 'codex', present: false, items: [], counts: {}, note: null }
    mockResponse(cli)
    const result = await envApi.getInventory('codex')
    expect(result).toEqual(cli)
    expect(mockFetch).toHaveBeenCalledWith('/env/inventory?cli=codex', expect.any(Object))
  })

  it('getInstructions([\'/a\',\'/b\']) GETs /env/instructions?paths=%2Fa%2C%2Fb and returns {entries:[…]}', async () => {
    const matrix = { entries: [{ scope: 'global', base_path: '$HOME', files: [] }] }
    mockResponse(matrix)
    const result = await envApi.getInstructions(['/a', '/b'])
    expect(result).toEqual(matrix)
    expect(mockFetch).toHaveBeenCalledWith('/env/instructions?paths=%2Fa%2C%2Fb', expect.any(Object))
  })

  it('getInstructions([]) still calls with paths= empty (global-only)', async () => {
    mockResponse({ entries: [] })
    await envApi.getInstructions([])
    expect(mockFetch).toHaveBeenCalledWith('/env/instructions?paths=', expect.any(Object))
  })

  it('convert(...) POSTs JSON to /env/convert and returns {converted,warnings,lossy_fields}', async () => {
    const body = { source_kind: 'claude_agent', target_kind: 'cao_profile', content: '# agent' }
    const result_ = { converted: '# converted', warnings: ['w1'], lossy_fields: ['tools'] }
    mockResponse(result_)
    const result = await envApi.convert(body)
    expect(result).toEqual(result_)
    expect(mockFetch).toHaveBeenCalledWith(
      '/env/convert',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    )
  })

  it('writeInstruction(...) POSTs to /env/instructions/write', async () => {
    const body = { path: '/home/u/CLAUDE.md', content: '# hi', overwrite: true }
    const result_ = { written: true, path: '/home/u/CLAUDE.md', backup_path: null, bytes: 4, created: false }
    mockResponse(result_)
    const result = await envApi.writeInstruction(body)
    expect(result).toEqual(result_)
    expect(mockFetch).toHaveBeenCalledWith(
      '/env/instructions/write',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    )
  })

  it('rejects with an error carrying .status and .detail on a non-2xx response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 409,
      statusText: 'Conflict',
      json: () => Promise.resolve({ detail: 'InstructionExists' }),
    })
    await expect(envApi.writeInstruction({ path: '/home/u/CLAUDE.md', content: '# hi' })).rejects.toMatchObject({
      status: 409,
      detail: 'InstructionExists',
    })
  })
})
