import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type {
  ChangeSpec, CommitResult, FieldKey, QueuedChange, Role, RundownDoc
} from "../types";
import {
  applyChange, buildEntries, checkConflict, targetRevesOf, timelineStartAt, undoEntry
} from "./engine";
import { hydrateOrSeed, readDoc, writeDoc } from "./persistence";
import { makeSeedDoc } from "./seed";
import type { AppDispatch, RootState } from "./index";

const CLIENT_KEY = "pair-wise-yf-46/client";

function loadClientId(): string {
  const existing = sessionStorage.getItem(CLIENT_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID().slice(0, 4);
  sessionStorage.setItem(CLIENT_KEY, id);
  return id;
}

interface State {
  doc: RundownDoc;
  role: Role;
  online: boolean;
  clientId: string;
  /** 离线应急队列（最新在前） */
  queue: QueuedChange[];
}

const initialState: State = {
  doc: makeSeedDoc(),
  role: "导播",
  online: true,
  clientId: loadClientId(),
  queue: []
};

const slice = createSlice({
  name: "rundown",
  initialState,
  reducers: {
    hydrate(state, action: PayloadAction<RundownDoc>) {
      state.doc = action.payload;
    },
    setRole(state, action: PayloadAction<Role>) { state.role = action.payload; },
    setOnline(state, action: PayloadAction<boolean>) { state.online = action.payload; },
    enqueue(state, action: PayloadAction<QueuedChange>) {
      state.queue.unshift(action.payload);
    },
    dropQueued(state, action: PayloadAction<string>) {
      state.queue = state.queue.filter((item) => item.id !== action.payload);
    },
    clearQueue(state) { state.queue = []; }
  }
});

export const { hydrate, setRole, setOnline, enqueue, dropQueued, clearQueue } = slice.actions;

/** 启动：从服务端文档（localStorage）加载，首次访问则播种并落库 */
export function bootstrap() {
  return (dispatch: AppDispatch) => {
    const doc = hydrateOrSeed(makeSeedDoc());
    dispatch(hydrate(structuredClone(doc)));
  };
}

/** 别的窗口保存后，通过 storage 事件推送权威文档 */
export function ingestExternalDoc(doc: RundownDoc) {
  return (_dispatch: AppDispatch, getState: () => RootState) => {
    const { clientId, queue, online } = getState().rundown;
    // 本地应急队列还有未提交改动时，不能让外部推送冲掉本地视图；
    // 待主链路恢复、队列重放完成后自然会 hydrate 到权威版本
    if (!online || queue.length > 0) return null;
    const latest = doc.log[0];
    _dispatch(hydrate(structuredClone(doc)));
    if (latest && latest.clientId !== clientId && !latest.undone) {
      return { role: latest.role, clientId: latest.clientId, detail: latest.detail };
    }
    return null;
  };
}

/**
 * 提交一次改动。
 * 在线：按条目版本号做条件写入——版本被别的窗口抢先保存过就判冲突，本次不写入。
 * 离线：本地立即生效并入应急队列，主链路恢复后重放。
 */
export function commit(spec: ChangeSpec, baseReves?: Record<string, number>): (dispatch: AppDispatch, getState: () => RootState) => CommitResult {
  return (dispatch, getState) => {
    const { doc, role, clientId, online, queue } = getState().rundown;
    const ctx = { role, clientId, pending: !online, timelineStart: timelineStartAt };

    if (online) {
      const server = readDoc() ?? doc;
      const built = buildEntries(server, spec, ctx);
      if ("error" in built) return { type: "blocked", message: built.error };
      const conflict = checkConflict(server, spec, baseReves ?? targetRevesOf(server, spec), clientId);
      if (conflict.conflict) return { type: "conflict", message: conflict.message! };
      const next = applyChange(server, spec, built.result.entries, { asRun: built.result.asRun, breakingId: built.result.breakingId });
      writeDoc(next);
      dispatch(hydrate(structuredClone(next)));
      return { type: "ok" };
    }

    // 本地应急模式
    const built = buildEntries(doc, spec, { ...ctx, pending: true });
    if ("error" in built) return { type: "blocked", message: built.error };
    const next = applyChange(doc, spec, built.result.entries, { asRun: built.result.asRun, breakingId: built.result.breakingId });
    const queued: QueuedChange = {
      id: crypto.randomUUID(),
      spec: structuredClone(spec),
      role,
      clientId,
      queuedAt: new Date().toISOString(),
      detail: built.result.entries[0]?.detail ?? "改动",
      itemTitle: built.result.entries[0]?.itemTitle ?? "",
      targetReves: targetRevesOf(doc, spec),
      entryIds: built.result.entries.map((entry) => entry.id)
    };
    dispatch(hydrate(next));
    dispatch(enqueue(queued));
    void queue;
    return { type: "ok", message: "已进入本地应急队列，主链路恢复后提交" };
  };
}

/**
 * 撤回一条改动（逆操作，只抵消选中那一次）。
 * 在线：直接对服务端文档判断并写入，挡得住时给出原因。
 * 离线：只允许撤回本窗口尚未提交的应急操作。
 */
export function undoOne(entryId: string): (dispatch: AppDispatch, getState: () => RootState) => CommitResult {
  return (dispatch, getState) => {
    const { doc, role, clientId, online, queue } = getState().rundown;

    if (!online) {
      const entry = doc.log.find((item) => item.id === entryId);
      if (!entry) return { type: "blocked", message: "找不到这条改动" };
      if (!entry.pending || entry.clientId !== clientId) {
        return { type: "blocked", message: "离线状态只能撤回本窗口尚未提交的改动；这条已经在主链路上，请恢复连接后再撤" };
      }
      const localResult = undoEntry(doc, entryId, role);
      if ("error" in localResult) return { type: "blocked", message: localResult.error };
      const op = queue.find((item) => item.entryIds.includes(entryId));
      if (op) {
        if (op.spec.kind === "编辑") {
          // 多字段编辑按条抵消：重放时跳过已撤回的字段
          const live = op.entryIds
            .map((id) => localResult.doc.log.find((logEntry) => logEntry.id === id))
            .filter((logEntry): logEntry is NonNullable<typeof logEntry> => !!logEntry && !logEntry.undone);
          const stillHasFields = live.some((logEntry) => logEntry.kind === "编辑");
          if (!stillHasFields) dispatch(dropQueued(op.id));
        } else {
          dispatch(dropQueued(op.id));
        }
      }
      dispatch(hydrate(localResult.doc));
      return { type: "ok", message: localResult.message };
    }

    const server = readDoc() ?? doc;
    const result = undoEntry(server, entryId, role);
    if ("error" in result) return { type: "blocked", message: result.error };
    writeDoc(result.doc);
    dispatch(hydrate(structuredClone(result.doc)));
    return { type: "ok", message: result.message };
  };
}

/** 主链路恢复：按顺序重放应急队列，逐条做版本冲突判断 */
export function syncQueue() {
  return async (dispatch: AppDispatch, getState: () => RootState) => {
    const state = getState().rundown;
    if (!state.queue.length) return { synced: 0, conflicts: [] as string[], blocked: [] as string[] };
    let server = readDoc() ?? state.doc;
    const conflicts: string[] = [];
    const blocked: string[] = [];
    let synced = 0;

    const pending = [...state.queue].reverse(); // 入队顺序（旧 -> 新）
    for (const op of pending) {
      let spec = op.spec;
      if (spec.kind === "编辑") {
        const undoneFields = new Set<FieldKey>();
        for (const id of op.entryIds) {
          const local = state.doc.log.find((entry) => entry.id === id);
          if (local?.undone && local.fields?.[0]) undoneFields.add(local.fields[0].field);
        }
        const fields = spec.fields.filter((f) => !undoneFields.has(f.field));
        if (!fields.length) continue;
        spec = { ...spec, fields };
      }
      const ctx = { role: op.role, clientId: op.clientId, pending: false, timelineStart: timelineStartAt };
      const built = buildEntries(server, spec, ctx);
      if ("error" in built) { blocked.push(`${op.itemTitle}：${built.error}`); continue; }
      const conflict = checkConflict(server, spec, op.targetReves, op.clientId);
      if (conflict.conflict) { conflicts.push(conflict.message!); continue; }
      server = applyChange(server, spec, built.result.entries, { asRun: built.result.asRun, breakingId: built.result.breakingId });
      synced += 1;
    }

    writeDoc(server);
    dispatch(hydrate(structuredClone(server)));
    dispatch(clearQueue());
    return { synced, conflicts, blocked };
  };
}

export default slice.reducer;
