import { DynamicModule, Module } from '@nestjs/common';
import {
  PRINCIPAL_AUTHORITY,
  type PrincipalAuthority,
} from '../auth/principal-authority.js';
import { PrincipalGuard } from './principal.guard.js';

@Module({})
export class HttpSecurityModule {
  static register(authority: PrincipalAuthority): DynamicModule {
    return {
      module: HttpSecurityModule,
      providers: [
        { provide: PRINCIPAL_AUTHORITY, useValue: authority },
        PrincipalGuard,
      ],
      exports: [PRINCIPAL_AUTHORITY, PrincipalGuard],
    };
  }
}
