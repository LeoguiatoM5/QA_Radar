type JourneyStepDescription = { description?: string };

export type JourneyStep = JourneyStepDescription & (
  | { action: "goto"; url: string }
  | { action: "click"; selector: string; allowDestructive?: boolean }
  | { action: "fill"; selector: string; value?: string; valueFromEnv?: string }
  | { action: "select"; selector: string; value: string }
  | { action: "waitFor"; selector: string; timeoutMs?: number }
  | { action: "assertVisible"; selector: string }
  | { action: "assertText"; selector: string; text: string }
);

export interface JourneyDefinition {
  schemaVersion: "1.0";
  name: string;
  steps: JourneyStep[];
}

const ACTIONS = new Set(["goto", "click", "fill", "select", "waitFor", "assertVisible", "assertText"]);
const DESTRUCTIVE = /delete|remove|destroy|purchase|buy|checkout|pay|publish|transfer|confirm|excluir|remover|apagar|comprar|pagar|publicar|transferir|confirmar/i;

export function isPotentiallyDestructive(value: string): boolean {
  return DESTRUCTIVE.test(value);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} deve ser um objeto.`);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, max = 500): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new Error(`${label} deve ser um texto não vazio com até ${max} caracteres.`);
  }
  return value;
}

function exactKeys(step: Record<string, unknown>, allowed: string[], index: number): void {
  const unexpected = Object.keys(step).find((key) => !allowed.includes(key));
  if (unexpected) throw new Error(`Passo ${index + 1}: campo desconhecido "${unexpected}".`);
}

function selector(step: Record<string, unknown>, index: number): string {
  return text(step.selector, `Passo ${index + 1}: selector`);
}

function description(step: Record<string, unknown>, index: number): JourneyStepDescription {
  if (step.description === undefined) return {};
  return { description: text(step.description, `Passo ${index + 1}: description`, 200) };
}

function parseStep(value: unknown, index: number): JourneyStep {
  const step = record(value, `Passo ${index + 1}`);
  const action = text(step.action, `Passo ${index + 1}: action`, 30);
  if (!ACTIONS.has(action)) throw new Error(`Passo ${index + 1}: ação não permitida "${action}".`);
  switch (action) {
    case "goto": {
      exactKeys(step, ["action", "url", "description"], index);
      const url = text(step.url, `Passo ${index + 1}: url`, 2_048);
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(`Passo ${index + 1}: URL deve usar HTTP ou HTTPS.`);
      return { action, url: parsed.toString(), ...description(step, index) };
    }
    case "click": {
      exactKeys(step, ["action", "selector", "allowDestructive", "description"], index);
      const target = selector(step, index);
      const allowDestructive = step.allowDestructive === true;
      if (isPotentiallyDestructive(target) && !allowDestructive) {
        throw new Error(`Passo ${index + 1}: clique potencialmente destrutivo exige allowDestructive: true.`);
      }
      return { action, selector: target, ...(allowDestructive ? { allowDestructive: true } : {}), ...description(step, index) };
    }
    case "fill": {
      exactKeys(step, ["action", "selector", "value", "valueFromEnv", "description"], index);
      const target = selector(step, index);
      const hasValue = typeof step.value === "string";
      const hasEnvironment = typeof step.valueFromEnv === "string";
      if (hasValue === hasEnvironment) throw new Error(`Passo ${index + 1}: informe somente value ou valueFromEnv.`);
      if (hasEnvironment) {
        const name = text(step.valueFromEnv, `Passo ${index + 1}: valueFromEnv`, 100);
        if (!/^QA_RADAR_SECRET_[A-Z0-9_]+$/.test(name)) {
          throw new Error(`Passo ${index + 1}: secrets devem usar variável QA_RADAR_SECRET_*.`);
        }
        return { action, selector: target, valueFromEnv: name, ...description(step, index) };
      }
      return { action, selector: target, value: text(step.value, `Passo ${index + 1}: value`, 2_000), ...description(step, index) };
    }
    case "select":
      exactKeys(step, ["action", "selector", "value", "description"], index);
      return { action, selector: selector(step, index), value: text(step.value, `Passo ${index + 1}: value`), ...description(step, index) };
    case "waitFor": {
      exactKeys(step, ["action", "selector", "timeoutMs", "description"], index);
      const timeoutMs = step.timeoutMs === undefined ? undefined : Number(step.timeoutMs);
      if (timeoutMs !== undefined && (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000)) {
        throw new Error(`Passo ${index + 1}: timeoutMs deve estar entre 100 e 120000.`);
      }
      return { action, selector: selector(step, index), ...(timeoutMs === undefined ? {} : { timeoutMs }), ...description(step, index) };
    }
    case "assertVisible":
      exactKeys(step, ["action", "selector", "description"], index);
      return { action, selector: selector(step, index), ...description(step, index) };
    case "assertText":
      exactKeys(step, ["action", "selector", "text", "description"], index);
      return { action, selector: selector(step, index), text: text(step.text, `Passo ${index + 1}: text`), ...description(step, index) };
    default:
      throw new Error(`Passo ${index + 1}: ação não permitida.`);
  }
}

export function parseJourney(value: unknown): JourneyDefinition {
  const journey = record(value, "Jornada");
  const unexpected = Object.keys(journey).find((key) => !["schemaVersion", "name", "steps"].includes(key));
  if (unexpected) throw new Error(`Jornada contém campo desconhecido "${unexpected}".`);
  if (journey.schemaVersion !== "1.0") throw new Error("Jornada incompatível: schemaVersion deve ser 1.0.");
  const name = text(journey.name, "Nome da jornada", 100);
  if (!Array.isArray(journey.steps) || journey.steps.length < 1 || journey.steps.length > 50) {
    throw new Error("Jornada deve possuir entre 1 e 50 passos.");
  }
  return { schemaVersion: "1.0", name, steps: journey.steps.map(parseStep) };
}
