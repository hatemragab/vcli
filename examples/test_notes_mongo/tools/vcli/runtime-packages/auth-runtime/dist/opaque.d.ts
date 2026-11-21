declare const purposes: readonly ["refresh-token", "session-capability", "installation-capability", "action-token", "realtime-ticket"];
export type OpaquePurpose = (typeof purposes)[number];
/** Exactly 256 random bits; canonical unpadded base64url, always 43 characters. */
export declare function createOpaqueCapability(): string;
export declare function hashOpaqueCapability(capability: string, purpose: OpaquePurpose): string;
/** Constant-time comparison of equal-size decoded hashes, after format checks. */
export declare function opaqueCapabilityMatches(capability: string, expectedHash: string, purpose: OpaquePurpose): boolean;
export {};
