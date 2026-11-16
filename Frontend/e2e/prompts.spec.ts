import { test, expect, type Page } from '@playwright/test';
import { acceptConfirmation, initialPrompts, initialWorkspace, mockWorkspace } from './fixtures';

async function openProject(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /^ABC-001 临床研究/ }).click();
}

test('toolbar manages all project prompts independently without sending AI', async ({ page }) => {
  await mockWorkspace(page);
  let sends = 0;
  let saves = 0;
  page.on('request', (request) => {
    if (/\/(extract_facts|generate_definitions|attach|revise_facts|revise_definitions)$/.test(request.url())) sends += 1;
    if (request.url().endsWith('/prompts') && request.method() === 'PUT') saves += 1;
  });
  await openProject(page);
  const trigger = page.getByRole('button', { name: '管理项目提示词', exact: true });
  const toolbar = page.locator('.workspace-head .compact-actions').getByRole('button');
  await expect(toolbar).toHaveCount(4);
  const tops = await toolbar.evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().top));
  expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(1);
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: '项目提示词', exact: true });
  await expect(dialog.getByRole('tab')).toHaveCount(5);
  await expect(dialog.getByRole('textbox')).toHaveCount(2);
  await expect(dialog.getByLabel('系统提示词', { exact: true })).toHaveValue(initialPrompts.system);
  await expect(dialog.getByLabel('方案验证提示词', { exact: true })).toHaveValue(initialPrompts.validation);
  await dialog.getByRole('tab', { name: '事实抽取', exact: true }).click();
  await dialog.getByLabel('事实抽取提示词', { exact: true }).fill('尚未保存 $categories');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  expect(saves).toBe(0);
  await trigger.click();
  await dialog.getByRole('tab', { name: '事实抽取', exact: true }).click();
  await expect(dialog.getByLabel('事实抽取提示词', { exact: true })).toHaveValue(initialPrompts.extract);
  await dialog.getByLabel('事实抽取提示词', { exact: true }).fill('保存后的抽取规则 $categories');
  await dialog.getByRole('button', { name: '保存提示词', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(saves).toBe(1);
  expect(sends).toBe(0);
  await page.reload();
  await page.getByRole('button', { name: /^ABC-001 临床研究/ }).click();
  await trigger.click();
  await dialog.getByRole('tab', { name: '事实抽取', exact: true }).click();
  await expect(dialog.getByLabel('事实抽取提示词', { exact: true })).toHaveValue('保存后的抽取规则 $categories');
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await page.getByRole('button', { name: '返回项目列表', exact: true }).click();
  await page.getByRole('button', { name: /^第二个项目/ }).click();
  await trigger.click();
  await dialog.getByRole('tab', { name: '事实抽取', exact: true }).click();
  await expect(dialog.getByLabel('事实抽取提示词', { exact: true })).toHaveValue(initialPrompts.extract);
  expect(sends).toBe(0);
});

test('function tabs pair each task with the shared system prompt and retain all draft edits', async ({ page }) => {
  await mockWorkspace(page);
  await openProject(page);
  await page.getByRole('button', { name: '管理项目提示词', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '项目提示词', exact: true });
  const system = dialog.getByLabel('系统提示词', { exact: true });
  await system.fill('所有功能共用的系统提示词');
  await dialog.getByLabel('方案验证提示词', { exact: true }).fill('自定义文档验证规则');
  await dialog.getByRole('tab', { name: '文档验证', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(dialog.getByRole('tab', { name: '事实抽取', exact: true })).toBeFocused();
  await expect(dialog.getByRole('tabpanel', { name: '事实抽取', exact: true })).toBeVisible();
  await expect(system).toHaveValue('所有功能共用的系统提示词');
  await dialog.getByLabel('事实抽取提示词', { exact: true }).fill('自定义抽取规则 $categories');
  for (const [tab, field, content] of [
    ['事实修订', '事实修订提示词', initialPrompts.revise_facts],
    ['定义生成', '定义生成提示词', initialPrompts.generate],
    ['定义修订', '定义修订提示词', initialPrompts.revise_definitions],
  ]) {
    await dialog.getByRole('tab', { name: tab, exact: true }).click();
    await expect(dialog.getByRole('tabpanel', { name: tab, exact: true })).toBeVisible();
    await expect(dialog.getByRole('textbox')).toHaveCount(2);
    await expect(system).toHaveValue('所有功能共用的系统提示词');
    await expect(dialog.getByLabel(field, { exact: true })).toHaveValue(content);
  }
  await dialog.getByRole('tab', { name: '文档验证', exact: true }).click();
  await expect(dialog.getByLabel('方案验证提示词', { exact: true })).toHaveValue('自定义文档验证规则');
  await dialog.getByRole('tab', { name: '事实抽取', exact: true }).click();
  await expect(dialog.getByLabel('事实抽取提示词', { exact: true })).toHaveValue('自定义抽取规则 $categories');
  const saved = page.waitForRequest((request) => request.url().endsWith('/prompts') && request.method() === 'PUT');
  await dialog.getByRole('button', { name: '保存提示词', exact: true }).click();
  expect((await saved).postDataJSON()).toEqual({
    ...initialPrompts, system: '所有功能共用的系统提示词',
    validation: '自定义文档验证规则', extract: '自定义抽取规则 $categories',
  });
  await expect(dialog).toHaveCount(0);
});

test('prompt textareas fit loaded text, grow and shrink on edits and reflow on width changes', async ({ page }, testInfo) => {
  await mockWorkspace(page);
  const longSystem = Array.from({ length: 12 }, (_, index) => `系统提示词第 ${index + 1} 行`).join('\n');
  const longTask = Array.from({ length: 24 }, (_, index) => `文档验证规则第 ${index + 1} 行`).join('\n');
  await page.route('**/api/project/1/prompts', (route) => route.fulfill({
    json: { ...initialPrompts, system: longSystem, validation: longTask },
  }));
  await openProject(page);
  await page.getByRole('button', { name: '管理项目提示词', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '项目提示词', exact: true });
  const system = dialog.getByLabel('系统提示词', { exact: true });
  const task = dialog.getByLabel('方案验证提示词', { exact: true });
  await expect(task).toHaveValue(longTask);
  for (const field of [system, task]) {
    await expect.poll(() => field.evaluate((element) => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
    await expect(field).toHaveCSS('resize', 'none');
  }
  const initialHeight = await task.evaluate((element) => element.clientHeight);
  expect(initialHeight).toBeGreaterThan(400);
  await task.fill('短提示词');
  await expect.poll(() => task.evaluate((element) => element.clientHeight)).toBeLessThan(initialHeight);
  await task.fill(`${longTask}\n${longTask}`);
  await expect.poll(() => task.evaluate((element) => element.clientHeight)).toBeGreaterThan(initialHeight);
  await expect.poll(() => task.evaluate((element) => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
  await task.fill('这是一段用于验证提示词在不同宽度下自动换行的长文本。'.repeat(30));
  await page.setViewportSize({ width: 1000, height: 900 });
  await expect.poll(() => task.evaluate((element) => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
  const wideHeight = await task.evaluate((element) => element.clientHeight);
  await page.setViewportSize({ width: 375, height: 812 });
  await expect.poll(() => task.evaluate((element) => element.clientHeight)).toBeGreaterThan(wideHeight);
  await expect.poll(() => task.evaluate((element) => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
  await dialog.getByRole('tab', { name: '事实抽取', exact: true }).click();
  await dialog.getByRole('tab', { name: '文档验证', exact: true }).click();
  await expect.poll(() => task.evaluate((element) => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
  await expect.poll(() => dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('prompt-tabs.png') });
});

for (const existing of [false, true]) {
  test(`split buttons preview read-only and run directly ${existing ? 'with existing results' : 'without existing results'}`, async ({ page }, testInfo) => {
    await mockWorkspace(page);
    let sends = 0;
    let saves = 0;
    const operations: string[] = [];
    page.on('request', (request) => {
      if (/\/(extract_facts|generate_definitions)$/.test(request.url())) sends += 1;
      if (request.url().endsWith('/prompts') && request.method() === 'PUT') saves += 1;
      if (request.url().endsWith('/prompt_preview')) operations.push(request.postDataJSON().operation);
    });
    for (const [tab, action, operation] of [
      ['方案事实抽取', '提取事实', 'extract'], ['PD 定义生成', '生成定义', 'generate'],
    ]) {
      const workspace = structuredClone(initialWorkspace);
      if (!existing) {
        if (operation === 'extract') workspace.facts = [];
        else workspace.definitions = [];
      }
      await page.route('**/api/project/1/workspace', (route) => route.fulfill({ json: workspace }));
      await openProject(page);
      await page.getByRole('button', { name: tab, exact: true }).click();
      const main = page.getByRole('button', { name: action, exact: true });
      await expect(main).toHaveText(existing ? operation === 'extract' ? '重新提取' : '重新生成' : action);
      const toggle = page.getByRole('button', { name: `${action}更多选项`, exact: true });
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect(page.getByRole('menuitem')).toBeFocused();
      await page.getByRole('menuitem', { name: '预览即将提交的提示词', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '即将提交的提示词', exact: true });
      const preview = dialog.getByRole('region', { name: '完整请求预览', exact: true });
      await expect(preview).toContainText(initialPrompts.system);
      await expect(preview).toContainText('知情同意');
      await expect(preview).toContainText('附件：file-test');
      if (operation === 'generate') await expect(preview).toContainText(initialWorkspace.facts[0].content);
      await expect(dialog.getByRole('textbox')).toHaveCount(0);
      await expect(dialog.getByRole('button', { name: /保存|发送/ })).toHaveCount(0);
      expect(saves).toBe(0);
      expect(sends).toBe(operations.length - 1);
      await expect.poll(() => dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`${operation}-preview.png`) });
      await dialog.getByRole('button', { name: '关闭预览', exact: true }).click();
      await expect(toggle).toBeFocused();
      await main.click();
      if (existing) await acceptConfirmation(page, '继续替换');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.locator('.operation-notice')).toContainText('生成完成并已保存');
      expect(sends).toBe(operations.length);
      await page.unroute('**/api/project/1/workspace');
    }
    expect(operations).toEqual(['extract', 'generate']);
  });
}

test('AI adjustment preview icons show current requirements without submitting or asking to replace', async ({ page }) => {
  await mockWorkspace(page);
  const requests: string[] = [];
  for (const suffix of ['revise_facts', 'revise_definitions']) {
    await page.route(`**/api/project/1/${suffix}`, (route) => {
      requests.push(route.request().postDataJSON().requirements);
      return route.fulfill({ json: suffix === 'revise_facts' ? { facts: initialWorkspace.facts } : { definitions: initialWorkspace.definitions } });
    });
  }
  await openProject(page);
  for (const [tab, field, previewLabel, submitLabel] of [
    ['方案事实抽取', '事实修订要求', '预览事实修订提示词', '提交事实修订'],
    ['PD 定义生成', '定义修订要求', '预览定义修订提示词', '提交定义修订'],
  ]) {
    await page.getByRole('button', { name: tab, exact: true }).click();
    const trigger = page.getByRole('button', { name: previewLabel, exact: true });
    await expect(trigger).toBeDisabled();
    await page.getByLabel(field, { exact: true }).fill('保留明确要求');
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: '即将提交的提示词', exact: true });
    const preview = dialog.getByRole('region', { name: '完整请求预览', exact: true });
    await expect(preview).toContainText('assistant');
    await expect(preview).toContainText(initialWorkspace.facts[0].content);
    await expect(preview).toContainText('保留明确要求');
    await expect(dialog.getByRole('textbox')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await page.getByLabel(field, { exact: true }).fill('最新修订要求');
    await trigger.click();
    await expect(preview).toContainText('最新修订要求');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: submitLabel, exact: true }).click();
    await acceptConfirmation(page, '继续替换');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.operation-notice')).toContainText('修订完成并已保存');
  }
  expect(requests).toEqual(['最新修订要求', '最新修订要求']);
});

test('prompt save and preview errors are explicit and unsaved upstream edits block preview', async ({ page }) => {
  await mockWorkspace(page);
  await page.route('**/api/project/1/prompts', (route) => route.request().method() === 'PUT'
    ? route.fulfill({ status: 422, json: { detail: '必须保留变量 categories' } }) : route.fallback());
  await openProject(page);
  await page.getByRole('button', { name: '管理项目提示词', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '项目提示词', exact: true });
  await editor.getByRole('tab', { name: '事实抽取', exact: true }).click();
  await editor.getByLabel('事实抽取提示词', { exact: true }).fill('缺少变量');
  await editor.getByRole('button', { name: '保存提示词', exact: true }).click();
  await expect(editor.getByRole('alert')).toContainText('必须保留变量');
  await expect(editor.getByLabel('事实抽取提示词', { exact: true })).toHaveValue('缺少变量');
  await page.keyboard.press('Escape');
  await page.route('**/api/project/1/prompt_preview', (route) => route.fulfill({
    status: 503, json: { detail: '暂时无法预览，请重试' },
  }));
  await page.getByRole('button', { name: '方案事实抽取', exact: true }).click();
  await page.getByRole('button', { name: '提取事实更多选项', exact: true }).click();
  await page.getByRole('menuitem').click();
  const preview = page.getByRole('dialog', { name: '即将提交的提示词', exact: true });
  await expect(preview.getByRole('alert')).toContainText('暂时无法预览');
  await expect(preview.getByRole('textbox')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'PD 分类', exact: true }).click();
  await page.getByLabel('分类名称', { exact: true }).first().fill('未保存分类');
  await page.getByRole('button', { name: '方案事实抽取', exact: true }).click();
  await page.getByRole('button', { name: '提取事实更多选项', exact: true }).click();
  await page.getByRole('menuitem').click();
  await expect(page.getByRole('dialog', { name: '提示', exact: true })).toContainText('请先保存上游');
});

test('split menu supports keyboard dismissal and disabled states', async ({ page }) => {
  await mockWorkspace(page);
  await openProject(page);
  await page.getByRole('button', { name: '方案事实抽取', exact: true }).click();
  const toggle = page.getByRole('button', { name: '提取事实更多选项', exact: true });
  await toggle.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(toggle).toBeFocused();
  await toggle.click();
  await page.getByRole('heading', { name: /^方案事实/ }).click();
  await expect(page.getByRole('menu')).toHaveCount(0);
  const workspace = structuredClone(initialWorkspace);
  workspace.project.file_valid = 0;
  await page.route('**/api/project/1/workspace', (route) => route.fulfill({ json: workspace }));
  await page.reload();
  await page.getByRole('button', { name: /^ABC-001 临床研究/ }).click();
  await page.getByRole('button', { name: '方案事实抽取', exact: true }).click();
  await expect(toggle).toBeDisabled();
  await expect(page.getByRole('button', { name: '提取事实', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '预览事实修订提示词', exact: true })).toBeDisabled();
});
