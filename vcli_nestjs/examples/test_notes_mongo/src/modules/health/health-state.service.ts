import { Injectable } from '@nestjs/common';
@Injectable()
export class HealthStateService {
  private initialized = false;
  private schemaReleaseId: string | undefined;
  ready(): boolean {
    return this.initialized;
  }
  facts(): Readonly<{ schemaReleaseId?: string }> {
    return this.schemaReleaseId
      ? { schemaReleaseId: this.schemaReleaseId }
      : {};
  }
  markReady(schemaReleaseId?: string): void {
    this.schemaReleaseId = schemaReleaseId;
    this.initialized = true;
  }
  markStopping(): void {
    this.initialized = false;
  }
}
