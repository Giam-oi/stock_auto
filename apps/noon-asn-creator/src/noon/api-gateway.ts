import type { AsnGateway, AsnItem, AsnJob, AsnRecord, NoonSession, StoreIndex } from "../contracts.js";
import { AsnCreatorError } from "../errors.js";
import { withRetry } from "../retry.js";
import { bindOperation } from "./contract-replay.js";
import {
  validateContractBundle,
  type ContractOperationName,
  type ContractOperation,
  type ContractResponseSelectors,
  type SanitizedContractBundle,
} from "./contract-schema.js";

interface GatewayOptions {
  fetch?: typeof fetch;
  refreshSession?: (storeIndex: StoreIndex) => Promise<NoonSession>;
  timeoutMs?: number;
  retryDelaysMs?: readonly number[];
  visibilityDelaysMs?: readonly number[];
  sleep?: (milliseconds: number) => Promise<void>;
}

function getPath(source: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    return (value as Record<string, unknown>)[key];
  }, source);
}

function firstValue(source: unknown, paths: readonly string[]): unknown {
  for (const path of paths) {
    const value = getPath(source, path);
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function requiredString(source: unknown, paths: readonly string[], label: string): string {
  const value = firstValue(source, paths);
  if (typeof value !== "string" || value.trim() === "") {
    throw new AsnCreatorError("contract", false, "response", `Noon response is missing ${label}`);
  }
  return value.trim();
}

function parseItem(value: unknown, selectors: ContractResponseSelectors): AsnItem {
  const sku = requiredString(value, selectors.skuPaths, "item SKU");
  const quantity = firstValue(value, selectors.quantityPaths);
  const parsedQuantity = typeof quantity === "string" && /^\d+$/.test(quantity) ? Number(quantity) : quantity;
  if (typeof parsedQuantity !== "number" || !Number.isSafeInteger(parsedQuantity) || parsedQuantity <= 0) {
    throw new AsnCreatorError("contract", false, "response", "Noon response contains an invalid item quantity");
  }
  return { partnerSku: sku, quantity: parsedQuantity };
}

function parseRecord(
  value: unknown,
  selectors: ContractResponseSelectors,
  job: AsnJob,
  missingItemsAsEmpty = false,
): AsnRecord {
  const itemsValue = firstValue(value, selectors.itemArrayPaths);
  if (!Array.isArray(itemsValue) && !(missingItemsAsEmpty && itemsValue === undefined)) {
    throw new AsnCreatorError("contract", false, "response", "Noon response is missing the ASN item array");
  }
  const projectValue = firstValue(value, ["project_code", "projectCode", "project.code", "data.project_code"]);
  const projectCode = projectValue === undefined ? job.projectCode : requiredString(
    value,
    ["project_code", "projectCode", "project.code", "data.project_code"],
    "project code",
  );
  if (!projectCode.startsWith("PRJ")) {
    throw new AsnCreatorError("contract", false, "response", "Noon response contains an invalid project code");
  }
  const createdAtValue = firstValue(value, ["created_at", "createdAt", "data.created_at"]);
  return {
    asnNumber: requiredString(value, selectors.asnNumberPaths, "ASN number"),
    projectCode: projectCode as `PRJ${string}`,
    status: requiredString(value, selectors.statusPaths, "ASN status"),
    ...(typeof createdAtValue === "string" ? { createdAt: createdAtValue } : {}),
    items: Array.isArray(itemsValue) ? itemsValue.map((item) => parseItem(item, selectors)) : [],
  };
}

function retryAfterMs(response: Response): number | undefined {
  const value = response.headers.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

function httpError(operation: ContractOperationName, response: Response): AsnCreatorError {
  const retryable = response.status === 429 || response.status >= 500;
  const retryDelay = retryAfterMs(response);
  return new AsnCreatorError(
    "http",
    retryable,
    operation,
    `Noon ASN ${operation} failed with HTTP ${response.status}`,
    { status: response.status, ...(retryDelay === undefined ? {} : { retryAfterMs: retryDelay }) },
  );
}

export class ContractApiGateway implements AsnGateway {
  private readonly bundle: SanitizedContractBundle;
  private readonly fetchImpl: typeof fetch;
  private readonly refreshSession: ((storeIndex: StoreIndex) => Promise<NoonSession>) | undefined;
  private readonly timeoutMs: number;
  private readonly retryDelaysMs: readonly number[];
  private readonly visibilityDelaysMs: readonly number[];
  private readonly sleep: ((milliseconds: number) => Promise<void>) | undefined;

  constructor(bundle: SanitizedContractBundle, options: GatewayOptions = {}) {
    this.bundle = validateContractBundle(bundle);
    this.fetchImpl = options.fetch ?? fetch;
    this.refreshSession = options.refreshSession;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.retryDelaysMs = options.retryDelaysMs ?? [1_000, 3_000];
    this.visibilityDelaysMs = options.visibilityDelaysMs ?? [1_000, 2_000, 4_000, 8_000, 15_000];
    this.sleep = options.sleep;
  }

  private operation(name: ContractOperationName): ContractOperation {
    const operation = name in this.bundle.operations
      ? this.bundle.operations[name as keyof typeof this.bundle.operations]
      : this.bundle.workflow?.[name as keyof NonNullable<typeof this.bundle.workflow>];
    if (!operation) throw new AsnCreatorError("contract", false, name, `Contract operation is missing: ${name}`);
    return operation;
  }

  private async fetchOnce(
    operationName: ContractOperationName,
    job: AsnJob,
    session: NoonSession,
    asnNumber?: string,
    extras: { partnerSku?: string; catalogItems?: readonly unknown[]; routeItems?: readonly unknown[] } = {},
  ): Promise<Response> {
    const request = bindOperation(this.bundle, operationName, job, session, asnNumber, extras);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(request.url, {
        method: request.method,
        headers: request.headers,
        ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
        signal: controller.signal,
      });
    } catch (cause) {
      const timedOut = controller.signal.aborted || (cause instanceof DOMException && cause.name === "AbortError");
      throw new AsnCreatorError(
        timedOut ? "timeout" : "network",
        true,
        operationName,
        timedOut ? `Noon ASN ${operationName} timed out` : `Noon ASN ${operationName} network failure`,
        { cause },
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private async responseWithAuthentication(
    operationName: ContractOperationName,
    job: AsnJob,
    session: NoonSession,
    asnNumber?: string,
    extras: { partnerSku?: string; catalogItems?: readonly unknown[]; routeItems?: readonly unknown[] } = {},
  ): Promise<Response> {
    let response = await this.fetchOnce(operationName, job, session, asnNumber, extras);
    if (response.status === 401 && this.refreshSession) {
      const refreshed = await this.refreshSession(job.storeIndex);
      response = await this.fetchOnce(operationName, job, refreshed, asnNumber, extras);
    }
    if (response.status === 401) {
      throw new AsnCreatorError("authentication", false, operationName, "Noon ASN session was rejected", { status: 401 });
    }
    return response;
  }

  private async readJson(
    operationName: ContractOperationName,
    job: AsnJob,
    session: NoonSession,
    asnNumber?: string,
    extras: { partnerSku?: string; catalogItems?: readonly unknown[]; routeItems?: readonly unknown[] } = {},
  ): Promise<unknown> {
    const retryOptions = {
      delaysMs: this.retryDelaysMs,
      ...(this.sleep ? { sleep: this.sleep } : {}),
    };
    const result = await withRetry(async () => {
      const response = await this.responseWithAuthentication(operationName, job, session, asnNumber, extras);
      if (!this.operation(operationName).successStatuses.includes(response.status)) {
        throw httpError(operationName, response);
      }
      try {
        return await response.json() as unknown;
      } catch (cause) {
        throw new AsnCreatorError("contract", false, operationName, "Noon ASN response is not valid JSON", { cause });
      }
    }, retryOptions);
    return result.value;
  }

  private async writeJson(
    operationName: ContractOperationName,
    job: AsnJob,
    session: NoonSession,
    asnNumber?: string,
    extras: { partnerSku?: string; catalogItems?: readonly unknown[]; routeItems?: readonly unknown[] } = {},
  ): Promise<unknown> {
    const response = await this.responseWithAuthentication(operationName, job, session, asnNumber, extras);
    if (!this.operation(operationName).successStatuses.includes(response.status)) throw httpError(operationName, response);
    try {
      return await response.json() as unknown;
    } catch (cause) {
      throw new AsnCreatorError("contract", false, operationName, "Noon ASN response is not valid JSON", { cause });
    }
  }

  async findMatches(job: AsnJob, session: NoonSession): Promise<readonly AsnRecord[]> {
    const body = await this.readJson("find", job, session);
    const operation = this.bundle.operations.find;
    const records = operation.response.recordsPath ? getPath(body, operation.response.recordsPath) : body;
    if (!Array.isArray(records)) {
      throw new AsnCreatorError("contract", false, "find", "Noon ASN list response is missing its records array");
    }
    const parseable = this.bundle.workflow
      ? records.filter((record) => Array.isArray(firstValue(record, operation.response.itemArrayPaths)))
      : records;
    return parseable.map((record) => parseRecord(record, operation.response, job));
  }

  async create(job: AsnJob, session: NoonSession): Promise<{ outcome: "accepted" | "uncertain" }> {
    if (this.bundle.workflow) return this.createWorkflow(job, session);
    let response: Response;
    try {
      response = await this.responseWithAuthentication("create", job, session);
    } catch (error) {
      if (error instanceof AsnCreatorError && (error.kind === "network" || error.kind === "timeout")) {
        return { outcome: "uncertain" };
      }
      throw error;
    }
    if (!this.bundle.operations.create.successStatuses.includes(response.status)) throw httpError("create", response);
    return { outcome: "accepted" };
  }

  private async catalogItems(
    items: readonly AsnItem[],
    job: AsnJob,
    session: NoonSession,
  ): Promise<Array<Record<string, unknown>>> {
    const eligibleOperation = this.bundle.workflow!.eligible;
    const catalogItems: Array<Record<string, unknown>> = [];
    for (const item of items) {
      const body = await this.readJson("eligible", job, session, undefined, { partnerSku: item.partnerSku });
      const rows = eligibleOperation.response.recordsPath ? getPath(body, eligibleOperation.response.recordsPath) : body;
      if (!Array.isArray(rows)) {
        throw new AsnCreatorError("contract", false, "eligible", "Noon eligible SKU response is missing rows");
      }
      const matches = rows.filter((row) => firstValue(row, ["partner_sku", "partnerSku"]) === item.partnerSku);
      if (matches.length !== 1) {
        throw new AsnCreatorError("verification", false, "eligible", `Noon catalog did not return one exact match for SKU ${item.partnerSku}`);
      }
      const match = matches[0];
      const pskuCode = requiredString(match, ["psku_code"], "catalog psku_code");
      const sku = requiredString(match, ["sku"], "catalog sku");
      const reportedStorageType = requiredString(match, ["storage_type_code"], "catalog storage type");
      const reportedCubicFeet = firstValue(match, ["cubic_feet"]);
      const useStandardDefaults = reportedStorageType === "unidentified" ||
        typeof reportedCubicFeet !== "number" || !Number.isFinite(reportedCubicFeet) || reportedCubicFeet <= 0;
      let storageType = reportedStorageType;
      let cubicFeet = reportedCubicFeet;
      if (useStandardDefaults) {
        const classification = await this.readJson("classify", job, session);
        storageType = requiredString(classification, ["storage_type_code"], "calculated storage type");
        cubicFeet = firstValue(classification, ["volume"]);
        if (storageType !== "standard") {
          throw new AsnCreatorError("verification", false, "classify", "Default 1/1/1/1 dimensions did not produce standard storage");
        }
      }
      if (typeof cubicFeet !== "number" || !Number.isFinite(cubicFeet) || cubicFeet <= 0) {
        throw new AsnCreatorError("contract", false, "eligible", "Noon catalog contains invalid cubic feet");
      }
      catalogItems.push({
        psku_code: pskuCode,
        qty: item.quantity,
        cubic_feet: cubicFeet * item.quantity,
        storage_type_code: storageType,
        sku,
      });
    }
    return catalogItems;
  }

  private assertExactSubset(job: AsnJob, record: AsnRecord): void {
    if (record.projectCode !== job.projectCode) {
      throw new AsnCreatorError("verification", false, "createLines", "ASN belongs to a different project");
    }
    const expected = new Map(job.items.map((item) => [item.partnerSku, item.quantity]));
    const seen = new Set<string>();
    for (const item of record.items) {
      if (seen.has(item.partnerSku) || expected.get(item.partnerSku) !== item.quantity) {
        throw new AsnCreatorError("verification", false, "createLines", "ASN contains an unexpected or mismatched line");
      }
      seen.add(item.partnerSku);
    }
  }

  private async waitForVisibleLines(
    job: AsnJob,
    session: NoonSession,
    asnNumber: string,
    requiredItems: readonly AsnItem[],
  ): Promise<void> {
    const pause = this.sleep ?? (async (milliseconds: number) => new Promise<void>((resolve) => {
      setTimeout(resolve, milliseconds);
    }));
    for (let attempt = 0; attempt <= this.visibilityDelaysMs.length; attempt += 1) {
      const current = await this.getDetails(asnNumber, job, session);
      this.assertExactSubset(job, current);
      const visible = new Map(current.items.map((item) => [item.partnerSku, item.quantity]));
      if (requiredItems.every((item) => visible.get(item.partnerSku) === item.quantity)) return;
      const delay = this.visibilityDelaysMs[attempt];
      if (delay === undefined) break;
      await pause(delay);
    }
    throw new AsnCreatorError(
      "verification",
      true,
      "createLines",
      "Noon did not expose the previous ASN line batch before the visibility timeout",
    );
  }

  private async checkRoute(
    job: AsnJob,
    session: NoonSession,
    asnNumber: string,
    catalogItems: readonly Record<string, unknown>[],
  ): Promise<void> {
    const routeItems = catalogItems.map((item) => ({
      sku: item.sku,
      qty: item.qty,
      storage_type_code: item.storage_type_code,
    }));
    let response: unknown;
    try {
      response = await this.readJson("route", job, session, asnNumber, { routeItems });
    } catch (error) {
      if (error instanceof AsnCreatorError && error.kind === "http" && error.status === 400) {
        throw new AsnCreatorError(
          "verification",
          false,
          "route",
          "Noon routing requires this workbook to be split into multiple ASNs",
        );
      }
      throw error;
    }
    const routes = getPath(response, "data");
    if (!Array.isArray(routes) || routes.length === 0) {
      throw new AsnCreatorError(
        "verification",
        false,
        "route",
        "Noon routing requires this workbook to be split into multiple ASNs",
      );
    }
  }

  private async writeAllLines(
    job: AsnJob,
    session: NoonSession,
    asnNumber: string,
    catalogItems: readonly Record<string, unknown>[],
  ): Promise<void> {
    await this.checkRoute(job, session, asnNumber, catalogItems);
    await this.writeJson("createLines", job, session, asnNumber, { catalogItems });
    await this.waitForVisibleLines(job, session, asnNumber, job.items);
  }

  private async createWorkflow(job: AsnJob, session: NoonSession): Promise<{ outcome: "accepted" | "uncertain"; asnNumber?: string }> {
    const catalogItems = await this.catalogItems(job.items, job, session);

    let mainAccepted = false;
    let asnNumber: string | undefined;
    try {
      const created = await this.writeJson("create", job, session);
      mainAccepted = true;
      asnNumber = requiredString(created, this.bundle.operations.create.response.asnNumberPaths, "created ASN number");
      await this.writeAllLines(job, session, asnNumber, catalogItems);
      await this.writeJson("storageCheck", job, session, asnNumber);
      return { outcome: "accepted", asnNumber };
    } catch (error) {
      if (mainAccepted) return { outcome: "uncertain", ...(asnNumber ? { asnNumber } : {}) };
      if (error instanceof AsnCreatorError) {
        if (error.kind === "network" || error.kind === "timeout" || error.kind === "contract" ||
            (error.kind === "http" && (error.retryable || error.status === 429))) {
          return { outcome: "uncertain" };
        }
      }
      throw error;
    }
  }

  async resume(job: AsnJob, session: NoonSession, asnNumber: string): Promise<void> {
    if (!this.bundle.workflow) throw new AsnCreatorError("contract", false, "resume", "ASN workflow does not support resume");
    const current = await this.getDetails(asnNumber, job, session);
    if (current.projectCode !== job.projectCode) {
      throw new AsnCreatorError("verification", false, "resume", "Pending ASN belongs to a different project");
    }
    this.assertExactSubset(job, current);
    if (current.items.length === job.items.length) return;
    await this.writeAllLines(job, session, asnNumber, await this.catalogItems(job.items, job, session));
    await this.writeJson("storageCheck", job, session, asnNumber);
  }

  async seal(asnNumber: string, job: AsnJob, session: NoonSession): Promise<AsnRecord> {
    const before = await this.getDetails(asnNumber, job, session);
    if (before.status.toLowerCase() === "sealed") return before;
    if (!new Set(["created", "pending"]).has(before.status.toLowerCase())) {
      throw new AsnCreatorError("verification", false, "seal", `Noon ASN cannot be sealed from status ${before.status}`);
    }

    let sealError: unknown;
    try {
      const response = await this.responseWithAuthentication("seal", job, session, asnNumber);
      if (!this.bundle.operations.seal.successStatuses.includes(response.status)) throw httpError("seal", response);
    } catch (error) {
      sealError = error;
    }

    const pause = this.sleep ?? (async (milliseconds: number) => new Promise<void>((resolve) => {
      setTimeout(resolve, milliseconds);
    }));
    for (let attempt = 0; attempt <= this.visibilityDelaysMs.length; attempt += 1) {
      try {
        const details = await this.getDetails(asnNumber, job, session);
        if (details.status.toLowerCase() === "sealed") return details;
      } catch (error) {
        if (!sealError) sealError = error;
      }
      const delay = this.visibilityDelaysMs[attempt];
      if (delay === undefined) break;
      await pause(delay);
    }

    throw new AsnCreatorError(
      "verification",
      true,
      "seal",
      "Noon ASN seal outcome could not be verified; rerun will query the same ASN without creating another",
      sealError === undefined ? {} : { cause: sealError },
    );
  }

  async getDetails(asnNumber: string, job: AsnJob, session: NoonSession): Promise<AsnRecord> {
    const body = await this.readJson("details", job, session, asnNumber);
    const selectors = this.bundle.operations.details.response;
    if (selectors.recordsPath) {
      const records = getPath(body, selectors.recordsPath);
      if (!Array.isArray(records)) {
        throw new AsnCreatorError("contract", false, "details", "Noon ASN details response is missing rows");
      }
      const matching = records.filter((record) => firstValue(record, selectors.asnNumberPaths) === asnNumber);
      if (matching.length !== 1) {
        throw new AsnCreatorError("verification", false, "details", "Noon ASN details did not return one exact ASN");
      }
      return parseRecord(matching[0], selectors, job, true);
    }
    return parseRecord(body, selectors, job, true);
  }
}
