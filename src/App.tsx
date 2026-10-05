import { useEffect, useMemo, useState } from "react";
import { closestCenter, DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Alert, Button, Card, Form, Input, InputNumber, Select, Switch, Tag, Timeline, Tooltip, message } from "antd";
import { addMinutes, format } from "date-fns";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import { NavLink, Route, Routes } from "react-router-dom";
import { SortableItem } from "./components/SortableItem";
import { useGetRundownQuery, useSaveRundownMutation, useSimulateExternalSaveMutation } from "./store/api";
import { useAppDispatch, useAppSelector } from "./store/hooks";
import { addItem, adjustDuration, clearConflict, clearUndoError, conflictDetected, initialize, insertBreaking, markSaved, queueChange, reorder, reloadFromServer, setOnline, setRole, skipItem, syncQueue, undoRecord, updateStatus } from "./store/rundownSlice";
import type { ChangeRecord, ConflictInfo, ItemType, Role, RundownItem } from "./types";

const schema = z.object({ title: z.string().min(2), type: z.enum(["新闻片", "连线", "嘉宾", "口播", "广告"]), duration: z.number().min(1).max(120), presenter: z.string().min(1), source: z.string().min(1) });
type FormValues = z.infer<typeof schema>;

/** 累计时间：已播出条目按实际时长计，其余按计划时长计；改动后由 useMemo 自动重算 */
function useTimeline(items: RundownItem[]) {
  const start = new Date("2026-10-08T08:00:00");
  let cursor = start;
  return items.map((item) => {
    const current = cursor;
    const effective = item.status === "已播出" && item.actualDuration ? item.actualDuration : item.duration;
    cursor = addMinutes(cursor, effective);
    return { item, at: format(current, "HH:mm"), duration: effective };
  });
}

const ROLE_COLOR: Record<Role, string> = { 导播: "red", 主编: "blue", 字幕: "default", 演播室: "green" };
const FIELD_LABELS: Record<string, string> = {
  title: "标题", type: "类型", duration: "时长", hardStart: "硬时间",
  status: "状态", presenter: "主播", source: "来源", version: "版本",
  airedAt: "播出时间", actualDuration: "实际时长"
};

function diffText(record: ChangeRecord): string {
  if (record.orderBefore) return `顺序 ${record.orderBefore.length} 条 → ${record.orderAfter?.length ?? 0} 条`;
  if (record.before === null) return `新增：${fieldsText(record.after)}`;
  if (record.after === null) return "条目删除";
  const keys = Array.from(new Set([...Object.keys(record.before ?? {}), ...Object.keys(record.after ?? {})]))
    .filter((key) => key !== "version" && key !== "airedAt");
  return keys.map((key) => {
    const before = (record.before as Record<string, unknown> | null)?.[key] ?? "—";
    const after = (record.after as Record<string, unknown> | null)?.[key] ?? "—";
    return `${FIELD_LABELS[key] ?? key}：${before} → ${after}`;
  }).join("，");
}

function fieldsText(fields: Partial<RundownItem> | null | undefined): string {
  if (!fields) return "";
  return Object.entries(fields)
    .filter(([key]) => key !== "version" && key !== "airedAt")
    .map(([key, value]) => `${FIELD_LABELS[key] ?? key}=${value ?? "—"}`)
    .join("，");
}

function isConflictResult(res: unknown): res is { conflict: ConflictInfo[] } {
  return res !== null && typeof res === "object" && "conflict" in res;
}

function RundownPage() {
  const dispatch = useAppDispatch();
  const { items, role, online, baseVersions, conflict, undoError } = useAppSelector((state) => state.rundown);
  const [saveMutation] = useSaveRundownMutation();
  const { refetch } = useGetRundownQuery();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const timeline = useTimeline(items);
  const total = items.reduce((sum, item) => sum + (item.status === "已播出" && item.actualDuration ? item.actualDuration : item.duration), 0);
  const overrun = timeline.filter(({ at, item }) => item.hardStart && at > item.hardStart);
  const { control, handleSubmit, reset } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { title: "", type: "新闻片", duration: 5, presenter: "陈默", source: "主控" } });

  // 自动保存：携带我方基线版本；一旦检测到对方窗口先保存，立即停止并说明冲突
  useEffect(() => {
    if (conflict) return;
    const timer = setTimeout(() => {
      void (async () => {
        const res = await saveMutation({ items, baseVersions });
        if (isConflictResult(res)) dispatch(conflictDetected(res.conflict));
        else dispatch(markSaved(items));
      })();
    }, 250);
    return () => clearTimeout(timer);
  }, [items, baseVersions, conflict, saveMutation, dispatch]);

  // 撤回被阻挡时给出原因
  useEffect(() => {
    if (undoError) {
      message.error(undoError.reason);
      dispatch(clearUndoError());
    }
  }, [undoError, dispatch]);

  const reloadFromExternal = async () => {
    const res = await refetch();
    if (res.data) {
      dispatch(reloadFromServer(res.data));
      message.success("已切换为先保存窗口的版本");
    }
  };

  const onDragEnd = (event: DragEndEvent) => {
    if (!event.over || event.active.id === event.over.id || role !== "导播") return;
    const oldIndex = items.findIndex((item) => item.id === event.active.id);
    const newIndex = items.findIndex((item) => item.id === event.over!.id);
    dispatch(reorder(arrayMove(items, oldIndex, newIndex)));
  };

  const submit = (values: FormValues) => {
    dispatch(addItem(values));
    if (!online) dispatch(queueChange({ action: "新增条目", detail: values.title }));
    reset();
  };

  return <div className="page-grid">
    <Card className="main-card">
      <div className="card-heading"><div><small>2026-10-08 · 08:00 开播</small><h2>直播串联单</h2></div><div className="head-actions"><Tag color={online ? "green" : "red"}>{online ? "主备链路正常" : "本地应急模式"}</Tag></div></div>
      {conflict && <Alert className="conflict-banner" type="error" showIcon message="保存已停止：同一条目已被其他岗位窗口先保存" description={<div>{conflict.map((item) => <p key={item.itemId}>「{item.title}」对方已保存到 v{item.storedVersion}，我方基线为 v{item.baseVersion}。按先保存为准，请刷新到对方版本后再继续编辑。</p>)}<div className="conflict-actions"><Button type="primary" size="small" onClick={() => void reloadFromExternal()}>以对方版本为准刷新</Button><Button size="small" onClick={() => dispatch(clearConflict())}>保留我的改动（保存仍暂停）</Button></div></div>} />}
      <div className="summary"><span><b>{items.length}</b> 条内容</span><span><b>{total}</b> 分钟总时长</span><span className={overrun.length ? "danger-text" : ""}><b>{overrun.length}</b> 个硬时间风险</span><span><b>{timeline.at(-1)?.at ?? "--:--"}</b> 预计收播</span></div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
          <div className="rundown-list">{timeline.map(({ item, at }) => <SortableItem key={item.id} item={item} cumulative={at} onDuration={(delta) => dispatch(adjustDuration({ id: item.id, delta }))} onStatus={() => dispatch(updateStatus({ id: item.id, status: "已播出" }))} onSkip={() => dispatch(skipItem(item.id))} />)}</div>
        </SortableContext>
      </DndContext>
    </Card>
    <aside className="side-stack">
      <Card title="新增播出条目">
        <Form layout="vertical" onFinish={handleSubmit(submit)}>
          <Form.Item label="标题"><Controller name="title" control={control} render={({ field, fieldState }) => <><Input {...field} status={fieldState.error ? "error" : ""} /><small className="error">{fieldState.error?.message}</small></>} /></Form.Item>
          <div className="two-cols"><Form.Item label="类型"><Controller name="type" control={control} render={({ field }) => <Select {...field} options={["新闻片","连线","嘉宾","口播","广告"].map((v) => ({ value: v, label: v }))} />} /></Form.Item><Form.Item label="时长"><Controller name="duration" control={control} render={({ field }) => <InputNumber {...field} min={1} max={120} addonAfter="分钟" />} /></Form.Item></div>
          <Form.Item label="主播"><Controller name="presenter" control={control} render={({ field }) => <Input {...field} />} /></Form.Item>
          <Form.Item label="来源"><Controller name="source" control={control} render={({ field }) => <Input {...field} />} /></Form.Item>
          <Button htmlType="submit" type="primary" block disabled={role === "字幕"}>加入串联单</Button>
        </Form>
      </Card>
      <BreakingForm />
      <CollabCard />
    </aside>
  </div>;
}

function BreakingForm() {
  const dispatch = useAppDispatch();
  const { items, online } = useAppSelector((state) => state.rundown);
  const [values, setValues] = useState({ headline: "", duration: 5, insertAfter: items[0]?.id ?? "", reason: "突发新闻" });
  return <Card title="突发插播" className="breaking-card">
    <Input value={values.headline} onChange={(event) => setValues({ ...values, headline: event.target.value })} placeholder="插播标题" />
    <div className="two-cols"><InputNumber value={values.duration} onChange={(value) => setValues({ ...values, duration: Number(value ?? 5) })} addonAfter="分钟" /><Select value={values.insertAfter} onChange={(value) => setValues({ ...values, insertAfter: value })} options={items.map((item) => ({ value: item.id, label: `插在「${item.title}」后` }))} /></div>
    <Input value={values.reason} onChange={(event) => setValues({ ...values, reason: event.target.value })} placeholder="插播原因" />
    <Button type="primary" danger block disabled={values.headline.length < 2} onClick={() => { dispatch(insertBreaking(values)); if (!online) message.warning("已进入本地应急队列"); setValues({ ...values, headline: "" }); }}>立即插入并重算时长</Button>
    {!online && <small>离线操作将在主链路恢复后统一提交，当前顺序仍可用于本地播出。</small>}
  </Card>;
}

/** 协作演示：模拟另一个岗位窗口先保存了某一条目 */
function CollabCard() {
  const { items, baseVersions } = useAppSelector((state) => state.rundown);
  const [simulate] = useSimulateExternalSaveMutation();
  const [saveMutation] = useSaveRundownMutation();
  const dispatch = useAppDispatch();
  const candidates = items.filter((item) => item.status !== "已播出");
  const poke = async (itemId: string) => {
    await simulate({ itemId }).unwrap();
    message.info("另一窗口已抢先保存该条目（版本 +1）");
    const res = await saveMutation({ items, baseVersions });
    if (isConflictResult(res)) dispatch(conflictDetected(res.conflict));
  };
  return <Card title="多窗口协作演示" size="small">
    <small className="collab-hint">两个窗口同时改同一条时，先保存的为准。点此模拟另一岗位窗口已抢先保存：</small>
    <div className="collab-rows">{candidates.map((item) => <Button key={item.id} size="small" onClick={() => void poke(item.id)}>「{item.title}」已被对方先保存</Button>)}</div>
  </Card>;
}

function ChainPage({ mode }: { mode: "changes" | "queue" | "history" | "broadcast" }) {
  const state = useAppSelector((root) => root.rundown);
  const dispatch = useAppDispatch();
  if (mode === "queue") return <Card title="本地应急队列"><div className="queue-list">{state.queue.length ? state.queue.map((item) => <article key={item.id}><Tag color="red">{item.action}</Tag><b>{item.detail}</b><small>{format(new Date(item.queuedAt), "HH:mm:ss")}</small></article>) : <p>当前没有待同步操作。</p>}</div><Button type="primary" disabled={state.online} onClick={() => { dispatchSync(); }}>主链路恢复后提交</Button></Card>;
  if (mode === "changes") return <Card title="突发变更记录"><Timeline items={state.changes.map((item) => ({ children: <div><b>{item.headline}</b><p>{item.reason} · 插播 {item.duration} 分钟</p><small>{format(new Date(item.createdAt), "HH:mm:ss")}</small></div> }))} /></Card>;
  if (mode === "broadcast") return <Card title="播出记录（只追加，不可撤回）"><Timeline items={state.broadcast.map((record) => ({ color: "green", children: <div><b>{record.title}</b><p>实际时长 {record.actualDuration} 分钟 · 岗位 <Tag color={ROLE_COLOR[record.role]}>{record.role}</Tag></p><small>{format(new Date(record.airedAt), "HH:mm:ss")} 播出</small></div> }))} /></Card>;
  return <Card title="操作历史（按岗位 · 对象逐条记录，撤回只抵消选中的一次）">
    <div className="history-list">
      {state.records.length ? state.records.map((record) => {
        const blocked = record.action === "播出";
        return <article key={record.id} className={`history-row${record.undone ? " is-undone" : ""}`}>
          <div className="history-head">
            <Tag color={ROLE_COLOR[record.role]}>{record.role}</Tag>
            <Tag>{record.action}</Tag>
            <b>{record.objectType === "串联单" ? "整张串联单" : record.detail}</b>
            <small>#{record.seq} · {format(new Date(record.time), "HH:mm:ss")}</small>
          </div>
          {record.objectType === "条目" && record.action !== "撤回" && <p className="history-diff">{diffText(record)}</p>}
          {record.action === "撤回" && <p className="history-diff">已抵消原改动{record.undoOf ? `（${record.undoOf.slice(0, 8)}）` : ""}</p>}
          <div className="history-actions">
            {record.undone
              ? <Tag color="default">已撤回{record.undoneAt ? ` · ${format(new Date(record.undoneAt), "HH:mm:ss")}` : ""}</Tag>
              : <Tooltip title={blocked ? "已播出条目进入播出记录，不可撤回" : state.role === "字幕" ? "字幕岗位无撤回权限" : "只抵消这一次改动；若其后还有改动会说明原因"}>
                  <Button size="small" disabled={blocked || state.role === "字幕"} onClick={() => dispatch(undoRecord(record.id))}>撤回这一步</Button>
                </Tooltip>}
          </div>
        </article>;
      }) : <p>暂无改动记录。</p>}
    </div>
  </Card>;
}

function dispatchSync() {
  window.dispatchEvent(new Event("sync-queue"));
}

export default function App() {
  const dispatch = useAppDispatch();
  const state = useAppSelector((root) => root.rundown);
  const { data = [] } = useGetRundownQuery();
  const { t, i18n } = useTranslation();
  useEffect(() => { if (data.length) dispatch(initialize(data)); }, [data, dispatch]);
  useEffect(() => {
    const handler = () => { dispatch(syncQueue()); message.success("应急队列已同步"); };
    window.addEventListener("sync-queue", handler);
    return () => window.removeEventListener("sync-queue", handler);
  }, [dispatch]);
  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><span>LIVE</span><div><b>{t("title")}</b><small>Control room</small></div></div><nav><NavLink to="/">{t("rundown")}</NavLink><NavLink to="/changes">{t("changes")}</NavLink><NavLink to="/broadcast">播出记录</NavLink><NavLink to="/history">操作历史</NavLink><NavLink to="/queue">{t("queue")} {state.queue.length ? <em>{state.queue.length}</em> : null}</NavLink></nav><Button ghost onClick={() => void i18n.changeLanguage(i18n.language === "zh" ? "en" : "zh")}>{i18n.language === "zh" ? "EN" : "中文"}</Button></aside>
    <main><header className="topbar"><div><small>直播运行中 · 改动按岗位与对象逐条留痕，撤回只抵消选中的一次</small><h1>{t("title")}</h1></div><div className="top-actions"><label>在线模式 <Switch checked={state.online} onChange={(value) => dispatch(setOnline(value))} /></label><label>当前岗位 <Select<Role> value={state.role} onChange={(value) => dispatch(setRole(value))} options={[{value:"导播"},{value:"主编"},{value:"字幕"},{value:"演播室"}]} /></label></div></header><Routes><Route path="/" element={<RundownPage />} /><Route path="/changes" element={<ChainPage mode="changes" />} /><Route path="/broadcast" element={<ChainPage mode="broadcast" />} /><Route path="/queue" element={<ChainPage mode="queue" />} /><Route path="/history" element={<ChainPage mode="history" />} /></Routes></main>
  </div>;
}
