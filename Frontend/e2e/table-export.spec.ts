import { test, expect, type Page } from '@playwright/test';
import ExcelJS from 'exceljs';
import { acceptConfirmation, initialWorkspace, mockWorkspace } from './fixtures';

async function open(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /^ABC-001 临床研究/ }).click();
  await page.getByRole('button', { name: 'PD 定义生成', exact: true }).click();
}

test('long tables extend naturally with a sticky top scrollbar and hover row actions', async ({ page }) => {
  await mockWorkspace(page);
  const workspace = structuredClone(initialWorkspace);
  workspace.definitions = Array.from({ length: 60 }, (_, index) => ({ ...workspace.definitions[0], position: index + 1, pd_ord: `1.${index + 1}` }));
  await page.route('**/api/project/1/workspace', (route) => route.fulfill({ json: workspace }));
  await open(page);
  const table = page.getByRole('region', { name: 'PD 定义表格，可横向滚动', exact: true });
  const scrollbar = page.getByRole('region', { name: 'PD 定义顶部水平滚动条', exact: true });
  await scrollbar.scrollIntoViewIfNeeded();
  const initialY = await page.evaluate(() => scrollY);
  await expect.poll(() => table.evaluate((element) => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
  await expect(table).toHaveCSS('scrollbar-width', 'none');
  await expect.poll(() => table.evaluate((element) => element.clientHeight)).toBeGreaterThan(3000);
  await page.locator('.definition-table-frame').evaluate((element) => window.scrollTo(0, element.getBoundingClientRect().top + scrollY + 650));
  await expect.poll(() => page.locator('.definition-table-sticky').evaluate((element) => Math.abs(element.getBoundingClientRect().top))).toBeLessThan(2);
  await expect(page.locator('.definition-table-header')).toBeInViewport();
  await page.evaluate((position) => window.scrollTo(0, position), initialY);
  await page.getByRole('button', { name: '向右滚动表格', exact: true }).click();
  await expect.poll(() => table.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await expect.poll(async () => Math.abs(await scrollbar.evaluate((element) => element.scrollLeft) - await table.evaluate((element) => element.scrollLeft))).toBeLessThan(2);
  expect(await page.evaluate(() => scrollY)).toBe(initialY);
  await scrollbar.focus();
  await page.keyboard.press('End');
  await expect.poll(() => table.evaluate((element) => Math.abs(element.scrollWidth - element.clientWidth - element.scrollLeft))).toBeLessThan(2);
  const controls = page.locator('.definition-row').first().locator('.table-row-controls');
  await page.mouse.move(0, 0);
  await expect(controls).toHaveCSS('opacity', '0');
  await page.locator('.definition-row').first().hover();
  await expect(controls).toHaveCSS('opacity', '1');
  const tableBounds = (await table.boundingBox())!;
  let controlBounds = (await controls.boundingBox())!;
  expect(Math.abs(controlBounds.x + controlBounds.width - tableBounds.x - tableBounds.width + 8)).toBeLessThan(2);
  const rightEdge = await table.evaluate((element) => element.scrollLeft);
  await page.getByRole('button', { name: '向左滚动表格', exact: true }).click();
  await expect.poll(() => table.evaluate((element) => element.scrollLeft)).toBeLessThan(rightEdge);
  await table.evaluate((element) => { element.scrollLeft = 0; });
  await page.locator('.definition-row').first().hover();
  controlBounds = (await controls.boundingBox())!;
  expect(Math.abs(controlBounds.x + controlBounds.width - tableBounds.x - tableBounds.width + 8)).toBeLessThan(2);
  const insert = page.getByRole('button', { name: '在定义 1 下方插入', exact: true });
  const bounds = (await insert.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await insert.click();
  await expect(page.locator('.definition-row')).toHaveCount(61);
  await expect(page.getByLabel('方案偏离编号', { exact: true }).nth(1)).toHaveValue('');
  await expect(page.getByLabel('方案偏离编号', { exact: true }).nth(2)).toHaveValue('1.2');
  await expect(page.getByLabel('方案偏离分类', { exact: true }).nth(1)).toBeFocused();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('definition confirmation saves, survives reload and sorting, and clears on editing', async ({ page }) => {
  const data = await mockWorkspace(page);
  await open(page);
  await page.locator('.definition-row').first().hover();
  await page.getByRole('button', { name: '确认定义 1', exact: true }).click();
  await expect(page.getByRole('button', { name: '取消确认定义 1', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '保存定义修改', exact: true }).click();
  await expect.poll(() => data().definitions[0].checked).toBe(1);
  await page.reload();
  await page.getByRole('button', { name: /^ABC-001 临床研究/ }).click();
  await page.getByRole('button', { name: 'PD 定义生成', exact: true }).click();
  await page.locator('.definition-row').first().hover();
  await expect(page.getByRole('button', { name: '取消确认定义 1', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '取消确认定义 1', exact: true }).click();
  await expect(page.getByRole('button', { name: '确认定义 1', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: '确认定义 1', exact: true }).click();
  await page.getByRole('button', { name: '在定义 1 下方插入', exact: true }).click();
  const handle = page.getByRole('button', { name: '拖动定义 1', exact: true });
  await handle.focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: '取消确认定义 2', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('方案偏离编号', { exact: true }).nth(1).fill('1.99');
  await expect(page.getByRole('button', { name: '确认定义 2', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.locator('.definition-row').first().hover();
  await page.getByRole('button', { name: '删除定义 1', exact: true }).click();
  await acceptConfirmation(page, '删除');
  await expect(page.locator('.definition-row')).toHaveCount(1);
  await expect(page.locator('.table-position > span')).toHaveText(['1']);
});

test('AI chat send buttons are icon-only and submit the correct request', async ({ page }) => {
  await mockWorkspace(page);
  let factsRequest = '';
  let definitionsRequest = '';
  await page.route('**/api/project/1/revise_facts', async (route) => {
    factsRequest = route.request().postDataJSON().requirements;
    await route.fulfill({ json: { facts: initialWorkspace.facts } });
  });
  await page.route('**/api/project/1/revise_definitions', async (route) => {
    definitionsRequest = route.request().postDataJSON().requirements;
    await route.fulfill({ json: { definitions: initialWorkspace.definitions } });
  });
  await open(page);
  await expect(page.getByRole('button', { name: '提交定义修订', exact: true })).toBeDisabled();
  await page.getByLabel('定义修订要求', { exact: true }).fill('明确偏离描述');
  expect((await page.locator('.ai-send').innerText()).trim()).toBe('');
  await page.getByRole('button', { name: '提交定义修订', exact: true }).click();
  await acceptConfirmation(page, '继续替换');
  await expect.poll(() => definitionsRequest).toBe('明确偏离描述');
  await expect(page.locator('.operation-notice')).toContainText('修订完成并已保存');
  await page.getByRole('button', { name: '方案事实抽取', exact: true }).click();
  await expect(page.getByRole('button', { name: '提交事实修订', exact: true })).toBeDisabled();
  await page.getByLabel('事实修订要求', { exact: true }).fill('补充研究访视要求');
  await page.getByRole('button', { name: '提交事实修订', exact: true }).click();
  await acceptConfirmation(page, '继续替换');
  await expect.poll(() => factsRequest).toBe('补充研究访视要求');
});

test('Excel exports only one formatted sheet with safe contiguous merges and mixed-script fonts', async ({ page }) => {
  await mockWorkspace(page);
  const workspace = structuredClone(initialWorkspace);
  workspace.project.version = 'v2';
  workspace.project.version_date = '2026/1/9';
  workspace.definitions = [
    { ...workspace.definitions[0], requirements: '中文 standard', note: '备注 Note', pd_ord: '1.01' },
    { ...workspace.definitions[0], requirements: '中文 standard', pd_ord: '1.02' },
    { ...workspace.definitions[0], requirements: '另一标准', pd_ord: '1.03' },
    { ...workspace.definitions[0], pd_category_name: '2.安全性', requirements: '另一标准', pd_ord: '2.01' },
    { ...workspace.definitions[0], requirements: '中文 standard', pd_ord: '1.04' },
  ];
  await page.route('**/api/project/1/workspace', (route) => route.fulfill({ json: workspace }));
  await open(page);
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Excel', exact: true }).click();
  const download = await pending;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile((await download.path())!);
  expect(workbook.worksheets).toHaveLength(1);
  const sheet = workbook.getWorksheet('PD 定义')!;
  expect(sheet.getRow(1).values).toEqual([
    undefined, '方案版本', ...workspace.fields.filter((field) => field.name !== 'position').map((field) => field.label),
  ]);
  expect(sheet.model.merges.sort()).toEqual(['A2:A6', 'B2:B4', 'D2:D3', 'D4:D5'].sort());
  expect(sheet.getCell('A2').text).toBe('V2.0 / 2026-01-09');
  expect(sheet.getCell('A6').master.address).toBe('A2');
  expect(sheet.getCell('B6').isMerged).toBe(false);
  expect(sheet.getCell('D6').text).toBe('中文 standard');
  expect(sheet.getCell('D6').isMerged).toBe(false);
  expect(sheet.getCell('B2').text).toBe('1.知情同意');
  expect(sheet.getCell('C2').font.name).toBe('Times New Roman');
  expect(sheet.getCell('A1').font.name).toBe('微软雅黑');
  const value = sheet.getCell('D2').value as ExcelJS.CellRichTextValue;
  expect(value.richText.map((run) => [run.text, run.font?.name, run.font?.size])).toEqual([
    ['中文', '微软雅黑', 10], [' standard', 'Times New Roman', 10],
  ]);
  sheet.eachRow((row) => row.eachCell({ includeEmpty: true }, (cell) => {
    expect(cell.alignment.horizontal).toBe('left');
    expect(cell.alignment.vertical).toBe('top');
    expect(cell.font.size).toBe(10);
  }));
  expect(sheet.autoFilter).toBe('A1:H1');
});

test('Excel export rejects missing or invalid saved version metadata clearly', async ({ page }) => {
  await mockWorkspace(page);
  const workspace = structuredClone(initialWorkspace);
  workspace.project.version_date = '2026-02-30';
  await page.route('**/api/project/1/workspace', (route) => route.fulfill({ json: workspace }));
  await open(page);
  await page.getByRole('button', { name: '导出 Excel', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('方案版本日期无效');
  await expect(page.getByRole('button', { name: '导出 Excel', exact: true })).toBeEnabled();
});
