import type { Command } from 'commander';
declare const collect: (value: string, values: string[]) => string[];
export declare function applyOptions(command: Command): Command;
export declare function capabilityOptions(command: Command): Command;
export { collect };
