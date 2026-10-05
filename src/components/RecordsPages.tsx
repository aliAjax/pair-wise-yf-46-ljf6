import { Button, Card, Table, Tag, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import { syncQueue } from "../store/rundownSlice";
import { formatTime } from "../store/engine";
import type { AsRunEntry } from "../types";

/** 播出记录：只追加、不可改、不可撤 */
export function AsRunPage() {
  const { doc } = useAppSelector((state) => state.rundown);
  const columns: ColumnsType<AsRunEntry> = [
    { title: "播出时间", dataIndex: "airedAt", width: 110, render: (v: string) => formatTime(v) },
    { title: "累计起点", dataIndex: "startAt", width: 90 },
    { title: "条目", render: (_, row) => <><b>{row.title}</b><div className="record-meta"><Tag>{row.type}</Tag></div></> },
    { title: "计划时长", dataIndex: "plannedDuration", width: 90, render: (v: number) => `${v} 分钟` },
    {
      title: "实际时长", width: 100,
      render: (_, row) => <b className={row.actualDuration !== row.plannedDuration ? "danger-text" : ""}>{row.actualDuration} 分钟</b>
    },
    { title: "确认岗位", width: 130, render: (_, row) => <><Tag color="purple">{row.role}</Tag><small>窗口 {row.clientId}</small></> }
  ];
  return (
    <Card
      title="播出记录（as-run）"
      extra={<small>点“播出”即写入，只追加；任何撤回、编辑都不会改动这里的条目和实际时长</small>}
    >
      <Table
        columns={columns}
        dataSource={doc.asRun}
        rowKey="id"
        pagination={false}
        size="middle"
        locale={{ emptyText: "尚无条目播出" }}
      />
    </Card>
  );
}

/** 本地应急队列 */
export function QueuePage() {
  const { queue, online } = useAppSelector((state) => state.rundown);
  const dispatch = useAppDispatch();
  const doSync = async () => {
    const result = await dispatch(syncQueue());
    if (!("synced" in result)) return;
    if (result.synced) message.success(`应急队列已提交 ${result.synced} 条改动`);
    for (const text of result.conflicts) message.warning(text, 8);
    for (const text of result.blocked) message.warning(`无法重放：${text}`, 8);
    if (!result.synced && !result.conflicts.length && !result.blocked.length) message.info("队列是空的");
  };
  return (
    <Card title="本地应急队列" extra={<Tag color={online ? "green" : "red"}>{online ? "主链路正常" : "离线应急模式"}</Tag>}>
      {queue.length ? (
        <div className="queue-list">
          {queue.map((item) => (
            <article key={item.id}>
              <Tag color="orange">{item.spec.kind}</Tag>
              <b>{item.detail}</b>
              <small>{formatTime(item.queuedAt)} · {item.role} · 窗口 {item.clientId}</small>
            </article>
          ))}
        </div>
      ) : <p>当前没有待同步操作。</p>}
      <Button type="primary" disabled={online || !queue.length} onClick={() => void doSync()} style={{ marginTop: 14 }}>
        主链路恢复后提交（逐条检查版本冲突）
      </Button>
      <div className="muted-hint" style={{ marginTop: 10 }}>
        提交时若某条已被其他窗口抢先改过，这条会留在冲突提示里、不会覆盖对方的版本。
      </div>
    </Card>
  );
}
