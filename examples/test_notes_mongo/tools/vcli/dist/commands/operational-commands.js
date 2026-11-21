import { registerDevCommand } from './dev-commands.js';
import { registerReleaseCommands } from './release-commands.js';
import { registerServicesCommands } from './services-commands.js';
export function registerOperationalCommands(program, context, execution = {}) {
    const environment = execution.environment ?? (() => ({ ...process.env }));
    registerServicesCommands(program, context, execution, environment);
    registerDevCommand(program, context, execution, environment);
    registerReleaseCommands(program, context, execution, environment);
}
//# sourceMappingURL=operational-commands.js.map