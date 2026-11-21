/** A local invocation lock is ownership, not stale-process discovery or a supervisor. */
export declare function withLocalOperationLock<T>(root: string, name: string, work: () => Promise<T>): Promise<T>;
