// 核心规则验证：engine 的纯逻辑不依赖 React/DOM，经 esbuild 打包后在 node 里跑
import assert from "node:assert";
import { makeSeedDoc } from "../src/store/seed.ts";
import {
  applyChange, buildEntries, canUndo, checkConflict, computeTimeline,
  latestUndoable, plannedTotal, riskCount, timelineStartAt, undoEntry
} from "../src/store/engine.ts";

const ctxBuild = { role: "导播", clientId: "win-A", pending: false, timelineStart: timelineStartAt };
let pass = 0;
const ok = (name, cond) => { assert.ok(cond, name); console.log("  ✓", name); pass += 1; };
const eq = (name, a, b) => { assert.strictEqual(a, b, `${name}: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`); console.log("  ✓", name); pass += 1; };

function run(doc, spec, role = "导播", clientId = "win-A", pending = false) {
  const built = buildEntries(doc, spec, { role, clientId, pending, timelineStart: timelineStartAt });
  if ("error" in built) throw new Error("buildEntries rejected: " + built.error);
  return applyChange(doc, spec, built.result.entries, { asRun: built.result.asRun, breakingId: built.result.breakingId });
}
const idOf = (doc, title) => doc.items.find((i) => i.title === title).id;

console.log("1) 撤回只抵消选中的一次，已播出条目不退回");
{
  let doc = makeSeedDoc();
  const r1 = idOf(doc, "早间新闻提要");
  eq("种子数据里 r1 已播出", doc.items.find((i) => i.id === r1).status, "已播出");
  const r2 = idOf(doc, "城市更新现场连线");
  doc = run(doc, { kind: "时长", itemId: r2, delta: 2 });
  const changeId = doc.log[0].id;
  doc = run(doc, { kind: "新增", item: { id: "n1", title: "临时口播稿", type: "口播", duration: 2, presenter: "陈默", source: "主编室" } });
  const undone = undoEntry(doc, changeId, "导播");
  assert.ok("doc" in undone, "撤回时长调整应成功: " + ("error" in undone ? undone.error : ""));
  doc = undone.doc;
  eq("r1 仍是已播出（旧整表恢复 bug 不再出现）", doc.items.find((i) => i.id === r1).status, "已播出");
  eq("r2 时长回到 8", doc.items.find((i) => i.id === r2).duration, 8);
  ok("新增的口播稿仍在（只撤了选中的一条）", doc.items.some((i) => i.title === "临时口播稿"));
  eq("播出记录仍保留 r1", doc.asRun.length, 1);
  eq("播出记录实际时长仍是 4", doc.asRun[0].actualDuration, 4);
}

console.log("2) 改动按岗位/对象逐条留痕，同次保存多字段拆成多条");
{
  let doc = makeSeedDoc();
  const r2 = idOf(doc, "城市更新现场连线");
  const batch = "batch-1";
  doc = run(doc, { kind: "编辑", itemId: r2, batchId: batch, fields: [
    { field: "title", value: "城市更新连线（延长版）" },
    { field: "duration", value: 10 },
    { field: "presenter", value: "陈默" } // 未变化，应被过滤
  ] }, "主编");
  eq("只有两个字段真正变化 -> 两条记录", doc.log.filter((e) => e.batchId === batch).length, 2);
  ok("记录带岗位", doc.log[0].role === "主编");
  ok("记录带窗口", doc.log[0].clientId === "win-A");
  eq("记录对象是 r2", doc.log[0].itemId, r2);
  const titleEntry = doc.log.find((e) => e.fields?.[0]?.field === "title");
  ok("可单独撤回标题字段，时长不受影响", canUndo(doc, titleEntry.id, "导播").ok);
  const u = undoEntry(doc, titleEntry.id, "导播");
  assert.ok("doc" in u); doc = u.doc;
  eq("标题回退", doc.items.find((i) => i.id === r2).title, "城市更新现场连线");
  eq("时长仍是 10（字段级独立抵消）", doc.items.find((i) => i.id === r2).duration, 10);
}

console.log("3) 改动后累计时间与硬时间风险自动重算");
{
  let doc = makeSeedDoc();
  eq("初始风险 0（r4 在 08:24，早于 08:30 硬时间）", riskCount(doc), 0);
  // r2: 8 -> 20，累计：r1 4 + r2 20 + r3 12 = 36 -> r4 起点 08:36 晚于 08:30
  doc = run(doc, { kind: "时长", itemId: idOf(doc, "城市更新现场连线"), delta: 12 });
  eq("拉长后出现 1 个硬时间风险", riskCount(doc), 1);
  eq("r4 预计起点 08:36", timelineStartAt(doc, idOf(doc, "整点广告")), "08:36");
  // 撤回后风险消失
  const changeId = doc.log[0].id;
  doc = undoEntry(doc, changeId, "导播").doc;
  eq("撤回后风险重算回 0", riskCount(doc), 0);
  eq("撤回后 r4 起点 08:24", timelineStartAt(doc, idOf(doc, "整点广告")), "08:24");
  void computeTimeline; void plannedTotal;
}

console.log("4) 两人先后改同一段：撤回被挡住并说明原因；不同字段不挡");
{
  let doc = makeSeedDoc();
  const r2 = idOf(doc, "城市更新现场连线");
  doc = run(doc, { kind: "时长", itemId: r2, delta: 3 }, "导播", "win-A"); // 8->11，第一条
  const firstId = doc.log[0].id;
  doc = run(doc, { kind: "时长", itemId: r2, delta: 2 }, "主编", "win-B"); // 11->13，挡在前面
  let check = canUndo(doc, firstId, "导播");
  ok("先撤旧版被挡", !check.ok);
  ok("挡因说明了后来者与动作", /主编/.test(check.reason ?? "") && /时长调整/.test(check.reason ?? ""));
  // 先撤新版，可以
  const secondId = doc.log[0].id;
  let u = undoEntry(doc, secondId, "导播");
  assert.ok("doc" in u, u.error); doc = u.doc;
  check = canUndo(doc, firstId, "导播");
  ok("新版撤掉后旧版可撤", check.ok);
  u = undoEntry(doc, firstId, "导播");
  assert.ok("doc" in u, u.error); doc = u.doc;
  eq("两次撤回后时长还原 8", doc.items.find((i) => i.id === r2).duration, 8);

  // 不同字段互不挡
  doc = makeSeedDoc();
  doc = run(doc, { kind: "编辑", itemId: r2, batchId: "b1", fields: [{ field: "duration", value: 11 }] }, "导播", "win-A");
  const durEntry = doc.log[0].id;
  doc = run(doc, { kind: "编辑", itemId: r2, batchId: "b2", fields: [{ field: "title", value: "现场连线（新）" }] }, "主编", "win-B");
  ok("后来改的是标题，不挡时长那一条撤回", canUndo(doc, durEntry, "导播").ok);
  doc = undoEntry(doc, durEntry, "导播").doc;
  eq("撤时长不影响标题", doc.items.find((i) => i.id === r2).title, "现场连线（新）");
  eq("时长回到 8", doc.items.find((i) => i.id === r2).duration, 8);
}

console.log("5) 已播出条目的改动撤不动，实际时长锁在播出记录");
{
  let doc = makeSeedDoc();
  const r3 = idOf(doc, "政策发布会解读");
  doc = run(doc, { kind: "时长", itemId: r3, delta: 3 }); // 12->15
  const durId = doc.log[0].id;
  doc = run(doc, { kind: "播出", itemId: r3 });
  // 播出条目本身不可撤
  const airEntry = doc.log[0];
  ok("播出条目标记 sealed", airEntry.sealed);
  ok("播出动作不可撤回", !canUndo(doc, airEntry.id, "导播").ok);
  // 之前的时长改动也被播出封存挡住
  const blocked = canUndo(doc, durId, "导播");
  ok("播出前的时长改动被播出挡住", !blocked.ok);
  ok(/已播出/.test(blocked.reason ?? ""), "原因提到已播出: " + blocked.reason);
  // 播出记录里有两条，r3 实际时长 = 播出当时 15
  eq("播出记录 2 条", doc.asRun.length, 2);
  eq("r3 实际时长锁定为 15", doc.asRun.find((a) => a.itemId === r3).actualDuration, 15);
  eq("r3 计划时长仍是 15", doc.items.find((i) => i.id === r3).duration, 15);
  // 拒绝直接对已播出条目改时长
  const again = buildEntries(doc, { kind: "时长", itemId: r3, delta: -2 }, ctxBuild);
  ok("已播出条目拒绝改时长", "error" in again);
  // “撤回上一步”不会选中已播出/被挡条目
  const latest = latestUndoable(doc, "导播");
  ok("此时没有可撤条目（顶部撤回按钮应为禁用态）", latest === undefined);
}

console.log("6) 两窗口同时改同一条：先保存者赢，后保存者冲突停下");
{
  let server = makeSeedDoc();
  const r2 = idOf(server, "城市更新现场连线");
  const reves = { [r2]: 1 }; // 两个窗口打开时都是 rev 1
  // 窗口 A 先保存
  const builtA = buildEntries(server, { kind: "编辑", itemId: r2, batchId: "ba", fields: [{ field: "duration", value: 10 }] }, { ...ctxBuild, clientId: "win-A" });
  assert.ok("entries" in builtA.result);
  server = applyChange(server, { kind: "编辑", itemId: r2, batchId: "ba", fields: [{ field: "duration", value: 10 }] }, builtA.result.entries);
  eq("A 保存后 r2 rev=2", server.items.find((i) => i.id === r2).rev, 2);
  // 窗口 B 用旧 rev 保存 -> 冲突
  const conflict = checkConflict(server, { kind: "编辑", itemId: r2, batchId: "bb", fields: [{ field: "title", value: "B 改的标题" }] }, reves, "win-B");
  ok("B 被判冲突", conflict.conflict);
  ok("冲突信息说明谁先保存、以谁为准", /win-A/.test(conflict.message ?? "") && /先保存/.test(conflict.message ?? ""));
  // B 刷新后基于 rev 2 再改不同字段 -> 成功
  const refreshed = { [r2]: 2 };
  const conflict2 = checkConflict(server, { kind: "编辑", itemId: r2, batchId: "bb", fields: [{ field: "title", value: "B 改的标题" }] }, refreshed, "win-B");
  ok("B 刷新后再保存不再冲突", !conflict2.conflict);
}

console.log("7) 撤回插播：条目收回，突发记录同步收回，后续时间重算");
{
  let doc = makeSeedDoc();
  const r1 = idOf(doc, "早间新闻提要");
  doc = run(doc, { kind: "插播", item: { id: "br1", title: "突发：地震速报", type: "新闻片", duration: 5, presenter: "值班主播", source: "插播：快讯" }, insertAfterId: r1, reason: "地震快讯" });
  eq("突发记录 1 条", doc.breaking.length, 1);
  const insId = doc.log[0].id;
  eq("插播后 r2 起点推迟到 08:09", timelineStartAt(doc, idOf(doc, "城市更新现场连线")), "08:09");
  doc = undoEntry(doc, insId, "导播").doc;
  ok("插播条目已收回", !doc.items.some((i) => i.title === "突发：地震速报"));
  eq("突发记录同步收回", doc.breaking.length, 0);
  eq("时间重算回 08:04", timelineStartAt(doc, idOf(doc, "城市更新现场连线")), "08:04");
  eq("已播出 r1 不受影响", doc.items.find((i) => i.id === r1).status, "已播出");
}

console.log("8) 排序逆操作与跳过逆操作");
{
  let doc = makeSeedDoc();
  const r2 = idOf(doc, "城市更新现场连线");
  const r3 = idOf(doc, "政策发布会解读");
  doc = run(doc, { kind: "排序", activeId: r3, overId: r2 });
  eq("r3 排到 r2 前", doc.items.findIndex((i) => i.id === r3) < doc.items.findIndex((i) => i.id === r2), true);
  doc = undoEntry(doc, doc.log[0].id, "导播").doc;
  eq("撤回排序后 r2 回到 r3 前", doc.items.findIndex((i) => i.id === r2) < doc.items.findIndex((i) => i.id === r3), true);
  // 跳过：撤回恢复待播
  doc = run(doc, { kind: "跳过", itemId: r2 });
  eq("r2 已跳过", doc.items.find((i) => i.id === r2).status, "已跳过");
  doc = undoEntry(doc, doc.log[0].id, "导播").doc;
  eq("撤回跳过后恢复待播", doc.items.find((i) => i.id === r2).status, "待播");
}

console.log("9) 已跳过条目不占时长，撤跳过后重新计入");
{
  let doc = makeSeedDoc();
  const totalBefore = plannedTotal(doc);
  doc = run(doc, { kind: "跳过", itemId: idOf(doc, "政策发布会解读") });
  eq("跳过 12 分钟条目后总时长减少", plannedTotal(doc), totalBefore - 12);
  doc = undoEntry(doc, doc.log[0].id, "导播").doc;
  eq("撤回跳过后时长恢复", plannedTotal(doc), totalBefore);
}

console.log(`\n全部 ${pass} 项断言通过 ✅`);
