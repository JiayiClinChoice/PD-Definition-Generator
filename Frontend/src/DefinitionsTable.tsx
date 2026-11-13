import { useLayoutEffect, useRef, useState } from 'react';
import type { DefinitionOut, FieldUpdate } from './types';
import { definitionColumns } from './definitionColumns';
import { DragHandle, SortableRow, type Keyed } from './SortableRows';
import { AutoTextarea } from './EditorControls';
import { Icon } from './ui';

export function DefinitionsTable({ rows, fields, busy, focusKey, filter, categoryFilter, projectId, onPatch, onInsert, onDelete }: {
  rows: Keyed<DefinitionOut>[]; fields: FieldUpdate[]; busy: boolean; focusKey: string;
  filter: string; categoryFilter: string; projectId: number;
  onPatch: (index: number, patch: Partial<DefinitionOut>) => void;
  onInsert: (index: number) => void; onDelete: (index: number) => void;
}) {
  const columns = definitionColumns(fields);
  const viewportRef = useRef<HTMLDivElement>(null);
  const horizontalRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const [tableWidth, setTableWidth] = useState(0);
  useLayoutEffect(() => {
    const viewport = viewportRef.current!;
    const table = tableRef.current!;
    const update = () => {
      const horizontal = horizontalRef.current!;
      setTableWidth(Math.max(0, table.scrollWidth - viewport.clientWidth + horizontal.clientWidth));
      horizontal.scrollLeft = viewport.scrollLeft;
      headerRef.current!.scrollLeft = viewport.scrollLeft;
      viewport.style.setProperty('--definition-actions-right', `${table.scrollWidth - viewport.clientWidth - viewport.scrollLeft + 8}px`);
    };
    const observer = new ResizeObserver(update);
    observer.observe(viewport); observer.observe(table); update();
    return () => observer.disconnect();
  }, []);
  function scroll(direction: number) {
    const viewport = viewportRef.current!;
    viewport.scrollBy({ left: direction * viewport.clientWidth * .75 });
  }
  return <div className="definition-table-frame">
    <div className="definition-table-sticky">
    <div className="table-scroll-toolbar">
      <button type="button" className="icon-button" aria-label="向左滚动表格" title="向左滚动表格" onClick={() => scroll(-1)}><Icon name="back" size={16} /></button>
      <div className="table-horizontal-scroll" ref={horizontalRef} tabIndex={0} role="region" aria-label="PD 定义顶部水平滚动条"
        onKeyDown={(event) => {
          if (event.key === 'Home' || event.key === 'End') {
            event.preventDefault();
            event.currentTarget.scrollLeft = event.key === 'End' ? event.currentTarget.scrollWidth : 0;
          }
        }}
        onScroll={(event) => { viewportRef.current!.scrollLeft = event.currentTarget.scrollLeft; headerRef.current!.scrollLeft = event.currentTarget.scrollLeft; }}><div style={{ width: tableWidth, height: 1 }} /></div>
      <button type="button" className="icon-button" aria-label="向右滚动表格" title="向右滚动表格" onClick={() => scroll(1)}><Icon name="arrow" size={16} /></button>
    </div>
    <div className="definition-table-header" ref={headerRef} aria-hidden="true">
      <table className="definition-table"><colgroup>{columns.map((column) => <col key={column.name} className={`column-${column.name}`} />)}</colgroup>
        <thead><tr>{columns.map((column) => <th key={column.name} className={`cell-${column.name}`}>{column.label}</th>)}</tr></thead>
      </table>
    </div>
    </div>
    <div ref={viewportRef} className="definition-table-scroll" role="region" aria-label="PD 定义表格，可横向滚动" tabIndex={0}
      onScroll={(event) => {
        const viewport = event.currentTarget;
        horizontalRef.current!.scrollLeft = viewport.scrollLeft;
        headerRef.current!.scrollLeft = viewport.scrollLeft;
        viewport.style.setProperty('--definition-actions-right', `${tableRef.current!.scrollWidth - viewport.clientWidth - viewport.scrollLeft + 8}px`);
      }}>
    <table ref={tableRef} className="definition-table">
      <caption className="sr-only">PD 定义，字段名称与字段协议一致，拖动序号旁的手柄排序</caption>
      <colgroup>{columns.map((column) => <col key={column.name} className={`column-${column.name}`} />)}</colgroup>
      <thead className="definition-semantic-header"><tr>{columns.map((column) => <th key={column.name} scope="col"><span className="sr-only">{column.label}</span></th>)}</tr></thead>
      <tbody>{rows.map((row, index) => <SortableRow as="tr" key={row._key} rowKey={row._key} disabled={busy}
        focusRequested={focusKey === row._key} onInsert={() => onInsert(index)} insertLabel={`在定义 ${index + 1} 下方插入`}
        actions={<><button type="button" disabled={busy} className={`icon-button confirm-fact ${row.checked === 1 ? 'confirmed' : ''}`} aria-label={`${row.checked === 1 ? '取消确认' : '确认'}定义 ${index + 1}`} aria-pressed={row.checked === 1} title={row.checked === 1 ? '已确认，点击取消确认' : '确认此定义（保存后生效）'} onClick={() => onPatch(index, { checked: row.checked === 1 ? 0 : 1 })}><Icon name="check" size={16} /></button><button type="button" disabled={busy} className="icon-button danger-text" aria-label={`删除定义 ${index + 1}`} title="删除定义" onClick={() => onDelete(index)}><Icon name="trash" size={16} /></button></>}
        hidden={!columns.map((column) => row[column.name] ?? '').join(' ').toLowerCase().includes(filter.toLowerCase()) || (!!categoryFilter && !row.pd_category_name.includes(categoryFilter))}>
        {(rowControls) => columns.map((column) => <td key={column.name} className={`cell-${column.name}`}>
          {column.name === 'position' ? <span className="table-position"><DragHandle label={`拖动定义 ${index + 1}`} disabled={busy} /><span>{index + 1}</span></span>
            : ['pd_ord', 'severity', 'review_method'].includes(column.name)
              ? <input aria-label={column.label} required={column.required || column.name === 'pd_ord'} value={row[column.name] ?? ''}
                list={column.name === 'review_method' ? `review-method-${projectId}` : column.name === 'severity' ? `severity-${projectId}` : undefined}
                onChange={(event) => onPatch(index, { [column.name]: event.target.value })} />
              : <AutoTextarea aria-label={column.label} required={column.required || column.name === 'description'} rows={1} value={row[column.name] ?? ''}
                onChange={(event) => onPatch(index, { [column.name]: event.target.value })} />}
          {column.name === 'note' && rowControls}
        </td>)}
      </SortableRow>)}</tbody>
    </table>
  </div></div>;
}
