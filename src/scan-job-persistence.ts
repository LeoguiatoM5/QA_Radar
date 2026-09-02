import type { ScanJob } from "./job-queue.js";
import type { PersistedScanJob, ScanJobRepository } from "./scan-job-repository.js";

/**
 * Persistência write-through dos jobs de análise.
 *
 * O agendamento continua em memória de propósito: um `ScanJob` carrega um
 * `AbortController` e o progresso ao vivo, que só existem no processo que está
 * rodando a análise. O banco guarda o registro — estado, opções, relatório,
 * erro — para que ele sobreviva ao reinício e possa ser consultado.
 *
 * A interface é sempre chamada, com ou sem banco: sem ele entra a implementação
 * inerte, e nenhum ponto do código precisa perguntar se há persistência.
 */
export interface ScanJobPersistence {
  /** Grava o job recém-criado. Erro aqui deve abortar a criação. */
  created(job: ScanJob): Promise<void>;
  /** Reflete uma mudança de estado, progresso ou resultado. Nunca lança. */
  updated(job: ScanJob): Promise<void>;
  /** Remove o registro quando a retenção expira. Nunca lança. */
  removed(id: string): Promise<void>;
  /** Apaga o histórico inteiro de uma conta e devolve os ids removidos. */
  removeForOwner(ownerId: string): Promise<string[]>;
  /** Histórico de uma aplicação da conta, do mais recente para o mais antigo. */
  listForApplication(ownerId: string, applicationId: string, limit: number): Promise<PersistedScanJob[]>;
  /** Busca um job que não está mais em memória. */
  load(id: string): Promise<PersistedScanJob | undefined>;
  /**
   * Fecha jobs que ficaram `running` porque a instância anterior morreu.
   *
   * Sem isto eles ficariam "em execução" para sempre: quem os estava rodando
   * não existe mais, e ninguém vai concluí-los.
   */
  recoverOrphans(): Promise<string[]>;
  /**
   * Análises que ficaram na fila e nunca chegaram a executar.
   *
   * Sem reenfileirá-las, o registro sobrevive ao reinício mas o trabalho não:
   * elas ficam `queued` no banco para sempre e quem consulta vê "na fila"
   * indefinidamente, o que é pior do que falhar.
   */
  pending(): Promise<PersistedScanJob[]>;
  /** Histórico de uma conta. Vazio sem banco: não há o que listar. */
  listForOwner(ownerId: string, limit: number): Promise<PersistedScanJob[]>;
  /** Sondagem barata para o readiness. Nunca lança. */
  status(): Promise<"disabled" | "ok" | "unreachable">;
}

export const NO_SCAN_JOB_PERSISTENCE: ScanJobPersistence = {
  created: async () => {},
  updated: async () => {},
  removed: async () => {},
  removeForOwner: async () => [],
  listForApplication: async () => [],
  load: async () => undefined,
  recoverOrphans: async () => [],
  pending: async () => [],
  listForOwner: async () => [],
  status: async () => "disabled",
};

export function toPersistedScanJob(job: ScanJob, retentionMs: number): PersistedScanJob {
  const now = new Date().toISOString();
  return {
    id: job.id,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: now,
    expiresAt: new Date(Date.now() + retentionMs).toISOString(),
    options: job.options,
    progress: job.progress,
    report: job.report,
    error: job.error,
    cancelRequested: job.cancelRequested,
    accessTokenHash: job.accessTokenHash,
    ownerId: job.ownerId,
    applicationId: job.applicationId,
  };
}

export interface ScanJobPersistenceOptions {
  repository: ScanJobRepository;
  retentionMs: number;
  /** Recebe falhas de escrita que não podem interromper a análise em curso. */
  onError: (operation: string, error: unknown) => void;
}

export function createScanJobPersistence({ repository, retentionMs, onError }: ScanJobPersistenceOptions): ScanJobPersistence {
  // Uma falha ao gravar o progresso não pode derrubar a análise que está
  // rodando: o resultado real é mais valioso que o registro dele. A criação é
  // a exceção — ali a falha precisa aparecer, senão o cliente recebe um id de
  // um job que o banco nunca viu.
  const swallow = async (operation: string, run: () => Promise<unknown>): Promise<void> => {
    try {
      await run();
    } catch (error) {
      onError(operation, error);
    }
  };

  return {
    created: (job) => repository.insert(toPersistedScanJob(job, retentionMs)).then(() => undefined),
    updated: (job) => swallow("update", () => repository.update(toPersistedScanJob(job, retentionMs))),
    removed: (id) => swallow("delete", () => repository.delete(id)),
    async removeForOwner(ownerId) {
      // Aqui a falha não pode ser engolida: quem pediu para apagar precisa
      // saber se sobrou alguma coisa. Engolir devolveria "pronto" com o
      // histórico intacto.
      return await repository.deleteByOwner(ownerId);
    },
    async load(id) {
      try {
        return await repository.get(id);
      } catch (error) {
        onError("load", error);
        return undefined;
      }
    },
    async recoverOrphans() {
      const recovered: string[] = [];
      try {
        // `claimNext` não serve aqui: ele pega os enfileirados. Os órfãos já
        // estão em `running` e precisam ser fechados um a um. A transição é
        // condicionada ao estado no próprio UPDATE, então duas instâncias
        // subindo juntas não fecham o mesmo job duas vezes.
        for (const job of await repository.runningJobs()) {
          const failed = await repository.transition(job.id, "failed", "A instância que executava esta análise foi encerrada antes de concluí-la.");
          if (failed) recovered.push(job.id);
        }
      } catch (error) {
        onError("recover", error);
      }
      return recovered;
    },
    async pending() {
      try {
        return await repository.queuedJobs();
      } catch (error) {
        onError("pending", error);
        return [];
      }
    },
    async listForApplication(ownerId, applicationId, limit) {
      try {
        return await repository.listByApplication(ownerId, applicationId, limit);
      } catch (error) {
        onError("list", error);
        return [];
      }
    },
    async listForOwner(ownerId, limit) {
      try {
        return await repository.listByOwner(ownerId, limit);
      } catch (error) {
        onError("list", error);
        return [];
      }
    },
    async status() {
      // `counts` é a consulta mais barata que ainda prova que o banco responde.
      try {
        await repository.counts();
        return "ok";
      } catch {
        return "unreachable";
      }
    },
  };
}

/** Reconstrói o job em memória a partir do registro, com controle novo. */
export function toRuntimeScanJob(stored: PersistedScanJob): ScanJob {
  return {
    id: stored.id,
    status: stored.status,
    createdAt: stored.createdAt,
    options: stored.options,
    report: stored.report,
    error: stored.error,
    progress: stored.progress,
    // O AbortController do processo anterior morreu com ele; esta execução
    // precisa do seu próprio para poder ser cancelada.
    controller: new AbortController(),
    cancelRequested: false,
    accessTokenHash: stored.accessTokenHash,
    ownerId: stored.ownerId,
    applicationId: stored.applicationId,
  };
}
