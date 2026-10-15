// خادم SSH حقيقي داخل العملية للاختبارات (ssh2.Server): مصادقة مفتاح/كلمة مرور، exec عبر bash حقيقي
// داخل مجلد مؤقت (الجذر البعيد /srv/ws ⇐ مجلد محلي) — يختبر الاقتباس فعلياً لا افتراضياً، و SFTP أساسي.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ssh2 from "ssh2";

/**
 * مفتاح ed25519 صالح: مولّد ssh2 يُخرج أحياناً (~0.4٪) مفتاحاً يرفضه محلّله نفسه
 * («Malformed OpenSSH private key») ⇒ يُعاد التوليد حتى يُقبل (كان سبب فشل متقطع في terboo-ssh).
 */
function freshKey() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const pair = ssh2.utils.generateKeyPairSync("ed25519");
    if (!(ssh2.utils.parseKey(pair.private) instanceof Error)) return pair;
  }
  throw new Error("ssh fixture: could not generate a parseable ed25519 key");
}

const { Server, utils } = ssh2;
const { OPEN_MODE, STATUS_CODE } = utils.sftp;

/**
 * @param {{password?:string, remoteRoot?:string, extraPath?:string}} [options] extraPath: أدوات وهمية (pm2) قبل PATH
 * @returns {Promise<{port:number, hostKey:Object, userKey:Object, root:string, remoteRoot:string, commands:string[], close:Function, rotateHostKey:Function}>}
 */
async function startSshServer({ password = "test-pass-123", remoteRoot = "/srv/ws", extraPath = "" } = {}) {
  let hostKey = freshKey();
  const userKey = freshKey();
  const allowed = utils.parseKey(userKey.public);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "terboo-ssh-root-"));
  const commands = [];
  const local = (remote) => (String(remote).startsWith(remoteRoot) ? path.join(root, String(remote).slice(remoteRoot.length)) : null);

  const onClient = (client) => {
    client.on("authentication", (ctx) => {
      if (ctx.method === "publickey" && ctx.key.algo === allowed.type && Buffer.compare(ctx.key.data, allowed.getPublicSSH()) === 0) {
        if (!ctx.signature) return ctx.accept();
        return allowed.verify(ctx.blob, ctx.signature, ctx.hashAlgo) === true ? ctx.accept() : ctx.reject();
      }
      if (ctx.method === "password" && ctx.password === password) return ctx.accept();
      return ctx.reject(["publickey", "password"]);
    }).on("ready", () => {
      client.on("session", (accept) => {
        const session = accept();
        session.on("pty", (acceptPty) => acceptPty?.());
        session.on("exec", (acceptExec, reject, info) => {
          const stream = acceptExec();
          commands.push(info.command);
          // الجذر البعيد ⇐ المجلد المحلي ثم bash حقيقي يفسّر الاقتباس كما على أي خادم
          const line = info.command.split(remoteRoot).join(root);
          const child = spawn("bash", ["-c", line], { cwd: root, env: { PATH: [extraPath, process.env.PATH].filter(Boolean).join(":"), HOME: root } });
          child.stdout.on("data", (d) => stream.write(d));
          child.stderr.on("data", (d) => stream.stderr.write(d));
          stream.on("data", (d) => child.stdin.write(d));
          stream.on("close", () => child.kill("SIGKILL"));
          child.on("close", (code) => {
            stream.exit(code ?? 1);
            stream.end();
          });
        });
        session.on("sftp", (acceptSftp) => {
          const sftp = acceptSftp();
          const handles = new Map();
          let next = 0;
          const handleOf = (fd) => { const h = Buffer.alloc(4); h.writeUInt32BE(next += 1); handles.set(h.toString("hex"), fd); return h; };
          const fdOf = (h) => handles.get(Buffer.from(h).toString("hex"));
          const attrs = (st) => ({ mode: st.mode, uid: st.uid, gid: st.gid, size: st.size, atime: Math.floor(st.atimeMs / 1000), mtime: Math.floor(st.mtimeMs / 1000) });
          sftp.on("OPEN", (id, filename, flags) => {
            const file = local(filename);
            if (!file) return sftp.status(id, STATUS_CODE.PERMISSION_DENIED);
            const mode = flags & OPEN_MODE.WRITE ? (flags & OPEN_MODE.APPEND ? "a" : "w") : "r";
            try { sftp.handle(id, handleOf(fs.openSync(file, mode))); } catch { sftp.status(id, STATUS_CODE.NO_SUCH_FILE); }
          });
          sftp.on("WRITE", (id, handle, offset, data) => { fs.writeSync(fdOf(handle), data, 0, data.length, offset); sftp.status(id, STATUS_CODE.OK); });
          sftp.on("READ", (id, handle, offset, length) => {
            const buffer = Buffer.alloc(length);
            const read = fs.readSync(fdOf(handle), buffer, 0, length, offset);
            if (!read) return sftp.status(id, STATUS_CODE.EOF);
            sftp.data(id, buffer.subarray(0, read));
          });
          sftp.on("FSTAT", (id, handle) => sftp.attrs(id, attrs(fs.fstatSync(fdOf(handle)))));
          sftp.on("CLOSE", (id, handle) => { const fd = fdOf(handle); if (fd !== undefined) fs.closeSync(fd); sftp.status(id, STATUS_CODE.OK); });
          // آباء الجذر البعيد (/srv) موجودة على أي خادم حقيقي ⇒ مجلدات
          const stat = (id, p) => {
            if (`${remoteRoot}/`.startsWith(`${String(p).replace(/\/+$/, "")}/`)) return sftp.attrs(id, attrs(fs.statSync(root)));
            const file = local(p);
            try { sftp.attrs(id, attrs(fs.statSync(file))); } catch { sftp.status(id, STATUS_CODE.NO_SUCH_FILE); }
          };
          sftp.on("STAT", stat);
          sftp.on("LSTAT", stat);
          sftp.on("MKDIR", (id, p) => { const dir = local(p); if (!dir) return sftp.status(id, STATUS_CODE.PERMISSION_DENIED); fs.mkdirSync(dir, { recursive: true }); sftp.status(id, STATUS_CODE.OK); });
          sftp.on("REALPATH", (id, p) => sftp.name(id, [{ filename: p, longname: p, attrs: {} }]));
        });
      });
    }).on("error", () => { /* عميل قطع الاتصال (مثلاً بعد رفض البصمة) */ });
  };

  let server = new Server({ hostKeys: [hostKey.private] }, onClient);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const state = { port: server.address().port };
  return {
    get port() { return state.port; },
    hostKey, userKey, root, remoteRoot, commands, password,
    async rotateHostKey() {
      // نفس المنفذ بمفتاح مضيف مختلف (محاكاة اعتراض/إعادة تثبيت النظام)
      await new Promise((resolve) => server.close(resolve));
      hostKey = freshKey();
      server = new Server({ hostKeys: [hostKey.private] }, onClient);
      await new Promise((resolve) => server.listen(state.port, "127.0.0.1", resolve));
    },
    close: () => new Promise((resolve) => server.close(() => { fs.rmSync(root, { recursive: true, force: true }); resolve(); })),
  };
}

export { startSshServer };
