import type { Page } from '@playwright/test';
import type { WorkspaceData } from '../src/types';

export async function acceptConfirmation(page: Page, button: string) {
  await page.getByRole('dialog').getByRole('button', { name: button, exact: true }).click();
}

export const initialWorkspace: WorkspaceData = {
  project: {
    id: 1, name: 'ABC-001 临床研究', file_valid: 1, file_name: 'protocol.pdf',
    title: '试验方案', protocol_no: 'ABC-001', version: '1.0',
    version_date: '2026-11-11', sponsor: '研究申办方',
  },
  categories: [
    { ord: 1, name: '知情同意', description: '知情同意相关要求', method: '摘录原文' },
    { ord: 2, name: '安全性', description: '安全事件相关要求', method: '按章节总结' },
  ],
  fields: [
    { ord: 1, name: 'position', label: '序号', meaning: '行位置', required: true, allowed_values: [], example: [] },
    { ord: 2, name: 'pd_category_name', label: '方案偏离分类', meaning: '分类', required: true, allowed_values: [], example: [] },
    { ord: 3, name: 'pd_ord', label: '方案偏离编号', meaning: '编号', required: true, allowed_values: [], example: [] },
    { ord: 4, name: 'requirements', label: '方案中的标准', meaning: '原文要求', required: true, allowed_values: [], example: [] },
    { ord: 5, name: 'description', label: '方案偏离的具体描述', meaning: '偏离描述', required: true, allowed_values: [], example: [] },
    { ord: 6, name: 'review_method', label: '临床团队提供外其他核查方法', meaning: '核查方法', required: false, allowed_values: [], example: [] },
    { ord: 7, name: 'severity', label: '严重程度', meaning: '偏离的严重程度', required: false, allowed_values: ['Major', 'Minor'], requirements: '按影响判断', example: ['Major'] },
    { ord: 8, name: 'note', label: '备注', meaning: '备注', required: false, allowed_values: [], example: [] },
  ],
  facts: [
    { position: 1, pd_category_ord: 1, pd_category_name: '知情同意', content: '研究程序前签署知情同意书', source: '第 8.1 节', checked: 0 },
  ],
  definitions: [
    { checked: 0, position: 1, pd_category_name: '1.知情同意', pd_ord: '1.01', requirements: '研究程序前签署知情同意书', description: '未签署有效知情同意书即开始研究流程', review_method: '医学核查', severity: 'Major', note: null },
  ],
};

export async function mockWorkspace(page: Page) {
  let workspace = structuredClone(initialWorkspace);
  const second = structuredClone(initialWorkspace);
  second.project = { ...second.project, id: 2, name: '第二个项目' };
  second.categories = [{ ord: 1, name: '独立分类', description: '第二项目', method: '摘录原文' }];
  second.facts = []; second.definitions = [];
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api', '');
    const method = request.method();
    if (path === '/auth/me') return route.fulfill({ json: { id: 1, username: 'reviewer' } });
    if (path === '/auth/logout') return route.fulfill({ json: { status: 'success' } });
    if (path === '/projects') return route.fulfill({ json: [workspace.project, second.project] });
    if (path === '/project/1/workspace') return route.fulfill({ json: workspace });
    if (path === '/project/2/workspace') return route.fulfill({ json: second });
    if (path === '/project/1/pd_categories' && method === 'PUT') {
      workspace.categories = request.postDataJSON().categories; workspace.facts = [];
      return route.fulfill({ json: { categories: workspace.categories } });
    }
    if (path === '/project/1/update_fields' && method === 'PUT') {
      workspace.fields = request.postDataJSON().fields;
      return route.fulfill({ json: { fields: workspace.fields } });
    }
    if (path === '/project/1/metadata' && method === 'PUT') {
      workspace.project = { ...workspace.project, ...request.postDataJSON() };
      return route.fulfill({ json: workspace.project });
    }
    if (path === '/project/1/facts' && method === 'PUT') {
      workspace.facts = request.postDataJSON().facts;
      return route.fulfill({ json: { facts: workspace.facts } });
    }
    if (path === '/project/1/definitions' && method === 'PUT') {
      workspace.definitions = request.postDataJSON().definitions;
      return route.fulfill({ json: { definitions: workspace.definitions } });
    }
    if (path === '/project/1/extract_facts' && method === 'POST') {
      workspace.facts = structuredClone(initialWorkspace.facts);
      return route.fulfill({ json: { facts: workspace.facts } });
    }
    if (path === '/project/1/generate_definitions' && method === 'POST') {
      workspace.definitions = structuredClone(initialWorkspace.definitions);
      return route.fulfill({ json: { definitions: workspace.definitions } });
    }
    return route.fulfill({ status: 501, json: { detail: `Unexpected endpoint: ${method} ${path}` } });
  });
  return () => workspace;
}
