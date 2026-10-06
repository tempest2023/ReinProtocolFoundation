import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ts from 'typescript'
import { adminLanguageCookie, createAdminI18n, normalizeAdminLanguage, type AdminLanguage } from '@/lib/admin/i18n'
import { adminChineseMessages } from '@/lib/admin/messages'
import { AdminI18nProvider, AdminLanguageSwitcher } from '@/components/admin-i18n'
import { AdminNavigation } from '@/components/admin-navigation'
import { AdminForm } from '@/components/admin-form'
import { AdminSubmitButton } from '@/components/admin-submit-button'
import { AdminAgentReviewControl } from '@/components/admin-agent-review-control'
import { AdminLoginForm } from '@/app/admin/login/login-form'
import { getAdminI18n } from '@/lib/admin/i18n-server'

const mocks = vi.hoisted(() => ({
  getCookie: vi.fn(),
  setCookie: vi.fn(),
  setAdminLanguage: vi.fn(),
  from: vi.fn(),
  runAdminFormAction: vi.fn(),
  startAgentReview: vi.fn(),
  requestAdminLink: vi.fn(),
}))

vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ get: mocks.getCookie, set: mocks.setCookie })) }))
vi.mock('next/navigation', () => ({ usePathname: () => '/admin/learn', notFound: () => { throw new Error('NOT_FOUND') } }))
vi.mock('@/app/admin/locale-actions', () => ({ setAdminLanguage: mocks.setAdminLanguage }))
vi.mock('@/app/admin/actions', () => ({ runAdminFormAction: mocks.runAdminFormAction, startAgentReview: mocks.startAgentReview, signOut: vi.fn() }))
vi.mock('@/app/admin/login/actions', () => ({ requestAdminLink: mocks.requestAdminLink }))
vi.mock('@/lib/admin/auth', () => ({ requireAdmin: vi.fn(async () => ({ user: { email: 'admin@example.org' }, service: { from: mocks.from } })) }))
vi.mock('@/lib/env', () => ({
  publicEnv: { siteUrl: 'https://rein-protocol.org' },
  adminReadiness: () => ({ ready: true, missing: [] }),
  isDirectAdminLoginEnabled: () => false,
}))
vi.mock('@/lib/community/data', () => ({ getPublicMemberMetrics: vi.fn(async () => ({ allTime: 12000, thisMonth: 30, bySource: { manual: 12000 } })) }))

function queryRows(rows: Record<string, unknown>[]) {
  const result = { data: rows, count: rows.length }
  const query = new Proxy({}, {
    get(_target, property) {
      if (property === 'then') return Promise.resolve(result).then.bind(Promise.resolve(result))
      if (property === 'maybeSingle') return async () => ({ data: rows[0] ?? null })
      return () => query
    },
  })
  return query
}

function renderLanguage(children: React.ReactNode, language: AdminLanguage = 'zh') {
  return render(<AdminI18nProvider language={language}>{children}</AdminI18nProvider>)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getCookie.mockReturnValue({ value: 'zh' })
  mocks.setAdminLanguage.mockResolvedValue(undefined)
  mocks.from.mockImplementation(() => queryRows([]))
  mocks.runAdminFormAction.mockResolvedValue({ status: 'success', message: '' })
  mocks.startAgentReview.mockResolvedValue({ status: 'success', message: 'Resource Agent review completed.' })
  mocks.requestAdminLink.mockResolvedValue({ status: 'success', message: 'If this address is authorized, a sign-in link has been sent.' })
})

afterEach(() => vi.unstubAllEnvs())

describe('administrator language configuration', () => {
  it('defaults to English and only accepts the supported cookie values', () => {
    expect(normalizeAdminLanguage(undefined)).toBe('en')
    expect(normalizeAdminLanguage('fr')).toBe('en')
    expect(normalizeAdminLanguage('zh')).toBe('zh')
    expect(normalizeAdminLanguage('en')).toBe('en')
  })

  it('uses the request cookie for server-rendered translations', async () => {
    expect((await getAdminI18n()).t('Administration')).toBe('管理后台')
    expect(mocks.getCookie).toHaveBeenCalledWith(adminLanguageCookie)
    mocks.getCookie.mockReturnValue({ value: 'unsupported' })
    expect((await getAdminI18n()).t('Administration')).toBe('Administration')
  })

  it('persists a validated language only within the administrator routes', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const actions = await vi.importActual<typeof import('@/app/admin/locale-actions')>('@/app/admin/locale-actions')
    await actions.setAdminLanguage('zh')
    expect(mocks.setCookie).toHaveBeenCalledWith(adminLanguageCookie, 'zh', {
      path: '/admin', maxAge: 31536000, httpOnly: true, sameSite: 'lax', secure: true,
    })
    await expect(actions.setAdminLanguage('fr')).rejects.toThrow('Unsupported administrator language.')
    expect(mocks.setCookie).toHaveBeenCalledOnce()
  })

  it('allows local HTTP development to persist the preference', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const actions = await vi.importActual<typeof import('@/app/admin/locale-actions')>('@/app/admin/locale-actions')
    await actions.setAdminLanguage('en')
    expect(mocks.setCookie).toHaveBeenCalledWith(adminLanguageCookie, 'en', expect.objectContaining({ secure: false }))
  })

  it('localizes record labels, interpolation, numbers, and attempt counts without changing unknown content', () => {
    const chinese = createAdminI18n('zh')
    const english = createAdminI18n('en')
    expect(chinese.label('published')).toBe('已发布')
    expect(chinese.label('subscribed')).toBe('已订阅')
    expect(chinese.label('waiting_verification')).toBe('等待验证')
    expect(chinese.label('in_progress')).toBe('进行中')
    expect(english.label('published')).toBe('Published')
    expect(chinese.t('{setting} saved.', { setting: chinese.t('Scheduling URL') })).toBe('预约链接已保存。')
    expect(chinese.number(12000)).toBe(new Intl.NumberFormat('zh-CN').format(12000))
    expect(chinese.attempts(2)).toBe('2 次尝试')
    expect(english.attempts(1)).toBe('1 attempt')
    expect(english.attempts(2)).toBe('2 attempts')
    expect(chinese.t('A user-authored title')).toBe('A user-authored title')
    expect(chinese.t('toString')).toBe('toString')
    expect(chinese.label('__proto__')).toBe('__proto__')
  })

  it('keeps interpolation fields consistent in every translation', () => {
    for (const [english, chinese] of Object.entries(adminChineseMessages)) {
      expect(chinese.trim(), english).not.toBe('')
      expect(chinese.match(/\{\w+\}/g) ?? [], english).toEqual(english.match(/\{\w+\}/g) ?? [])
    }
  })
})

describe('administrator client translations', () => {
  it('localizes navigation and preserves its current route', () => {
    renderLanguage(<AdminNavigation />)
    const navigation = screen.getByRole('navigation', { name: '管理后台' })
    expect(within(navigation).getByRole('link', { name: '学习资源' })).toHaveAttribute('aria-current', 'page')
    expect(within(navigation).getByRole('link', { name: '设置' })).toHaveAttribute('href', '/admin/settings')
  })

  it('switches language through the server action and identifies the current selection', async () => {
    renderLanguage(<AdminLanguageSwitcher />, 'en')
    expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: '中文' }))
    await vi.waitFor(() => expect(mocks.setAdminLanguage).toHaveBeenCalledWith('zh'))
  })

  it('reports a failed switch without claiming that the language changed', async () => {
    mocks.setAdminLanguage.mockRejectedValue(new Error('offline'))
    renderLanguage(<AdminLanguageSwitcher />)
    fireEvent.click(screen.getByRole('button', { name: 'English' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('语言切换失败，请重试。')
    expect(screen.getByRole('button', { name: '中文' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('localizes action feedback, moves focus, and leaves the action ID intact', async () => {
    mocks.runAdminFormAction.mockResolvedValue({ status: 'error', message: 'Enter a valid monitored contact email.' })
    renderLanguage(<AdminForm actionId="save_setting"><AdminSubmitButton>保存</AdminSubmitButton></AdminForm>)
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    const feedback = await screen.findByRole('alert')
    expect(feedback).toHaveTextContent('请输入有效且有人值守的联系邮箱。')
    expect(feedback).toHaveFocus()
    expect(mocks.runAdminFormAction.mock.calls[0]?.[1].get('_admin_action')).toBe('save_setting')
  })

  it('localizes Agent controls and still submits the original job ID', async () => {
    renderLanguage(<AdminAgentReviewControl jobId="job-1" jobStatus="failed" reviewKind="resource" />)
    fireEvent.click(screen.getByRole('button', { name: '重试资源 Agent 审核' }))
    expect(await screen.findByRole('status')).toHaveTextContent('资源 Agent 审核已完成。')
    expect(mocks.startAgentReview.mock.calls[0]?.[1].get('id')).toBe('job-1')
  })

  it('updates existing form feedback when the interface language changes', async () => {
    mocks.runAdminFormAction.mockResolvedValue({ status: 'error', message: 'Enter a valid monitored contact email.' })
    const form = <AdminForm actionId="save_setting"><AdminSubmitButton>Save</AdminSubmitButton></AdminForm>
    const { rerender } = renderLanguage(form, 'en')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a valid monitored contact email.')
    rerender(<AdminI18nProvider language="zh">{form}</AdminI18nProvider>)
    expect(screen.getByRole('alert')).toHaveTextContent('请输入有效且有人值守的联系邮箱。')
    rerender(<AdminI18nProvider language="en">{form}</AdminI18nProvider>)
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid monitored contact email.')
    expect(mocks.runAdminFormAction).toHaveBeenCalledOnce()
  })

  it('localizes login progress and delivery feedback without sending a real email', async () => {
    let resolveLogin!: (state: { status: 'success'; message: string }) => void
    mocks.requestAdminLink.mockImplementation(() => new Promise((resolve) => { resolveLogin = resolve }))
    renderLanguage(<AdminLoginForm />)
    fireEvent.change(screen.getByRole('textbox', { name: '邮箱' }), { target: { value: 'admin@example.org' } })
    fireEvent.click(screen.getByRole('button', { name: '发送登录链接' }))
    await screen.findByRole('button', { name: '正在发送…' })
    await act(async () => resolveLogin({ status: 'success', message: 'If this address is authorized, a sign-in link has been sent.' }))
    expect(await screen.findByRole('status')).toHaveTextContent('如果此邮箱已获授权，登录链接已发送。')
  })
})

describe('administrator server pages', () => {
  it.each([
    ['zh', '页面不存在', '返回后台首页'],
    ['en', 'Page not found', 'Return to dashboard'],
  ] as const)('localizes missing-record pages in %s', async (language, heading, linkText) => {
    mocks.getCookie.mockReturnValue({ value: language })
    const { default: Page } = await import('@/app/admin/(dashboard)/not-found')
    renderLanguage(await Page(), language)
    expect(screen.getByRole('heading', { name: heading, level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: linkText })).toHaveAttribute('href', '/admin')
  })

  const pages: Array<[string, string, () => Promise<React.ReactNode>]> = [
    ['overview', 'Community operations', async () => (await import('@/app/admin/(dashboard)/page')).default()],
    ['participants', 'Participants', async () => (await import('@/app/admin/(dashboard)/participants/page')).default({ searchParams: Promise.resolve({}) })],
    ['applications', 'Applications', async () => (await import('@/app/admin/(dashboard)/applications/page')).default()],
    ['contributors', 'Contributors', async () => (await import('@/app/admin/(dashboard)/contributors/page')).default()],
    ['people', 'People', async () => (await import('@/app/admin/(dashboard)/people/page')).default()],
    ['learn', 'Learn', async () => (await import('@/app/admin/(dashboard)/learn/page')).default()],
    ['gather', 'Gather', async () => (await import('@/app/admin/(dashboard)/gather/page')).default()],
    ['resources', 'Review', async () => (await import('@/app/admin/(dashboard)/resources/page')).default()],
    ['settings', 'Settings', async () => (await import('@/app/admin/(dashboard)/settings/page')).default()],
    ['audit', 'Audit', async () => (await import('@/app/admin/(dashboard)/audit-log/page')).default()],
    ['guide', 'Contributor Conversation', async () => (await import('@/app/admin/(dashboard)/guide/contributor-conversation/page')).default()],
  ]

  it.each(pages)('renders %s in the saved language', async (_path, title, renderPage) => {
    renderLanguage(await renderPage())
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(adminChineseMessages[title])
  })

  it('translates industry options but preserves the submitted English values', async () => {
    const { default: Page } = await import('@/app/admin/(dashboard)/participants/page')
    renderLanguage(await Page({ searchParams: Promise.resolve({ industry: 'Student' }) }))
    expect(screen.getByRole('combobox', { name: '行业' })).toHaveValue('Student')
    expect(screen.getByRole('option', { name: '学生' })).toHaveAttribute('value', 'Student')
  })

  it('keeps publication, resource types, and user-authored content unchanged', async () => {
    mocks.from.mockImplementation(() => queryRows([{ id: 'resource-1', title: 'Published', language: 'English', public_url: 'https://example.org', resource_type: 'Video', publication_status: 'published', sort_order: 100 }]))
    const { default: Page } = await import('@/app/admin/(dashboard)/learn/page')
    renderLanguage(await Page())
    expect(screen.getByText('Published')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '状态' })).toHaveValue('published')
    expect(screen.getByRole('option', { name: '视频' })).toHaveAttribute('value', 'Video')
  })

  it('translates the event editor without translating stored format values or timezone identifiers', async () => {
    mocks.from.mockImplementation(() => queryRows([{ id: 'event-1', title: 'Original event', format: 'hybrid', timezone: 'America/Los_Angeles', relationship: 'Partner event', external_registration_url: 'https://example.org', event_sessions: [] }]))
    const { default: Page } = await import('@/app/admin/(dashboard)/gather/[id]/page')
    renderLanguage(await Page({ params: Promise.resolve({ id: 'event-1' }) }))
    expect(screen.getByRole('combobox', { name: '活动形式' })).toHaveValue('hybrid')
    expect(screen.getByRole('combobox', { name: '分类' })).toHaveValue('Partner event')
    expect(screen.getByRole('textbox', { name: '时区' })).toHaveValue('America/Los_Angeles')
  })

  it('localizes audit dates while leaving structured details untouched', async () => {
    const createdAt = '2026-10-06T12:30:00Z'
    mocks.from.mockImplementation(() => queryRows([{ id: 'entry-1', created_at: createdAt, actor_type: 'admin', actor_id: 'admin-1', action: 'set_resource_publication', entity_type: 'resource', entity_id: 'resource-1', details: { status: 'published' } }]))
    const { default: Page } = await import('@/app/admin/(dashboard)/audit-log/page')
    renderLanguage(await Page())
    expect(screen.getByText(new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(createdAt)))).toBeInTheDocument()
    expect(screen.getByText(/"status": "published"/)).toBeInTheDocument()
  })

  it('renders English when the preference is missing', async () => {
    mocks.getCookie.mockReturnValue(undefined)
    const { default: Page } = await import('@/app/admin/(dashboard)/settings/page')
    renderLanguage(await Page(), 'en')
    expect(screen.getByRole('heading', { name: 'Settings', level: 1 })).toBeInTheDocument()
  })

  it('sets the Admin language scope and metadata without changing the public root layout', async () => {
    const { default: Layout, generateMetadata } = await import('@/app/admin/layout')
    const { container } = render(await Layout({ children: <p>Child</p> }))
    expect(container.querySelector('.admin-shell')).toHaveAttribute('lang', 'zh-CN')
    expect(await generateMetadata()).toMatchObject({ title: '管理后台', robots: { index: false, follow: false } })
    expect(readFileSync('app/layout.tsx', 'utf8')).toContain('<html lang="en">')
  })
})

describe('administrator translation coverage', () => {
  function sources(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory()
      ? sources(join(directory, entry.name))
      : entry.name.endsWith('.tsx') ? [join(directory, entry.name)] : [],
    )
  }

  it('keeps visible page copy translated and technical form values unlocalized', () => {
    const allowedText = new Set(['Rein', 'GitHub', 'Google Scholar', 'LinkedIn', 'OpenAI', 'meeting_scheduled', 'conversation_complete', 'closed'])
    for (const filename of sources('app/admin')) {
      const source = ts.createSourceFile(filename, readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
      function check(node: ts.Node) {
        if (ts.isJsxText(node) && /[A-Za-z]/.test(node.text)) expect(allowedText.has(node.text.trim()), `${filename}: ${node.text}`).toBe(true)
        if (ts.isJsxAttribute(node) && ['value', 'defaultValue', 'jobStatus', 'actionId', 'name'].includes(node.name.getText(source))) {
          expect(node.initializer?.getText(source) ?? '', filename).not.toMatch(/\b(?:t|label)\(/)
        }
        if (ts.isCallExpression(node) && node.expression.getText(source) === 't' && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
          expect(Object.hasOwn(adminChineseMessages, node.arguments[0].text), `${filename}: ${node.arguments[0].text}`).toBe(true)
        }
        ts.forEachChild(node, check)
      }
      check(source)
    }
  })
})
