import { test, expect, type Page } from '@playwright/test';
import { acceptConfirmation, initialWorkspace, mockWorkspace } from './fixtures';

async function openProject(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /^ABC-001 临床研究/ }).click();
}

async function moveWithKeyboard(page: Page, name: string, direction: 'ArrowUp' | 'ArrowDown') {
  await page.getByRole('button', { name, exact: true }).focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press(direction);
  await expect.poll(() => page.locator('.dragging').evaluate((node) => new DOMMatrix(getComputedStyle(node).transform).m42)).not.toBe(0);
  await page.keyboard.press('Space');
}

test('a background AI job does not block another project and keeps its results', async ({ page }) => {
  await mockWorkspace(page);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const result = { ...initialWorkspace.facts[0], content: '第一项目后台提取完成' };
  await page.route('**/api/project/1/extract_facts', async (route) => {
    await pending;
    await route.fulfill({ json: { facts: [result] } });
  });
  await page.route('**/api/project/2/extract_facts', (route) => route.fulfill({ json: { facts: [{ ...result, pd_category_name: '独立分类', content: '第二项目提取完成' }] } }));
  await openProject(page);
  await page.getByRole('button', { name: /方案事实抽取/ }).click();
  await page.getByRole('button', { name: '提取事实', exact: true }).click();
  await acceptConfirmation(page, '继续替换');
  await expect(page.locator('.results-content .processing')).toContainText('正在提取事实');
  await expect(page.getByRole('textbox', { name: '事实内容', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '返回项目列表', exact: true }).click();
  await expect(page.getByRole('button', { name: /^ABC-001 临床研究/ })).toContainText('AI 处理中');
  await page.getByRole('button', { name: /^ABC-001 临床研究/ }).click();
  await expect(page.locator('.workspace:not([hidden]) .processing')).toBeVisible();
  await page.getByRole('button', { name: '返回项目列表', exact: true }).click();
  await page.getByRole('button', { name: /^第二个项目/ }).click();
  await page.getByLabel('方案标题', { exact: true }).fill('独立编辑');
  await page.getByRole('button', { name: /方案事实抽取/ }).click();
  await page.getByRole('button', { name: '提取事实', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '事实内容', exact: true })).toHaveValue('第二项目提取完成');
  release();
  await expect(page.locator('.project-row')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: '事实内容', exact: true })).toHaveValue('第二项目提取完成');
  await page.getByRole('button', { name: '返回项目列表', exact: true }).click();
  await acceptConfirmation(page, '放弃修改');
  await page.getByRole('button', { name: /^ABC-001 临床研究/ }).click();
  await expect(page.getByRole('textbox', { name: '事实内容', exact: true })).toHaveValue('第一项目后台提取完成');
  await expect(page.getByRole('button', { name: '提取事实', exact: true })).toBeEnabled();
});

test('facts and definitions support insertion, sorting and normalized saved positions', async ({ page }) => {
  const data = await mockWorkspace(page);
  await openProject(page);
  await page.getByRole('button', { name: /方案事实抽取/ }).click();
  await page.getByRole('button', { name: '确认事实 1', exact: true }).click();
  await page.getByRole('textbox', { name: '事实内容', exact: true }).hover();
  await page.getByRole('button', { name: '在事实 1 下方插入', exact: true }).click();
  await page.getByRole('textbox', { name: '事实内容', exact: true }).nth(1).fill('中间插入事实');
  await moveWithKeyboard(page, '拖动事实 2', 'ArrowUp');
  await expect(page.getByRole('textbox', { name: '事实内容', exact: true }).first()).toHaveValue('中间插入事实');
  await page.getByRole('button', { name: '保存事实修改', exact: true }).click();
  await expect(page.locator('.workspace:not([hidden]) .operation-notice')).toContainText('修改已保存');
  expect(data().facts.map((row) => row.position)).toEqual([1, 2]);
  expect(data().facts.map((row) => row.checked)).toEqual([0, 1]);
  expect(data().facts[0]).not.toHaveProperty('_key');
  await page.getByRole('button', { name: /PD 定义生成/ }).click();
  await page.locator('.definition-row').first().hover();
  await page.getByRole('button', { name: '在定义 1 下方插入', exact: true }).click();
  await page.getByLabel('方案偏离编号', { exact: true }).nth(1).fill('2.01');
  await page.getByLabel('方案中的标准', { exact: true }).nth(1).fill('新增标准');
  await page.getByLabel('方案偏离分类', { exact: true }).nth(1).fill('知情同意');
  await page.getByLabel('方案偏离的具体描述', { exact: true }).nth(1).fill('插入的定义');
  await moveWithKeyboard(page, '拖动定义 2', 'ArrowUp');
  await expect(page.getByLabel('方案偏离编号', { exact: true }).first()).toHaveValue('2.01');
  await expect(page.locator('.table-position > span')).toHaveText(['1', '2']);
  await page.getByRole('button', { name: '保存定义修改', exact: true }).click();
  await expect(page.locator('.workspace:not([hidden]) .operation-notice')).toContainText('修改已保存');
  expect(data().definitions.map((row) => row.position)).toEqual([1, 2]);
  expect(data().definitions[0].pd_ord).toBe('2.01');
});

test('category insertion and pointer dragging keep the edited row identity', async ({ page }) => {
  const data = await mockWorkspace(page);
  await openProject(page);
  await page.getByRole('button', { name: /PD 分类/ }).click();
  await page.getByLabel('分类名称').first().hover();
  await page.getByRole('button', { name: '在分类 1 下方插入', exact: true }).click();
  await page.getByLabel('分类名称').nth(1).fill('插入分类');
  await page.locator('.row-details summary').nth(1).click();
  await page.getByLabel('分类描述').nth(1).fill('新描述');
  await page.getByLabel('提取方法').nth(1).fill('新方法');
  await page.locator('.row-details summary').nth(1).click();
  const source = page.getByRole('button', { name: '拖动分类 2', exact: true });
  const target = page.getByRole('button', { name: '拖动分类 1', exact: true });
  await source.scrollIntoViewIfNeeded();
  const start = (await source.boundingBox())!;
  const end = (await target.boundingBox())!;
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2 - 10, { steps: 3 });
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByLabel('分类名称').first()).toHaveValue('插入分类');
  await page.getByRole('button', { name: '保存分类配置', exact: true }).click();
  await acceptConfirmation(page, '保存并清空事实');
  await expect(page.locator('.workspace:not([hidden]) .operation-notice')).toContainText('分类已保存');
  expect(data().categories.map((row) => row.ord)).toEqual([1, 2, 3]);
  expect(data().categories[0].description).toBe('新描述');
});

test('upload progress stays beside the file and navigation remains available', async ({ page }) => {
  await mockWorkspace(page);
  const workspace = structuredClone(initialWorkspace);
  workspace.project.file_name = null; workspace.project.file_valid = 0;
  await page.route('**/api/project/1/workspace', (route) => route.fulfill({ json: workspace }));
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/project/1/attach', async (route) => {
    await pending;
    await route.fulfill({ json: initialWorkspace.project });
  });
  await openProject(page);
  await expect(page.locator('.drop-zone')).toContainText('上传并验证方案');
  await expect(page.locator('.drop-zone')).toHaveCSS('cursor', 'pointer');
  await page.getByLabel('方案文件', { exact: true }).setInputFiles({ name: 'protocol.pdf', mimeType: 'application/pdf', buffer: Buffer.from('mock protocol') });
  await expect(page.locator('.protocol-file .processing')).toBeVisible();
  await expect(page.locator('.status-notice')).toBeHidden();
  await expect(page.getByRole('button', { name: '配置分类', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '返回项目列表', exact: true }).click();
  await expect(page.getByRole('button', { name: /^第二个项目/ })).toBeEnabled();
  release();
  await page.getByRole('button', { name: /^ABC-001 临床研究/ }).click();
  await expect(page.getByText('校验通过', { exact: true })).toBeVisible();
});

test('field display sorting persists without mutating fixed backend identities', async ({ page }) => {
  await mockWorkspace(page);
  const workspace = structuredClone(initialWorkspace);
  await page.route('**/api/project/1/workspace', (route) => route.fulfill({ json: workspace }));
  await openProject(page);
  await page.getByRole('button', { name: /字段协议/ }).click();
  await moveWithKeyboard(page, '拖动字段 2', 'ArrowUp');
  await expect(page.locator('.field-row summary').first()).toContainText('方案偏离分类');
  await page.reload();
  await page.getByRole('button', { name: /^ABC-001 临床研究/ }).click();
  await page.getByRole('button', { name: /字段协议/ }).click();
  await expect(page.locator('.field-row summary').first()).toContainText('方案偏离分类');
});

test('a background AI failure stays in its own project and can be retried', async ({ page }) => {
  await mockWorkspace(page);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/project/1/extract_facts', async (route) => {
    await pending;
    await route.fulfill({ status: 502, json: { detail: '第一项目解析失败' } });
  });
  await openProject(page);
  await page.getByRole('button', { name: /方案事实抽取/ }).click();
  await page.getByRole('button', { name: '提取事实', exact: true }).click();
  await acceptConfirmation(page, '继续替换');
  await page.getByRole('button', { name: '返回项目列表', exact: true }).click();
  await page.getByRole('button', { name: /^第二个项目/ }).click();
  release();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: '方案标题', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '返回项目列表', exact: true }).click();
  await page.getByRole('button', { name: /^ABC-001 临床研究/ }).click();
  await expect(page.getByRole('alert')).toContainText('第一项目解析失败');
  await expect(page.getByRole('textbox', { name: '事实内容', exact: true })).toHaveValue(initialWorkspace.facts[0].content);
  await expect(page.getByRole('button', { name: '提取事实', exact: true })).toBeEnabled();
  await page.unroute('**/api/project/1/extract_facts');
  await page.getByRole('button', { name: '提取事实', exact: true }).click();
  await acceptConfirmation(page, '继续替换');
  await expect(page.locator('.workspace:not([hidden]) .operation-notice')).toContainText('生成完成并已保存');
});
