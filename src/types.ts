export type Role = "导播" | "主编" | "字幕" | "演播室";
export type ItemType = "新闻片" | "连线" | "嘉宾" | "口播" | "广告";
export type ItemStatus = "待播" | "已播出" | "已跳过" | "草稿";

export interface RundownItem {
  id: string;
  title: string;
  type: ItemType;
  duration: number;
  hardStart?: string;
  status: ItemStatus;
  presenter: string;
  source: string;
  /** 条目版本号：每次改动 +1，用于多窗口并发冲突检测（先保存为准） */
  version: number;
  /** 实际播出时间（播出后锁定，撤回不可动） */
  airedAt?: string;
  /** 实际时长（播出时锁定，留在播出记录里） */
  actualDuration?: number;
}

export type ChangeAction =
  | "新增条目"
  | "调整时长"
  | "调整顺序"
  | "播出"
  | "取消条目"
  | "突发插播"
  | "撤回";

/** 一条按「岗位 + 对象」记下的改动 */
export interface ChangeRecord {
  id: string;
  /** 全局递增序号，用于判断改动先后 */
  seq: number;
  /** 操作岗位 */
  role: Role;
  /** 对象类型：条目 / 整张串联单 */
  objectType: "条目" | "串联单";
  /** 条目 id（对象为条目时） */
  objectId?: string;
  action: ChangeAction;
  detail: string;
  time: string;
  /** 条目字段改动前的值（null = 条目此前不存在） */
  before?: Partial<RundownItem> | null;
  /** 条目字段改动后的值（null = 条目被删除） */
  after?: Partial<RundownItem> | null;
  /** 顺序改动前的条目 id 序列 */
  orderBefore?: string[];
  /** 顺序改动后的条目 id 序列 */
  orderAfter?: string[];
  /** 是否已被撤回 */
  undone?: boolean;
  undoneAt?: string;
  /** 撤回的是哪条改动 */
  undoOf?: string;
}

/** 播出记录：只追加、不可撤回 */
export interface BroadcastRecord {
  itemId: string;
  title: string;
  airedAt: string;
  actualDuration: number;
  role: Role;
}

/** 并发冲突：对方窗口已先保存同一对象 */
export interface ConflictInfo {
  itemId: string;
  title: string;
  /** 对方已保存到的版本 */
  storedVersion: number;
  /** 我方基于的版本 */
  baseVersion: number;
}

export interface BreakingChange {
  id: string;
  headline: string;
  duration: number;
  insertAfter: string;
  reason: string;
  createdAt: string;
}

export interface PendingChange {
  id: string;
  action: string;
  detail: string;
  queuedAt: string;
}
