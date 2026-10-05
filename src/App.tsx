import { useEffect, useMemo, useState } from "react";
import { closestCenter, DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Button, Card, Form, Input, InputNumber, Select, Switch, Tag, message } from "antd";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import { NavLink, Route, Routes } from "react-router-dom";
import { SortableItem } from "./components/SortableItem";
import { EditItemModal } from "./components/EditItemModal";
import { HistoryPage, ChangesPage } from "./components/HistoryPage";
import { AsRunPage, QueuePage } from "./components/RecordsPages";
import { useAppDispatch, useAppSelector } from "./store/hooks";
import { bootstrap, commit, ingestExternalDoc, setOnline, setRole, undoOne } from "./store/rundownSlice";
import { computeTimeline, latestUndoable, plannedTotal, targetRevesOf } from "./store/engine";
import { readDoc } from "./store/persistence";
import type { CommitResult, FieldKey, ItemType, Role, RundownItem } from "./types";

const schema = z.object({ title: z.string().min(2), type: z.enum(["新闻片", "连线", "嘉宾", "口播", "广告"]), duration: z.number().min(1).max(120), presenter: z.string().min(1), source: z.string().min(1) });
type FormValues = z.infer<typeof schema>;

function notify(result: CommitResult) {
  if (result.type === "ok") {
    if (result.message) message.success(result.message);
  } else if (result.type === "conflict") {
    message.error({ content: result.message, duration: 8 });
  } else {
    message.warning(result.message);
  }
}

function RundownPage() {
  const dispatch = useAppDispatch();
  const { doc, role, online, clientId } = useAppSelector((state) => state.rundown);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const timeline = useMemo(() => computeTimeline(doc), [doc]);
  const total = plannedTotal(doc);
  const risks = timeline.filter((row) => row.risk);
  const [editing, setEditing] = useState<RundownItem | null>(null);
  const [editConflict, setEditConflict] = useState<string | null>(null);
  const { control, handleSubmit, reset } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { title: "", type: "新闻片", duration: 5, presenter: "陈默", source: "主控" } });

  const isDirector = role === "导播";
  const canModify = role !== "字幕";

  const onDragEnd = (event: DragEndEvent) => {
    if (!event.over || event.active.id === event.over.id || !isDirector) return;
    notify(dispatch(commit({
      kind: "排序",
      activeId: String(event.active.id),
      overId: String(event.over.id)
    }, targetRevesOf(doc, { kind: "排序", activeId: String(event.active.id), overId: String(event.over.id) }))));
  };

  const submit = (values: FormValues) => {
    notify(dispatch(commit({ kind: "新增", item: { ...values, id: crypto.randomUUID() } })));
    reset();
  };

  const saveEdit = (fields: { field: FieldKey; value: string | number | undefined }[]) => {
    if (!editing) return;
    const result = dispatch(commit(
      { kind: "编辑", itemId: editing.id, batchId: crypto.randomUUID(), fields },
      { [editing.id]: editing.rev }
    ));
    notify(result);
    if (result.type === "conflict") {
      setEditConflict(result.message);
    } else if (result.type === "ok") {
      setEditing(null);
      setEditConflict(null);
    }
  };

  return <div className="page-grid">
    <Card className="main-card">
      <div className="card-heading">
        <div><small>2026-10-08 · 08:00 开播 · 窗口 {clientId}</small><h2>直播串联单</h2></div>
        <div className="head-actions">
          <Tag color={online ? "green" : "red"}>{online ? "主链路正常" : "本地应急模式"}</Tag>
          <Button
            disabled={role === "字幕" || !latestUndoable(doc, role)}
            onClick={() => {
              const target = latestUndoable(doc, role);
              if (!target) return;
              const result = dispatch(undoOne(target.id));
              notify(result);
            }}
          >撤回上一步</Button>
        </div>
      </div>
      <div className="summary">
        <span><b>{doc.items.length}</b> 条内容</span>
        <span><b>{total}</b> 分钟计划总时长（不含跳过）</span>
        <span className={risks.length ? "danger-text" : ""}><b>{risks.length}</b> 个硬时间风险</span>
        <span><b>{timeline.at(-1)?.end ?? "--:--"}</b> 预计收播</span>
      </div>
      {risks.length > 0 && (
        <div className="risk-banner">
          ⚠ 硬时间风险：{risks.map((row) => `「${row.item.title}」最早 ${row.at} 才到，晚于硬时间 ${row.item.hardStart}`).join("；")}
        </div>
      )}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={doc.items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
          <div className="rundown-list">
            {timeline.map(({ item, at, risk }) => (
              <SortableItem
                key={item.id}
                item={item}
                cumulative={at}
                risk={risk}
                canEdit={isDirector}
                onDuration={(delta) => notify(dispatch(commit({ kind: "时长", itemId: item.id, delta }, { [item.id]: item.rev })))}
                onStatus={() => notify(dispatch(commit({ kind: "播出", itemId: item.id }, { [item.id]: item.rev })))}
                onSkip={() => notify(dispatch(commit({ kind: "跳过", itemId: item.id }, { [item.id]: item.rev })))}
                onEdit={() => { setEditing(item); setEditConflict(null); }}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </Card>
    <aside className="side-stack">
      <Card title="新增播出条目">
        <Form layout="vertical" onFinish={handleSubmit(submit)}>
          <Form.Item label="标题"><Controller name="title" control={control} render={({ field, fieldState }) => <><Input {...field} status={fieldState.error ? "error" : ""} /><small className="error">{fieldState.error?.message}</small></>} /></Form.Item>
          <div className="two-cols"><Form.Item label="类型"><Controller name="type" control={control} render={({ field }) => <Select {...field} options={["新闻片", "连线", "嘉宾", "口播", "广告"].map((v) => ({ value: v, label: v }))} />} /></Form.Item><Form.Item label="时长"><Controller name="duration" control={control} render={({ field }) => <InputNumber {...field} min={1} max={120} addonAfter="分钟" />} /></Form.Item></div>
          <Form.Item label="主播"><Controller name="presenter" control={control} render={({ field }) => <Input {...field} />} /></Form.Item>
          <Form.Item label="来源"><Controller name="source" control={control} render={({ field }) => <Input {...field} />} /></Form.Item>
          <Button htmlType="submit" type="primary" block disabled={!canModify}>加入串联单</Button>
        </Form>
      </Card>
      <BreakingForm />
    </aside>
    {editing && (
      <EditItemModal
        item={editing}
        currentRev={doc.items.find((item) => item.id === editing.id)?.rev ?? editing.rev}
        saving={false}
        conflict={editConflict}
        onSave={saveEdit}
        onClose={() => { setEditing(null); setEditConflict(null); }}
      />
    )}
  </div>;
}

/** 时长加减按钮需要 delta —— 用事件委托方式直接在 SortableItem 上传 delta，这里不再需要 */

function BreakingForm() {
  const dispatch = useAppDispatch();
  const { doc, online } = useAppSelector((state) => state.rundown);
  const [values, setValues] = useState({ headline: "", duration: 5, insertAfter: doc.items[0]?.id ?? "", reason: "突发新闻" });
  return <Card title="突发插播" className="breaking-card">
    <Input value={values.headline} onChange={(event) => setValues({ ...values, headline: event.target.value })} placeholder="插播标题" />
    <div className="two-cols"><InputNumber value={values.duration} min={1} max={60} onChange={(value) => setValues({ ...values, duration: Number(value ?? 5) })} addonAfter="分钟" /><Select value={values.insertAfter} onChange={(value) => setValues({ ...values, insertAfter: value })} options={doc.items.map((item) => ({ value: item.id, label: `插在「${item.title}」后` }))} /></div>
    <Input value={values.reason} onChange={(event) => setValues({ ...values, reason: event.target.value })} placeholder="插播原因" />
    <Button type="primary" danger block disabled={values.headline.length < 2 || !values.insertAfter} onClick={() => {
      const newItem = { id: crypto.randomUUID(), title: values.headline, type: "新闻片" as ItemType, duration: values.duration, presenter: "值班主播", source: `插播：${values.reason}` };
      const result = dispatch(commit(
        { kind: "插播", item: newItem, insertAfterId: values.insertAfter, reason: values.reason },
        targetRevesOf(doc, { kind: "插播", item: newItem, insertAfterId: values.insertAfter, reason: values.reason })
      ));
      notify(result);
      if (result.type === "ok") setValues({ ...values, headline: "" });
    }}>立即插入并重算时长{online ? "" : "（进应急队列）"}</Button>
    {!online && <small>离线操作本地立即生效并入应急队列，主链路恢复后逐条提交、检查冲突。</small>}
  </Card>;
}

export default function App() {
  const dispatch = useAppDispatch();
  const state = useAppSelector((root) => root.rundown);
  const { t, i18n } = useTranslation();

  useEffect(() => { dispatch(bootstrap()); }, [dispatch]);

  // 另一个窗口保存了：storage 事件推送权威文档，先保存者的版本覆盖本窗口视图
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (!event.key?.includes("pair-wise-yf-46")) return;
      const doc = readDoc();
      if (!doc) return;
      const notice = dispatch(ingestExternalDoc(doc));
      if (notice) message.info({ content: `其他岗位已先保存：${notice.role}（窗口 ${notice.clientId}）— ${notice.detail}`, duration: 6 });
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [dispatch]);

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span>LIVE</span><div><b>{t("title")}</b><small>Control room</small></div></div>
      <nav>
        <NavLink to="/">{t("rundown")}</NavLink>
        <NavLink to="/changes">{t("changes")}</NavLink>
        <NavLink to="/asrun">{t("asrun")}</NavLink>
        <NavLink to="/history">{t("history")}</NavLink>
        <NavLink to="/queue">{t("queue")} {state.queue.length ? <em>{state.queue.length}</em> : null}</NavLink>
      </nav>
      <Button ghost onClick={() => void i18n.changeLanguage(i18n.language === "zh" ? "en" : "zh")}>{i18n.language === "zh" ? "EN" : "中文"}</Button>
    </aside>
    <main>
      <header className="topbar">
        <div><small>直播运行中 · 紧急操作均保留审计记录</small><h1>{t("title")}</h1></div>
        <div className="top-actions">
          <label>在线模式 <Switch checked={state.online} onChange={(value) => dispatch(setOnline(value))} /></label>
          <label>当前岗位 <Select<Role> value={state.role} onChange={(value) => dispatch(setRole(value))} options={[{ value: "导播" }, { value: "主编" }, { value: "字幕" }, { value: "演播室" }]} /></label>
        </div>
      </header>
      <Routes>
        <Route path="/" element={<RundownPage />} />
        <Route path="/changes" element={<ChangesPage />} />
        <Route path="/asrun" element={<AsRunPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/queue" element={<QueuePage />} />
      </Routes>
    </main>
  </div>;
}
