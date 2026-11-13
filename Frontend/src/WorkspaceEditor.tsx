import { useEffect, useState, type FormEvent } from 'react';
import { api } from './api/client';
import type { RunAction } from './AppBoard';
import { downloadDefinitions } from './export';
import { Icon, Modal, type IconName } from './ui';
import { DragHandle, SortableRow, SortableRows, moveRow, stripKeys, withKey, withKeys } from './SortableRows';
import { AutoTextarea, ScrollNavigation } from './EditorControls';
import { DefinitionsTable } from './DefinitionsTable';
import { useAppDialog } from './AppDialogs';
import type { DefinitionOut, FactOut, FieldUpdate, PDCategoryUpdate, ProjectInfo, ProtocolMetadata, WorkspaceData } from './types';

type Tab = 'protocol' | 'categories' | 'facts' | 'fields' | 'definitions';
const tabs: Array<[Tab, string]> = [
  ['protocol', '方案校验'], ['categories', 'PD 分类'], ['facts', '方案事实抽取'],
  ['fields', '字段协议'], ['definitions', 'PD 定义生成'],
];
const tabIcons: Record<Tab, IconName> = { protocol: 'file', categories: 'settings', facts: 'list', fields: 'settings', definitions: 'list' };
const metadataLabels: Array<[keyof ProtocolMetadata, string]> = [
  ['title', '方案标题'], ['protocol_no', '方案编号'], ['sponsor', '申办方'],
  ['version', '版本'], ['version_date', '版本日期'],
];
const metadataOf = (project: ProjectInfo): ProtocolMetadata => ({
  title: project.title ?? '', protocol_no: project.protocol_no ?? '', version: project.version ?? '',
  version_date: project.version_date ?? '', sponsor: project.sponsor ?? '',
});
const lines = (text: string) => text.split('\n').map((item) => item.trim()).filter(Boolean);
const positioned = <Row extends { position: number }>(rows: Row[]) => withKeys(rows.map((row, index) => ({ ...row, position: index + 1 })));

export default function WorkspaceEditor({ data, busy, status, run, onDirtyChange, onProjectChange, onDelete, onBack, onRefresh }: {
  data: WorkspaceData; busy: boolean; status: { text: string; error: boolean }; run: RunAction;
  onDirtyChange: (dirty: boolean) => void; onProjectChange: (project: ProjectInfo) => void;
  onDelete: () => Promise<void>;
  onBack: () => void; onRefresh: () => void;
}) {
  const { confirm, notify } = useAppDialog();
  const [project, setProject] = useState(data.project);
  const [name, setName] = useState(data.project.name);
  const [metadata, setMetadata] = useState(metadataOf(data.project));
  const [categories, setCategories] = useState(() => withKeys(data.categories));
  const fieldOrderKey = `pd-field-order:${data.project.id}`;
  function orderedFields(rows: FieldUpdate[]) {
    let order: string[] = [];
    try { order = JSON.parse(localStorage.getItem(fieldOrderKey) ?? '[]'); if (!Array.isArray(order)) order = []; } catch { order = []; }
    return withKeys(rows.map((field) => ({ ...field, allowedText: field.allowed_values.join('\n'), exampleText: field.example.join('\n') })))
      .sort((left, right) => (order.indexOf(left.name) < 0 ? 999 : order.indexOf(left.name)) - (order.indexOf(right.name) < 0 ? 999 : order.indexOf(right.name)));
  }
  const [fields, setFields] = useState(() => orderedFields(data.fields));
  const [facts, setFacts] = useState(() => positioned(data.facts));
  const [definitions, setDefinitions] = useState(() => positioned(data.definitions));
  const [tab, setTab] = useState<Tab>('protocol');
  const [dirty, setDirty] = useState<Tab[]>([]);
  const [factRequest, setFactRequest] = useState('');
  const [definitionRequest, setDefinitionRequest] = useState('');
  const [filter, setFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [focusKey, setFocusKey] = useState('');
  const id = project.id;
  const valid = project.file_valid === 1;
  const feedback = status.text && <div className={`notice operation-notice ${status.error ? 'error' : ''} ${busy ? 'processing' : ''}`} role={status.error ? 'alert' : 'status'} aria-live="polite">
    {busy && <span className="spinner" />}<span>{status.text}{busy && /提取|生成|修订|上传/.test(status.text) && <small>AI 处理可能需要一些时间，你可以返回项目列表继续其他项目。</small>}</span>
  </div>;
  function insertCategory(after: number) {
    const added = withKey({ ord: 0, name: '', description: '', method: '' });
    setFocusKey(added._key);
    setCategories((rows) => {
      const next = [...rows];
      next.splice(after + 1, 0, added);
      return next.map((row, index) => ({ ...row, ord: index + 1 }));
    }); mark('categories');
  }
  function insertFact(after: number) {
    const category = categories[0];
    if (!category || dirty.includes('categories')) { void notify('请先配置并保存 PD 分类。'); return; }
    const added = withKey<FactOut>({ position: 0, pd_category_ord: category.ord, pd_category_name: category.name, content: '', source: '', checked: 0 });
    setFocusKey(added._key);
    setFacts((rows) => {
      const next = [...rows];
      next.splice(after + 1, 0, added);
      return next.map((row, index) => ({ ...row, position: index + 1 }));
    }); mark('facts'); setFilter(''); setCategoryFilter('');
  }
  function insertDefinition(after: number) {
    const added = withKey<DefinitionOut>({ checked: 0, position: 0, pd_category_name: categories[0]?.name ?? '', pd_ord: '', requirements: '', description: '', review_method: '', severity: '', note: '' });
    setFocusKey(added._key);
    setDefinitions((rows) => {
      const next = [...rows];
      next.splice(after + 1, 0, added);
      return next.map((row, index) => ({ ...row, position: index + 1 }));
    }); mark('definitions'); setFilter(''); setCategoryFilter('');
  }
  useEffect(() => { onDirtyChange(dirty.length > 0); }, [dirty, onDirtyChange]);
  function mark(section: Tab) { setDirty((current) => current.includes(section) ? current : [...current, section]); }
  function clean(section: Tab) { setDirty((current) => current.filter((item) => item !== section)); }
  function updateProject(value: ProjectInfo) { setProject(value); onProjectChange(value); }
  function submit(event: FormEvent, label: string, action: () => Promise<void>, success: string) {
    event.preventDefault(); void run(label, action, success);
  }
  function categoryPatch(index: number, patch: Partial<PDCategoryUpdate>) {
    setCategories((items) => items.map((item, i) => i === index ? { ...item, ...patch } : item)); mark('categories');
  }
  function fieldPatch(index: number, patch: Partial<(typeof fields)[number]>) {
    setFields((items) => items.map((item, i) => i === index ? { ...item, ...patch } : item)); mark('fields');
  }
  function factPatch(index: number, patch: Partial<FactOut>) {
    setFacts((items) => items.map((item, i) => i === index ? { ...item, checked: 0, ...patch } : item)); mark('facts');
  }
  function definitionPatch(index: number, patch: Partial<DefinitionOut>) {
    setDefinitions((items) => items.map((item, i) => i === index ? { ...item, checked: 0, ...patch } : item)); mark('definitions');
  }
  async function canGenerate(section: 'facts' | 'definitions') {
    if (dirty.includes('categories') || (section === 'definitions' && (dirty.includes('fields') || dirty.includes('facts')))) {
      await notify('请先保存上游分类、事实或字段规则的修改，再运行 AI。'); return false;
    }
    return !(section === 'facts' ? facts.length : definitions.length) ||
      await confirm('此操作会替换当前列表，包括未保存修改，确定继续？', { title: '替换当前列表', confirmLabel: '继续替换' });
  }
  async function generate(section: 'facts' | 'definitions') {
    if (!await canGenerate(section)) return;
    void run(section === 'facts' ? '正在提取事实…' : '正在生成 PD 定义…', async () => {
      if (section === 'facts') setFacts(positioned((await api.getFacts(id)).facts));
      else setDefinitions(positioned((await api.getDefinitions(id)).definitions));
      clean(section);
    }, '生成完成并已保存');
  }

  return <>
    <div className="workspace-head">
      <div className="workspace-title"><button className="icon-button back-button" aria-label="返回项目列表" title="返回项目列表" onClick={onBack}><Icon name="back" /></button><h1>{project.name}</h1></div>
      <div className="compact-actions">
        <button className="icon-button" aria-label="重命名项目" title="重命名" disabled={busy} onClick={() => { setName(project.name); setRenaming(true); }}><Icon name="edit" /></button>
        <button className="icon-button" aria-label="刷新工作区" title="刷新" disabled={busy} onClick={onRefresh}><Icon name="refresh" /></button>
        <button className="icon-button danger-text" aria-label="删除项目" title="删除项目" disabled={busy} onClick={async () => {
          if (await confirm('项目及其全部数据将被永久删除，此操作不可撤销。', { title: '删除项目', confirmLabel: '永久删除项目', danger: true, requiredName: project.name })) void run('正在删除…', onDelete, '项目已删除');
        }}><Icon name="trash" /></button>
      </div>
    </div>
    <nav className="tabs panel" aria-label="工作流程">
      {tabs.map(([key, title]) => <button key={key} className={`tab ${tab === key ? 'active' : ''}`} aria-pressed={tab === key} onClick={() => { setTab(key); setFilter(''); setCategoryFilter(''); }} disabled={busy}>
        <Icon name={tabIcons[key]} size={16} />{title}{dirty.includes(key) && <span className="unsaved-dot" aria-label="未保存" />}
      </button>)}
    </nav>
    <section className={`workspace-content ${tab === 'facts' || tab === 'definitions' ? 'results-content' : 'panel content'}`}>
      {tab !== 'protocol' && feedback}
      {tab === 'protocol' && <>
        <div className="protocol-file"><h2>方案文件</h2>
        {project.file_name ? <div className="attached-file"><span className="file-icon"><Icon name="file" size={28} /></span><span className="attached-file-name">{project.file_name}</span><span className={`validation-state ${valid ? 'valid' : 'invalid'}`}><Icon name={valid ? 'check' : 'info'} size={16} />{valid ? '校验通过' : '校验未通过'}</span></div> : <label className="drop-zone"><Icon name="upload" size={28} /><strong>上传并验证方案</strong><span>支持 PDF、Word、Markdown 或文本文件</span>
          <input className="sr-only" aria-label="方案文件" type="file" accept=".pdf,.doc,.docx,.md,.txt" disabled={busy} onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            if (dirty.includes('protocol') && !await confirm('上传并验证方案会覆盖当前方案元数据，确定继续？', { title: '覆盖方案信息', confirmLabel: '上传并验证' })) return;
            void run('正在上传并验证方案，请稍候…', async () => {
              const saved = await api.attachFile(id, file);
              updateProject(saved); setMetadata(metadataOf(saved));
              clean('protocol');
              if (saved.file_valid !== 1) throw new Error('文件已保存，但未通过方案验证。请检查文件内容后新建项目重新上传。');
            }, '方案已上传并验证');
          }} />
        </label>}
        {feedback}
        </div>
        <div className="protocol-information"><h2>方案信息</h2>
        <form className="editor-form" onSubmit={(event) => submit(event, '正在保存元数据…', async () => {
          updateProject(await api.updateMetadata(id, metadata)); clean('protocol');
        }, '方案元数据已保存')}>
          <fieldset disabled={busy} className="form-grid">
            {metadataLabels.map(([key, label]) => <label className={key === 'title' ? 'full-width' : ''} key={key}>{label}{key === 'title' ? <textarea aria-label={label} required rows={2} value={metadata[key]} onChange={(event) => { setMetadata({ ...metadata, [key]: event.target.value }); mark('protocol'); }} /> : <input aria-label={label} required value={metadata[key]} onChange={(event) => {
              setMetadata({ ...metadata, [key]: event.target.value }); mark('protocol');
            }} />}</label>)}
          </fieldset>
          <div className="form-footer split"><button className="button primary" disabled={busy || !dirty.includes('protocol')}>保存方案信息</button></div>
        </form>
        </div>
      </>}

      {tab === 'categories' && <>
        <div className="section-heading"><h2>PD 分类配置 <span className="count">{categories.length}</span></h2><button className="button secondary" disabled={busy} onClick={() => {
          insertCategory(categories.length - 1);
        }}><Icon name="plus" size={16} />添加分类</button></div>
        <form className="editor-form" onSubmit={async (event) => {
          event.preventDefault();
          if (facts.length && !await confirm('保存分类将清空全部事实，包括未保存的事实修改。确定继续？', { title: '保存分类配置', confirmLabel: '保存并清空事实', danger: true })) return;
          void run('正在保存分类…', async () => {
            const result = await api.updatePdCategories(id, { categories: stripKeys(categories) });
            setCategories(withKeys(result.categories)); setFacts([]); clean('categories'); clean('facts');
          }, '分类已保存，原有事实已清空');
        }}>
          <fieldset disabled={busy} className="editor-list">
            <SortableRows items={categories} onMove={(from, to) => { setCategories(moveRow(categories, from, to).map((row, index) => ({ ...row, ord: index + 1 }))); mark('categories'); }}>
            {categories.map((category, index) => <SortableRow key={category._key} rowKey={category._key} focusRequested={focusKey === category._key} disabled={busy} onInsert={() => insertCategory(index)} insertLabel={`在分类 ${index + 1} 下方插入`}><article className="category-row">
              <DragHandle label={`拖动分类 ${index + 1}`} disabled={busy} />
              <span className="row-number">{String(index + 1).padStart(2, '0')}</span>
              <div className="category-body"><label><span className="sr-only">分类名称</span><input aria-label="分类名称" required maxLength={200} value={category.name} placeholder="分类名称" onChange={(event) => categoryPatch(index, { name: event.target.value })} /></label>
              <details className="row-details" onInvalidCapture={(event) => { event.currentTarget.open = true; }}><summary>提取规则</summary><div className="form-grid">
                <label>分类描述<textarea aria-label="分类描述" required maxLength={400} rows={3} value={category.description} onChange={(event) => categoryPatch(index, { description: event.target.value })} /></label>
                <label>提取方法<textarea aria-label="提取方法" required maxLength={400} rows={3} value={category.method} onChange={(event) => categoryPatch(index, { method: event.target.value })} /></label>
              </div></details></div>
              <div className="row-actions">
                <button type="button" className="button ghost danger-text" aria-label={`删除分类 ${index + 1}`} disabled={categories.length === 1} onClick={async () => {
                  if (await confirm(`删除分类“${category.name || '未命名'}”？保存后生效。`, { title: '删除分类', confirmLabel: '删除', danger: true })) {
                    setCategories(categories.filter((_, i) => i !== index).map((item, i) => ({ ...item, ord: i + 1 }))); mark('categories');
                  }
                }}><Icon name="trash" size={16} /></button>
              </div>
            </article></SortableRow>)}
            </SortableRows>
          </fieldset>
          <button className="button primary" disabled={busy || !dirty.includes('categories') || !categories.length}>保存分类配置</button>
        </form>
      </>}

      {tab === 'fields' && <>
        <h2>字段协议 <span className="count">{fields.length}</span></h2>
        <p className="hint">拖动手柄调整显示顺序。字段结构由生成协议固定，不支持新增字段；可展开编辑含义、允许值、示例与生成要求。</p>
        <form className="editor-form" onSubmit={(event) => submit(event, '正在保存字段规则…', async () => {
          const payload: FieldUpdate[] = fields.map(({ allowedText, exampleText, _key, ...field }) => ({
            ...field, allowed_values: lines(allowedText), example: lines(exampleText),
          }));
          const result = await api.updateFields(id, { fields: payload });
          setFields(orderedFields(result.fields));
          clean('fields');
        }, '字段规则已保存')}>
          <fieldset disabled={busy} className="editor-list">
            <SortableRows items={fields} onMove={(from, to) => {
              const next = moveRow(fields, from, to); setFields(next);
              try { localStorage.setItem(fieldOrderKey, JSON.stringify(next.map((field) => field.name))); } catch { setFields(next); }
            }}>
            {fields.map((field, index) => <SortableRow key={field._key} rowKey={field._key} disabled={busy}><details className="editor-card field-row">
              <summary><DragHandle label={`拖动字段 ${index + 1}`} disabled={busy} /><span className="row-number">{String(index + 1).padStart(2, '0')}</span><span>{field.label || field.name}</span><span className="field-required">{field.required ? '必填' : '选填'}</span></summary>
              <div className="editor-form">
                <label>字段含义<textarea aria-label="字段含义" rows={2} value={field.meaning} onChange={(event) => fieldPatch(index, { meaning: event.target.value })} /></label>
                <div className="form-grid">
                  <label>允许值（每行一个，不限制时留空）<textarea aria-label="允许值（每行一个，不限制时留空）" rows={3} value={field.allowedText} onChange={(event) => fieldPatch(index, { allowedText: event.target.value })} /></label>
                  <label>示例（每行一个）<textarea aria-label="示例（每行一个）" rows={3} value={field.exampleText} onChange={(event) => fieldPatch(index, { exampleText: event.target.value })} /></label>
                </div>
                <label>生成要求<textarea aria-label="生成要求" rows={3} value={field.requirements ?? ''} onChange={(event) => fieldPatch(index, { requirements: event.target.value })} /></label>
              </div>
            </details></SortableRow>)}
            </SortableRows>
          </fieldset>
          <button className="button primary" disabled={busy || !dirty.includes('fields')}>保存字段规则</button>
        </form>
      </>}

      {(tab === 'facts' || tab === 'definitions') && <>
        <div className="section-heading"><h2>{tab === 'facts' ? '方案事实' : 'PD 定义'} <span className="count">{tab === 'facts' ? facts.length : definitions.length}</span></h2>
          <div className="compact-actions">
          <button className="button secondary" disabled={busy || (tab === 'facts' && (!categories.length || dirty.includes('categories')))} onClick={() => tab === 'facts' ? insertFact(facts.length - 1) : insertDefinition(definitions.length - 1)}><Icon name="plus" size={16} />{tab === 'facts' ? '添加事实' : '添加定义'}</button>
          {tab === 'definitions' && <button className="button secondary" disabled={busy || !definitions.length || dirty.includes('definitions')} onClick={() => void run('正在导出 Excel…', () => downloadDefinitions(definitions, id, fields, project), 'Excel 已导出')}><Icon name="download" size={16} />导出 Excel</button>}
          <button className="button secondary" aria-label={tab === 'facts' ? '提取事实' : '生成定义'} disabled={busy || !valid || (tab === 'definitions' && !facts.length)} onClick={() => generate(tab)}><Icon name="sparkles" size={16} />{tab === 'facts' ? facts.length ? '重新提取' : '提取事实' : definitions.length ? '重新生成' : '生成定义'}</button>
          </div>
        </div>
        {!valid ? <p className="notice warning">请先上传有效方案。</p>
          : tab === 'definitions' && !facts.length && <p className="notice warning">请先保存方案事实。</p>}
        <details className="ai-panel" open><summary><Icon name="sparkles" size={17} /><strong>AI 调整</strong><span className="ai-hint">描述你的修改意图，让 AI 优化当前结果</span><span className="ai-toggle"><span className="sr-only when-open">收起</span><span className="sr-only when-closed">展开</span><Icon name="chevron" size={20} /></span></summary><div className="action-row">
          <textarea rows={2} aria-label={tab === 'facts' ? '事实修订要求' : '定义修订要求'} placeholder="描述希望补充、删减或调整的内容…" value={tab === 'facts' ? factRequest : definitionRequest} disabled={busy}
            onChange={(event) => tab === 'facts' ? setFactRequest(event.target.value) : setDefinitionRequest(event.target.value)} />
          <button className="ai-send" aria-label={tab === 'facts' ? '提交事实修订' : '提交定义修订'} title="发送修订要求" disabled={busy || !valid || !(tab === 'facts' ? facts.length && factRequest.trim() : definitions.length && definitionRequest.trim())} onClick={async () => {
            const section = tab;
            if (!await canGenerate(section)) return;
            void run('正在按要求修订…', async () => {
              if (section === 'facts') setFacts(positioned((await api.reviseFacts(id, factRequest.trim())).facts));
              else setDefinitions(positioned((await api.reviseDefinitions(id, definitionRequest.trim())).definitions));
              clean(section);
            }, '修订完成并已保存');
          }}><Icon name="send" size={20} /></button>
        </div></details>
        <div className="result-filters"><label className="search-field"><Icon name="search" /><input aria-label="搜索结果" placeholder={tab === 'facts' ? '搜索事实、分类或来源…' : '搜索编号、标准、描述或备注…'} value={filter} onChange={(event) => setFilter(event.target.value)} /></label><select aria-label="筛选分类" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="">全部分类</option>{categories.map((category) => <option key={category.ord} value={category.name}>{category.name}</option>)}</select></div>
        <form className="editor-form" onInvalid={() => { setFilter(''); setCategoryFilter(''); }} onSubmit={(event) => {
          const section = tab;
          submit(event, '正在保存修改…', async () => {
            if (section === 'facts') setFacts(positioned((await api.saveFacts(id, { facts: stripKeys(facts) })).facts));
            else setDefinitions(positioned((await api.saveDefinitions(id, { definitions: stripKeys(definitions) })).definitions));
            clean(section);
          }, '修改已保存');
        }}>
          <fieldset disabled={busy} className={`editor-list ${tab === 'definitions' ? 'definition-list' : 'fact-list'}`}>
            <SortableRows items={tab === 'facts' ? facts : definitions} onMove={(from, to) => {
              if (tab === 'facts') setFacts(moveRow(facts, from, to).map((row, index) => ({ ...row, position: index + 1 })));
              else setDefinitions(moveRow(definitions, from, to).map((row, index) => ({ ...row, position: index + 1 })));
              mark(tab);
            }}>
            {tab === 'facts' ? facts.map((fact, index) => <SortableRow key={fact._key} rowKey={fact._key} focusRequested={focusKey === fact._key} disabled={busy} onInsert={() => insertFact(index)} insertLabel={`在事实 ${index + 1} 下方插入`} hidden={!`${fact.content} ${fact.pd_category_name} ${fact.source ?? ''}`.toLowerCase().includes(filter.toLowerCase()) || (!!categoryFilter && fact.pd_category_name !== categoryFilter)}><article className="editor-card fact-card">
              <div className="section-heading"><span className="row-identity"><DragHandle label={`拖动事实 ${index + 1}`} disabled={busy} /><h3>{String(index + 1).padStart(2, '0')}</h3></span><span className="fact-actions"><button type="button" className={`icon-button confirm-fact ${fact.checked === 1 ? 'confirmed' : ''}`} aria-label={`${fact.checked === 1 ? '取消确认' : '确认'}事实 ${index + 1}`} aria-pressed={fact.checked === 1} title={fact.checked === 1 ? '已确认，点击取消确认' : '确认此事实（保存后生效）'} onClick={() => factPatch(index, { checked: fact.checked === 1 ? 0 : 1 })}><Icon name="check" size={18} /></button><button type="button" className="icon-button danger-text" aria-label={`删除事实 ${index + 1}`} onClick={async () => {
                if (await confirm('删除此事实？保存后生效。', { title: '删除事实', confirmLabel: '删除', danger: true })) { setFacts(facts.filter((_, i) => i !== index).map((row, index) => ({ ...row, position: index + 1 }))); mark('facts'); }
              }}><Icon name="trash" size={16} /></button></span></div>
              <label className="fact-category"><span className="sr-only">所属分类</span><select aria-label="所属分类" value={fact.pd_category_ord} onChange={(event) => {
                const category = categories.find((item) => item.ord === Number(event.target.value));
                if (category) factPatch(index, { pd_category_ord: category.ord, pd_category_name: category.name });
              }}>{categories.map((category) => <option key={category.ord} value={category.ord}>{category.ord}. {category.name}</option>)}</select></label>
              <label className="fact-content"><span className="sr-only">事实内容</span><AutoTextarea aria-label="事实内容" required rows={2} value={fact.content} onChange={(event) => factPatch(index, { content: event.target.value })} /></label>
              <label className="fact-source">来源<input value={fact.source ?? ''} onChange={(event) => factPatch(index, { source: event.target.value })} /></label>
            </article></SortableRow>) : <DefinitionsTable rows={definitions} fields={fields} busy={busy} focusKey={focusKey} filter={filter} categoryFilter={categoryFilter} projectId={id}
              onPatch={definitionPatch} onInsert={insertDefinition} onDelete={async (index) => {
                if (await confirm('删除此定义？保存后生效。', { title: '删除定义', confirmLabel: '删除', danger: true })) {
                  setDefinitions(definitions.filter((_, current) => current !== index).map((row, current) => ({ ...row, position: current + 1 }))); mark('definitions');
                }
              }} />}
            </SortableRows>
          </fieldset>
          <datalist id={`severity-${id}`}>{fields.find((field) => field.name === 'severity')?.allowed_values.map((value) => <option key={value} value={value} />)}</datalist>
          <datalist id={`review-method-${id}`}>{fields.find((field) => field.name === 'review_method')?.allowed_values.map((value) => <option key={value} value={value} />)}</datalist>
          {!(tab === 'facts' ? facts.length : definitions.length) && <p className="empty-cell">暂无结果</p>}
          {!!(filter || categoryFilter) && !(tab === 'facts'
            ? facts.some((fact) => `${fact.content} ${fact.pd_category_name} ${fact.source ?? ''}`.toLowerCase().includes(filter.toLowerCase()) && (!categoryFilter || fact.pd_category_name === categoryFilter))
            : definitions.some((definition) => Object.values(definition).join(' ').toLowerCase().includes(filter.toLowerCase()) && (!categoryFilter || definition.pd_category_name.includes(categoryFilter)))) && <p className="empty-cell">没有匹配的结果。</p>}
          <button className="button primary" disabled={busy || !dirty.includes(tab) || (tab === 'facts' && dirty.includes('categories'))}>{tab === 'facts' ? '保存事实修改' : '保存定义修改'}</button>
        </form>
      </>}
    </section>
    {tab !== 'protocol' && <ScrollNavigation />}
    {renaming && <Modal title="重命名项目" busy={busy} onClose={() => setRenaming(false)}><form className="editor-form" onSubmit={(event) => submit(event, '正在重命名…', async () => {
      updateProject(await api.renameProject(id, name.trim())); setRenaming(false);
    }, '项目已重命名')}><label>项目名称<input autoFocus aria-label="重命名项目" required maxLength={200} value={name} disabled={busy} onChange={(event) => setName(event.target.value)} /></label><div className="form-footer"><button type="button" className="button secondary" disabled={busy} onClick={() => setRenaming(false)}>取消</button><button className="button primary" disabled={busy || !name.trim() || name.trim() === project.name}>保存名称</button></div></form></Modal>}
  </>;
}
