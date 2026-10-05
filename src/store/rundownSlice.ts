import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { BreakingChange, BroadcastRecord, ChangeRecord, ConflictInfo, PendingChange, Role, RundownItem } from "../types";

const seed: RundownItem[] = [
  { id: "r1", title: "早间新闻提要", type: "新闻片", duration: 4, hardStart: "08:00", status: "已播出", presenter: "陈默", source: "主控", version: 1, airedAt: "2026-10-08T08:00:00", actualDuration: 4 },
  { id: "r2", title: "城市更新现场连线", type: "连线", duration: 8, hardStart: "08:06", status: "待播", presenter: "陈默", source: "记者周岚", version: 1 },
  { id: "r3", title: "政策发布会解读", type: "嘉宾", duration: 12, status: "待播", presenter: "陈默", source: "演播室A", version: 1 },
  { id: "r4", title: "整点广告", type: "广告", duration: 3, hardStart: "08:30", status: "待播", presenter: "系统", source: "广告串", version: 1 }
];

interface State {
  initialized: boolean;
  items: RundownItem[];
  /** 按岗位 + 对象逐条记下的改动（最新在前） */
  records: ChangeRecord[];
  /** 播出记录：只追加，撤回不可动 */
  broadcast: BroadcastRecord[];
  queue: PendingChange[];
  changes: BreakingChange[];
  role: Role;
  online: boolean;
  /** 我方上次保存时各条目的版本，用于并发冲突检测 */
  baseVersions: Record<string, number>;
  /** 保存时发现的并发冲突（先保存的为准，我方停止） */
  conflict: ConflictInfo[] | null;
  /** 撤回被阻挡时给出的原因 */
  undoError: { recordId: string; reason: string } | null;
}

const initialState: State = {
  initialized: false,
  items: seed,
  records: [],
  broadcast: seed.filter((item) => item.status === "已播出").map((item) => ({ itemId: item.id, title: item.title, airedAt: item.airedAt!, actualDuration: item.actualDuration!, role: "导播" })),
  queue: [],
  changes: [],
  role: "导播",
  online: true,
  baseVersions: {},
  conflict: null,
  undoError: null
};

type ItemFields = Partial<RundownItem>;

/** 取条目上会被改动记录的字段 */
function fieldsOf(item: RundownItem): ItemFields {
  return { title: item.title, type: item.type, duration: item.duration, hardStart: item.hardStart, status: item.status, presenter: item.presenter, source: item.source, version: item.version, airedAt: item.airedAt, actualDuration: item.actualDuration };
}

function makeRecord(state: State, input: Omit<ChangeRecord, "id" | "seq" | "time">): ChangeRecord {
  const seq = state.records.reduce((max, record) => Math.max(max, record.seq), 0) + 1;
  return { ...input, id: crypto.randomUUID(), seq, time: new Date().toISOString() };
}

/** 条目被改动时版本 +1（并发冲突检测的依据） */
function touch(item: RundownItem) {
  item.version += 1;
}

const slice = createSlice({
  name: "rundown",
  initialState,
  reducers: {
    initialize(state, action: PayloadAction<RundownItem[]>) {
      if (!state.initialized) {
        state.items = action.payload.length ? action.payload : seed;
        state.initialized = true;
        state.baseVersions = Object.fromEntries(state.items.map((item) => [item.id, item.version]));
      }
    },
    setRole(state, action: PayloadAction<Role>) { state.role = action.payload; },
    setOnline(state, action: PayloadAction<boolean>) { state.online = action.payload; },

    addItem(state, action: PayloadAction<Omit<RundownItem, "id" | "status" | "version">>) {
      const item: RundownItem = { ...action.payload, id: crypto.randomUUID(), status: "草稿", version: 1 };
      state.records.unshift(makeRecord(state, {
        role: state.role, objectType: "条目", objectId: item.id, action: "新增条目",
        detail: item.title, before: null, after: fieldsOf(item)
      }));
      state.items.push(item);
    },

    updateStatus(state, action: PayloadAction<{ id: string; status: RundownItem["status"] }>) {
      const item = state.items.find((entry) => entry.id === action.payload.id);
      if (!item || item.status === "已播出") return;
      if (action.payload.status === "已播出") {
        const before: ItemFields = { status: item.status };
        item.status = "已播出";
        item.airedAt = new Date().toISOString();
        item.actualDuration = item.duration;
        touch(item);
        state.broadcast.unshift({ itemId: item.id, title: item.title, airedAt: item.airedAt, actualDuration: item.actualDuration, role: state.role });
        state.records.unshift(makeRecord(state, {
          role: state.role, objectType: "条目", objectId: item.id, action: "播出",
          detail: `${item.title} 播出，实际时长 ${item.actualDuration} 分钟`,
          before, after: { status: "已播出", airedAt: item.airedAt, actualDuration: item.actualDuration }
        }));
      } else {
        const before: ItemFields = { status: item.status };
        item.status = action.payload.status;
        touch(item);
        state.records.unshift(makeRecord(state, {
          role: state.role, objectType: "条目", objectId: item.id, action: "取消条目",
          detail: `${item.title} → ${action.payload.status}`, before, after: { status: item.status }
        }));
      }
    },

    reorder(state, action: PayloadAction<RundownItem[]>) {
      const before = state.items.map((item) => item.id);
      const after = action.payload.map((item) => item.id);
      if (before.join() === after.join()) return;
      state.records.unshift(makeRecord(state, {
        role: state.role, objectType: "串联单", action: "调整顺序",
        detail: `顺序调整 ${before.length} 条`, orderBefore: before, orderAfter: after
      }));
      state.items = action.payload;
      state.items.forEach(touch);
    },

    adjustDuration(state, action: PayloadAction<{ id: string; delta: number }>) {
      const item = state.items.find((entry) => entry.id === action.payload.id);
      if (!item) return;
      if (item.status === "已播出") return; // 实际时长已锁定在播出记录里
      const before: ItemFields = { duration: item.duration };
      item.duration = Math.max(1, item.duration + action.payload.delta);
      touch(item);
      state.records.unshift(makeRecord(state, {
        role: state.role, objectType: "条目", objectId: item.id, action: "调整时长",
        detail: `${item.title} ${action.payload.delta > 0 ? "增加" : "减少"} ${Math.abs(action.payload.delta)} 分钟`,
        before, after: { duration: item.duration }
      }));
    },

    insertBreaking(state, action: PayloadAction<Omit<BreakingChange, "id" | "createdAt">>) {
      const change: BreakingChange = { ...action.payload, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
      const index = state.items.findIndex((item) => item.id === change.insertAfter);
      const item: RundownItem = {
        id: crypto.randomUUID(), title: change.headline, type: "新闻片", duration: change.duration,
        status: "待播", presenter: "值班主播", source: `插播：${change.reason}`, version: 1
      };
      state.records.unshift(makeRecord(state, {
        role: state.role, objectType: "条目", objectId: item.id, action: "突发插播",
        detail: change.headline, before: null, after: fieldsOf(item)
      }));
      state.items.splice(index + 1, 0, item);
      state.changes.unshift(change);
      if (!state.online) state.queue.unshift({ id: crypto.randomUUID(), action: "突发插播", detail: change.headline, queuedAt: change.createdAt });
    },

    skipItem(state, action: PayloadAction<string>) {
      const item = state.items.find((entry) => entry.id === action.payload);
      if (!item || item.status === "已播出") return;
      const before: ItemFields = { status: item.status };
      item.status = "已跳过";
      touch(item);
      state.records.unshift(makeRecord(state, {
        role: state.role, objectType: "条目", objectId: item.id, action: "取消条目",
        detail: item.title, before, after: { status: item.status }
      }));
      if (!state.online) state.queue.unshift({ id: crypto.randomUUID(), action: "取消条目", detail: item.title, queuedAt: new Date().toISOString() });
    },

    /**
     * 撤回只抵消选中的那一条改动：
     * - 播出记录不可撤回（已播出条目和实际时长留在播出记录里）
     * - 同一对象在它之后还有未撤回的改动时，撤回会覆盖后续改动，必须说明原因并拒绝
     */
    undoRecord(state, action: PayloadAction<string>) {
      const record = state.records.find((entry) => entry.id === action.payload);
      if (!record || record.undone) return;

      if (record.action === "播出") {
        state.undoError = { recordId: record.id, reason: "已播出条目已进入播出记录，实际时长锁定，不可撤回。" };
        return;
      }

      const later = state.records.filter(
        (entry) => entry.objectId === record.objectId && entry.seq > record.seq && !entry.undone
      );
      if (later.length) {
        const names = later.map((entry) => `「${entry.action}」`).join("、");
        state.undoError = {
          recordId: record.id,
          reason: `该条目在你要撤回的改动之后还有 ${later.length} 次改动（${names}）。撤回会把这些改动一并覆盖，请先从最近的改动开始撤回。`
        };
        return;
      }

      if (record.orderBefore) {
        // 恢复整张串联单的顺序；撤回之后新增的条目保留在末尾，不丢弃
        const order = record.orderBefore;
        const restored = state.items
          .filter((item) => order.includes(item.id))
          .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
        const added = state.items.filter((item) => !order.includes(item.id));
        state.items = [...restored, ...added];
        state.items.forEach(touch);
      } else if (record.before === null) {
        // 新增 / 插播：条目当时不存在，撤回即删除
        state.items = state.items.filter((item) => item.id !== record.objectId);
      } else {
        const item = state.items.find((entry) => entry.id === record.objectId);
        if (!item) return;
        if (item.status === "已播出") {
          state.undoError = { recordId: record.id, reason: "该条目已播出，播出记录不可撤回。" };
          return;
        }
        Object.assign(item, record.before);
        touch(item);
      }

      record.undone = true;
      record.undoneAt = new Date().toISOString();
      state.records.unshift(makeRecord(state, {
        role: state.role, objectType: record.objectType, objectId: record.objectId,
        action: "撤回", detail: `撤回：${record.detail}`,
        before: record.after ?? null, after: record.before ?? null, undoOf: record.id
      }));
    },

    clearUndoError(state) { state.undoError = null; },

    /** 保存成功：同步我方基线版本 */
    markSaved(state, action: PayloadAction<RundownItem[]>) {
      state.baseVersions = Object.fromEntries(action.payload.map((item) => [item.id, item.version]));
    },

    /** 保存被对方窗口先一步完成：停止并说明冲突 */
    conflictDetected(state, action: PayloadAction<ConflictInfo[]>) {
      state.conflict = action.payload;
    },
    clearConflict(state) { state.conflict = null; },

    /** 以对方保存的版本为准刷新（我方未保存的改动放弃） */
    reloadFromServer(state, action: PayloadAction<RundownItem[]>) {
      state.items = action.payload.length ? action.payload : state.items;
      state.baseVersions = Object.fromEntries(state.items.map((item) => [item.id, item.version]));
      state.conflict = null;
    },

    queueChange(state, action: PayloadAction<{ action: string; detail: string }>) {
      state.queue.unshift({ ...action.payload, id: crypto.randomUUID(), queuedAt: new Date().toISOString() });
    },
    syncQueue(state) { state.queue = []; }
  }
});

export const {
  initialize, setRole, setOnline, addItem, updateStatus, reorder, adjustDuration,
  insertBreaking, skipItem, undoRecord, clearUndoError, markSaved, conflictDetected,
  clearConflict, reloadFromServer, queueChange, syncQueue
} = slice.actions;
export default slice.reducer;
