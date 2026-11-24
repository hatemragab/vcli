import { Module } from '@nestjs/common';
import {
  PRINCIPAL_AUTHORITY,
  type PrincipalAuthority,
} from '../auth/principal-authority.js';
import { bootstrapBinding } from '../bootstrap/bootstrap-bindings.js';
import { PrincipalGuard } from './principal.guard.js';

const authorityBinding =
  bootstrapBinding<PrincipalAuthority>(PRINCIPAL_AUTHORITY);
export const bindPrincipalAuthority = authorityBinding.bind;

@Module({
  providers: [authorityBinding.provider, PrincipalGuard],
  exports: [PRINCIPAL_AUTHORITY, PrincipalGuard],
})
export class HttpSecurityModule {}
