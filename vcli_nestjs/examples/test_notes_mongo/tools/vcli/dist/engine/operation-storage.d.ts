import type { OperationJournal } from './types.js';
export declare const journalRelative: (id: string) => string;
export declare function listJournals(projectDir: string): Promise<OperationJournal[]>;
export declare const unfinishedJournals: (journals: OperationJournal[]) => OperationJournal[];
export declare function privateDirectory(projectDir: string, relative: string): Promise<string>;
export declare function writePrivate(file: string, content: string | Buffer): Promise<void>;
export declare function writeJournal(journal: OperationJournal): Promise<void>;
/** The sibling lock also serializes initialization before its target exists. */
export declare function withProjectLock<T>(projectDir: string, action: () => Promise<T>, abandonLock?: boolean): Promise<T>;
