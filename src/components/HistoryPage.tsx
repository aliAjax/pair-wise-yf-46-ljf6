import { useMemo, useState } from "react";
import { Button, Card, Popover, Table, Tag, Timeline, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import { undoOne } from "../store/rundownSlice";
import { canUndo, formatTime } from "../store/engine";
import type { ChangeEntry } from "../types";

export function HistoryPage() {
  const { doc, role } = useAppSelector((state) => state.rundown);
  const dispatch = useAppDispatch();
  const [busy, setBusy] = useState<string | null>(null);

  const rows = useMemo(() => doc.log.map((entry, index) => {
    const check = canUndo(doc, entry.id, role);
    return { key: entry.id, seq: doc.log.length - index, entry, check };
  }), [doc, role]);

  const tryUndo = async (entry: ChangeEntry) => {
    setBusy(entry.id);
    try {
      const result = dispatch(undoOne(entry.id));
      if (result.type === "ok") message.success(result.message);
      else message.warning(result.message);
    } finally {
      setBusy(null);
    }
  };

  const columns: ColumnsType<(typeof rows)[number]> = [
    { title: "#", dataIndex: "seq", width: 54, render: (v) => <small>#{v}</small> },
    {
      title: "改动（岗位 / 对象）",
      render: (_, { entry }) => (
        <div>
          <b>{entry.detail}</b>
          {entry.batchId && <small className="muted-hint"> 同次保存的多条字段之一</small>}
          <div className="record-meta">
            <Tag color="purple">{entry.role}</Tag>
            <Tag>窗口 {entry.clientId}</Tag>
            <Tag color={kindColor(entry.kind)}>{entry.kind}</Tag>
            {entry.pending && <Tag color="orange">待同步</Tag>}
            {entry.undone && <Tag color="default">已于 {entry.undoneAt ? formatTime(entry.undoneAt) : "--"} 由 {entry.undoneBy ?? "?"} 撤回</Tag>}
            {entry.sealed && <Tag color="green">已封存</Tag>}
          </div>
        </div>
      )
    },
    { title: "对象版本", width: 92, render: (_, { entry }) => <small>base rev {entry.baseRev}</small> },
    { title: "时间", width: 96, render: (_, { entry }) => formatTime(entry.time) },
    {
      title: "撤回",
      width: 130,
      render: (_, { entry, check }) => {
        if (entry.undone) return <Tag>已抵消</Tag>;
        if (entry.sealed) {
          return <Popover content="播出事实与实际时长保留在播出记录中，永远不可撤回"><Button size="small" disabled>不可撤</Button></Popover>;
        }
        if (!check.ok) {
          return <Popover title="这条现在撤不了" content={check.reason}><Button size="small" danger>被挡住</Button></Popover>;
        }
        return <Button size="small" type="primary" ghost loading={busy === entry.id} onClick={() => void tryUndo(entry)}>撤回此条</Button>;
      }
    }
  ];

  return (
    <Card
      title="操作历史 · 逐条留痕"
      extra={<small>撤回只抵消选中的一次改动；已播出条目与实际时长留在播出记录，累计时间与硬时间风险随即重算</small>}
    >
      <Table columns={columns} dataSource={rows} pagination={false} size="middle" />
    </Card>
  );
}

function kindColor(kind: ChangeEntry["kind"]): string {
  return ({ 新增: "blue", 插播: "red", 时长: "gold", 编辑: "cyan", 跳过: "default", 播出: "green", 排序: "geekblue" })[kind];
}

/** 突发变更记录页（保留原有 Timeline 形式，撤回插播时对应记录会被收回） */
export function ChangesPage() {
  const { doc } = useAppSelector((state) => state.rundown);
  return (
    <Card title="突发变更记录" extra={<small>对应“插播”留痕；撤回该插播条目时此记录一并收回</small>}>
      {doc.breaking.length ? (
        <Timeline items={doc.breaking.map((item) => ({
          color: "red",
          children: <div><b>{item.headline}</b><p>{item.reason} · 插播 {item.duration} 分钟</p><small>{formatTime(item.createdAt)}</small></div>
        }))} />
      ) : <p>当前没有突发插播。</p>}
    </Card>
  );
}
