// thunk/持久化层验证：真实 redux store + 内存版 localStorage，模拟两个窗口
import "./storage-stub.mjs";
import assert from "node:assert";
import { createStore, applyMiddleware } from "redux";
import { thunk as thunkMiddleware } from "redux-thunk";
import reducer, { bootstrap, commit, setOnline, setRole, syncQueue, undoOne } from "../src/store/rundownSlice.ts";
import { writeDoc } from "../src/store/persistence.ts";

const rootReducer = (state, action) => ({ rundown: reducer(state?.rundown, action) });
const makeStore = () =>
  createStore(rootReducer, undefined, applyMiddleware(thunkMiddleware));

let pass = 0;
const ok = (name, cond) => { assert.ok(cond, name); console.log("  ✓", name); pass += 1; };

const idOf = (state, title) => state.rundown.doc.items.find((i) => i.title === title).id;

console.log("A) bootstrap：首次播种并落库，二次 hydrate 取库内权威文档");
{
  const store = makeStore();
  store.dispatch(bootstrap());
  ok("播种后 4 条", store.getState().rundown.doc.items.length === 4);
  ok("已写入 localStorage", localStorage.getItem("pair-wise-yf-46/doc") !== null);
  const store2 = makeStore();
  store2.dispatch(bootstrap());
  ok("第二窗口 hydrate 出同样 4 条", store2.getState().rundown.doc.items.length === 4);
}

console.log("B) 两窗口并发改同一条：先保存者赢，后保存冲突且不写入");
{
  localStorage.clear();
  const A = makeStore(); A.dispatch(bootstrap());
  const B = makeStore(); B.dispatch(bootstrap()); B.dispatch(setRole("主编"));
  const r2A = idOf(A.getState(), "城市更新现场连线");
  const r2B = idOf(B.getState(), "城市更新现场连线");
  // 两边打开时 rev 都是 1
  const resA = A.dispatch(commit({ kind: "时长", itemId: r2A, delta: 2 }, { [r2A]: 1 }));
  ok("A 先保存 ok", resA.type === "ok");
  const resB = B.dispatch(commit({ kind: "编辑", itemId: r2B, batchId: "b", fields: [{ field: "title", value: "B 改标题" }] }, { [r2B]: 1 }));
  ok("B 被拒为 conflict", resB.type === "conflict");
  const server = JSON.parse(localStorage.getItem("pair-wise-yf-46/doc"));
  const r2 = server.items.find((i) => i.id === r2A);
  ok("服务端保留 A 的时长 10", r2.duration === 10);
  ok("B 的标题没写进去", r2.title === "城市更新现场连线");
  ok("冲突信息告知是谁抢先", /先保存/.test(resB.message));
  // B 重新 hydrate（模拟刷新）后再改，成功
  B.dispatch({ type: "rundown/hydrate", payload: server });
  const resB2 = B.dispatch(commit({ kind: "编辑", itemId: r2B, batchId: "b2", fields: [{ field: "title", value: "B 改标题" }] }, { [r2B]: 2 }));
  ok("B 基于最新版本保存成功", resB2.type === "ok");
}

console.log("C) 离线应急：本地生效+入队，恢复后重放；其中冲突条目不覆盖先保存版本");
{
  localStorage.clear();
  const offline = makeStore();
  offline.dispatch(bootstrap());
  offline.dispatch(setRole("演播室"));
  offline.dispatch(setOnline(false));
  const r2 = idOf(offline.getState(), "城市更新现场连线");
  const r3 = idOf(offline.getState(), "政策发布会解读");
  offline.dispatch(commit({ kind: "时长", itemId: r2, delta: 1 }, { [r2]: 1 }));
  offline.dispatch(commit({ kind: "编辑", itemId: r3, batchId: "off", fields: [{ field: "title", value: "本地改的标题" }] }, { [r3]: 1 }));
  ok("本地立即生效", offline.getState().rundown.doc.items.find((i) => i.id === r2).duration === 9);
  ok("队列 2 条", offline.getState().rundown.queue.length === 2);
  ok("待同步标记", offline.getState().rundown.doc.log[0].pending === true);

  // 另一在线窗口在主链路上先改了 r2（rev 1->2）
  const online = makeStore();
  online.dispatch(bootstrap());
  const r2srv = idOf(online.getState(), "城市更新现场连线");
  online.dispatch(commit({ kind: "时长", itemId: r2srv, delta: 5 }, { [r2srv]: 1 }));
  const serverNow = JSON.parse(localStorage.getItem("pair-wise-yf-46/doc"));
  offline.dispatch({ type: "rundown/hydrate", payload: serverNow }); // 刷新视图

  offline.dispatch(setOnline(true));
  const result = await Promise.resolve(offline.dispatch(syncQueue()));
  ok("1 条提交成功", result.synced === 1);
  ok("1 条冲突（r2 被抢先）", result.conflicts.length === 1);
  const finalDoc = JSON.parse(localStorage.getItem("pair-wise-yf-46/doc"));
  const r2f = finalDoc.items.find((i) => i.id === r2srv);
  const r3f = finalDoc.items.find((i) => i.id === r3);
  ok("r2 保留在线窗口版本 13，不被离线 +1 覆盖", r2f.duration === 13);
  ok("r3 离线标题提交成功", r3f.title === "本地改的标题");
  ok("队列清空", offline.getState().rundown.queue.length === 0);
}

{
  console.log("D) 撤回经 thunk 落库并拦截");
  localStorage.clear();
  const store = makeStore();
  store.dispatch(bootstrap());
  const r2 = idOf(store.getState(), "城市更新现场连线");
  store.dispatch(commit({ kind: "时长", itemId: r2, delta: 2 }, { [r2]: 1 }));
  const changeId = store.getState().rundown.doc.log[0].id;
  const res = store.dispatch(undoOne(changeId));
  ok("撤回 ok", res.type === "ok");
  ok("服务端文档同步回退", JSON.parse(localStorage.getItem("pair-wise-yf-46/doc")).items.find((i) => i.id === r2).duration === 8);
  const undone = store.dispatch(undoOne(changeId));
  ok("重复撤回被拦", undone.type === "blocked");

  console.log("E) 字幕岗位无撤回权限");
  const dir = makeStore();
  dir.dispatch(bootstrap());
  const r3 = idOf(dir.getState(), "政策发布会解读");
  dir.dispatch(commit({ kind: "编辑", itemId: r3, batchId: "y", fields: [{ field: "title", value: "导播改的" }] }, { [r3]: 1 }));
  dir.dispatch(setRole("字幕"));
  const denied = dir.dispatch(undoOne(dir.getState().rundown.doc.log[0].id));
  ok("字幕撤回被拒", denied.type === "blocked" && /字幕/.test(denied.message));
  void writeDoc;
  console.log(`\nthunk 层 ${pass} 项断言通过 ✅`);
}
