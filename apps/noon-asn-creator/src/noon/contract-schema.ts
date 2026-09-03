import { AsnCreatorError } from "../errors.js";

export type PrimaryContractOperationName = "find" | "create" | "details" | "seal";
export type WorkflowContractOperationName = "eligible" | "classify" | "route" | "createLines" | "storageCheck";
export type ContractOperationName = PrimaryContractOperationName | WorkflowContractOperationName;
export type ContractMethod = "GET" | "POST" | "PUT";

export interface ContractResponseSelectors {
  recordsPath?: string;
  asnNumberPaths: readonly string[];
  statusPaths: readonly string[];
  itemArrayPaths: readonly string[];
  skuPaths: readonly string[];
  quantityPaths: readonly string[];
}

export interface ContractOperation {
  method: ContractMethod;
  urlTemplate: string;
  allowedHeaders: readonly string[];
  bodyTemplate?: unknown;
  successStatuses: readonly number[];
  response: ContractResponseSelectors;
}

export interface SanitizedContractBundle {
  version: 1;
  site: "UAE";
  operations: Record<PrimaryContractOperationName, ContractOperation>;
  workflow?: Record<WorkflowContractOperationName, ContractOperation>;
}

export interface CapturedExchange {
  operation: ContractOperationName;
  request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: unknown;
  };
  response: {
    status: number;
    body?: unknown;
  };
}

export interface SanitizeContext {
  projectCode: string;
  partnerId: string;
  countryCode: string;
  locale: string;
  asnNumber?: string;
  items: readonly { partnerSku: string; quantity: number }[];
}

const OPERATIONS: readonly PrimaryContractOperationName[] = ["find", "create", "details", "seal"];
const WORKFLOW_OPERATIONS: readonly WorkflowContractOperationName[] = ["eligible", "classify", "route", "createLines", "storageCheck"];
const ALL_OPERATIONS = new Set<ContractOperationName>([...OPERATIONS, ...WORKFLOW_OPERATIONS]);
const METHODS = new Set<ContractMethod>(["GET", "POST", "PUT"]);
const VARIABLES = new Set([
  "projectCode", "partnerId", "partnerIdNumber", "countryCode", "locale", "asnNumber",
  "itemsJson", "catalogItemsJson", "routeItemsJson", "partnerSku", "totalQuantity",
]);
const SENSITIVE_KEY = /^(?:private[_-]?key|key[_-]?id|authorization|token|jwt|password|secret)$/i;
const PEM = /-----BEGIN(?: RSA)? PRIVATE KEY-----/i;
const JWT = /\beyJ[A-Za-z0-9_-]{7,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/;

function contractError(message: string): AsnCreatorError {
  return new AsnCreatorError("contract", false, "contract", message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertStringArray(value: unknown, label: string, allowEmpty = false): asserts value is string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.some((item) => typeof item !== "string" || item === "")) {
    throw contractError(`${label} must be ${allowEmpty ? "a" : "a non-empty"} string array`);
  }
}

function scanValue(value: unknown, path = "contract"): void {
  if (typeof value === "string") {
    if (PEM.test(value) || JWT.test(value) || /(?:^|;\s*)[^=;]+=[^;]*(?:session|bearer|private)/i.test(value)) {
      throw contractError(`Credential-like value remains at ${path}`);
    }
    for (const match of value.matchAll(/\$\{([^}]+)\}/g)) {
      if (!VARIABLES.has(match[1]!)) {
        throw contractError(`Unknown template variable: ${match[1]}`);
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanValue(item, `${path}[${index}]`));
    return;
  }
  if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (SENSITIVE_KEY.test(key)) {
        throw contractError(`Credential field is not allowed at ${path}.${key}`);
      }
      scanValue(item, `${path}.${key}`);
    }
  }
}

function validateResponse(value: unknown, operation: string): asserts value is ContractResponseSelectors {
  if (!isRecord(value)) throw contractError(`${operation}.response must be an object`);
  if (value.recordsPath !== undefined && typeof value.recordsPath !== "string") {
    throw contractError(`${operation}.response.recordsPath must be a string`);
  }
  for (const key of ["asnNumberPaths", "statusPaths", "itemArrayPaths", "skuPaths", "quantityPaths"] as const) {
    assertStringArray(value[key], `${operation}.response.${key}`);
  }
}

function validateOperation(value: unknown, name: ContractOperationName): asserts value is ContractOperation {
  if (!isRecord(value)) throw contractError(`Contract operation ${name} is missing`);
  if (typeof value.method !== "string" || !METHODS.has(value.method as ContractMethod)) {
    throw contractError(`${name}.method is invalid`);
  }
  if (typeof value.urlTemplate !== "string" || !/^https:\/\//.test(value.urlTemplate)) {
    throw contractError(`${name}.urlTemplate must be an HTTPS URL`);
  }
  assertStringArray(value.allowedHeaders, `${name}.allowedHeaders`, true);
  if (!Array.isArray(value.successStatuses) || value.successStatuses.length === 0 ||
      value.successStatuses.some((status) => !Number.isInteger(status) || status < 200 || status > 299)) {
    throw contractError(`${name}.successStatuses must contain HTTP success codes`);
  }
  validateResponse(value.response, name);
  scanValue(value, `operations.${name}`);
}

export function validateContractBundle(value: unknown): SanitizedContractBundle {
  if (!isRecord(value) || value.version !== 1 || value.site !== "UAE" || !isRecord(value.operations)) {
    throw contractError("Invalid Noon ASN contract bundle");
  }
  for (const name of OPERATIONS) validateOperation(value.operations[name], name);
  if (value.workflow !== undefined) {
    if (!isRecord(value.workflow)) throw contractError("Contract workflow must be an object");
    for (const name of WORKFLOW_OPERATIONS) validateOperation(value.workflow[name], name);
  }
  scanValue(value);
  return value as unknown as SanitizedContractBundle;
}

function replaceLiteral(value: string, literal: string | undefined, variable: string): string {
  if (!literal) return value;
  return value
    .replaceAll(literal, `\${${variable}}`)
    .replaceAll(encodeURIComponent(literal), `\${${variable}}`);
}

function looksLikeCapturedItems(value: unknown, context: SanitizeContext): boolean {
  if (!Array.isArray(value) || value.length !== context.items.length) return false;
  const serialized = JSON.stringify(value);
  return context.items.every(({ partnerSku, quantity }) => serialized.includes(partnerSku) && serialized.includes(String(quantity)));
}

function sanitizeBody(value: unknown, context: SanitizeContext): unknown {
  if (looksLikeCapturedItems(value, context)) return "${itemsJson}";
  if (typeof value === "string") {
    let result = value;
    for (const item of context.items) result = replaceLiteral(result, item.partnerSku, "itemsJson");
    result = replaceLiteral(result, context.asnNumber, "asnNumber");
    return result;
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeBody(item, context));
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !SENSITIVE_KEY.test(key) && !/^(?:cookie|set-cookie)$/i.test(key))
      .map(([key, item]) => [key, sanitizeBody(item, context)]));
  }
  return value;
}

export function sanitizeExchange(exchange: CapturedExchange, context: SanitizeContext): ContractOperation {
  if (!ALL_OPERATIONS.has(exchange.operation)) throw contractError("Unknown captured operation");
  const method = exchange.request.method.toUpperCase();
  if (!METHODS.has(method as ContractMethod)) throw contractError(`Unsupported captured method: ${method}`);

  let urlTemplate = exchange.request.url;
  urlTemplate = replaceLiteral(urlTemplate, context.projectCode, "projectCode");
  urlTemplate = replaceLiteral(urlTemplate, context.partnerId, "partnerId");
  urlTemplate = replaceLiteral(urlTemplate, context.locale, "locale");
  urlTemplate = replaceLiteral(urlTemplate, context.countryCode, "countryCode");
  urlTemplate = replaceLiteral(urlTemplate, context.countryCode.toLowerCase(), "countryCode");
  urlTemplate = replaceLiteral(urlTemplate, context.asnNumber, "asnNumber");

  const allowedHeaders = Object.keys(exchange.request.headers).filter(
    (name) => !/^(?:authorization|cookie|set-cookie)$/i.test(name),
  );
  const response: ContractResponseSelectors = {
    ...(exchange.operation === "find" ? { recordsPath: "data.records" } : {}),
    asnNumberPaths: ["data.asn_number", "asn_number", "asnNumber"],
    statusPaths: ["data.status", "status"],
    itemArrayPaths: ["data.items", "items"],
    skuPaths: ["partner_sku", "partnerSku", "sku"],
    quantityPaths: ["quantity", "qty"],
  };
  const operation: ContractOperation = {
    method: method as ContractMethod,
    urlTemplate,
    allowedHeaders,
    ...(exchange.request.body === undefined ? {} : { bodyTemplate: sanitizeBody(exchange.request.body, context) }),
    successStatuses: [exchange.response.status],
    response,
  };
  scanValue(operation);
  return operation;
}
