import { describe, expect, it } from 'vitest'
import { allowsChannel, allowsPlatform } from '@/lib/agent/contracts'

const SLACK_T0 = { platform: 'slack', workspace_id: 'T0TEST' } as const
const DISCORD_G0 = { platform: 'discord', workspace_id: 'G0GUILD' } as const

describe('platform allowlist', () => {
  it('authorizes the exact registered tuple', () => {
    expect(allowsPlatform([SLACK_T0], 'slack', 'T0TEST')).toBe(true)
  })

  it('refuses a different workspace in the same platform', () => {
    expect(allowsPlatform([SLACK_T0], 'slack', 'T0OTHER')).toBe(false)
  })

  it('refuses the same workspace id on a different platform', () => {
    expect(allowsPlatform([SLACK_T0], 'discord', 'T0TEST')).toBe(false)
  })

  it('refuses everything when the stored list is empty', () => {
    expect(allowsPlatform([], 'slack', 'T0TEST')).toBe(false)
  })

  it('authorizes every workspace only through an explicit wildcard entry', () => {
    expect(allowsPlatform([{ platform: 'slack', workspace_id: '*' }], 'slack', 'T0ANY')).toBe(true)
  })

  it('keeps a wildcard scoped to its own platform', () => {
    expect(allowsPlatform([{ platform: 'slack', workspace_id: '*' }], 'discord', 'G0ANY')).toBe(false)
  })

  it('accepts several registered tuples', () => {
    expect(allowsPlatform([SLACK_T0, DISCORD_G0], 'discord', 'G0GUILD')).toBe(true)
  })
})

describe('channel allowlist', () => {
  it('authorizes a listed channel', () => {
    expect(allowsChannel(['C0PROPOSALS'], 'C0PROPOSALS')).toBe(true)
  })

  it('refuses an unlisted channel', () => {
    expect(allowsChannel(['C0PROPOSALS'], 'C0ELSEWHERE')).toBe(false)
  })

  it('refuses everything when the stored list is empty', () => {
    expect(allowsChannel([], 'C0PROPOSALS')).toBe(false)
  })

  it('authorizes every channel only through an explicit wildcard entry', () => {
    expect(allowsChannel(['*'], 'C0ANYWHERE')).toBe(true)
  })
})
