import { test, expect, type Page } from '@playwright/test';
import { acceptConfirmation, initialWorkspace, mockWorkspace } from './fixtures';

async function open(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /^ABC-001 临床研究/ }).click();
}

test.beforeEach(async ({ page }) => {
  await mockWorkspace(page);
  page.on('dialog', async (dialog) => {
    expect(dialog.type()).toBe('beforeunload');
    await dialog.accept();
  });
});

test('project deletion requires the exact name, supports cancellation and never deletes twice', async ({ page }) => {
  let deletions = 0;
  await page.route('**/api/project/1', (route) => {
    expect(route.request().method()).toBe('DELETE');
    deletions += 1;
    return route.fulfill({ json: { status: 'success' } });
  });
  await open(page);
  const trigger = page.getByRole('button', { name: '删除项目', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: '删除项目', exact: true });
  const input = dialog.getByLabel('输入项目名称以确认', { exact: true });
  const submit = dialog.getByRole('button', { name: '永久删除项目', exact: true });
  await expect(input).toBeFocused();
  await expect(submit).toBeDisabled();
  for (const name of ['ABC-001', 'abc-001 临床研究', 'ABC-001 临床研究 ']) {
    await input.fill(name);
    await expect(submit).toBeDisabled();
    await input.press('Enter');
    await expect(dialog).toBeVisible();
    expect(deletions).toBe(0);
  }
  await input.fill(initialWorkspace.project.name);
  await expect(submit).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(deletions).toBe(0);
  await trigger.click();
  await expect(input).toHaveValue('');
  await input.fill(initialWorkspace.project.name);
  await acceptConfirmation(page, '取消');
  expect(deletions).toBe(0);
  await trigger.click();
  await input.fill(initialWorkspace.project.name);
  await submit.click();
  await expect(page.getByRole('heading', { name: '项目', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^ABC-001 临床研究/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^第二个项目/ })).toBeVisible();
  expect(deletions).toBe(1);
});

test('failed deletion preserves the project and a retry asks for its current renamed name', async ({ page }) => {
  const renamed = '新名称 Project 2026';
  await page.route('**/api/project/1/rename?*', (route) => route.fulfill({ json: { ...initialWorkspace.project, name: renamed } }));
  let deletions = 0;
  await page.route('**/api/project/1', (route) => {
    deletions += 1;
    return route.fulfill({ status: 502, json: { detail: '暂时无法删除，请稍后重试' } });
  });
  await open(page);
  await page.getByRole('button', { name: '重命名项目', exact: true }).click();
  await page.getByRole('textbox', { name: '重命名项目', exact: true }).fill(renamed);
  await acceptConfirmation(page, '保存名称');
  await expect(page.getByRole('heading', { name: renamed, exact: true })).toBeVisible();
  await page.getByRole('button', { name: '删除项目', exact: true }).click();
  const input = page.getByLabel('输入项目名称以确认', { exact: true });
  await input.fill(initialWorkspace.project.name);
  await expect(page.getByRole('button', { name: '永久删除项目', exact: true })).toBeDisabled();
  await input.fill(renamed);
  await acceptConfirmation(page, '永久删除项目');
  await expect(page.getByRole('alert')).toContainText('暂时无法删除');
  await expect(page.getByRole('heading', { name: renamed, exact: true })).toBeVisible();
  await page.getByRole('button', { name: '删除项目', exact: true }).click();
  await expect(input).toHaveValue('');
  await expect(page.getByRole('button', { name: '永久删除项目', exact: true })).toBeDisabled();
  expect(deletions).toBe(1);
  await acceptConfirmation(page, '取消');
});

test('category, fact and definition deletion use cancellable application dialogs', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'PD 分类', exact: true }).click();
  await page.getByRole('button', { name: '删除分类 1', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '删除分类', exact: true })).toContainText('知情同意');
  await expect(page.getByRole('dialog').getByRole('button', { name: '取消', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('分类名称', { exact: true })).toHaveCount(2);
  await page.getByRole('button', { name: '删除分类 1', exact: true }).click();
  await acceptConfirmation(page, '删除');
  await expect(page.getByLabel('分类名称', { exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: '方案事实抽取', exact: true }).click();
  await page.getByRole('button', { name: '删除事实 1', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '删除事实', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('事实内容', { exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: '删除事实 1', exact: true }).click();
  await acceptConfirmation(page, '删除');
  await expect(page.getByLabel('事实内容', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'PD 定义生成', exact: true }).click();
  await page.locator('.definition-row').first().hover();
  await page.getByRole('button', { name: '删除定义 1', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '删除定义', exact: true })).toBeVisible();
  await acceptConfirmation(page, '取消');
  await expect(page.locator('.definition-row')).toHaveCount(1);
  await page.locator('.definition-row').first().hover();
  await page.getByRole('button', { name: '删除定义 1', exact: true }).click();
  await acceptConfirmation(page, '删除');
  await expect(page.locator('.definition-row')).toHaveCount(0);
});

test('upstream warnings, workspace refresh and dirty logout use application dialogs', async ({ page }) => {
  let refreshes = 0;
  let logouts = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/project/1/workspace')) refreshes += 1;
    if (request.url().endsWith('/api/auth/logout')) logouts += 1;
  });
  await open(page);
  await page.getByRole('button', { name: 'PD 分类', exact: true }).click();
  await page.getByLabel('分类名称', { exact: true }).first().fill('未保存分类');
  await page.getByRole('button', { name: '方案事实抽取', exact: true }).click();
  await page.getByRole('button', { name: '提取事实', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '提示', exact: true })).toContainText('请先保存上游');
  await acceptConfirmation(page, '知道了');
  await page.getByRole('button', { name: '刷新工作区', exact: true }).click();
  await acceptConfirmation(page, '取消');
  expect(refreshes).toBe(1);
  await page.getByRole('button', { name: '刷新工作区', exact: true }).click();
  await acceptConfirmation(page, '重新加载');
  await expect(page.getByLabel('方案标题', { exact: true })).toHaveValue(initialWorkspace.project.title!);
  expect(refreshes).toBe(2);
  await page.getByLabel('方案标题', { exact: true }).fill('尚未保存的方案标题');
  await page.getByRole('button', { name: '退出', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '退出登录', exact: true })).toContainText('未保存');
  await acceptConfirmation(page, '取消');
  expect(logouts).toBe(0);
  await expect(page.getByLabel('方案标题', { exact: true })).toHaveValue('尚未保存的方案标题');
  await page.getByRole('button', { name: '退出', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '退出', exact: true }).click();
  await expect(page.getByRole('heading', { name: '欢迎回来', exact: true })).toBeVisible();
  expect(logouts).toBe(1);
});

test('upload overwrite confirmation preserves metadata on cancellation', async ({ page }) => {
  const workspace = structuredClone(initialWorkspace);
  workspace.project.file_name = null;
  workspace.project.file_valid = 0;
  await page.route('**/api/project/1/workspace', (route) => route.fulfill({ json: workspace }));
  let uploads = 0;
  await page.route('**/api/project/1/attach', (route) => {
    uploads += 1;
    return route.fulfill({ json: initialWorkspace.project });
  });
  await open(page);
  await page.getByLabel('方案标题', { exact: true }).fill('尚未保存');
  const file = { name: 'protocol.pdf', mimeType: 'application/pdf', buffer: Buffer.from('mock protocol') };
  await page.getByLabel('方案文件', { exact: true }).setInputFiles(file);
  await expect(page.getByRole('dialog', { name: '覆盖方案信息', exact: true })).toBeVisible();
  await acceptConfirmation(page, '取消');
  expect(uploads).toBe(0);
  await expect(page.getByLabel('方案标题', { exact: true })).toHaveValue('尚未保存');
  await page.getByLabel('方案文件', { exact: true }).setInputFiles(file);
  await acceptConfirmation(page, '上传并验证');
  await expect(page.getByText('校验通过', { exact: true })).toBeVisible();
  expect(uploads).toBe(1);
});
