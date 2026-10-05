import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button, Tag, Tooltip } from "antd";
import type { RundownItem } from "../types";

export function SortableItem({ item, cumulative, onStatus, onSkip, onDuration }: { item: RundownItem; cumulative: string; onStatus: () => void; onSkip: () => void; onDuration: (delta: number) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: item.id, disabled: item.status === "已播出" });
  const aired = item.status === "已播出";
  return (
    <article ref={setNodeRef} className={`rundown-row status-${item.status}`} style={{ transform: CSS.Transform.toString(transform), transition }}>
      <button className="drag-handle" {...attributes} {...listeners}>⠿</button>
      <time>{cumulative}</time>
      <div className="row-main"><b>{item.title}</b><small>{item.source} · {item.presenter}</small></div>
      <Tag color={item.type === "广告" ? "gold" : item.type === "连线" ? "blue" : "geekblue"}>{item.type}</Tag>
      <span>{aired ? item.actualDuration : item.duration} 分钟{aired ? "（实际）" : ""}</span>
      <Tag color={aired ? "green" : item.status === "已跳过" ? "red" : "default"}>{item.status}</Tag>
      <div className="row-actions">
        <Tooltip title={aired ? "已播出条目实际时长锁定" : ""}><Button size="small" disabled={aired} onClick={() => onDuration(-1)}>-1</Button></Tooltip>
        <Tooltip title={aired ? "已播出条目实际时长锁定" : ""}><Button size="small" disabled={aired} onClick={() => onDuration(1)}>+1</Button></Tooltip>
        <Button size="small" type="primary" disabled={aired} onClick={onStatus}>播出</Button>
        <Button size="small" danger disabled={aired} onClick={onSkip}>取消</Button>
      </div>
    </article>
  );
}
