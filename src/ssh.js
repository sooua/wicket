const { Client } = require("ssh2");

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function sudo(node, command) {
  return `printf %s ${shellQuote(node.password)} | sudo -S -p '' sh -c ${shellQuote(command)}`;
}

function runSshOnce(node, command, options = {}) {
  const timeoutMs = options.timeoutMs || 30000;
  const readyTimeout = options.readyTimeout || 6000;

  return new Promise((resolve, reject) => {
    const conn = new Client();
    let stdout = "";
    let stderr = "";
    let ready = false; // 命令是否已开始执行
    let timer;

    conn
      .on("ready", () => {
        ready = true;
        timer = setTimeout(() => {
          conn.end();
          reject(Object.assign(new Error(`SSH command timed out on ${node.name}: ${command}`), { phase: "exec" }));
        }, timeoutMs);

        conn.exec(command, (err, stream) => {
          if (err) {
            clearTimeout(timer);
            conn.end();
            reject(Object.assign(err, { phase: "exec" }));
            return;
          }

          stream
            .on("close", (code) => {
              clearTimeout(timer);
              conn.end();
              resolve({ node: node.name, code, stdout, stderr, command });
            })
            .on("data", (data) => {
              stdout += data.toString();
            });

          stream.stderr.on("data", (data) => {
            stderr += data.toString();
          });
        });
      })
      // 连接阶段（尚未 ready）失败标记为 connect，可安全重试
      .on("error", (err) => reject(Object.assign(err, { phase: ready ? "exec" : "connect" })))
      .connect({
        host: node.host,
        username: node.username,
        password: node.password,
        readyTimeout,
      });
  });
}

// 仅在"连接阶段"失败时重试一次：此时命令从未执行，重试对写操作也是安全幂等的。
async function runSsh(node, command, options = {}) {
  try {
    return await runSshOnce(node, command, options);
  } catch (error) {
    if (error.phase === "connect") {
      return runSshOnce(node, command, options);
    }
    throw error;
  }
}

async function readRemoteFile(node, path) {
  const result = await runSsh(node, `cat ${shellQuote(path)}`);
  if (result.code !== 0) {
    throw new Error(`${node.name}: failed to read ${path}: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

async function writeRemoteFile(node, path, content) {
  // 重要：不要把文件内容直接管道进 sudo。sudo() 里 `printf %s '<密码>' | sudo -S`
  // 会占用同一条 stdin，密码那段 printf 会吞掉内容流，导致目标文件被写成 0 字节。
  // 正确做法：先用普通用户把内容写到临时文件（独占的内容管道），再用 sudo `cat tmp > path`
  // （sudo 的 stdin 只承载密码，cat 从文件读内容，互不干扰）。
  const encoded = Buffer.from(content, "utf8").toString("base64");
  const tmp = `/tmp/wicket-write-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const writeTemp = `printf %s ${shellQuote(encoded)} | base64 -d > ${shellQuote(tmp)}`;
  const install = sudo(node, `cat ${shellQuote(tmp)} > ${shellQuote(path)}`);
  const cleanup = `status=$?; rm -f ${shellQuote(tmp)}; exit $status`;
  const result = await runSsh(node, `${writeTemp} && ${install}; ${cleanup}`, { timeoutMs: 30000 });
  if (result.code !== 0) {
    throw new Error(`${node.name}: failed to write ${path}: ${result.stderr || result.stdout}`);
  }
  return result;
}

module.exports = { runSsh, readRemoteFile, writeRemoteFile, shellQuote, sudo };
