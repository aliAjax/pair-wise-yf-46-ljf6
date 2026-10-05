// 必须在任何业务模块导入前装好内存版 storage（slice 初始化即读 sessionStorage）
function memoryStorage() {
  const storage = {};
  return {
    getItem: (k) => (k in storage ? storage[k] : null),
    setItem: (k, v) => { storage[k] = String(v); },
    removeItem: (k) => { delete storage[k]; },
    clear: () => { for (const k of Object.keys(storage)) delete storage[k]; }
  };
}
globalThis.localStorage = memoryStorage();
globalThis.sessionStorage = memoryStorage();
