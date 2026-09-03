import type { Database } from "./database.js";
import type { ScreenshotMode } from "./types.js";
import type { StoredAccountSettings } from "./account-settings.js";

/**
 * Uma linha por conta, chave primária `ownerId` — não existe "a segunda linha
 * de configurações" de uma conta, então `update` é sempre upsert: cria a linha
 * na primeira vez, mescla nas seguintes. Campo ausente do patch nunca apaga o
 * que já estava gravado — é assim que "não mexer no que não foi enviado" do
 * `PATCH /api/v1/account/settings` fica verdadeiro até no armazenamento.
 */
export interface AccountSettingsRepository {
  get(ownerId: string): Promise<StoredAccountSettings | undefined>;
  update(ownerId: string, patch: StoredAccountSettings): Promise<StoredAccountSettings>;
}

function definedEntries(patch: StoredAccountSettings): Array<[keyof StoredAccountSettings, StoredAccountSettings[keyof StoredAccountSettings]]> {
  return Object.entries(patch).filter(([, value]) => value !== undefined) as Array<[keyof StoredAccountSettings, StoredAccountSettings[keyof StoredAccountSettings]]>;
}

export class InMemoryAccountSettingsRepository implements AccountSettingsRepository {
  readonly #rows = new Map<string, StoredAccountSettings>();

  async get(ownerId: string): Promise<StoredAccountSettings | undefined> {
    const row = this.#rows.get(ownerId);
    return row ? { ...row } : undefined;
  }

  async update(ownerId: string, patch: StoredAccountSettings): Promise<StoredAccountSettings> {
    const merged: StoredAccountSettings = { ...this.#rows.get(ownerId) };
    for (const [key, value] of definedEntries(patch)) (merged as Record<string, unknown>)[key] = value;
    this.#rows.set(ownerId, merged);
    return { ...merged };
  }
}

interface AccountSettingsRow {
  owner_id: string;
  alert_window_days: number | null;
  alert_threshold_points: number | null;
  alert_min_sample: number | null;
  scan_timeout_ms: number | null;
  scan_settle_ms: number | null;
  scan_ignored_statuses: string | null;
  scan_screenshot: string | null;
}

function fromRow(row: AccountSettingsRow): StoredAccountSettings {
  return {
    alertWindowDays: row.alert_window_days ?? undefined,
    alertThresholdPoints: row.alert_threshold_points ?? undefined,
    alertMinSample: row.alert_min_sample ?? undefined,
    scanTimeoutMs: row.scan_timeout_ms ?? undefined,
    scanSettleMs: row.scan_settle_ms ?? undefined,
    scanIgnoredStatuses: row.scan_ignored_statuses ?? undefined,
    scanScreenshot: (row.scan_screenshot as ScreenshotMode | null) ?? undefined,
  };
}

const COLUMNS = "owner_id, alert_window_days, alert_threshold_points, alert_min_sample, scan_timeout_ms, scan_settle_ms, scan_ignored_statuses, scan_screenshot";

export class PostgresAccountSettingsRepository implements AccountSettingsRepository {
  constructor(private readonly database: Database) {}

  async get(ownerId: string): Promise<StoredAccountSettings | undefined> {
    const rows = await this.database.query<AccountSettingsRow>(`select ${COLUMNS} from account_settings where owner_id = $1`, [ownerId]);
    return rows[0] ? fromRow(rows[0]) : undefined;
  }

  async update(ownerId: string, patch: StoredAccountSettings): Promise<StoredAccountSettings> {
    const rows = await this.database.query<AccountSettingsRow>(
      `insert into account_settings (owner_id, alert_window_days, alert_threshold_points, alert_min_sample, scan_timeout_ms, scan_settle_ms, scan_ignored_statuses, scan_screenshot)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (owner_id) do update set
         alert_window_days = coalesce($2, account_settings.alert_window_days),
         alert_threshold_points = coalesce($3, account_settings.alert_threshold_points),
         alert_min_sample = coalesce($4, account_settings.alert_min_sample),
         scan_timeout_ms = coalesce($5, account_settings.scan_timeout_ms),
         scan_settle_ms = coalesce($6, account_settings.scan_settle_ms),
         scan_ignored_statuses = coalesce($7, account_settings.scan_ignored_statuses),
         scan_screenshot = coalesce($8, account_settings.scan_screenshot),
         updated_at = now()
       returning ${COLUMNS}`,
      [
        ownerId,
        patch.alertWindowDays ?? null,
        patch.alertThresholdPoints ?? null,
        patch.alertMinSample ?? null,
        patch.scanTimeoutMs ?? null,
        patch.scanSettleMs ?? null,
        patch.scanIgnoredStatuses ?? null,
        patch.scanScreenshot ?? null,
      ],
    );
    return fromRow(rows[0] as AccountSettingsRow);
  }
}
