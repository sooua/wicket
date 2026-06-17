// 全局写锁：把所有会修改 Caddyfile 的操作串行化，避免并发写入交错损坏配置。
let tail = Promise.resolve();

function withWriteLock(fn) {
  const result = tail.then(() => fn());
  // 无论成功失败，后续任务都接在其后执行
  tail = result.then(
    () => {},
    () => {},
  );
  return result;
}

module.exports = { withWriteLock };
