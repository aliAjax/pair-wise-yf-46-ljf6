import type { ChangeEntry, RundownDoc, RundownItem } from "../types";

const AIR_TIME = "2026-10-08T08:04:00";

export const seedItems: RundownItem[] = [
  { id: "r1", title: "早间新闻提要", type: "新闻片", duration: 4, hardStart: "08:00", status: "已播出", presenter: "陈默", source: "主控", actualDuration: 4, airedAt: AIR_TIME, rev: 1 },
  { id: "r2", title: "城市更新现场连线", type: "连线", duration: 8, hardStart: "08:06", status: "待播", presenter: "陈默", source: "记者周岚", rev: 1 },
  { id: "r3", title: "政策发布会解读", type: "嘉宾", duration: 12, status: "待播", presenter: "陈默", source: "演播室A", rev: 1 },
  { id: "r4", title: "整点广告", type: "广告", duration: 3, hardStart: "08:30", status: "待播", presenter: "系统", source: "广告串", rev: 1 }
];

const seedLog: ChangeEntry[] = [
  {
    id: "seed-air-r1", seq: 1, kind: "播出", role: "导播", clientId: "seed", time: AIR_TIME,
    itemId: "r1", itemTitle: "早间新闻提要",
    detail: "导播 标记「早间新闻提要」已播出，实际 4 分钟（08:00 起），写入播出记录",
    fields: [{ field: "status", before: "待播", after: "已播出" }],
    baseRev: 0, undone: false, sealed: true
  }
];

export function makeSeedDoc(): RundownDoc {
  return {
    items: structuredClone(seedItems),
    log: structuredClone(seedLog),
    asRun: [{
      id: "seed-asrun-r1", itemId: "r1", title: "早间新闻提要", type: "新闻片",
      plannedDuration: 4, actualDuration: 4, startAt: "08:00", airedAt: AIR_TIME,
      role: "导播", clientId: "seed"
    }],
    breaking: [],
    seq: 1
  };
}
