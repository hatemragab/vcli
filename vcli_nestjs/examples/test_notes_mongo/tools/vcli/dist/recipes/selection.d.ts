import { type ProjectConfig, type Recipe } from '../contracts.js';
export declare function selection(config: ProjectConfig, family: string): string | undefined;
export declare function usernameAuth(config: ProjectConfig): boolean;
export declare function validateSelection(config: ProjectConfig, resolved: readonly Recipe[]): void;
