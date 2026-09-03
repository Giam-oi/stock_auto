import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { Destination, SiteCode } from "./config";

export interface Options {
  stores: string;
  site: SiteCode;
  destination: Destination;
  chromePath?: string;
  monitorUntil?: string;
  intervalMinutes: number;
  interactive: boolean;
  resident: boolean;
  openLoginOnLogout: boolean;
  autoLogin: boolean;
}

function valueAfter(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} 缺少参数`);
  return value;
}

export function parseArgs(args: readonly string[], env: NodeJS.ProcessEnv = process.env): Options {
  const resident = args.includes("--resident");
  const background = args.includes("--background");
  const store = valueAfter(args, "--store");
  const siteText = valueAfter(args, "--site")?.toUpperCase();
  const pageText = valueAfter(args, "--page")?.toLowerCase();
  if (siteText && siteText !== "UAE" && siteText !== "KSA") throw new Error("--site 只能是 UAE 或 KSA");
  if (pageText && pageText !== "dashboard" && pageText !== "inventory" && pageText !== "fbn") {
    throw new Error("--page 只能是 dashboard、inventory 或 fbn");
  }
  const chromePath = valueAfter(args, "--chrome");
  const monitorUntil = valueAfter(args, "--monitor-until");
  const intervalText = valueAfter(args, "--interval-minutes");
  const intervalMinutes = intervalText === undefined ? 30 : Number(intervalText);
  if (!Number.isInteger(intervalMinutes) || intervalMinutes < 1 || intervalMinutes > 1_440) {
    throw new Error("--interval-minutes 必须是 1 到 1440 的整数");
  }
  if (monitorUntil && !Number.isFinite(Date.parse(monitorUntil))) {
    throw new Error("--monitor-until 必须是有效的 ISO 日期时间");
  }
  return {
    stores: store ?? (resident ? "all" : ""),
    site: (siteText as SiteCode | undefined) ?? "UAE",
    destination: (pageText as Destination | undefined) ?? "dashboard",
    ...(chromePath ? { chromePath } : {}),
    ...(monitorUntil ? { monitorUntil } : {}),
    intervalMinutes,
    interactive: !store && !resident,
    resident,
    openLoginOnLogout: !resident && !background,
    autoLogin: !args.includes("--no-auto-login"),
  };
}

function normalizeStoreChoice(value: string): string {
  return value.trim().toLowerCase() === "a" ? "all" : value.trim();
}

export async function promptOptions(options: Options): Promise<Options> {
  const rl = createInterface({ input, output });
  try {
    output.write("\n  Noon 店铺免密码登录\n  ====================\n\n");
    output.write("  店铺：1  2  3  4  5  6  |  A 全部\n");
    const stores = normalizeStoreChoice(await rl.question("  请选择店铺（可输入 1,3,5）: "));
    output.write("\n  站点：1 UAE  |  2 KSA\n");
    const siteChoice = (await rl.question("  请选择站点 [1]: ")).trim();
    output.write("\n  页面：1 Store Dashboard  |  2 FBN Inventory  |  3 FBN 首页\n");
    const pageChoice = (await rl.question("  请选择页面 [1]: ")).trim();
    return {
      ...options,
      stores,
      site: siteChoice === "2" ? "KSA" : "UAE",
      destination: pageChoice === "2" ? "inventory" : pageChoice === "3" ? "fbn" : "dashboard",
    };
  } finally {
    rl.close();
  }
}

export async function pause(): Promise<void> {
  if (!process.stdin.isTTY) return;
  const rl = createInterface({ input, output });
  try { await rl.question("\n  按 Enter 关闭此窗口..."); } finally { rl.close(); }
}
