import type {
  DirectGrant,
  MultipartPart,
  ObjectEvidence,
  StorageObject,
} from './storage.entity.js';
export interface StorageProvider {
  finalize(record: StorageObject, mayCreate: boolean): Promise<ObjectEvidence>;
  download(
    record: StorageObject,
    signal: AbortSignal,
  ): Promise<AsyncIterable<Uint8Array>>;
  remove(record: StorageObject): Promise<void>;
  directGrant?(record: StorageObject): Promise<DirectGrant>;
  initiateMultipart?(
    record: StorageObject,
    reconcile: boolean,
  ): Promise<string>;
  uploadPart?(
    record: StorageObject,
    part: MultipartPart,
    body: Uint8Array,
    signal: AbortSignal,
  ): Promise<MultipartPart>;
  abortMultipart?(record: StorageObject): Promise<void>;
  discardStaging?(record: StorageObject): Promise<void>;
  close?(): void;
}
