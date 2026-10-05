export type Role = "导播" | "主编" | "字幕" | "演播室";
export type ItemType = "新闻片" | "连线" | "嘉宾" | "口播" | "广告";
export type ItemStatus = "待播" | "已播出" | "已跳过" | "草稿";

export interface RundownItem {
  id: string;
  title: string;
  type: ItemType;
  /** 计划时长（分钟） */
  duration: number;
  hardStart?: string;
  status: ItemStatus;
  presenter: string;
  source: string;
  /** 实际时长（分钟），点“播出”时按当时计划锁定，之后任何撤回都不改它 */
  actualDuration?: number;
  airedAt?: string;
  /** 该条的版本号，每次被保存成功的改动 +1，用于跨窗口并发判断 */
  rev: number;
}

export interface BreakingChange {
  id: string;
  headline: string;
  duration: number;
  insertAfter: string;
  reason: string;
  createdAt: string;
}

/** 播出记录（as-run）：只追加、不可撤回，与串联单改动相互独立 */
export interface AsRunEntry {
  id: string;
  itemId: string;
  title: string;
  type: ItemType;
  plannedDuration: number;
  actualDuration: number;
  /** 播出时推算的累计起点 HH:mm */
  startAt: string;
  airedAt: string;
  role: Role;
  clientId: string;
}

export type FieldKey = "title" | "duration" | "hardStart" | "presenter" | "source" | "status";

export type ChangeKind = "新增" | "插播" | "时长" | "编辑" | "跳过" | "播出" | "排序";

/** 单条字段改动记录：按岗位、窗口、对象逐条留痕 */
export interface FieldChange {
  field: FieldKey;
  before: string | number | undefined;
  after: string | number | undefined;
}

export interface ChangeEntry {
  id: string;
  /** 服务端确认的全局序号，越大越新；离线待同步条目为 pending */
  seq: number;
  kind: ChangeKind;
  /** 同一次“保存”改了多个字段时共用，便于在历史里识别为同一版 */
  batchId?: string;
  role: Role;
  clientId: string;
  time: string;
  itemId: string;
  itemTitle: string;
  detail: string;
  /** 字段级逆操作数据 */
  fields?: FieldChange[];
  /** 排序逆操作：移动前两侧的相邻条目 */
  beforeId?: string;
  afterId?: string;
  fromPosition?: number;
  toPosition?: number;
  /** 插播对应的突发变更记录，撤回时一并收回 */
  breakingId?: string;
  baseRev: number;
  undone: boolean;
  undoneAt?: string;
  undoneBy?: Role;
  /** 已播出动作：审计封存，永远不可撤回 */
  sealed: boolean;
  /** 离线本地生效、尚未同步主链路 */
  pending?: boolean;
}

/** 离线应急队列里的一次操作，主链路恢复后按顺序重放 */
export interface QueuedChange {
  id: string;
  spec: ChangeSpec;
  role: Role;
  clientId: string;
  queuedAt: string;
  detail: string;
  itemTitle: string;
  /** 入队时目标条目的版本号，重放时用于冲突判断 */
  targetReves: Record<string, number>;
  entryIds: string[];
}

/** 服务端权威文档：所有窗口共享 */
export interface RundownDoc {
  items: RundownItem[];
  log: ChangeEntry[];
  asRun: AsRunEntry[];
  breaking: BreakingChange[];
  seq: number;
}

export interface NewItemInput {
  id: string;
  title: string;
  type: ItemType;
  duration: number;
  hardStart?: string;
  presenter: string;
  source: string;
}

export interface EditFieldInput {
  field: FieldKey;
  value: string | number | undefined;
}

/** 一次改动的意图，序列化为纯数据，可进离线队列 */
export type ChangeSpec =
  | { kind: "新增"; item: NewItemInput }
  | { kind: "插播"; item: NewItemInput; insertAfterId: string; reason: string }
  | { kind: "时长"; itemId: string; delta: number }
  | { kind: "编辑"; itemId: string; batchId: string; fields: EditFieldInput[] }
  | { kind: "跳过"; itemId: string }
  | { kind: "播出"; itemId: string }
  | { kind: "排序"; activeId: string; overId: string };

export type CommitResult =
  | { type: "ok"; message?: string }
  | { type: "conflict"; message: string }
  | { type: "blocked"; message: string }
  | { type: "noop"; message: string };
