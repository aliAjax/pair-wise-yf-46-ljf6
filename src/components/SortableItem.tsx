import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button, Tag, Tooltip } from "antd";
import type { RundownItem } from "../types";

export function SortableItem({
  item, cumulative, risk, canEdit, onStatus, onSkip, onDuration, onEdit
}: {
  item: RundownItem;
  cumulative: string;
  risk: boolean;
  canEdit: boolean;
  onStatus: () => void;
  onSkip: () => void;
  onDuration: (delta: number) => void;
  onEdit: () => void;
}) {
  const aired = item.status === "已播出";
  const skipped = item.status === "已跳过";
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: item.id, disabled: aired || !canEdit });
  return (
    <article ref={setNodeRef} className={`rundown-row status-${item.status}`} style={{ transform: CSS.Transform.toString(transform), transition }}>
      <button className="drag-handle" {...attributes} {...listeners} title={canEdit ? "拖动调整顺序" : "已播出条目不可移动"}>⠿</button>
      <time className={risk ? "risk-time" : ""}>{cumulative}{risk ? <em className="risk-dot" title="晚于硬时间">⚠</em> : null}</time>
      <div className="row-main">
        <b>{item.title}</b>
        <small>{item.source} · {item.presenter}{item.hardStart ? ` · 硬时间 ${item.hardStart}` : ""}</small>
      </div>
      <Tag color={item.type === "广告" ? "gold" : item.type === "连线" ? "blue" : "geekblue"}>{item.type}</Tag>
      <span>
        {aired ? <Tooltip title="实际时长已锁定在播出记录，撤回改动不会改它">实播 {item.actualDuration ?? item.duration}′</Tooltip> : <>{item.duration} 分钟</>}
        {aired && item.actualDuration !== undefined && item.actualDuration !== item.duration ? <small className="plan-diff">（计划 {item.duration}′）</small> : null}
      </span>
      <Tag color={aired ? "green" : skipped ? "red" : "default"}>{item.status}</Tag>
      <div className="row-actions">
        <Tooltip title={aired ? "已播出，时长锁定" : ""}><Button size="small" disabled={aired || skipped || !canEdit} onClick={() => onDuration(-1)}>-1</Button></Tooltip>
        <Tooltip title={aired ? "已播出，时长锁定" : ""}><Button size="small" disabled={aired || skipped || !canEdit} onClick={() => onDuration(1)}>+1</Button></Tooltip>
        <Button size="small" disabled={aired || skipped || !canEdit} onClick={onEdit}>编辑</Button>
        <Button size="small" type="primary" disabled={aired || skipped} onClick={onStatus}>播出</Button>
        <Button size="small" danger disabled={aired || skipped || !canEdit} onClick={onSkip}>取消</Button>
      </div>
    </article>
  );
}
