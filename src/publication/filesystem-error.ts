/** Errno-style code of an operating system failure, such as ENOENT or EACCES */
const errnoCode = /^E[A-Z0-9]+$/;

/** Operating system failure of a filesystem call
 * @param error - Thrown value
 * @returns Whether the value is a Node error carrying an errno-style string code
 */
export function isFilesystemError(error: unknown): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    errnoCode.test(error.code)
  );
}

/** Filesystem absence classification at a path boundary
 * @param error - Thrown value
 * @returns Whether the value reports that the path does not exist
 */
export function isMissing(error: unknown): boolean {
  return isFilesystemError(error) && error.code === "ENOENT";
}

/** Reportable explanation of a filesystem failure
 * @param error - Thrown value caught around filesystem calls
 * @returns The failure text without generated contents
 * @throws {@link Error} The value is not a filesystem failure but a defect, which is never reported as output I/O
 */
export function filesystemMessage(error: unknown): string {
  if (!isFilesystemError(error)) throw error;
  return error.message;
}
