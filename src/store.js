import { DatabaseSync } from "node:sqlite";
import { mkdirSync, openSync, closeSync, chmodSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { EpostError, safeError } from "./errors.js";

export const digest = (value) =>
  createHash("sha256").update(value).digest("hex");

export class SqliteOperationStore {
  #db;
  #readOnly;
  constructor(path = ".epost/operations.sqlite", { readOnly = false } = {}) {
    if (typeof readOnly !== "boolean")
      throw new EpostError("VALIDATION", { field: "store.readOnly" });
    this.#readOnly = readOnly;
    try {
      if (path === ":memory:")
        throw new EpostError("VALIDATION", { field: "store.path" });
      const fullPath = resolve(path);
      if (readOnly) {
        try {
          if (!statSync(fullPath).isFile()) throw new EpostError("STORAGE");
        } catch (error) {
          if (error.code === "ENOENT") return;
          throw error;
        }
        this.#db = new DatabaseSync(fullPath, { readOnly: true });
        this.#db.exec("PRAGMA busy_timeout=5000; PRAGMA query_only=ON;");
        return;
      }
      mkdirSync(dirname(fullPath), { recursive: true, mode: 0o700 });
      const fd = openSync(fullPath, "a", 0o600);
      closeSync(fd);
      chmodSync(fullPath, 0o600);
      this.#db = new DatabaseSync(fullPath);
      this.#db
        .exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;
        CREATE TABLE IF NOT EXISTS operations (
          id TEXT PRIMARY KEY, account TEXT NOT NULL, key_hash TEXT NOT NULL,
          kind TEXT NOT NULL, fingerprint TEXT NOT NULL, status TEXT NOT NULL,
          result TEXT, error_code TEXT, target TEXT, owner_pid INTEGER NOT NULL, owner_host TEXT NOT NULL,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
          UNIQUE(account,key_hash)
        );
        CREATE TABLE IF NOT EXISTS account_locks (account TEXT PRIMARY KEY, operation_id TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS account_reads (account TEXT PRIMARY KEY, token TEXT NOT NULL, owner_pid INTEGER NOT NULL, owner_host TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS events (
          id INTEGER PRIMARY KEY, operation_id TEXT NOT NULL, status TEXT NOT NULL,
          source TEXT NOT NULL, created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS operations_request ON operations(account,kind,fingerprint);`);
    } catch (error) {
      this.#db?.close();
      throw safeError(error, "STORAGE");
    }
  }
  #transaction(action) {
    if (this.#readOnly) throw new EpostError("STORAGE");
    try {
      this.#db.exec("BEGIN IMMEDIATE");
      const result = action();
      this.#db.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.#db.exec("ROLLBACK");
      } catch {
        /* BEGIN may have failed. */
      }
      throw safeError(error, "STORAGE");
    }
  }
  #decode(row) {
    if (!row) return null;
    return {
      id: row.id,
      kind: row.kind,
      status: row.status,
      result: row.result ? JSON.parse(row.result) : null,
      errorCode: row.error_code,
      target: row.target,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
  get(account, key) {
    try {
      if (!this.#db) return null;
      return this.#decode(
        this.#db
          .prepare("SELECT * FROM operations WHERE account=? AND key_hash=?")
          .get(account, digest(key)),
      );
    } catch (error) {
      throw safeError(error, "STORAGE");
    }
  }
  claim(
    account,
    key,
    kind,
    fingerprint,
    target = null,
    { retryFailed = false } = {},
  ) {
    return this.#transaction(() => {
      const row = this.#db
        .prepare("SELECT * FROM operations WHERE account=? AND key_hash=?")
        .get(account, digest(key));
      if (row) {
        if (row.fingerprint !== fingerprint || row.kind !== kind)
          throw new EpostError("KEY_CONFLICT", { operationId: row.id });
        if (row.status !== "failed" || !retryFailed)
          return { claimed: false, operation: this.#decode(row) };
      }
      const lock = this.#db
        .prepare("SELECT * FROM account_locks WHERE account=?")
        .get(account);
      if (lock)
        throw new EpostError("ACCOUNT_BUSY", {
          operationId: lock.operation_id,
        });
      this.#checkReader(account);
      if (row) {
        this.#db
          .prepare(
            "UPDATE operations SET status='running', result=NULL, error_code=NULL, owner_pid=?, owner_host=?, updated_at=? WHERE id=? AND status='failed'",
          )
          .run(process.pid, hostname(), new Date().toISOString(), row.id);
        this.#db
          .prepare("INSERT INTO account_locks VALUES (?,?)")
          .run(account, row.id);
        this.#event(row.id, "running", "explicit-safe-retry");
        return {
          claimed: true,
          operation: this.#decode(
            this.#db.prepare("SELECT * FROM operations WHERE id=?").get(row.id),
          ),
        };
      }
      const id = randomUUID(),
        now = new Date().toISOString();
      this.#db
        .prepare(
          "INSERT INTO operations VALUES (?,?,?,?,?,?,NULL,NULL,?,?,?,?,?)",
        )
        .run(
          id,
          account,
          digest(key),
          kind,
          fingerprint,
          "running",
          target,
          process.pid,
          hostname(),
          now,
          now,
        );
      this.#db
        .prepare("INSERT INTO account_locks VALUES (?,?)")
        .run(account, id);
      this.#event(id, "running", "client");
      return {
        claimed: true,
        operation: this.#decode(
          this.#db.prepare("SELECT * FROM operations WHERE id=?").get(id),
        ),
      };
    });
  }
  list(account, { status, limit = 20 } = {}) {
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      (status !== undefined &&
        !["running", "submitted", "unknown", "failed", "succeeded"].includes(
          status,
        ))
    )
      throw new EpostError("VALIDATION", { field: "historyOptions" });
    try {
      if (!this.#db) return [];
      const rows = status
        ? this.#db
            .prepare(
              "SELECT * FROM operations WHERE account=? AND status=? ORDER BY updated_at DESC, rowid DESC LIMIT ?",
            )
            .all(account, status, limit)
        : this.#db
            .prepare(
              "SELECT * FROM operations WHERE account=? ORDER BY updated_at DESC, rowid DESC LIMIT ?",
            )
            .all(account, limit);
      return rows.map((row) => this.#decode(row));
    } catch (error) {
      throw safeError(error, "STORAGE");
    }
  }
  get journalExists() {
    return !!this.#db;
  }
  inspectBatch(account, entries) {
    const empty = {
      journalExists: this.journalExists,
      mutation: null,
      reading: false,
      items: entries.map(() => ({
        operation: null,
        matches: true,
        duplicates: [],
      })),
    };
    if (!this.#db) return empty;
    try {
      // A read transaction gives the whole preview one coherent local snapshot.
      // It does not claim keys, reclaim locks, or change operation state.
      this.#db.exec("BEGIN");
      const mutation = this.#db
        .prepare(
          "SELECT o.* FROM account_locks l JOIN operations o ON o.id=l.operation_id WHERE l.account=?",
        )
        .get(account);
      const reader = this.#db
        .prepare("SELECT * FROM account_reads WHERE account=?")
        .get(account);
      const items = entries.map(({ key, kind, fingerprint }) => {
        const row = this.#db
          .prepare("SELECT * FROM operations WHERE account=? AND key_hash=?")
          .get(account, digest(key));
        const duplicates = this.#db
          .prepare(
            "SELECT * FROM operations WHERE account=? AND kind=? AND fingerprint=? AND key_hash<>? AND status IN ('succeeded','running','submitted','unknown') ORDER BY updated_at DESC LIMIT 5",
          )
          .all(account, kind, fingerprint, digest(key));
        return {
          operation: this.#decode(row),
          matches:
            !row || (row.kind === kind && row.fingerprint === fingerprint),
          duplicates: duplicates.map((other) => this.#decode(other)),
        };
      });
      this.#db.exec("COMMIT");
      return {
        ...empty,
        mutation: this.#decode(mutation),
        reading: !!reader && ownerState(reader) !== "stopped",
        items,
      };
    } catch (error) {
      try {
        this.#db.exec("ROLLBACK");
      } catch {}
      throw safeError(error, "STORAGE");
    }
  }
  listRecovery(account, { limit = 20, key } = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new EpostError("VALIDATION", { field: "historyOptions" });
    if (!this.#db) return { total: 0, items: [] };
    try {
      this.#db.exec("BEGIN");
      const filter =
        key === undefined
          ? "account=? AND status IN ('running','submitted','unknown')"
          : "account=? AND key_hash=?";
      const params = key === undefined ? [account] : [account, digest(key)];
      const total = this.#db
        .prepare(`SELECT count(*) AS n FROM operations WHERE ${filter}`)
        .get(...params).n;
      const rows = this.#db
        .prepare(
          `SELECT * FROM operations WHERE ${filter} ORDER BY updated_at DESC, rowid DESC LIMIT ?`,
        )
        .all(...params, limit);
      this.#db.exec("COMMIT");
      return {
        total,
        items: rows.map((row) => ({
          operation: this.#decode(row),
          owner: ownerState(row),
        })),
      };
    } catch (error) {
      try {
        this.#db.exec("ROLLBACK");
      } catch {}
      throw safeError(error, "STORAGE");
    }
  }
  #checkReader(account) {
    const row = this.#db
      .prepare("SELECT * FROM account_reads WHERE account=?")
      .get(account);
    if (!row) return;
    let dead = false;
    if (row.owner_host === hostname()) {
      try {
        process.kill(Number(row.owner_pid), 0);
      } catch (e) {
        dead = e.code === "ESRCH";
      }
    }
    if (!dead) throw new EpostError("ACCOUNT_BUSY");
    // A dead read-only process cannot submit a reservation; only its read lock
    // may be reclaimed. Mutation locks never expire or get reclaimed here.
    this.#db.prepare("DELETE FROM account_reads WHERE account=?").run(account);
  }
  beginRead(account) {
    return this.#transaction(() => {
      const lock = this.#db
        .prepare(
          "SELECT o.id,o.status FROM account_locks l JOIN operations o ON l.operation_id=o.id WHERE l.account=?",
        )
        .get(account);
      if (lock && lock.status !== "unknown")
        throw new EpostError("ACCOUNT_BUSY", { operationId: lock.id });
      this.#checkReader(account);
      const token = randomUUID();
      this.#db
        .prepare("INSERT INTO account_reads VALUES (?,?,?,?)")
        .run(account, token, process.pid, hostname());
      return token;
    });
  }
  endRead(account, token) {
    return this.#transaction(() => {
      this.#db
        .prepare("DELETE FROM account_reads WHERE account=? AND token=?")
        .run(account, token);
    });
  }
  #event(id, status, source) {
    this.#db
      .prepare(
        "INSERT INTO events(operation_id,status,source,created_at) VALUES (?,?,?,?)",
      )
      .run(id, status, source, new Date().toISOString());
  }
  markSubmitted(id) {
    return this.#transaction(() => {
      const changed = this.#db
        .prepare(
          "UPDATE operations SET status='submitted',updated_at=? WHERE id=? AND status='running'",
        )
        .run(new Date().toISOString(), id);
      if (changed.changes !== 1)
        throw new EpostError("RECOVERY_REQUIRED", { operationId: id });
      this.#event(id, "submitted", "client");
    });
  }
  finish(id, status, { result = null, errorCode = null } = {}) {
    return this.#transaction(() => {
      const row = this.#db
        .prepare("SELECT * FROM operations WHERE id=?")
        .get(id);
      if (
        !row ||
        !["running", "submitted"].includes(row.status) ||
        !["succeeded", "failed", "unknown"].includes(status)
      )
        throw new EpostError("RECOVERY_REQUIRED", { operationId: id });
      if (row.status === "submitted" && status === "failed")
        throw new EpostError("RECOVERY_REQUIRED", { operationId: id });
      this.#db
        .prepare(
          "UPDATE operations SET status=?,result=?,error_code=?,updated_at=? WHERE id=?",
        )
        .run(
          status,
          result ? JSON.stringify(result) : null,
          errorCode,
          new Date().toISOString(),
          id,
        );
      if (status !== "unknown")
        this.#db
          .prepare("DELETE FROM account_locks WHERE operation_id=?")
          .run(id);
      this.#event(id, status, "client");
    });
  }
  resolve(
    account,
    key,
    { outcome, result = null, confirmedProcessStopped, verifiedWithKoreaPost },
  ) {
    if (
      confirmedProcessStopped !== true ||
      verifiedWithKoreaPost !== true ||
      !["succeeded", "not-submitted"].includes(outcome)
    )
      throw new EpostError("RECOVERY_REQUIRED");
    return this.#transaction(() => {
      const row = this.#db
        .prepare("SELECT * FROM operations WHERE account=? AND key_hash=?")
        .get(account, digest(key));
      if (!row || !["running", "submitted", "unknown"].includes(row.status))
        throw new EpostError("RECOVERY_REQUIRED");
      // Never steal a live worker's lock. Unknown means the client has already
      // returned; interrupted running/submitted operations need a dead owner.
      if (row.status !== "unknown") {
        if (row.owner_host !== hostname())
          throw new EpostError("RECOVERY_REQUIRED", { operationId: row.id });
        let alive = true;
        try {
          process.kill(Number(row.owner_pid), 0);
        } catch (e) {
          if (e.code === "ESRCH") alive = false;
        }
        if (alive)
          throw new EpostError("RECOVERY_REQUIRED", { operationId: row.id });
      }
      const status = outcome === "succeeded" ? "succeeded" : "failed";
      this.#db
        .prepare(
          "UPDATE operations SET status=?,result=?,error_code=?,updated_at=? WHERE id=?",
        )
        .run(
          status,
          result ? JSON.stringify(result) : null,
          status === "failed" ? "OPERATION_FAILED" : null,
          new Date().toISOString(),
          row.id,
        );
      this.#db
        .prepare("DELETE FROM account_locks WHERE operation_id=?")
        .run(row.id);
      this.#event(row.id, status, "manual-provider-verification");
      return this.#decode(
        this.#db.prepare("SELECT * FROM operations WHERE id=?").get(row.id),
      );
    });
  }
  close() {
    this.#db?.close();
  }
}

function ownerState(row) {
  if (row.owner_host !== hostname()) return "unverifiable";
  try {
    process.kill(Number(row.owner_pid), 0);
    return "running";
  } catch (error) {
    return error.code === "ESRCH" ? "stopped" : "unverifiable";
  }
}
