import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent, type KeyboardCoordinateGetter } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Icon } from './ui';

export type Keyed<Row> = Row & { _key: string };
export const withKey = <Row extends object>(row: Row): Keyed<Row> => ({ ...row, _key: crypto.randomUUID() });
export const withKeys = <Row extends object>(rows: Row[]): Keyed<Row>[] => rows.map(withKey);
export const stripKeys = <Row extends { _key: string }>(rows: Row[]) => rows.map(({ _key, ...row }) => row);

const HandleContext = createContext<ReturnType<typeof useSortable> | null>(null);

export function SortableRows({ items, onMove, children }: {
  items: { _key: string }[]; onMove: (from: number, to: number) => void; children: ReactNode;
}) {
  const keyboardTarget = useRef<string | null>(null);
  const coordinates: KeyboardCoordinateGetter = (event, { currentCoordinates, context }) => {
    if (event.code !== 'ArrowUp' && event.code !== 'ArrowDown') return;
    event.preventDefault();
    const enabled = items.filter((row) => context.droppableContainers.get(row._key)?.disabled === false);
    const current = enabled.findIndex((row) => row._key === (keyboardTarget.current ?? context.active?.id));
    const target = enabled[current + (event.code === 'ArrowUp' ? -1 : 1)];
    if (!target || !context.collisionRect) return currentCoordinates;
    const targetRect = context.droppableRects.get(target._key);
    if (!targetRect) return currentCoordinates;
    keyboardTarget.current = target._key;
    return {
      x: currentCoordinates.x + targetRect.left - context.collisionRect.left,
      y: currentCoordinates.y + targetRect.top - context.collisionRect.top,
    };
  };
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: coordinates }));
  function finish(event: DragEndEvent) {
    const target = keyboardTarget.current ?? event.over?.id;
    keyboardTarget.current = null;
    if (!target || event.active.id === target) return;
    const from = items.findIndex((row) => row._key === event.active.id);
    const to = items.findIndex((row) => row._key === target);
    if (from >= 0 && to >= 0) {
      onMove(from, to);
    }
  }
  return <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={finish}
    onDragStart={(event) => { keyboardTarget.current = event.activatorEvent instanceof KeyboardEvent ? String(event.active.id) : null; }}
    onDragCancel={() => { keyboardTarget.current = null; }} accessibility={{
    screenReaderInstructions: { draggable: '按空格开始拖动，使用上下方向键调整顺序，再按空格放下，Escape 取消。' },
    announcements: {
      onDragStart: ({ active }) => `已选中第 ${items.findIndex((row) => row._key === active.id) + 1} 行。`,
      onDragOver: ({ over }) => over ? `移动到第 ${items.findIndex((row) => row._key === over.id) + 1} 行位置。` : '已移出列表。',
      onDragEnd: ({ over }) => over ? `已放到第 ${items.findIndex((row) => row._key === over.id) + 1} 行位置。` : '排序未改变。',
      onDragCancel: () => '已取消拖动，排序未改变。',
    },
  }}>
    <SortableContext items={items.map((row) => row._key)} strategy={verticalListSortingStrategy}>{children}</SortableContext>
  </DndContext>;
}

export function SortableRow({ rowKey, disabled, hidden, children, onInsert, insertLabel, focusRequested, actions, as: Element = 'div' }: {
  rowKey: string; disabled: boolean; hidden?: boolean; children: ReactNode | ((controls: ReactNode) => ReactNode);
  onInsert?: () => void; insertLabel?: string; focusRequested?: boolean;
  as?: 'div' | 'tr';
  actions?: ReactNode;
}) {
  const sortable = useSortable({ id: rowKey, disabled: disabled || hidden });
  const rowRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (focusRequested) rowRef.current?.querySelector<HTMLElement>('input[required], textarea[required]')?.focus();
  }, [focusRequested]);
  const insertButton = onInsert && <button type="button" className="insert-row" aria-label={insertLabel} title={insertLabel} disabled={disabled} onClick={onInsert}><Icon name="plus" size={15} /></button>;
  return <HandleContext.Provider value={sortable}><Element ref={(node: HTMLDivElement | HTMLTableRowElement | null) => { rowRef.current = node; sortable.setNodeRef(node); }} hidden={hidden}
    className={`sortable-row ${Element === 'tr' ? 'definition-row' : ''} ${sortable.isDragging ? 'dragging' : ''}`}
    style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }}>
    {typeof children === 'function' ? children(<div className="table-row-controls" role="group" aria-label="定义行操作">{insertButton}{actions}</div>) : children}
    {Element !== 'tr' && insertButton}
  </Element></HandleContext.Provider>;
}

export function DragHandle({ label, disabled }: { label: string; disabled: boolean }) {
  const sortable = useContext(HandleContext)!;
  return <button type="button" className="drag-handle" ref={sortable.setActivatorNodeRef} disabled={disabled}
    {...sortable.attributes} {...sortable.listeners} aria-label={label} title="拖动排序；或按空格与方向键排序" onClick={(event) => event.stopPropagation()}>
    <svg width="14" height="20" viewBox="0 0 14 20" fill="currentColor" aria-hidden="true">{[5, 10, 15].flatMap((height) => [4, 10].map((left) => <circle key={`${left}-${height}`} cx={left} cy={height} r="1.2" />))}</svg>
  </button>;
}

export function moveRow<Row>(rows: Row[], from: number, to: number): Row[] {
  const next = [...rows];
  const [row] = next.splice(from, 1);
  next.splice(to, 0, row);
  return next;
}
