import { useEffect, useId, useRef, useState } from 'react';
import { api } from './api/client';
import { AutoTextarea } from './EditorControls';
import { Modal } from './ui';
import type { AIOperation, ProjectPrompts, PromptPreview } from './types';

const labels: Record<keyof ProjectPrompts, string> = {
  system: '系统提示词', validation: '方案验证提示词', extract: '事实抽取提示词',
  revise_facts: '事实修订提示词', generate: '定义生成提示词', revise_definitions: '定义修订提示词',
};
type FunctionPromptKey = Exclude<keyof ProjectPrompts, 'system'>;
const promptTabs: Array<[FunctionPromptKey, string]> = [
  ['validation', '文档验证'], ['extract', '事实抽取'], ['revise_facts', '事实修订'],
  ['generate', '定义生成'], ['revise_definitions', '定义修订'],
];

export type PromptDialogMode = { kind: 'edit' } | {
  kind: 'preview';
  operation: AIOperation;
  requirements?: string;
};

export default function PromptDialog({ projectId, mode, onClose }: {
  projectId: number; mode: PromptDialogMode; onClose: () => void;
}) {
  const [prompts, setPrompts] = useState<ProjectPrompts | null>(null);
  const [preview, setPreview] = useState<PromptPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<FunctionPromptKey>('validation');
  const tabsId = useId();
  const pending = useRef(false);
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const saved = await api.getPrompts(projectId);
        if (!active) return;
        if (mode.kind === 'edit') setPrompts(saved);
        else {
          const rendered = await api.previewPrompts(projectId, mode.operation, saved, mode.requirements ?? '');
          if (active) setPreview(rendered);
        }
      } catch (failure) {
        if (active) setError(failure instanceof Error ? failure.message : '加载提示词失败，请重试。');
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [projectId, mode]);

  async function save() {
    if (!prompts || pending.current) return;
    pending.current = true; setSaving(true); setError('');
    try {
      await api.savePrompts(projectId, prompts);
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '保存提示词失败，请重试。');
    } finally {
      pending.current = false; setSaving(false);
    }
  }

  return <Modal title={mode.kind === 'edit' ? '项目提示词' : '即将提交的提示词'} busy={saving} onClose={onClose}>
    <div className="prompt-dialog editor-form">
      {error && <p className="notice error" role="alert">{error}</p>}
      {loading && <p role="status">正在加载提示词…</p>}
      {mode.kind === 'edit' ? <form className="editor-form prompt-editor" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <p className="hint">初始值来自系统默认提示词。系统提示词由各功能共用，修改后同步显示；功能提示词分别保存。切换 Tab 不会丢失修改，“保存提示词”统一保存到当前项目，不会发起 AI 请求。请保留 $变量名；字面量 $ 请写为 $$。</p>
        {prompts && <>
          <div className="tabs" role="tablist" aria-label="提示词功能">
            {promptTabs.map(([key, title], index) => <button key={key} type="button" role="tab"
              id={`${tabsId}-tab-${key}`} aria-controls={`${tabsId}-panel`}
              aria-selected={activeTab === key} tabIndex={activeTab === key ? 0 : -1}
              className={`tab ${activeTab === key ? 'active' : ''}`} disabled={saving}
              onClick={() => setActiveTab(key)} onKeyDown={(event) => {
                let next: number;
                if (event.key === 'ArrowRight') next = (index + 1) % promptTabs.length;
                else if (event.key === 'ArrowLeft') next = (index + promptTabs.length - 1) % promptTabs.length;
                else if (event.key === 'Home') next = 0;
                else if (event.key === 'End') next = promptTabs.length - 1;
                else return;
                event.preventDefault();
                setActiveTab(promptTabs[next][0]);
                event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
              }}>{title}</button>)}
          </div>
          <fieldset disabled={saving}>
            <div className="editor-form" role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-tab-${activeTab}`}>
              <label>{labels.system}
                <AutoTextarea aria-label={labels.system} required rows={2} value={prompts.system}
                  onChange={(event) => setPrompts({ ...prompts, system: event.target.value })} />
              </label>
              <label>{labels[activeTab]}
                <AutoTextarea key={activeTab} aria-label={labels[activeTab]} required rows={2} value={prompts[activeTab]}
                  onChange={(event) => setPrompts({ ...prompts, [activeTab]: event.target.value })} />
              </label>
            </div>
          </fieldset>
        </>}
        <div className="form-footer">
          <button type="button" className="button secondary" disabled={saving} onClick={onClose}>取消</button>
          <button className="button primary" disabled={saving || loading || !prompts}>{saving ? '正在保存…' : '保存提示词'}</button>
        </div>
      </form> : <>
        <p className="hint">只读预览，基于当前项目已保存的提示词和上游数据组装；不会保存或发起 AI 请求。修改模板请使用项目标题旁的提示词管理按钮。</p>
        {preview && <section className="prompt-preview" aria-label="完整请求预览">
          <h3>完整请求预览</h3>
          <article><h4>system</h4><pre>{preview.instructions}</pre></article>
          {preview.messages.map((message, index) => <article key={index}><h4>{index + 1}. {message.role}</h4>
            {typeof message.content === 'string' ? <pre>{message.content}</pre>
              : message.content.map((part, partIndex) => <pre key={partIndex}>{part.type === 'input_file' ? `附件：${part.file_id}` : part.text}</pre>)}
          </article>)}
        </section>}
        <div className="form-footer"><button type="button" className="button secondary" onClick={onClose}>关闭预览</button></div>
      </>}
    </div>
  </Modal>;
}
