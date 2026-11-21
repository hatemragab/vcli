const collect = (value, values) => [...values, value];
export function applyOptions(command) {
    return command
        .option('--dry-run', 'Preview without writes, installs or probes')
        .option('--save-plan <file>', 'Explicitly save a private plan without applying it')
        .option('--skip-install', 'Apply source and record installation pending')
        .option('--offline', 'Use only cached dependencies during installation')
        .option('--check', 'Run the generated declared checks after source/install');
}
export function capabilityOptions(command) {
    return command
        .option('--database <provider>', 'mongodb or postgres, selected once')
        .option('--auth <provider>', 'local or firebase')
        .option('--local-identifier <identifier>', 'Local auth: email (requires mail) or username (no email actions)')
        .option('--mail <provider>', 'capture (development/test only), smtp or http (Resend)')
        .option('--reliable-actions', 'Encrypted database-backed action mail intents')
        .option('--storage <provider>', 'local, aws-s3 or r2')
        .option('--media', 'Private owned media (requires database/auth/storage)')
        .option('--notes', 'Owned notes example (requires database/auth)')
        .option('--upload-modes <modes>', 'Comma-separated mediated,presigned,multipart')
        .option('--realtime <provider>', 'socket-io, native-ws or centrifugo')
        .option('--realtime-scale <profile>', 'single-instance or supported cluster')
        .option('--push <providers>', 'fcm, apns or fcm,apns')
        .option('--diagnostics', 'Bounded local evidence')
        .option('--evidence-sources <sources>', 'application,workers,database,infrastructure,tests')
        .option('--test-evidence', 'Retain scoped assertion metadata; requires tests source')
        .option('--diagnostic-reader <profile>', 'local-same-user or restricted-remote-read')
        .option('--mcp', 'Read-only local diagnostics MCP')
        .option('--vector', 'Selected Vector artifacts')
        .option('--logdy', 'Selected Logdy artifacts')
        .option('--deploy <target>', 'dokploy, coolify or caprover artifacts')
        .option('--firebase-methods <methods>', 'Comma-separated email-password,phone,google,apple')
        .option('--action-delivery <mode>', 'Firebase action email mode')
        .option('--with <recipe>', 'Also explicitly select a required recipe', collect, []);
}
export { collect };
//# sourceMappingURL=command-options.js.map