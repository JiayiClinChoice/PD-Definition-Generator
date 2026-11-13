import { test, expect, type Page } from '@playwright/test';
import { initialWorkspace, mockWorkspace } from './fixtures';

async function open(page: Page, tab: string) {
  await page.goto('/');
  await page.getByRole('button', { name: /^ABC-001 临床研究/ }).click();
  await page.getByRole('button', { name: tab, exact: true }).click();
}

test('fact extraction uses consistent terminology', async ({ page }) => {
  await mockWorkspace(page);
  const workspace = structuredClone(initialWorkspace);
  workspace.facts = [];
  await page.route('**/api/project/1/workspace', (route) => route.fulfill({ json: workspace }));
  await open(page, '方案事实抽取');
  await expect(page.getByRole('heading', { name: /^方案事实/ })).toBeVisible();
  const extract = page.getByRole('button', { name: '提取事实', exact: true });
  await expect(extract).toHaveText('提取事实');
  await expect(page.getByPlaceholder('搜索事实、分类或来源…')).toBeVisible();
  await extract.click();
  await expect(page.getByRole('textbox', { name: '事实内容', exact: true })).toHaveValue(initialWorkspace.facts[0].content);
});

test('fact confirmation persists, content auto-grows and editing clears confirmation', async ({ page }) => {
  const data = await mockWorkspace(page);
  await open(page, '方案事实抽取');
  const content = page.getByRole('textbox', { name: '事实内容', exact: true });
  const text = Array.from({ length: 22 }, (_, index) => `第 ${index + 1} 项：在研究开始之前，应向受试者完整说明研究程序和潜在风险。`).join('\n');
  await content.fill(text);
  await expect(page.locator('.fact-card h3')).toHaveText('01');
  await expect(content).toHaveCSS('resize', 'none');
  await expect.poll(() => content.evaluate((element) => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
  await page.getByRole('button', { name: '确认事实 1', exact: true }).click();
  await expect(page.getByRole('button', { name: '取消确认事实 1', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '保存事实修改', exact: true }).click();
  await expect.poll(() => data().facts[0].checked).toBe(1);
  await page.reload();
  await page.getByRole('button', { name: /^ABC-001 临床研究/ }).click();
  await page.getByRole('button', { name: '方案事实抽取', exact: true }).click();
  await expect(page.getByRole('button', { name: '取消确认事实 1', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(content).toHaveValue(text);
  await expect.poll(() => content.evaluate((element) => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
  await page.setViewportSize({ width: 375, height: 812 });
  await expect.poll(() => content.evaluate((element) => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
  await content.fill('已更改的事实');
  await expect(page.getByRole('button', { name: '确认事实 1', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: '保存事实修改', exact: true }).click();
  await expect.poll(() => data().facts[0].checked).toBe(0);
});

test('AI expand and collapse uses a compact accessible chevron on both result pages', async ({ page }) => {
  await mockWorkspace(page);
  await open(page, '方案事实抽取');
  for (const tab of ['方案事实抽取', 'PD 定义生成']) {
    await page.getByRole('button', { name: tab, exact: true }).click();
    const control = page.locator('.ai-toggle');
    await expect(control.locator('.when-open')).toBeVisible();
    const bounds = (await control.boundingBox())!;
    expect(bounds.width).toBeGreaterThanOrEqual(32);
    expect(bounds.width).toBeLessThanOrEqual(40);
    expect(bounds.height).toBeGreaterThanOrEqual(32);
    await control.click();
    await expect(control.locator('.when-closed')).toBeVisible();
    await expect(page.locator('.ai-panel textarea')).toBeHidden();
    await control.click();
    await expect(page.locator('.ai-panel textarea')).toBeVisible();
  }
});

test('definition table uses exact protocol labels and normalizes loaded positions', async ({ page }) => {
  await mockWorkspace(page);
  const workspace = structuredClone(initialWorkspace);
  workspace.fields[4].label = '项目自定义的偏离描述标签';
  workspace.definitions[0].position = 85;
  await page.route('**/api/project/1/workspace', (route) => route.fulfill({ json: workspace }));
  await open(page, 'PD 定义生成');
  await expect(page.getByRole('table')).toHaveCount(1);
  await expect(page.getByRole('columnheader')).toHaveText(workspace.fields.map((field) => field.label));
  await expect(page.locator('.definition-row').first().locator('td')).toHaveCount(workspace.fields.length);
  await expect(page.locator('.table-position > span')).toHaveText(['1']);
  await expect(page.getByLabel('项目自定义的偏离描述标签', { exact: true })).toHaveValue(workspace.definitions[0].description);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const scroller = page.getByRole('region', { name: 'PD 定义表格，可横向滚动' });
  await scroller.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
  await expect(page.getByLabel('备注', { exact: true })).toBeVisible();
});

test('workflow pages provide working top and bottom navigation without the category warning', async ({ page }) => {
  await mockWorkspace(page);
  const workspace = structuredClone(initialWorkspace);
  workspace.categories = Array.from({ length: 25 }, (_, index) => ({ ...workspace.categories[0], ord: index + 1, name: `分类 ${index + 1}` }));
  await page.route('**/api/project/1/workspace', (route) => route.fulfill({ json: workspace }));
  await open(page, 'PD 分类');
  await expect(page.getByText('保存分类将清空事实；已有定义需重新核对。', { exact: true })).toHaveCount(0);
  for (const tab of ['PD 分类', '方案事实抽取', '字段协议', 'PD 定义生成']) {
    await page.getByRole('button', { name: tab, exact: true }).click();
    await page.getByRole('button', { name: '到底部', exact: true }).click();
    await expect.poll(() => page.evaluate(() => Math.abs(document.documentElement.scrollHeight - innerHeight - scrollY))).toBeLessThan(3);
    await page.getByRole('button', { name: '回到顶部', exact: true }).click();
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  }
  await page.getByRole('button', { name: '方案校验', exact: true }).click();
  await expect(page.getByRole('button', { name: '回到顶部', exact: true })).toHaveCount(0);
});
