function own(renderer, rendered) {
    for (const item of rendered) {
        const template = item.provenance?.template;
        item.provenance = {
            renderer,
            ...(template ? { template } : {}),
        };
    }
    return [...rendered];
}
import { file, runtime } from './bundle.js';
import { checkFiles } from './render-checks.js';
import { configuration } from './render-config.js';
import { foundationFiles } from './render-foundation.js';
import { identityFiles } from './render-identity.js';
import { identityJobFiles } from './render-identity-job.js';
import { firebaseMailFiles } from './render-mail.js';
import { schemaFiles } from './render-schema.js';
import { renderReleaseFiles } from './render-release.js';
import { httpDocsFile } from './render-http-docs.js';
import { mailFiles, mediaFiles, pushFiles, storageFiles, } from './render-capabilities.js';
import { realtimeFiles } from './render-realtime.js';
import { notesFiles } from './render-notes.js';
import { diagnosticsFiles } from './render-diagnostics.js';
import { deploymentFiles } from './render-deployment.js';
import { serviceFiles } from './render-services.js';
import { packageFile } from './render-package.js';
import { compositionFile } from './render-composition.js';
import { selectedGuidance } from './selected-guidance.js';
import { formatFiles } from './format-files.js';
import { selection, usernameAuth, validateSelection } from './selection.js';
import { projectChecks } from './project-checks.js';
export async function renderProject(config, resolved) {
    validateSelection(config, resolved);
    // Use validated canonical defaults, never caller order, for deterministic rendering.
    const canonical = {
        ...config,
        capabilities: Object.fromEntries(Object.entries(config.capabilities).map(([family, value]) => [
            family,
            {
                recipe: value.recipe,
                options: resolved
                    .find((r) => r.id === value.recipe)
                    .validateOptions(value.options),
            },
        ])),
    };
    const files = own('foundation.nest', await foundationFiles(canonical));
    const env = configuration(canonical);
    files.push(...own('config', env.files));
    const pending = [];
    const warnings = [];
    if (selection(canonical, 'database')) {
        const mongo = selection(canonical, 'database') === 'database.mongodb';
        const variant = mongo ? 'mongodb' : 'postgres';
        for (const name of [
            'base-repository.ts',
            'repository-types.ts',
            'transaction-context.ts',
            'database-errors.ts',
            'database.ts',
            `${mongo ? 'mongo' : 'postgres'}-database.ts`,
        ])
            files.push(...own(selection(canonical, 'database') ?? 'database', [
                await runtime('src/core/database/' + name, variant),
            ]));
        const name = mongo ? 'MongoDatabase' : 'PostgresDatabase';
        files.push(...own(selection(canonical, 'database') ?? 'database', [
            file('src/core/database/database.module.ts', `import {Module,type DynamicModule} from '@nestjs/common';
import {${name}} from './${mongo ? 'mongo' : 'postgres'}-database.js';
@Module({})
export class DatabaseModule {static register(database:${name}):DynamicModule{return {module:DatabaseModule,providers:[{provide:${name},useValue:database}],exports:[${name}]};}}
`),
        ]));
        pending.push(mongo
            ? 'Configure MongoDB replica set or sharded transactional topology; initialize selected schemas before boot.'
            : 'Configure PostgreSQL and run selected reviewed migrations before boot.');
    }
    if (selection(canonical, 'mail')) {
        files.push(...own(selection(canonical, 'mail') ?? 'mail', await mailFiles(canonical)));
        if (selection(canonical, 'mail') === 'mail.capture')
            warnings.push('Mail capture is for development/test only. Production startup rejects it. For a new production project, choose --mail smtp or --mail http during init.');
        else
            pending.push(selection(canonical, 'mail') === 'mail.http'
                ? 'Supply the selected Resend API credential privately and verify domain/provider/inbox acceptance separately.'
                : 'Inject SMTP host and optional paired credentials; accept TLS/provider/inbox behavior independently.');
    }
    if (selection(canonical, 'auth')) {
        files.push(...own(selection(canonical, 'auth') ?? 'auth', [
            ...(await identityFiles(canonical)),
            httpDocsFile(canonical),
        ]));
        if (usernameAuth(canonical))
            warnings.push('Username/password authentication has no email verification or forgotten-password recovery. No email ownership is claimed; authenticated current-password change is available.');
        if (selection(canonical, 'auth') === 'auth.firebase')
            pending.push('Configure Firebase project ADC and selected client sign-in/action settings. Verify each provider/client method and account cleanup independently; local policy tests are not Firebase acceptance.');
        else
            pending.push('Supply private JWT_KEYS_JSON and JWT_ACTIVE_KID with independently generated keys. Retain overlap keys through token and backup lifetimes; clients singleflight refresh and reauthenticate after an ambiguous response.');
    }
    if (selection(canonical, 'auth') === 'auth.firebase')
        files.push(...own('auth.firebase', [
            ...(await firebaseMailFiles(canonical)),
            ...identityJobFiles(canonical),
        ]));
    if (canonical.capabilities.mail?.options.reliableActions === true)
        pending.push('Supply the private delivery encryption key ring, initialize mail schema and run the bounded mail:drain command regularly; unknown outcomes require explicit reconciliation.');
    if (selection(canonical, 'storage')) {
        files.push(...own(selection(canonical, 'storage') ?? 'storage', await storageFiles(canonical)));
        pending.push(selection(canonical, 'storage') === 'storage.local'
            ? 'Provide a private writable durable local storage directory.'
            : 'Provide a private writable staging directory plus selected object-store bucket, credentials and permission policy; accept conditional immutable-write behavior against the named provider.');
        warnings.push('Storage emits only the selected transfer modes. Named AWS/R2 provider acceptance and permissions remain separate; arbitrary custom S3 profiles are unsupported.');
    }
    if (selection(canonical, 'media'))
        files.push(...own(selection(canonical, 'media') ?? 'media', await mediaFiles(canonical)));
    if (selection(canonical, 'notes'))
        files.push(...own(selection(canonical, 'notes') ?? 'notes', await notesFiles(canonical)));
    if (selection(canonical, 'push-fcm') || selection(canonical, 'push-apns')) {
        files.push(...own(selection(canonical, 'push-fcm') ??
            selection(canonical, 'push-apns') ??
            'push', await pushFiles(canonical)));
        pending.push('Configure selected push credentials and accept each purpose/client/device separately. FCM acceptance does not establish notification display.');
        warnings.push('Push dispatch is immediate and fenced by current ownership; a durable queued dispatcher is not implemented.');
    }
    if (selection(canonical, 'realtime')) {
        files.push(...own(selection(canonical, 'realtime') ?? 'realtime', await realtimeFiles(canonical)));
        pending.push('Import the configured RealtimeModule explicitly in custom consumers, recover authoritative owner state after connection loss, and accept the selected protocol.');
        if (selection(canonical, 'realtime') === 'realtime.centrifugo')
            pending.push('Configure and run Centrifugo with ops/centrifugo/config.json; inject separate API/proxy secrets and restrict internal proxy endpoints.');
        warnings.push('Realtime hints require authoritative state recovery after loss. Native shared tickets and selected cluster adapters do not provide durable delivery or replay; accept separate-node revocation and provider topology independently.');
    }
    if (selection(canonical, 'diagnostics')) {
        files.push(...own(selection(canonical, 'diagnostics') ?? 'diagnostics', await diagnosticsFiles(canonical)));
        warnings.push('Diagnostic evidence is bounded, sanitized and may contain gaps. Restricted remote reads require a private scoped profile and independently verified HTTPS boundary; isolated/shared-production profiles are unsupported.');
        if (canonical.capabilities.diagnostics.options.vector)
            pending.push('Run the selected Vector configuration separately and validate collection boundaries; app startup does not start Vector.');
        if (canonical.capabilities.diagnostics.options.logdy)
            pending.push('Install reviewed Logdy separately; bind its UI to loopback and its private feed to the configured Vector network.');
    }
    if (selection(canonical, 'deployment')) {
        files.push(...own(selection(canonical, 'deployment') ?? 'deployment', deploymentFiles(canonical, env.fields)));
        pending.push('Use the reviewed target profile with deploy discover/plan/apply/inspect/reconcile/verify. Plans require exact external resource references and explicit private-network, ingress, volume and exclusive-writer evidence; real target/TLS/persistence acceptance remains separate.');
    }
    files.push(...own('services', serviceFiles(canonical, env.fields)));
    files.push(...own('release', await renderReleaseFiles(canonical)));
    files.push(...own('schema', schemaFiles(canonical)));
    files.push(...own('checks', await checkFiles(canonical)));
    files.push(...own('composition', [compositionFile(canonical)]));
    files.push(...own('package', [packageFile(canonical, files)]));
    files.push(...own('guidance', selectedGuidance(canonical, warnings, pending)));
    const unique = new Map();
    for (const item of files) {
        if (unique.has(item.path))
            throw new Error('DUPLICATE_RENDERED_PATH:' + item.path);
        unique.set(item.path, item);
    }
    return {
        files: await formatFiles([...unique.values()].sort((a, b) => a.path.localeCompare(b.path))),
        checks: projectChecks(),
        warnings,
        pending,
    };
}
//# sourceMappingURL=render-project.js.map