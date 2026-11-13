import { test, expect } from '@playwright/test';
import { mockWorkspace } from './fixtures';

test('neutral project overview and every workflow step fit the viewport', async ({ page }, testInfo) => {
  await mockWorkspace(page);
  await page.goto('/');
  const favicon = await page.locator('link[rel="icon"]').getAttribute('href');
  const response = await page.request.get(favicon!);
  expect(response.ok()).toBe(true);
  expect(response.headers()['content-type']).toContain('image/svg+xml');
  const faviconPaths = await page.evaluate((source) => Array.from(new DOMParser().parseFromString(source, 'image/svg+xml').querySelectorAll('path'), (path) => path.getAttribute('d')), await response.text());
  expect(faviconPaths).toEqual(await page.locator('.brand svg path').evaluateAll((paths) => paths.map((path) => path.getAttribute('d'))));
  await expect(page.getByRole('heading', { name: '项目', exact: true })).toBeVisible();
  await expect(page.locator('.project-row > svg')).toHaveCount(0);
  await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(246, 246, 245)');
  await page.getByLabel('搜索项目', { exact: true }).fill('研究申办方');
  await expect(page.locator('.project-row')).toHaveCount(2);
  await page.getByLabel('搜索项目', { exact: true }).fill('ABC-001');
  await expect(page.locator('.project-row')).toHaveCount(2);
  await page.getByLabel('搜索项目', { exact: true }).fill('ABC-001 临床研究');
  await expect(page.locator('.project-row')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('projects.png'), fullPage: true });
  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog').getByLabel('项目名称', { exact: true })).toHaveAttribute('placeholder', '请输入项目名称');
  await page.getByRole('dialog').getByLabel('项目名称', { exact: true }).fill('待创建项目');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '新建项目', exact: true })).toBeFocused();
  await page.getByRole('button', { name: /^ABC-001 临床研究/ }).click();
  await page.getByRole('button', { name: '重命名项目', exact: true }).click();
  await page.getByRole('dialog').getByLabel('重命名项目', { exact: true }).fill('未保存的新名称');
  await page.keyboard.press('Escape');
  await page.getByLabel('方案标题', { exact: true }).fill('更新后的试验方案');
  await page.getByRole('button', { name: '保存方案信息', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('方案元数据已保存');
  for (const [label, screenshot] of [
    ['方案校验', 'protocol'], ['PD 分类', 'categories'], ['方案事实抽取', 'facts'],
    ['字段协议', 'fields'], ['PD 定义生成', 'definitions'],
  ]) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await expect(page.getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (screenshot === 'facts') expect((await page.locator('.fact-card').first().boundingBox())!.height).toBeLessThan(220);
    await page.screenshot({ path: testInfo.outputPath(`${screenshot}.png`), fullPage: true });
  }
  await page.getByLabel('筛选分类', { exact: true }).selectOption('安全性');
  await expect(page.getByText('没有匹配的结果。')).toBeVisible();
  await page.getByRole('button', { name: '返回项目列表', exact: true }).click();
  await expect(page.getByRole('heading', { name: '项目', exact: true })).toBeVisible();
});
