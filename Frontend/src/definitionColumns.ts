import type { DefinitionOut, FieldUpdate } from './types';

const defaults: Array<{ name: Exclude<keyof DefinitionOut, 'checked'>; label: string; width: number }> = [
  { name: 'position', label: '序号', width: 8 },
  { name: 'pd_category_name', label: '方案偏离分类', width: 24 },
  { name: 'pd_ord', label: '方案偏离编号', width: 16 },
  { name: 'requirements', label: '方案中的标准', width: 55 },
  { name: 'description', label: '方案偏离的具体描述', width: 55 },
  { name: 'review_method', label: '临床团队提供外其他核查方法', width: 22 },
  { name: 'severity', label: '严重程度', width: 16 },
  { name: 'note', label: '备注', width: 36 },
];

export function definitionColumns(fields?: FieldUpdate[]) {
  return defaults.map((column, index) => {
    const protocol = fields?.find((field) => field.name === column.name);
    return { ...column, label: protocol?.label ?? column.label, ord: protocol?.ord ?? index + 1,
      required: protocol?.required ?? ['pd_ord', 'description'].includes(column.name) };
  }).sort((left, right) => left.ord - right.ord);
}
