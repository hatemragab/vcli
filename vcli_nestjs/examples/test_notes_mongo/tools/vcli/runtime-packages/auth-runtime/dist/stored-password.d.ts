/** Strict PHC shape/resource validation runs before node-argon2 sees stored input. */
export declare function inspectStoredPassword(hash: string): {
    saltLength: number;
    hashLength: number;
};
