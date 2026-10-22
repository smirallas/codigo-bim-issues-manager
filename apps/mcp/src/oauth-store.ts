import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Adapter, AdapterPayload } from "oidc-provider";

/** Una instancia SQLite: identificadores hash y payloads OAuth cifrados con AES-GCM. */
export class OAuthStore {
  private readonly db: DatabaseSync;
  private readonly key: Buffer;
  constructor(file: string, secret: string) {
    if (secret.length < 43)
      throw new Error("MCP_STORAGE_KEY must have at least 43 characters");
    this.key = createHash("sha256").update(secret).digest();
    if (file !== ":memory:")
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS oauth (
        model TEXT, id TEXT, payload TEXT NOT NULL, expires INTEGER NOT NULL,
        uid TEXT, usercode TEXT, grantid TEXT, PRIMARY KEY(model,id));`);
  }
  private hash(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }
  private seal(value: AdapterPayload): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const data = Buffer.concat([
      cipher.update(JSON.stringify(value)),
      cipher.final(),
    ]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
  }
  private open(
    row: Record<string, unknown> | undefined,
  ): AdapterPayload | undefined {
    if (!row) return undefined;
    const raw = Buffer.from(String(row.payload), "base64");
    const cipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      raw.subarray(0, 12),
    );
    cipher.setAuthTag(raw.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([
        cipher.update(raw.subarray(28)),
        cipher.final(),
      ]).toString(),
    ) as AdapterPayload;
  }
  adapter(model: string): Adapter {
    const find = async (column: string, value: string) =>
      this.open(
        this.db
          .prepare(
            `SELECT payload FROM oauth WHERE model=? AND ${column}=? AND expires>?`,
          )
          .get(model, this.hash(value), Math.floor(Date.now() / 1000)),
      );
    return {
      find: (id) => find("id", id),
      findByUid: (uid) => find("uid", uid),
      findByUserCode: (code) => find("usercode", code),
      upsert: async (id, payload, seconds = 28800) => {
        this.db
          .prepare("DELETE FROM oauth WHERE expires<=?")
          .run(Math.floor(Date.now() / 1000));
        this.db
          .prepare("INSERT OR REPLACE INTO oauth VALUES (?,?,?,?,?,?,?)")
          .run(
            model,
            this.hash(id),
            this.seal(payload),
            Math.floor(Date.now() / 1000) + seconds,
            payload.uid ? this.hash(payload.uid) : null,
            payload.userCode ? this.hash(payload.userCode) : null,
            payload.grantId ? this.hash(payload.grantId) : null,
          );
      },
      consume: async (id) => {
        // Sin await entre lectura y escritura: un código no puede consumirse dos veces.
        const payload = this.open(
          this.db
            .prepare(
              "SELECT payload FROM oauth WHERE model=? AND id=? AND expires>?",
            )
            .get(model, this.hash(id), Math.floor(Date.now() / 1000)),
        );
        if (payload) {
          if (payload.consumed) throw new Error("OAuth code already consumed");
          payload.consumed = Math.floor(Date.now() / 1000);
          this.db
            .prepare("UPDATE oauth SET payload=? WHERE model=? AND id=?")
            .run(this.seal(payload), model, this.hash(id));
        }
      },
      destroy: async (id) => {
        this.db
          .prepare("DELETE FROM oauth WHERE model=? AND id=?")
          .run(model, this.hash(id));
      },
      revokeByGrantId: async (id) => {
        this.db.prepare("DELETE FROM oauth WHERE grantid=?").run(this.hash(id));
      },
    };
  }
  close(): void {
    this.db.close();
  }
}
