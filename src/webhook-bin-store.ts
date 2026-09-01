/**
 * Caixas de webhook em memória.
 *
 * Memória, e não banco, de propósito: uma caixa de webhook é descartável por
 * natureza — vive o tempo de um teste. Persistir o que terceiros mandam para uma
 * URL pública transformaria a ferramenta num depósito de conteúdo alheio, com
 * retenção que ninguém pediu e que alguém teria de responder por.
 *
 * Perder tudo num reinício é o comportamento correto aqui.
 */

import { randomBytes } from "node:crypto";
import { MAX_BINS, MAX_REQUESTS_PER_BIN, WEBHOOK_TTL_MS, type WebhookBin, type WebhookRequestRecord } from "./toolbox/webhook.js";

export class WebhookBinStore {
  readonly #bins = new Map<string, WebhookBin>();

  constructor(
    private readonly ttlMs: number = WEBHOOK_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  /** Remove as caixas vencidas. Chamado antes de qualquer leitura ou escrita. */
  #sweep(): void {
    const agora = this.now();
    for (const [id, bin] of this.#bins) {
      if (bin.expiresAt <= agora) this.#bins.delete(id);
    }
  }

  create(): WebhookBin {
    this.#sweep();
    // Sem teto, uma única rajada encheria a memória do processo. A mais antiga
    // sai primeiro: é a que tem menos chance de estar em uso.
    if (this.#bins.size >= MAX_BINS) {
      const maisAntiga = [...this.#bins.values()].sort((a, b) => a.createdAt - b.createdAt)[0];
      if (maisAntiga) this.#bins.delete(maisAntiga.id);
    }
    const agora = this.now();
    // 24 caracteres: adivinhar a URL de uma caixa alheia precisa ser inviável,
    // porque é ela que dá acesso ao conteúdo.
    const bin: WebhookBin = { id: randomBytes(18).toString("base64url"), createdAt: agora, expiresAt: agora + this.ttlMs, requests: [], received: 0 };
    this.#bins.set(bin.id, bin);
    return bin;
  }

  get(id: string): WebhookBin | undefined {
    this.#sweep();
    return this.#bins.get(id);
  }

  /** Registra uma chegada. `false` quando a caixa não existe ou já venceu. */
  push(id: string, record: WebhookRequestRecord): boolean {
    const bin = this.get(id);
    if (!bin) return false;
    bin.received += 1;
    bin.requests.unshift(record);
    if (bin.requests.length > MAX_REQUESTS_PER_BIN) bin.requests.length = MAX_REQUESTS_PER_BIN;
    return true;
  }

  clear(id: string): boolean {
    const bin = this.get(id);
    if (!bin) return false;
    bin.requests = [];
    return true;
  }

  /** Só para observabilidade e testes. */
  size(): number {
    this.#sweep();
    return this.#bins.size;
  }
}
