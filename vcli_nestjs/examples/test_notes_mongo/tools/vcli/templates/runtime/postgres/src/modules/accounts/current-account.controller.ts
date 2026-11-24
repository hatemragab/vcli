import { Controller, Get, Header, Inject, UseGuards } from '@nestjs/common';
import { PrincipalGuard } from '../../core/http/principal.guard.js';
import { CurrentPrincipal } from '../../core/http/current-principal.decorator.js';
import type { Principal } from '../../core/auth/principal.js';
import { AccountService } from './account.service.js';
@Controller('accounts')
@UseGuards(PrincipalGuard)
export class CurrentAccountController {
  constructor(
    @Inject(AccountService) private readonly account: AccountService,
  ) {}
  @Get('me')
  @Header('Cache-Control', 'no-store')
  read(@CurrentPrincipal() actor: Principal) {
    return this.account.current(actor);
  }
}
