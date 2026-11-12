import type { Stats } from "node:fs";
import { lstat } from "node:fs/promises";

/**
 * Filesystem entry inspection without following symbolic links
 * @param path - Entry path under inspection
 * @returns Entry metadata with absence represented by undefined
 * @throws {@link Error} Filesystem access failure other than absence
 */
export async function inspect(path: string): Promise<Stats | undefined> {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
