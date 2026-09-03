import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface InstanceLock {
  acquired: boolean;
  release(): Promise<void>;
}

function defaultPidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export async function acquireSingleInstance(
  lockPath: string,
  pid = process.pid,
  isPidAlive: (pid: number) => boolean = defaultPidAlive,
): Promise<InstanceLock> {
  const create = async () => {
    await mkdir(lockPath);
    await writeFile(join(lockPath, "owner.json"), JSON.stringify({ pid, startedAt: new Date().toISOString() }), "utf8");
  };
  try {
    await create();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EEXIST") throw error;
    let ownerPid = 0;
    try { ownerPid = (JSON.parse(await readFile(join(lockPath, "owner.json"), "utf8")) as { pid?: number }).pid ?? 0; } catch { /* Invalid owner data is stale. */ }
    if (ownerPid > 0 && isPidAlive(ownerPid)) return { acquired: false, release: async () => {} };
    await rm(lockPath, { recursive: true, force: true });
    await create();
  }
  let released = false;
  return {
    acquired: true,
    release: async () => {
      if (released) return;
      released = true;
      await rm(lockPath, { recursive: true, force: true });
    },
  };
}
