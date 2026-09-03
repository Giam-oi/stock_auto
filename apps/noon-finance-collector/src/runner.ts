import { join } from "node:path";
import { loadCredential } from "./credentials.js";
import { loginNoon } from "./auth.js";
import { outputFileName, SITE_CONFIGS, STORE_CONFIGS, type StoreConfig } from "./contracts.js";
import { validateStatementCsv, validateTransactionCsv } from "./csv.js";
import { fetchFinanceExport, statementExportRequest, transactionExportRequest } from "./export-client.js";
import { publishFiles, type PendingFile } from "./publish.js";

export interface RunnerOptions {
  fromDate: string;
  toDate: string;
  credentialDirectory: string;
  localDirectory: string;
  oneDriveDirectory?: string;
  concurrency?: number;
}

async function collectStore(store: StoreConfig, options: RunnerOptions): Promise<PendingFile[]> {
  const credential = await loadCredential(join(options.credentialDirectory, store.credentialFile), store);
  const cookieHeader = await loginNoon(credential);

  const uaeStatement = await fetchFinanceExport(statementExportRequest(
    store.projectCode, cookieHeader, SITE_CONFIGS.UAE, options.fromDate, options.toDate,
  ));
  const uaeStatementRows = validateStatementCsv(uaeStatement.csvText, "AE", options.fromDate, options.toDate);

  const ksaStatement = await fetchFinanceExport(statementExportRequest(
    store.projectCode, cookieHeader, SITE_CONFIGS.KSA, options.fromDate, options.toDate,
  ));
  const ksaStatementRows = validateStatementCsv(ksaStatement.csvText, "SA", options.fromDate, options.toDate);

  const transaction = await fetchFinanceExport(transactionExportRequest(
    store.projectCode, cookieHeader, options.fromDate, options.toDate,
  ));
  const transactionRows = validateTransactionCsv(transaction.csvText, options.fromDate, options.toDate);

  return [
    { name: outputFileName("UAE", store.index, "statements"), csvText: uaeStatement.csvText, rows: uaeStatementRows,
      projectCode: store.projectCode, site: "UAE", report: "statements", exportCode: uaeStatement.exportCode },
    { name: outputFileName("KSA", store.index, "statements"), csvText: ksaStatement.csvText, rows: ksaStatementRows,
      projectCode: store.projectCode, site: "KSA", report: "statements", exportCode: ksaStatement.exportCode },
    { name: outputFileName("KSA", store.index, "transactionviewreportonitemlevelwithcontractselection"), csvText: transaction.csvText,
      rows: transactionRows, projectCode: store.projectCode, site: "UAE+KSA", report: "transactionview", exportCode: transaction.exportCode },
  ];
}

export async function runCollector(options: RunnerOptions): Promise<Record<string, unknown>> {
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 3, STORE_CONFIGS.length));
  const results: PendingFile[][] = new Array(STORE_CONFIGS.length);
  let next = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const index = next++;
      const store = STORE_CONFIGS[index];
      if (!store) return;
      results[index] = await collectStore(store, options);
    }
  });
  await Promise.all(workers);
  const files = results.flat();
  const publication = await publishFiles(files, options.localDirectory, options.oneDriveDirectory);
  return {
    ok: true, fromDate: options.fromDate, toDate: options.toDate,
    files: files.map(({ csvText: _csvText, ...file }) => file), publication,
  };
}
