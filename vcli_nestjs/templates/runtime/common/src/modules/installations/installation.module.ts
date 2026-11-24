import { Module } from '@nestjs/common';
import { bootstrapBinding } from '../../core/bootstrap/bootstrap-bindings.js';
import { InstallationService } from './installation.service.js';

const installationServiceBinding = bootstrapBinding(InstallationService);
export const bindInstallationService = installationServiceBinding.bind;

@Module({
  providers: [installationServiceBinding.provider],
  exports: [InstallationService],
})
export class InstallationModule {}
