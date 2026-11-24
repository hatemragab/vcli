import { Module, type DynamicModule } from '@nestjs/common';
import type { PrincipalAuthority } from '../../core/auth/principal-authority.js';
import { HttpSecurityModule } from '../../core/http/http-security.module.js';
import { AccountService } from './account.service.js';
import { CurrentAccountController } from './current-account.controller.js';
@Module({})
export class AccountModule {
  static register(
    service: AccountService,
    authority: PrincipalAuthority,
  ): DynamicModule {
    return {
      module: AccountModule,
      imports: [HttpSecurityModule.register(authority)],
      controllers: [CurrentAccountController],
      providers: [{ provide: AccountService, useValue: service }],
      exports: [AccountService],
    };
  }
}
