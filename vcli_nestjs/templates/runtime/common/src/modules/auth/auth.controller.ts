import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { parseInput } from '../../core/http/parse-input.js';
import { credentialInputs, credentialRequestBody } from './auth-inputs.js';
import { AuthGuard, type AuthenticatedRequest } from './auth.guard.js';
import { AuthService } from './auth.service.js';

@ApiTags('Local authentication')
@Controller()
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Post('identity/local/register')
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Register a new account with a password' })
  @ApiBody(credentialRequestBody)
  async register(@Body() body: unknown, @Req() request: Request) {
    const credentials = parseInput(
      credentialInputs[this.auth.identifierKind],
      body,
    );
    await this.auth.register(
      credentials,
      request.socket.remoteAddress ?? 'unknown',
    );
    return { status: 'accepted' };
  }

  @Post('identity/local/login')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Log in and receive an expiring bearer token' })
  @ApiBody(credentialRequestBody)
  login(@Body() body: unknown, @Req() request: Request) {
    const credentials = parseInput(
      credentialInputs[this.auth.identifierKind],
      body,
    );
    return this.auth.login(
      credentials,
      request.socket.remoteAddress ?? 'unknown',
    );
  }

  @Get('accounts/me')
  @Header('Cache-Control', 'no-store')
  @UseGuards(AuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Read the authenticated account profile' })
  current(@Req() request: AuthenticatedRequest) {
    return request.authAccount;
  }
}
