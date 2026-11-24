import { Module } from '@nestjs/common';
import { bootstrapBinding } from '../../core/bootstrap/bootstrap-bindings.js';
import { HttpSecurityModule } from '../../core/http/http-security.module.js';
import { AccountService } from './account.service.js';
import { CurrentAccountController } from './current-account.controller.js';

const accountServiceBinding = bootstrapBinding(AccountService);
export const bindAccountService = accountServiceBinding.bind;

@Module({
  imports: [HttpSecurityModule],
  controllers: [CurrentAccountController],
  providers: [accountServiceBinding.provider],
  exports: [AccountService],
})
export class AccountModule {}
