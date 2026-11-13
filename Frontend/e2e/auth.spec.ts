import { test, expect } from '@playwright/test'

test('register, session restore, logout and account switching', async ({ page }, testInfo) => {
  let account: { id: number; username: string } | null = null
  const accounts = new Map<string, { id: number; password: string }>()
  const projectRequests: string[] = []
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const request = route.request()
    expect(request.headers()['x-requested-with']).toBe('ProtocolDeviationGenerator')
    const path = new URL(request.url()).pathname
    if (path === '/api/auth/me') {
      await route.fulfill(account ? { json: account } : { status: 401, json: { detail: '请先登录。' } })
    } else if (path === '/api/auth/register') {
      const { username, password } = request.postDataJSON()
      accounts.set(username, { id: accounts.size + 1, password })
      account = { id: accounts.get(username)!.id, username }
      await route.fulfill({ json: account })
    } else if (path === '/api/auth/login') {
      const { username, password } = request.postDataJSON()
      const match = accounts.get(username)
      if (!match || match.password !== password) await route.fulfill({ status: 401, json: { detail: '用户名或密码不正确。' } })
      else { account = { id: match.id, username }; await route.fulfill({ json: account }) }
    } else if (path === '/api/auth/logout') {
      account = null
      await route.fulfill({ json: { status: 'success' } })
    } else if (path === '/api/projects' && account) {
      projectRequests.push(account.username)
      await route.fulfill({ json: [{ id: account.id, name: `${account.username} 的项目`, file_valid: 0 }] })
    } else if (path.endsWith('/workspace') && account) {
      await route.fulfill({ json: {
        project: { id: account.id, name: `${account.username} 的项目`, file_valid: 0 },
        categories: [], fields: [], facts: [], definitions: [],
      } })
    } else await route.fulfill({ status: 401, json: { detail: '请先登录。' } })
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '欢迎回来' })).toBeVisible()
  expect(projectRequests).toEqual([])
  await expect(page.getByLabel('密码', { exact: true })).toHaveAttribute('autocomplete', 'current-password')
  if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}\\${testInfo.project.name}-login.png`, fullPage: true })
  for (const username of ['alice', 'bob']) {
    await page.getByRole('button', { name: '创建账号', exact: true }).click()
    await page.getByLabel('用户名', { exact: true }).fill('invalid username')
    expect(await page.getByLabel('用户名', { exact: true }).evaluate((input: HTMLInputElement) => input.validity.patternMismatch)).toBe(true)
    await page.getByLabel('用户名', { exact: true }).fill('valid.user_1@example-test.com')
    expect(await page.getByLabel('用户名', { exact: true }).evaluate((input: HTMLInputElement) => input.checkValidity())).toBe(true)
    await page.getByLabel('用户名', { exact: true }).fill(username)
    await expect(page.getByLabel('密码', { exact: true })).toHaveAttribute('minlength', '3')
    await expect(page.getByLabel('确认密码', { exact: true })).toHaveAttribute('minlength', '3')
    await page.getByLabel('密码', { exact: true }).fill('abc')
    await page.getByLabel('确认密码', { exact: true }).fill('abc')
    await page.getByRole('button', { name: '注册并登录' }).click()
    await expect(page.getByRole('button', { name: new RegExp(`${username} 的项目`) })).toBeVisible()
    await expect(page.getByRole('button', { name: new RegExp(`${username === 'alice' ? 'bob' : 'alice'} 的项目`) })).toHaveCount(0)
    await page.reload()
    await expect(page.getByText(username, { exact: true })).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.getByRole('button', { name: '退出', exact: true }).click()
    await expect(page.getByRole('heading', { name: '欢迎回来' })).toBeVisible()
    await expect(page.getByRole('button', { name: new RegExp(`${username} 的项目`) })).toHaveCount(0)
  }
  await page.getByLabel('用户名', { exact: true }).fill('alice')
  await page.getByLabel('密码', { exact: true }).fill('incorrect-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('用户名或密码不正确')
  await expect(page.getByRole('alert')).toBeFocused()
  await page.getByLabel('密码', { exact: true }).fill('abc')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByRole('button', { name: /alice 的项目/ })).toBeVisible()
  expect(await page.evaluate(() => localStorage.length)).toBe(0)
})
