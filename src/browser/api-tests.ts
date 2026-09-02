import { activityTarget, esc, recordActivity, signInAndReturn } from "./shared.js";

/**
 * Cliente HTTP interativo de /api-tests.
 *
 * Independente do Modo Jornada: não compartilha elemento nenhum com ele. As
 * chamadas saem do servidor do QA Radar, e não do navegador, para não esbarrar
 * em CORS — collection, histórico, variáveis e credenciais ficam só aqui.
 */
interface Pair {
  key: string;
  value: string;
}

interface Auth {
  type: string;
  bearerToken: string;
  username: string;
  password: string;
  apiKeyName: string;
  apiKeyValue: string;
  apiKeyLocation: string;
}

interface SavedRequest {
  name: string;
  method: string;
  url: string;
  params: Pair[];
  headers: Pair[];
  body: string;
  auth: Auth;
}

interface HistoryEntry extends SavedRequest {
  displayUrl?: string;
  status?: number;
  statusText?: string;
  durationMs?: number;
  createdAt: number;
}

const httpSend = document.querySelector<HTMLButtonElement>("#http-send");
const httpMethod = document.querySelector<HTMLSelectElement>("#http-method");
const httpUrl = document.querySelector<HTMLInputElement>("#http-url");
const httpErrorBox = document.querySelector<HTMLElement>("#http-error");
const httpNotice = document.querySelector<HTMLElement>("#http-notice");
const httpBody = document.querySelector<HTMLTextAreaElement>("#http-body");
const httpParams = document.querySelector<HTMLElement>("#http-params");
const httpHeaders = document.querySelector<HTMLElement>("#http-headers");
const httpVariables = document.querySelector<HTMLElement>("#http-variables");
const httpAuthType = document.querySelector<HTMLSelectElement>("#http-auth-type");
const httpAuthBearerToken = document.querySelector<HTMLInputElement>("#http-auth-bearer-token");
const httpAuthBasicUser = document.querySelector<HTMLInputElement>("#http-auth-basic-user");
const httpAuthBasicPassword = document.querySelector<HTMLInputElement>("#http-auth-basic-password");
const httpAuthApiKeyName = document.querySelector<HTMLInputElement>("#http-auth-api-key-name");
const httpAuthApiKeyValue = document.querySelector<HTMLInputElement>("#http-auth-api-key-value");
const httpAuthApiKeyLocation = document.querySelector<HTMLSelectElement>("#http-auth-api-key-location");
const httpResponse = document.querySelector<HTMLElement>("#http-response");
const httpResponseEmpty = document.querySelector<HTMLElement>("#http-response-empty");
const httpResponseStatus = document.querySelector<HTMLElement>("#http-response-status");
const httpResponseDuration = document.querySelector<HTMLElement>("#http-response-duration");
const httpResponseSize = document.querySelector<HTMLElement>("#http-response-size");
const httpResponseHeaders = document.querySelector<HTMLElement>("#http-response-headers");
const httpResponseBody = document.querySelector<HTMLElement>("#http-response-body");
const httpCopyResponse = document.querySelector<HTMLButtonElement>("#http-copy-response");
const httpCollectionList = document.querySelector<HTMLElement>("#http-collection-list");
const httpCollectionName = document.querySelector<HTMLInputElement>("#http-collection-name");
const httpCollectionSearch = document.querySelector<HTMLInputElement>("#http-collection-search");
const httpHistoryList = document.querySelector<HTMLElement>("#http-history-list");
const httpHistoryCount = document.querySelector<HTMLElement>("#http-history-count");
const httpBodyState = document.querySelector<HTMLElement>("#http-body-state");

// A página inteira depende destes elementos. Fora de /api-tests o módulo nem
// chega a ser carregado; a conjunção aqui é o que dá ao compilador a certeza
// de que nenhum deles é nulo dentro do bloco.
if (
  httpSend &&
  httpMethod &&
  httpUrl &&
  httpErrorBox &&
  httpNotice &&
  httpBody &&
  httpParams &&
  httpHeaders &&
  httpVariables &&
  httpAuthType &&
  httpAuthBearerToken &&
  httpAuthBasicUser &&
  httpAuthBasicPassword &&
  httpAuthApiKeyName &&
  httpAuthApiKeyValue &&
  httpAuthApiKeyLocation &&
  httpResponse &&
  httpResponseEmpty &&
  httpResponseStatus &&
  httpResponseDuration &&
  httpResponseSize &&
  httpResponseHeaders &&
  httpResponseBody &&
  httpCopyResponse &&
  httpCollectionList &&
  httpCollectionName &&
  httpCollectionSearch &&
  httpHistoryList &&
  httpHistoryCount &&
  httpBodyState
) {
  const COLLECTION_KEY = "qa-radar-api-collection";
  const VARIABLES_KEY = "qa-radar-api-variables";
  const HISTORY_KEY = "qa-radar-api-history";
  const HISTORY_LIMIT = 30;
  const PENDING = /{{[^{}]+}}/;

  let activeHttpRequest: AbortController | undefined;
  let currentCollectionIndex = -1;
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;

  const hideHttpMessages = (): void => {
    httpErrorBox.style.display = "none";
    httpNotice.style.display = "none";
    clearTimeout(noticeTimer);
  };

  const showHttpError = (message: string): void => {
    httpNotice.style.display = "none";
    httpErrorBox.textContent = message;
    httpErrorBox.style.display = "block";
  };

  const showHttpNotice = (message: string): void => {
    httpErrorBox.style.display = "none";
    httpNotice.textContent = message;
    httpNotice.style.display = "block";
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
      httpNotice.style.display = "none";
    }, 3500);
  };

  const kvPairs = (container: HTMLElement): Pair[] => {
    return [...container.querySelectorAll<HTMLElement>(".http-kv-row")]
      .map((row) => ({ key: row.querySelector<HTMLInputElement>(".http-kv-key")?.value.trim() ?? "", value: row.querySelector<HTMLInputElement>(".http-kv-value")?.value ?? "" }))
      .filter((pair) => pair.key);
  };

  const updatePairCounts = (): void => {
    for (const [selector, container] of [
      ["#http-param-count", httpParams],
      ["#http-header-count", httpHeaders],
      ["#http-variable-count", httpVariables],
    ] as const) {
      const field = document.querySelector<HTMLElement>(selector);
      if (field) field.textContent = String(kvPairs(container).length);
    }
  };

  const pairsChanged = (container: HTMLElement): void => {
    updatePairCounts();
    if (container !== httpVariables) return;
    try {
      localStorage.setItem(VARIABLES_KEY, JSON.stringify(kvPairs(httpVariables)));
    } catch {
      // Sem armazenamento as variáveis valem só nesta aba.
    }
  };

  const kvRow = (container: HTMLElement, keyPlaceholder: string, valuePlaceholder: string): HTMLElement => {
    const row = document.createElement("div");
    row.className = "http-kv-row";
    row.innerHTML =
      `<input type="text" class="http-kv-key" aria-label="Nome" placeholder="${esc(keyPlaceholder)}">` +
      `<input type="text" class="http-kv-value" aria-label="Valor" placeholder="${esc(valuePlaceholder)}">` +
      '<button type="button" class="secondary http-kv-remove" aria-label="Remover">×</button>';
    row.querySelector<HTMLButtonElement>(".http-kv-remove")?.addEventListener("click", () => {
      row.remove();
      pairsChanged(container);
    });
    container.appendChild(row);
    return row;
  };

  document.querySelector<HTMLButtonElement>("#http-add-param")?.addEventListener("click", () => kvRow(httpParams, "Nome", "Valor"));
  document.querySelector<HTMLButtonElement>("#http-add-header")?.addEventListener("click", () => kvRow(httpHeaders, "Nome", "Valor"));
  document.querySelector<HTMLButtonElement>("#http-add-variable")?.addEventListener("click", () => kvRow(httpVariables, "nome", "valor"));

  for (const container of [httpParams, httpHeaders, httpVariables]) {
    for (const button of container.querySelectorAll<HTMLButtonElement>(".http-kv-remove")) {
      button.addEventListener("click", () => {
        button.closest(".http-kv-row")?.remove();
        pairsChanged(container);
      });
    }
    container.addEventListener("input", () => pairsChanged(container));
  }

  const applyVariables = (text: string, variables: Pair[]): string => variables.reduce((value, variable) => value.split(`{{${variable.key}}}`).join(variable.value), text);

  const bindHttpTabs = (): void => {
    for (const tabList of document.querySelectorAll<HTMLElement>("[data-http-tabs]")) {
      for (const tab of tabList.querySelectorAll<HTMLElement>("[data-http-tab]")) {
        tab.addEventListener("click", () => {
          if (!document.querySelector(`#${tab.dataset.httpTab}`)) return;
          for (const item of tabList.querySelectorAll<HTMLElement>("[data-http-tab]")) {
            const selected = item === tab;
            item.classList.toggle("active", selected);
            item.setAttribute("aria-selected", String(selected));
            const panel = document.querySelector<HTMLElement>(`#${item.dataset.httpTab}`);
            if (panel) panel.hidden = !selected;
          }
        });
      }
    }
  };

  const loadCollection = (): { requests: SavedRequest[] } => {
    try {
      const raw = localStorage.getItem(COLLECTION_KEY);
      const parsed = (raw ? JSON.parse(raw) : {}) as { requests?: unknown };
      return { requests: Array.isArray(parsed.requests) ? (parsed.requests as SavedRequest[]) : [] };
    } catch {
      return { requests: [] };
    }
  };

  const saveCollection = (collection: { requests: SavedRequest[] }): void => {
    try {
      localStorage.setItem(COLLECTION_KEY, JSON.stringify(collection));
    } catch {
      // Sem armazenamento a collection não persiste entre visitas.
    }
  };

  const loadRequestHistory = (): HistoryEntry[] => {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
      return Array.isArray(parsed) ? (parsed as HistoryEntry[]) : [];
    } catch {
      return [];
    }
  };

  const saveRequestHistory = (history: HistoryEntry[]): void => {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, HISTORY_LIMIT)));
    } catch {
      // Idem: o histórico é conveniência local, não dado do produto.
    }
  };

  const fillPairs = (container: HTMLElement, pairs: Pair[] | undefined, keyPlaceholder = "Nome", valuePlaceholder = "Valor"): void => {
    container.innerHTML = "";
    for (const pair of pairs?.length ? pairs : [{ key: "", value: "" }]) {
      const row = kvRow(container, keyPlaceholder, valuePlaceholder);
      const key = row.querySelector<HTMLInputElement>(".http-kv-key");
      const value = row.querySelector<HTMLInputElement>(".http-kv-value");
      if (key) key.value = pair.key || "";
      if (value) value.value = pair.value || "";
    }
    pairsChanged(container);
  };

  const normalizePairs = (value: unknown): Pair[] =>
    Array.isArray(value) ? (value as Pair[]).filter((pair) => pair && typeof pair.key === "string" && typeof pair.value === "string").map((pair) => ({ key: pair.key, value: pair.value })) : [];

  const normalizeAuth = (value: unknown): Auth => {
    const auth = (value && typeof value === "object" ? value : {}) as Partial<Auth>;
    const type = ["bearer", "basic", "api-key"].includes(auth.type ?? "") ? (auth.type as string) : "none";
    return {
      type,
      bearerToken: typeof auth.bearerToken === "string" ? auth.bearerToken : "",
      username: typeof auth.username === "string" ? auth.username : "",
      password: typeof auth.password === "string" ? auth.password : "",
      apiKeyName: typeof auth.apiKeyName === "string" ? auth.apiKeyName : "",
      apiKeyValue: typeof auth.apiKeyValue === "string" ? auth.apiKeyValue : "",
      apiKeyLocation: auth.apiKeyLocation === "query" ? "query" : "header",
    };
  };

  const readAuth = (): Auth => ({
    type: httpAuthType.value,
    bearerToken: httpAuthBearerToken.value,
    username: httpAuthBasicUser.value,
    password: httpAuthBasicPassword.value,
    apiKeyName: httpAuthApiKeyName.value,
    apiKeyValue: httpAuthApiKeyValue.value,
    apiKeyLocation: httpAuthApiKeyLocation.value,
  });

  const syncAuthType = (): void => {
    for (const type of ["none", "bearer", "basic", "api-key"]) {
      const block = document.querySelector<HTMLElement>(`#http-auth-${type}`);
      if (block) block.hidden = httpAuthType.value !== type;
    }
  };

  const fillAuth = (value: unknown): void => {
    const auth = normalizeAuth(value);
    httpAuthType.value = auth.type;
    httpAuthBearerToken.value = auth.bearerToken;
    httpAuthBasicUser.value = auth.username;
    httpAuthBasicPassword.value = auth.password;
    httpAuthApiKeyName.value = auth.apiKeyName;
    httpAuthApiKeyValue.value = auth.apiKeyValue;
    httpAuthApiKeyLocation.value = auth.apiKeyLocation;
    syncAuthType();
  };

  const currentRequest = (name = ""): SavedRequest => ({
    name,
    method: httpMethod.value,
    url: httpUrl.value.trim(),
    params: kvPairs(httpParams),
    headers: kvPairs(httpHeaders),
    body: httpBody.value,
    auth: readAuth(),
  });

  const normalizeRequest = (item: unknown): SavedRequest | undefined => {
    const value = item as Partial<SavedRequest> | null;
    if (!value || typeof value !== "object" || typeof value.name !== "string" || typeof value.url !== "string") return undefined;
    const method = typeof value.method === "string" ? value.method.toUpperCase() : "GET";
    if (!value.name.trim() || !["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"].includes(method)) return undefined;
    return {
      name: value.name.trim(),
      method,
      url: value.url,
      params: normalizePairs(value.params),
      headers: normalizePairs(value.headers),
      body: typeof value.body === "string" ? value.body : "",
      auth: normalizeAuth(value.auth),
    };
  };

  const syncHttpMethod = (): void => {
    httpBodyState.hidden = !["GET", "HEAD"].includes(httpMethod.value);
  };

  const fillRequest = (item: Partial<SavedRequest>): void => {
    httpMethod.value = item.method ?? "GET";
    httpUrl.value = item.url ?? "";
    httpBody.value = item.body ?? "";
    fillPairs(httpParams, item.params);
    fillPairs(httpHeaders, item.headers);
    fillAuth(item.auth);
    syncHttpMethod();
    hideHttpMessages();
  };

  const renderCollection = (query = httpCollectionSearch.value.trim()): void => {
    const collection = loadCollection();
    if (!collection.requests.length) {
      httpCollectionList.innerHTML = '<p class="hint">Nenhuma requisição salva ainda.</p>';
      return;
    }
    const normalized = query.toLocaleLowerCase("pt-BR");
    const matches = collection.requests
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => !normalized || `${item.name} ${item.method} ${item.url}`.toLocaleLowerCase("pt-BR").includes(normalized));
    if (!matches.length) {
      httpCollectionList.innerHTML = '<p class="hint">Nenhuma requisição encontrada.</p>';
      return;
    }
    httpCollectionList.innerHTML = matches
      .map(
        ({ item, index }) =>
          `<div class="http-collection-item ${index === currentCollectionIndex ? "active" : ""}"><span class="http-method-badge">${esc(item.method)}</span>` +
          `<button type="button" class="http-collection-load" data-index="${index}"><strong>${esc(item.name)}</strong><span>${esc(item.url || "URL não informada")}</span></button>` +
          `<button type="button" class="secondary http-collection-delete" data-index="${index}" aria-label="Remover ${esc(item.name)}">Remover</button></div>`,
      )
      .join("");
    for (const button of httpCollectionList.querySelectorAll<HTMLButtonElement>(".http-collection-load")) {
      button.addEventListener("click", () => {
        const index = Number(button.dataset.index);
        const item = loadCollection().requests[index];
        if (!item) return;
        currentCollectionIndex = index;
        httpCollectionName.value = item.name;
        fillRequest(item);
        renderCollection();
      });
    }
    for (const button of httpCollectionList.querySelectorAll<HTMLButtonElement>(".http-collection-delete")) {
      button.addEventListener("click", () => {
        const index = Number(button.dataset.index);
        const collection = loadCollection();
        collection.requests.splice(index, 1);
        saveCollection(collection);
        if (currentCollectionIndex === index) currentCollectionIndex = -1;
        else if (currentCollectionIndex > index) currentCollectionIndex -= 1;
        renderCollection();
        showHttpNotice("Requisição removida da collection.");
      });
    }
  };

  const renderHistory = (): void => {
    const history = loadRequestHistory();
    httpHistoryCount.textContent = String(history.length);
    if (!history.length) {
      httpHistoryList.innerHTML = '<p class="hint">Nenhuma requisição executada ainda.</p>';
      return;
    }
    httpHistoryList.innerHTML = history
      .map((item, index) => {
        const failed = !item.status || item.status >= 400;
        const date = new Date(item.createdAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
        return (
          `<div class="http-history-item"><span class="http-method-badge">${esc(item.method)}</span>` +
          `<button type="button" class="http-history-load" data-index="${index}"><strong>${esc(item.displayUrl ?? item.url)}</strong><span>${esc(date)}</span></button>` +
          `<div class="http-history-result"><strong class="${failed ? "error" : ""}">${esc(item.status ? `${item.status} ${item.statusText ?? ""}` : "Erro")}</strong><small>${esc(item.durationMs ?? 0)} ms</small></div></div>`
        );
      })
      .join("");
    for (const button of httpHistoryList.querySelectorAll<HTMLButtonElement>(".http-history-load")) {
      button.addEventListener("click", () => {
        const item = loadRequestHistory()[Number(button.dataset.index)];
        if (!item) return;
        currentCollectionIndex = -1;
        httpCollectionName.value = "";
        fillRequest(item);
        renderCollection();
        showHttpNotice("Requisição carregada do histórico.");
      });
    }
  };

  const recordHistory = (request: SavedRequest, result: { displayUrl: string; status: number; statusText: string; durationMs: number }): void => {
    const createdAt = Date.now();
    const history = loadRequestHistory();
    history.unshift({ ...request, ...result, createdAt });
    saveRequestHistory(history);
    renderHistory();
    const failed = !result.status || result.status >= 400;
    recordActivity({
      id: `api-${createdAt}`,
      type: "api",
      title: `${request.method} ${activityTarget(result.displayUrl || request.url)}`,
      detail: result.status ? `${result.status} ${result.statusText || ""}` : "Falha de conexão",
      status: failed ? "error" : "success",
      errors: failed ? 1 : 0,
      warnings: 0,
      durationMs: result.durationMs || 0,
      createdAt,
      href: `/api-tests?activity=${createdAt}`,
      scores: { http: failed ? 30 : 100 },
    });
  };

  const resetHttpRequest = (): void => {
    activeHttpRequest?.abort();
    activeHttpRequest = undefined;
    currentCollectionIndex = -1;
    httpMethod.value = "GET";
    httpUrl.value = "";
    httpBody.value = "";
    httpCollectionName.value = "";
    fillPairs(httpParams, []);
    fillPairs(httpHeaders, []);
    fillAuth({});
    syncHttpMethod();
    hideHttpMessages();
    httpResponse.hidden = true;
    httpResponseEmpty.hidden = false;
    httpCopyResponse.hidden = true;
    renderCollection();
  };

  bindHttpTabs();
  try {
    const savedVariables: unknown = JSON.parse(localStorage.getItem(VARIABLES_KEY) ?? "[]");
    if (Array.isArray(savedVariables)) fillPairs(httpVariables, savedVariables as Pair[], "nome", "valor");
  } catch {
    // Variáveis corrompidas: começa com a linha vazia de sempre.
  }
  updatePairCounts();
  syncHttpMethod();
  syncAuthType();
  renderCollection();
  renderHistory();

  const requestedActivity = Number(new URLSearchParams(location.search).get("activity"));
  if (requestedActivity) {
    const request = loadRequestHistory().find((item) => Number(item.createdAt) === requestedActivity);
    if (request) {
      fillRequest(request);
      showHttpNotice("Requisição recuperada. Revise os dados antes de reenviar.");
    }
  }

  document.querySelector<HTMLButtonElement>("#http-save-request")?.addEventListener("click", () => {
    const name = httpCollectionName.value.trim();
    if (!name) {
      showHttpError("Informe um nome para salvar a requisição.");
      return;
    }
    const request = currentRequest(name);
    const collection = loadCollection();
    const sameName = collection.requests.findIndex((item, index) => index !== currentCollectionIndex && item.name.toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR"));
    const targetIndex = currentCollectionIndex >= 0 ? currentCollectionIndex : sameName;
    if (targetIndex >= 0) {
      collection.requests[targetIndex] = request;
      currentCollectionIndex = targetIndex;
    } else {
      collection.requests.push(request);
      currentCollectionIndex = collection.requests.length - 1;
    }
    saveCollection(collection);
    renderCollection();
    showHttpNotice(targetIndex >= 0 ? "Requisição atualizada." : "Requisição salva na collection.");
  });

  httpCollectionSearch.addEventListener("input", () => renderCollection());
  httpMethod.addEventListener("change", syncHttpMethod);
  httpAuthType.addEventListener("change", syncAuthType);
  document.querySelector<HTMLButtonElement>("#http-clear")?.addEventListener("click", resetHttpRequest);
  document.querySelector<HTMLButtonElement>("#http-clear-history")?.addEventListener("click", () => {
    saveRequestHistory([]);
    renderHistory();
    showHttpNotice("Histórico removido.");
  });

  document.querySelector<HTMLButtonElement>("#http-format-body")?.addEventListener("click", () => {
    hideHttpMessages();
    if (!httpBody.value.trim()) {
      showHttpError("Informe um body JSON para formatar.");
      return;
    }
    try {
      httpBody.value = JSON.stringify(JSON.parse(httpBody.value), null, 2);
      showHttpNotice("JSON formatado.");
    } catch {
      showHttpError("O body não contém um JSON válido.");
    }
  });

  document.querySelector<HTMLButtonElement>("#http-collection-export")?.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(loadCollection(), null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "qa-radar-api-collection.json";
    link.click();
    URL.revokeObjectURL(link.href);
  });

  document.querySelector<HTMLInputElement>("#http-collection-import")?.addEventListener("change", (event) => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    void (async () => {
      try {
        const imported = JSON.parse(await file.text()) as { requests?: unknown };
        if (!Array.isArray(imported.requests)) throw new Error();
        const valid = imported.requests.map(normalizeRequest).filter((item): item is SavedRequest => Boolean(item));
        if (valid.length !== imported.requests.length) throw new Error();
        const collection = loadCollection();
        const byName = new Map(collection.requests.map((item) => [item.name.toLocaleLowerCase("pt-BR"), item]));
        for (const item of valid) byName.set(item.name.toLocaleLowerCase("pt-BR"), item);
        saveCollection({ requests: [...byName.values()] });
        currentCollectionIndex = -1;
        renderCollection();
        showHttpNotice(`${valid.length} requisição(ões) importada(s).`);
      } catch {
        showHttpError("Arquivo de collection inválido.");
      } finally {
        input.value = "";
      }
    })();
  });

  httpCopyResponse.addEventListener("click", () => {
    void (async () => {
      try {
        await navigator.clipboard.writeText(httpResponseBody.textContent ?? "");
        showHttpNotice("Body copiado para a área de transferência.");
      } catch {
        showHttpError("Não foi possível copiar o body.");
      }
    })();
  });

  httpSend.addEventListener("click", () => {
    if (activeHttpRequest) {
      activeHttpRequest.abort();
      return;
    }
    hideHttpMessages();
    const request = currentRequest();
    const variables = kvPairs(httpVariables);
    const method = request.method;
    const rawUrl = applyVariables(request.url, variables);
    if (!rawUrl) {
      showHttpError("Informe a URL da requisição.");
      return;
    }
    if (PENDING.test(rawUrl)) {
      showHttpError("Preencha todas as variáveis usadas na URL.");
      return;
    }
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl);
      if (!["http:", "https:"].includes(parsedUrl.protocol)) throw new Error();
    } catch {
      showHttpError("Informe uma URL HTTP ou HTTPS válida.");
      return;
    }
    for (const pair of request.params) {
      const key = applyVariables(pair.key, variables);
      const value = applyVariables(pair.value, variables);
      if (PENDING.test(key + value)) {
        showHttpError("Preencha todas as variáveis usadas nos parâmetros.");
        return;
      }
      if (key) parsedUrl.searchParams.append(key, value);
    }
    const headers: Record<string, string> = {};
    for (const pair of request.headers) {
      const key = applyVariables(pair.key, variables);
      const value = applyVariables(pair.value, variables);
      if (PENDING.test(key + value)) {
        showHttpError("Preencha todas as variáveis usadas nos headers.");
        return;
      }
      if (key) headers[key] = value;
    }
    const setHeader = (key: string, value: string): void => {
      const existing = Object.keys(headers).find((name) => name.toLowerCase() === key.toLowerCase());
      if (existing) delete headers[existing];
      headers[key] = value;
    };
    const auth = request.auth;
    let authQueryName: string | undefined;
    if (auth.type === "bearer") {
      const token = applyVariables(auth.bearerToken, variables);
      if (!token) {
        showHttpError("Informe o Bearer Token.");
        return;
      }
      if (PENDING.test(token)) {
        showHttpError("Preencha a variável usada no Bearer Token.");
        return;
      }
      setHeader("Authorization", `Bearer ${token}`);
    } else if (auth.type === "basic") {
      const username = applyVariables(auth.username, variables);
      const password = applyVariables(auth.password, variables);
      if (!username) {
        showHttpError("Informe o usuário do Basic Auth.");
        return;
      }
      if (PENDING.test(username + password)) {
        showHttpError("Preencha as variáveis usadas no Basic Auth.");
        return;
      }
      const bytes = new TextEncoder().encode(`${username}:${password}`);
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      setHeader("Authorization", `Basic ${btoa(binary)}`);
    } else if (auth.type === "api-key") {
      const key = applyVariables(auth.apiKeyName, variables);
      const value = applyVariables(auth.apiKeyValue, variables);
      if (!key || !value) {
        showHttpError("Informe o nome e o valor da API Key.");
        return;
      }
      if (PENDING.test(key + value)) {
        showHttpError("Preencha as variáveis usadas na API Key.");
        return;
      }
      if (auth.apiKeyLocation === "query") {
        parsedUrl.searchParams.set(key, value);
        authQueryName = key;
      } else {
        setHeader(key, value);
      }
    }
    const url = parsedUrl.toString();
    let displayUrl = url;
    // A chave na query não pode ir para o histórico em texto claro.
    if (authQueryName) {
      const redactedUrl = new URL(url);
      redactedUrl.searchParams.set(authQueryName, "REDACTED");
      displayUrl = redactedUrl.toString();
    }
    const body = method === "GET" || method === "HEAD" ? undefined : applyVariables(httpBody.value, variables);
    if (body && PENDING.test(body)) {
      showHttpError("Preencha todas as variáveis usadas no body.");
      return;
    }
    if (body && !Object.keys(headers).some((key) => key.toLowerCase() === "content-type")) {
      try {
        JSON.parse(body);
        headers["Content-Type"] = "application/json";
      } catch {
        // Body que não é JSON segue sem content-type declarado.
      }
    }
    activeHttpRequest = new AbortController();
    httpSend.classList.add("cancel-active");
    httpSend.innerHTML = '<i class="loader"></i>Cancelar';
    let historyRecorded = false;
    void (async () => {
      try {
        const response = await fetch("/api/http-request", {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: activeHttpRequest?.signal ?? null,
          body: JSON.stringify({ method, url, headers, ...(body !== undefined ? { body } : {}) }),
        });
        const data = (await response.json()) as { status: number; statusText: string; durationMs: number; headers?: Record<string, string>; body?: string; bodyTruncated?: boolean; error?: string };
        if (response.status === 401) {
          signInAndReturn();
          return;
        }
        if (!response.ok) throw new Error(data.error ?? "Não foi possível enviar a requisição.");
        httpResponse.hidden = false;
        httpResponseEmpty.hidden = true;
        httpCopyResponse.hidden = false;
        const statusClass = data.status >= 200 && data.status < 300 ? "ok" : data.status >= 300 && data.status < 400 ? "redirect" : "error";
        httpResponseStatus.className = `http-status ${statusClass}`;
        httpResponseStatus.textContent = `${data.status} ${data.statusText}`;
        httpResponseDuration.textContent = `${data.durationMs} ms`;
        httpResponseHeaders.textContent =
          Object.entries(data.headers ?? {})
            .map(([key, value]) => `${key}: ${value}`)
            .join("\n") || "(sem headers)";
        let prettyBody = data.body ?? "";
        try {
          prettyBody = JSON.stringify(JSON.parse(prettyBody), null, 2);
        } catch {
          // Resposta que não é JSON aparece como veio.
        }
        httpResponseBody.textContent = prettyBody + (data.bodyTruncated ? "\n\n[corpo truncado]" : "");
        const bytes = new TextEncoder().encode(data.body ?? "").length;
        httpResponseSize.textContent = bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
        recordHistory(request, { displayUrl, status: data.status, statusText: data.statusText, durationMs: data.durationMs });
        historyRecorded = true;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          showHttpNotice("Envio cancelado.");
        } else {
          showHttpError(error instanceof Error ? error.message : "Não foi possível enviar a requisição.");
          if (!historyRecorded) recordHistory(request, { displayUrl, status: 0, statusText: "Erro", durationMs: 0 });
        }
      } finally {
        activeHttpRequest = undefined;
        httpSend.classList.remove("cancel-active");
        httpSend.textContent = "Enviar";
      }
    })();
  });

  document.addEventListener("keydown", (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.key !== "Enter") return;
    event.preventDefault();
    httpSend.click();
  });
}
