import type {
  AsRunEntry, ChangeEntry, FieldChange, FieldKey, ItemStatus,
  NewItemInput, Role, RundownDoc, RundownItem, ChangeSpec
} from "../types";

export const SHOW_START = new Date("2026-10-08T08:00:00");

export const EDITABLE_FIELDS = new Set<FieldKey>(["title", "duration", "hardStart", "presenter", "source"]);

function findItem(doc: RundownDoc, id: string): RundownItem | undefined {
  return doc.items.find((item) => item.id === id);
}

function isFieldChange(f: FieldChange): boolean {
  const norm = (v: unknown) => (v === undefined || v === "" ? undefined : v);
  return norm(f.before) !== norm(f.after);
}

function readField(item: RundownItem, field: FieldKey): string | number | undefined {
  if (field === "duration") return item.duration;
  if (field === "hardStart") return item.hardStart;
  return item[field] as string | undefined;
}

function writeField(item: RundownItem, field: FieldKey, value: string | number | undefined) {
  if (field === "duration") {
    item.duration = Math.max(1, Number(value) || 1);
  } else if (field === "hardStart") {
    item.hardStart = value === undefined || value === "" ? undefined : String(value);
  } else {
    (item as unknown as Record<string, unknown>)[field] = value === undefined ? "" : value;
  }
}

export interface BuildResult {
  entries: ChangeEntry[];
  asRun?: AsRunEntry;
  breakingId?: string;
}

export interface BuildContext {
  role: Role;
  clientId: string;
  pending: boolean;
  timelineStart: (doc: RundownDoc, itemId: string) => string;
}

/**
 * 把一次改动翻译成逐条留痕（同次保存多字段 -> 多条 entry，各自带字段级逆操作数据）。
 * 纯函数，不修改 doc；做不了（对象不存在 / 已播出锁 / 无实际变化）返回拒绝原因。
 */
export function buildEntries(doc: RundownDoc, spec: ChangeSpec, ctx: BuildContext): { result: BuildResult } | { error: string } {
  const now = new Date().toISOString();
  const base = (id: string) => findItem(doc, id)?.rev ?? 0;
  const mk = (partial: Omit<ChangeEntry, "id" | "seq" | "role" | "clientId" | "time" | "baseRev" | "undone" | "sealed" | "pending"> & { sealed?: boolean }): ChangeEntry => ({
    id: crypto.randomUUID(),
    seq: ctx.pending ? -1 : doc.seq + 1,
    role: ctx.role,
    clientId: ctx.clientId,
    time: now,
    baseRev: partial.itemId ? base(partial.itemId) : 0,
    undone: false,
    sealed: partial.sealed ?? false,
    pending: ctx.pending || undefined,
    ...partial
  });

  switch (spec.kind) {
    case "新增": {
      return { result: { entries: [mk({ kind: "新增", itemId: spec.item.id, itemTitle: spec.item.title, detail: `新增「${spec.item.title}」（${spec.item.type} · ${spec.item.duration} 分钟）` })] } };
    }
    case "插播": {
      const anchor = findItem(doc, spec.insertAfterId);
      if (!anchor) return { error: "插入位置所选条目已不存在" };
      const breakingId = crypto.randomUUID();
      return {
        result: {
          entries: [mk({
            kind: "插播", itemId: spec.item.id, itemTitle: spec.item.title,
            detail: `突发插播「${spec.item.title}」（${spec.item.duration} 分钟），插在「${anchor.title}」之后：${spec.reason}`,
            breakingId
          })],
          breakingId
        }
      };
    }
    case "时长": {
      const item = findItem(doc, spec.itemId);
      if (!item) return { error: "条目已不存在，无法调整时长" };
      if (item.status === "已播出") return { error: `「${item.title}」已播出，实际 ${item.actualDuration ?? item.duration} 分钟已锁定在播出记录，不能再改` };
      if (item.status === "已跳过") return { error: `「${item.title}」已跳过` };
      const before = item.duration;
      const after = Math.max(1, before + spec.delta);
      if (after === before) return { error: "时长没有变化" };
      return {
        result: {
          entries: [mk({
            kind: "时长", itemId: item.id, itemTitle: item.title,
            detail: `${ctx.role} 把「${item.title}」时长 ${before} → ${after} 分钟（${spec.delta > 0 ? "+" : ""}${after - before}）`,
            fields: [{ field: "duration", before, after }]
          })]
        }
      };
    }
    case "编辑": {
      const item = findItem(doc, spec.itemId);
      if (!item) return { error: "条目已不存在，无法编辑" };
      if (item.status === "已播出") return { error: `「${item.title}」已播出，实际时长与播出事实已封存，不能再编辑` };
      const changes: FieldChange[] = spec.fields
        .filter((f) => EDITABLE_FIELDS.has(f.field))
        .map((f) => ({ field: f.field, before: readField(item, f.field), after: f.value === "" ? undefined : f.value }))
        .filter(isFieldChange);
      if (!changes.length) return { error: "内容没有变化" };
      const label: Record<string, string> = { title: "标题", duration: "时长", hardStart: "硬时间", presenter: "主播", source: "来源" };
      return {
        result: {
          entries: changes.map((f) => mk({
            kind: "编辑", itemId: item.id, itemTitle: item.title, batchId: spec.batchId,
            detail: `${ctx.role} 修改「${item.title}」${label[f.field]}：${fmt(f.before)} → ${fmt(f.after)}`,
            fields: [f]
          }))
        }
      };
    }
    case "跳过": {
      const item = findItem(doc, spec.itemId);
      if (!item) return { error: "条目已不存在" };
      if (item.status === "已播出") return { error: `「${item.title}」已播出，不能取消` };
      if (item.status === "已跳过") return { error: `「${item.title}」已是跳过状态` };
      return {
        result: {
          entries: [mk({
            kind: "跳过", itemId: item.id, itemTitle: item.title,
            detail: `${ctx.role} 取消条目「${item.title}」（${item.status} → 已跳过）`,
            fields: [{ field: "status", before: item.status, after: "已跳过" satisfies ItemStatus }]
          })]
        }
      };
    }
    case "播出": {
      const item = findItem(doc, spec.itemId);
      if (!item) return { error: "条目已不存在" };
      if (item.status === "已播出") return { error: `「${item.title}」已经在播出记录中` };
      if (item.status === "已跳过") return { error: `「${item.title}」已跳过，不能标记播出` };
      const startAt = ctx.timelineStart(doc, item.id);
      const airedAt = new Date().toISOString();
      const asRun: AsRunEntry = {
        id: crypto.randomUUID(), itemId: item.id, title: item.title, type: item.type,
        plannedDuration: item.duration, actualDuration: item.duration, startAt,
        airedAt, role: ctx.role, clientId: ctx.clientId
      };
      return {
        result: {
          entries: [mk({
            kind: "播出", itemId: item.id, itemTitle: item.title,
            detail: `${ctx.role} 标记「${item.title}」已播出，实际 ${item.duration} 分钟（${startAt} 起），写入播出记录`,
            fields: [{ field: "status", before: item.status, after: "已播出" satisfies ItemStatus }],
            sealed: true
          })],
          asRun
        }
      };
    }
    case "排序": {
      const from = doc.items.findIndex((item) => item.id === spec.activeId);
      const to = doc.items.findIndex((item) => item.id === spec.overId);
      if (from < 0 || to < 0 || from === to) return { error: "顺序没有变化" };
      const active = doc.items[from];
      if (active.status === "已播出") return { error: `「${active.title}」已播出，播出顺序不可再动` };
      if (doc.items[to].status === "已播出") return { error: `「${doc.items[to].title}」已播出，不能把条目挪过它` };
      const beforeId = from > 0 ? doc.items[from - 1].id : undefined;
      const afterId = from < doc.items.length - 1 ? doc.items[from + 1].id : undefined;
      return {
        result: {
          entries: [mk({
            kind: "排序", itemId: active.id, itemTitle: active.title,
            detail: `${ctx.role} 调整顺序：「${active.title}」第 ${from + 1} 位 → 第 ${to + 1} 位`,
            beforeId, afterId, fromPosition: from, toPosition: to
          })]
        }
      };
    }
  }
}

function fmt(v: string | number | undefined): string {
  if (v === undefined || v === "") return "（空）";
  return String(v);
}

function newItemFromInput(input: NewItemInput, rev: number): RundownItem {
  return { id: input.id, title: input.title, type: input.type, duration: input.duration, hardStart: input.hardStart, status: "待播", presenter: input.presenter, source: input.source, rev };
}

/**
 * 应用一次改动（含其全部条目）到文档。纯函数，返回新文档。
 * 调用方负责先做并发冲突判断。
 */
export function applyChange(doc: RundownDoc, spec: ChangeSpec, entries: ChangeEntry[], extra?: { asRun?: AsRunEntry; breakingId?: string }): RundownDoc {
  const next: RundownDoc = structuredClone({ ...doc, items: [...doc.items], log: [...doc.log] });
  const bump = (id: string) => {
    const item = next.items.find((entry) => entry.id === id);
    if (item) item.rev += 1;
  };

  switch (spec.kind) {
    case "新增": {
      next.items.push(newItemFromInput(spec.item, 1));
      break;
    }
    case "插播": {
      const index = next.items.findIndex((item) => item.id === spec.insertAfterId);
      next.items.splice(index + 1, 0, newItemFromInput(spec.item, 1));
      next.breaking.unshift({
        id: extra?.breakingId ?? entries[0]?.breakingId ?? crypto.randomUUID(),
        headline: spec.item.title, duration: spec.item.duration,
        insertAfter: spec.insertAfterId, reason: spec.reason, createdAt: entries[0]?.time ?? new Date().toISOString()
      });
      break;
    }
    case "时长":
    case "编辑": {
      const item = next.items.find((entry) => entry.id === spec.itemId);
      if (item) {
        for (const entry of entries) for (const f of entry.fields ?? []) writeField(item, f.field, f.after);
        bump(item.id);
      }
      break;
    }
    case "跳过":
    case "播出": {
      const item = next.items.find((entry) => entry.id === spec.itemId);
      if (item) {
        for (const f of entries[0]?.fields ?? []) writeField(item, f.field, f.after);
        bump(item.id);
      }
      if (spec.kind === "播出" && extra?.asRun) next.asRun.unshift(structuredClone(extra.asRun));
      break;
    }
    case "排序": {
      const from = next.items.findIndex((item) => item.id === spec.activeId);
      const to = next.items.findIndex((item) => item.id === spec.overId);
      if (from >= 0 && to >= 0 && from !== to) {
        next.items.splice(to, 0, ...next.items.splice(from, 1));
        // 被拖动条目的版本号 +1，配合区间版本检查拦住另一窗口基于旧顺序的拖拽/编辑
        bump(spec.activeId);
      }
      break;
    }
  }

  next.log.unshift(...structuredClone(entries));
  next.seq = Math.max(doc.seq, ...entries.map((entry) => entry.seq > 0 ? entry.seq : 0));
  return next;
}

function kindText(kind: ChangeEntry["kind"]): string {
  return ({ 新增: "新增", 插播: "插播", 时长: "时长调整", 编辑: "编辑", 跳过: "跳过", 播出: "标记播出", 排序: "调整顺序" })[kind];
}

/** 撤回可行性判断：看这条是否被后面的改动挡住，或对象已经播出封存 */
export function canUndo(doc: RundownDoc, entryId: string, by: Role): { ok: boolean; reason?: string } {
  const entry = doc.log.find((logEntry) => logEntry.id === entryId);
  if (!entry) return { ok: false, reason: "该条记录已不存在" };
  if (entry.undone) return { ok: false, reason: "这条改动此前已经撤回过" };
  if (by === "字幕") return { ok: false, reason: "字幕岗位没有撤回权限" };
  if (entry.sealed || entry.kind === "播出") {
    return { ok: false, reason: `「${entry.itemTitle}」已播出，实际时长已写入播出记录，播出事实不可撤回` };
  }

  const item = findItem(doc, entry.itemId);
  if (!item) {
    return { ok: false, reason: `对象「${entry.itemTitle}」已不在串联单中` };
  }
  if (item.status === "已播出") {
    return { ok: false, reason: `「${entry.itemTitle}」随后已播出（实际 ${item.actualDuration ?? item.duration} 分钟已锁定），这版改动被播出封存挡住` };
  }

  const blockers: ChangeEntry[] = [];
  for (const later of doc.log) {
    if (later.undone || later.id === entry.id) continue;
    const laterIsAfter = later.seq > entry.seq || (entry.seq < 0 && later.time > entry.time);
    if (!laterIsAfter) continue;
    if (overlaps(entry, later, doc)) blockers.push(later);
  }
  if (blockers.length) {
    const first = blockers[0];
    const who = first.role === by ? `你（${by}）` : `${first.role}`;
    return {
      ok: false,
      reason: `撤不动：${who}在这之后又${kindText(first.kind)}了「${first.itemTitle}」（${formatTime(first.time)}），先撤回或保留那次改动再撤这一条`
    };
  }
  return { ok: true };
}

function overlaps(entry: ChangeEntry, later: ChangeEntry, doc: RundownDoc): boolean {
  // 排序条目：之后对该条再做排序，或该条又被删除/新增类操作波及，才挡住；
  // 逆操作按移动前的相邻锚点重新定位，对别处的普通插入、字段编辑是稳健的，不挡
  if (entry.kind === "排序") {
    return later.itemId === entry.itemId && (later.kind === "排序" || later.kind === "新增" || later.kind === "插播");
  }
  // 新增/插播：之后对该条的任何字段改动都挡住整体撤回
  if (entry.kind === "新增" || entry.kind === "插播") {
    return later.itemId === entry.itemId;
  }
  // 时长/编辑：同字段重叠才挡（不同字段的改动可以各自独立撤回）
  if (entry.kind === "时长" || entry.kind === "编辑") {
    if (later.itemId !== entry.itemId) return false;
    if (later.kind === "新增" || later.kind === "插播" || later.kind === "排序") return true;
    const mine = new Set((entry.fields ?? []).map((f) => f.field));
    const theirs = new Set((later.fields ?? []).map((f) => f.field));
    for (const f of theirs) if (mine.has(f)) return true;
    return false;
  }
  // 跳过：之后的状态变化挡住
  if (entry.kind === "跳过") {
    return later.itemId === entry.itemId && (later.kind === "跳过" || later.kind === "播出" || (later.fields ?? []).some((f) => f.field === "status"));
  }
  return false;
}

/**
 * 撤回指定的一条：只做这一条的逆操作，不恢复整张旧表。
 * 已播出条目、实际时长留在播出记录里，不受影响。
 */
export function undoEntry(doc: RundownDoc, entryId: string, by: Role): { doc: RundownDoc; message: string } | { error: string } {
  const check = canUndo(doc, entryId, by);
  if (!check.ok) return { error: check.reason ?? "无法撤回" };
  const entry = doc.log.find((logEntry) => logEntry.id === entryId)!;
  const next: RundownDoc = structuredClone({ ...doc, items: [...doc.items], log: [...doc.log] });

  switch (entry.kind) {
    case "新增":
    case "插播": {
      next.items = next.items.filter((item) => item.id !== entry.itemId);
      if (entry.breakingId) next.breaking = next.breaking.filter((change) => change.id !== entry.breakingId);
      break;
    }
    case "排序": {
      const current = next.items.findIndex((item) => item.id === entry.itemId);
      if (current < 0) return { error: "条目已不在串联单中" };
      const [moved] = next.items.splice(current, 1);
      let insertAt: number;
      if (entry.beforeId === undefined) {
        insertAt = 0;
      } else {
        const anchor = next.items.findIndex((item) => item.id === entry.beforeId);
        insertAt = anchor < 0 ? 0 : anchor + 1;
      }
      next.items.splice(insertAt, 0, moved);
      moved.rev += 1;
      break;
    }
    default: {
      const target = next.items.find((item) => item.id === entry.itemId);
      if (!target) return { error: `「${entry.itemTitle}」已不在串联单中` };
      for (const f of entry.fields ?? []) writeField(target, f.field, f.before);
      target.rev += 1;
    }
  }
  const logEntry = next.log.find((logEntryItem) => logEntryItem.id === entryId);
  if (logEntry) {
    logEntry.undone = true;
    logEntry.undoneAt = new Date().toISOString();
    logEntry.undoneBy = by;
  }
  return { doc: next, message: `已撤回${kindText(entry.kind)}：${entry.itemTitle}（仅此一条，累计时间与硬时间风险已重算）` };
}

/** 找当前可撤回的最新一条（顶部“撤回上一步”按钮用） */
export function latestUndoable(doc: RundownDoc, by: Role): ChangeEntry | undefined {
  return doc.log.find((entry) => canUndo(doc, entry.id, by).ok);
}

/* ---------- 累计时间与硬时间风险：全部从当前数据派生 ---------- */

export interface TimelineRow {
  item: RundownItem;
  start: Date;
  at: string;
  end: string;
  skipped: boolean;
  risk: boolean;
}

function toMinutes(hhmm?: string): number | undefined {
  if (!hhmm) return undefined;
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return undefined;
  return h * 60 + m;
}

export function computeTimeline(doc: RundownDoc): TimelineRow[] {
  const rows: TimelineRow[] = [];
  let cursor = SHOW_START.getTime();
  const showStartMin = SHOW_START.getHours() * 60 + SHOW_START.getMinutes();
  for (const item of doc.items) {
    const start = new Date(cursor);
    // 已播出条目按锁定的实际时长推进；跳过条目不占时长
    const skipped = item.status === "已跳过";
    const consumed = skipped ? 0 : item.status === "已播出" ? item.actualDuration ?? item.duration : item.duration;
    const end = new Date(cursor + consumed * 60_000);
    const hard = toMinutes(item.hardStart);
    const startMin = (start.getTime() - SHOW_START.getTime()) / 60_000;
    // 硬时间是绝对钟点，换算成相对开播的分钟再比（半分钟容差）
    const risk = !skipped && hard !== undefined && startMin > hard - showStartMin + 0.5;
    rows.push({ item, start, at: formatClock(start), end: formatClock(end), skipped, risk });
    cursor = end.getTime();
  }
  return rows;
}

export function plannedTotal(doc: RundownDoc): number {
  return doc.items.filter((item) => item.status !== "已跳过").reduce((sum, item) => sum + item.duration, 0);
}

export function riskCount(doc: RundownDoc): number {
  return computeTimeline(doc).filter((row) => row.risk).length;
}

export function timelineStartAt(doc: RundownDoc, itemId: string): string {
  return computeTimeline(doc).find((row) => row.item.id === itemId)?.at ?? "--:--";
}

export function formatClock(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function formatTime(iso: string): string {
  const date = new Date(iso);
  return `${formatClock(date)}:${String(date.getSeconds()).padStart(2, "0")}`;
}

/** 提交前的并发版本检查：目标条目是否被别的窗口先保存过 */
export function checkConflict(
  doc: RundownDoc,
  spec: ChangeSpec,
  targetReves: Record<string, number>,
  clientId: string
): { conflict: boolean; message?: string } {
  const targets = conflictTargets(doc, spec);
  for (const id of targets) {
    const current = doc.items.find((item) => item.id === id)?.rev ?? 0;
    if ((targetReves[id] ?? 0) !== current) {
      const item = doc.items.find((entry) => entry.id === id);
      const lastChange = doc.log.find((entry) => entry.itemId === id && !entry.undone);
      const who = lastChange && lastChange.clientId !== clientId ? `${lastChange.role}（窗口 ${lastChange.clientId}）` : "另一窗口";
      return {
        conflict: true,
        message: `保存冲突：「${item?.title ?? id}」已被${who}先保存（版本 ${targetReves[id] ?? 0} → ${current}）。以先保存的版本为准，你的这次改动未写入，请刷新后基于最新版本再改。`
      };
    }
  }
  return { conflict: false };
}

function conflictTargets(doc: RundownDoc, spec: ChangeSpec): string[] {
  switch (spec.kind) {
    case "新增": return [];
    case "插播": return [spec.insertAfterId];
    case "排序": {
      const from = doc.items.findIndex((item) => item.id === spec.activeId);
      const to = doc.items.findIndex((item) => item.id === spec.overId);
      if (from < 0 || to < 0) return [];
      const [lo, hi] = from < to ? [from, to] : [to, from];
      return doc.items.slice(lo, hi + 1).map((item) => item.id);
    }
    default: return [spec.itemId];
  }
}

/** 一次改动涉及的条目及其当前版本号（打开编辑/入队时采集） */
export function targetRevesOf(doc: RundownDoc, spec: ChangeSpec): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of conflictTargets(doc, spec)) {
    const item = doc.items.find((entry) => entry.id === id);
    if (item) out[id] = item.rev;
  }
  return out;
}
