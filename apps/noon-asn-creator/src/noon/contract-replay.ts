import type { AsnJob, NoonSession } from "../contracts.js";
import { AsnCreatorError } from "../errors.js";
import { webHeaders } from "./headers.js";
import {
  validateContractBundle,
  type ContractMethod,
  type ContractOperationName,
  type ContractOperation,
  type SanitizedContractBundle,
} from "./contract-schema.js";

export interface BoundContractRequest {
  method: ContractMethod;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
}

type BoundVariable = string | number | readonly unknown[];

function bindString(value: string, variables: Record<string, BoundVariable>): unknown {
  const exact = value.match(/^\$\{([^}]+)\}$/)?.[1];
  if (exact) {
    const replacement = variables[exact];
    if (replacement === undefined) {
      throw new AsnCreatorError("contract", false, "contract", `Missing contract variable: ${exact}`);
    }
    return structuredClone(replacement);
  }
  return value.replace(/\$\{([^}]+)\}/g, (_whole, name: string) => {
    const replacement = variables[name];
    if (replacement === undefined) {
      throw new AsnCreatorError("contract", false, "contract", `Missing contract variable: ${name}`);
    }
    return encodeURIComponent(String(replacement));
  });
}

function bindValue(value: unknown, variables: Record<string, BoundVariable>): unknown {
  if (typeof value === "string") return bindString(value, variables);
  if (Array.isArray(value)) return value.map((item) => bindValue(item, variables));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, bindValue(item, variables)]));
  }
  return value;
}

export function bindOperation(
  source: SanitizedContractBundle,
  name: ContractOperationName,
  job: AsnJob,
  session: NoonSession,
  asnNumber?: string,
  extras: { partnerSku?: string; catalogItems?: readonly unknown[]; routeItems?: readonly unknown[] } = {},
): BoundContractRequest {
  const bundle = validateContractBundle(source);
  if ((name === "details" || name === "seal") && !asnNumber) {
    throw new AsnCreatorError("contract", false, "contract", `ASN number is required for ${name} operation`);
  }
  const operation: ContractOperation | undefined = name in bundle.operations
    ? bundle.operations[name as keyof typeof bundle.operations]
    : bundle.workflow?.[name as keyof NonNullable<typeof bundle.workflow>];
  if (!operation) throw new AsnCreatorError("contract", false, "contract", `Contract operation is missing: ${name}`);
  const variables: Record<string, BoundVariable> = {
    projectCode: job.projectCode,
    partnerId: job.partnerId,
    partnerIdNumber: Number(job.partnerId),
    countryCode: "AE",
    locale: "en-ae",
    totalQuantity: job.items.reduce((total, item) => total + item.quantity, 0),
    itemsJson: job.items.map(({ partnerSku, quantity }) => ({ partner_sku: partnerSku, quantity })),
    ...(extras.partnerSku ? { partnerSku: extras.partnerSku } : {}),
    ...(extras.catalogItems ? { catalogItemsJson: extras.catalogItems } : {}),
    ...(extras.routeItems ? { routeItemsJson: extras.routeItems } : {}),
    ...(asnNumber ? { asnNumber } : {}),
  };
  const availableHeaders = webHeaders(job, session);
  const allowed = new Set(operation.allowedHeaders.map((header) => header.toLowerCase()));
  const headers = Object.fromEntries(Object.entries(availableHeaders).filter(([header]) => allowed.has(header.toLowerCase())));
  const body = operation.bodyTemplate === undefined ? undefined : bindValue(operation.bodyTemplate, variables);
  return {
    method: operation.method,
    url: bindString(operation.urlTemplate, variables) as string,
    headers,
    ...(body === undefined ? {} : { body }),
  };
}
