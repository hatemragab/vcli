import { file } from './bundle.js';
import { formatFiles } from './format-files.js';
import { selection } from './selection.js';
import { projectChecks } from './project-checks.js';
export const injectableCapabilities = {
    notes: { service: 'NotesService', file: '../notes/notes.service.js' },
    mail: { service: 'MailService', file: '../mail/mail.service.js' },
    storage: { service: 'StorageService', file: '../storage/storage.service.js' },
    realtime: {
        service: 'RealtimeService',
        file: '../realtime/realtime.service.js',
    },
    push: { service: 'PushService', file: '../push/push.service.js' },
};
export const scaffoldKinds = [
    'feature',
    'service',
    'controller',
    'dto',
    'repository',
    'command',
    'query',
    'realtime',
];
export async function renderScaffold(config, request) {
    if (!scaffoldKinds.includes(request.kind))
        throw new Error('UNKNOWN_SCAFFOLD_KIND');
    if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(request.name) ||
        request.name.length > 64 ||
        [
            'core',
            'generated',
            'health',
            'identity',
            'accounts',
            'installations',
            'sessions',
            'storage',
            'media',
            'push',
            'realtime',
            'mail',
            'notes',
            'diagnostics',
            'constructor',
            'prototype',
            '__proto__',
        ].includes(request.name))
        throw new Error('INVALID_OR_RESERVED_SCAFFOLD_NAME');
    const name = request.name, type = name
        .split('-')
        .map((part) => part[0].toUpperCase() + part.slice(1))
        .join('');
    const files = [];
    const uses = [...new Set(request.uses ?? [])].sort();
    if (uses.length && request.kind !== 'feature')
        throw new Error('CAPABILITY_IMPORTS_REQUIRE_FEATURE_SCAFFOLD');
    for (const name of uses) {
        if (!Object.hasOwn(injectableCapabilities, name))
            throw new Error('UNSUPPORTED_SCAFFOLD_CAPABILITY');
        if (!(name === 'push'
            ? selection(config, 'push-fcm') || selection(config, 'push-apns')
            : selection(config, name)))
            throw new Error('SCAFFOLD_CAPABILITY_NOT_SELECTED');
    }
    const capabilities = uses.map((name) => ({
        name,
        ...injectableCapabilities[name],
    }));
    const serviceImports = capabilities
        .map((capability) => `import {${capability.service}} from '${capability.file}';`)
        .join('\n');
    const serviceParameters = capabilities
        .map((capability) => `@Inject(${capability.service}) protected readonly ${capability.name}:${capability.service}`)
        .join(',');
    const pending = [
        `Integrate ${type} explicitly in AppCustomModule; configured capability modules must be imported by each consumer. No custom source was rewritten.`,
    ];
    if (uses.length)
        pending.push(`Pass configured ${uses.join(', ')} module handles to ${type}Module.register${selection(config, 'database') ? '(capabilities.database!, ' : '('}{${uses.map((name) => `${name}:capabilities.${name}!`).join(',')}}) in AppCustomModule.register. No consumer source is rewritten.`);
    const add = (suffix, source) => files.push(file(`src/modules/${name}/${name}.${suffix}.ts`, source, 'scaffold'));
    if (request.kind === 'repository' ||
        (request.kind === 'feature' && selection(config, 'database'))) {
        if (!selection(config, 'database'))
            throw new Error('DATABASE_REQUIRED_FOR_REPOSITORY');
        const mongo = selection(config, 'database') === 'database.mongodb', database = mongo ? 'MongoDatabase' : 'PostgresDatabase';
        if (mongo)
            add('entity', `import {Schema} from 'mongoose';
export type ${type}=Readonly<{id:string}>;
export const ${camel(type)}Schema=new Schema<${type}>({id:{type:String,required:true,unique:true}},{collection:'${name.replaceAll('-', '_')}',versionKey:false,strict:'throw',autoCreate:false,autoIndex:false});
${camel(type)}Schema.add(new Schema({_id:String}));
`);
        else
            add('entity', `import {pgTable,uuid} from 'drizzle-orm/pg-core';
export const ${camel(type)}Table=pgTable('${name.replaceAll('-', '_')}',{id:uuid('id').primaryKey()});
export type ${type}=typeof ${camel(type)}Table.$inferSelect;
`);
        const suffix = request.kind === 'feature' ? 'service' : 'repository', className = type + (suffix === 'service' ? 'Service' : 'Repository');
        add(suffix, `import {Injectable,Inject} from '@nestjs/common';
import {BaseRepository} from '../../core/database/base-repository.js';
import {${database}} from '../../core/database/${mongo ? 'mongo' : 'postgres'}-database.js';
${mongo ? '' : "import {getTableColumns} from 'drizzle-orm';"}
import {${camel(type)}${mongo ? 'Schema' : 'Table'},type ${type}} from './${name}.entity.js';
${serviceImports}
/** Internal owner service. Define actor policy and invariants before exposing operations. */
@Injectable()
export class ${className} extends BaseRepository<${type}>{constructor(@Inject(${database}) database:${database}${serviceParameters ? ',' + serviceParameters : ''}){super(database,${mongo ? `'${type}',${camel(type)}Schema` : `{table:${camel(type)}Table,columns:{...getTableColumns(${camel(type)}Table)},conflictTargets:[['id']]}`});}}
`);
        add('module', moduleSource(type, className, name, suffix, true, uses));
        pending.push(mongo
            ? `Initialize the ${camel(type)}Schema collection/indexes with a preserving migration; activate ${type}Module.register with the configured database${uses.length ? ' and declared capability handles' : ''} from AppCustomModule.register before using it.`
            : `Add and review a preserving SQL migration for ${camel(type)}Table; activate ${type}Module.register with the configured database${uses.length ? ' and declared capability handles' : ''} from AppCustomModule.register before using it.`);
    }
    else if (request.kind === 'feature' ||
        request.kind === 'service' ||
        request.kind === 'command' ||
        request.kind === 'query') {
        const suffix = request.kind === 'feature' ? 'service' : request.kind, className = type + suffix[0].toUpperCase() + suffix.slice(1);
        add(suffix, `import {Injectable${uses.length ? ',Inject' : ''}} from '@nestjs/common';
${serviceImports}
/** Define the operation contract before adding a transport route or event handler. */
@Injectable()
export class ${className}{${serviceParameters ? `constructor(${serviceParameters}){}` : ''}async execute(_input:Readonly<Record<string,never>>):Promise<never>{throw new Error('${name.toUpperCase().replaceAll('-', '_')}_NOT_IMPLEMENTED');}}
`);
        if (request.kind === 'feature')
            add('module', moduleSource(type, className, name, suffix, false, uses));
        pending.push('Implement typed input, verified actor policy, owner invariants and an explicit result; unfinished execute throws and is unexposed.');
    }
    else if (request.kind === 'controller') {
        add('controller', `import {Controller} from '@nestjs/common';
/** No routes: define validated inputs, verified actor policy and a service contract first. */
@Controller()
export class ${type}Controller {}
`);
        pending.push('Choose and implement explicit HTTP operations; this controller exposes no route.');
    }
    else if (request.kind === 'dto') {
        add('dto', `import {z} from 'zod';
// Add explicitly approved transport fields; unknown keys are rejected.
export const ${camel(type)}Input=z.strictObject({});
export class ${type}Dto {static parse(input:unknown):${type}Dto{${camel(type)}Input.parse(input);return new ${type}Dto();}}
`);
        pending.push('Define the actual transport schema and mapping before using this empty strict input.');
    }
    else {
        if (!selection(config, 'auth') || !selection(config, 'realtime'))
            throw new Error('AUTH_AND_REALTIME_REQUIRED');
        add('realtime', `import {Injectable} from '@nestjs/common';
import {RealtimeService} from '../realtime/realtime.service.js';
import type {ApplicationEvent,PublicationOutcome} from '../../core/realtime/event-publisher.js';
@Injectable()
export class ${type}Realtime {constructor(private readonly realtime:RealtimeService){} publish(accountId:string,event:ApplicationEvent):Promise<PublicationOutcome>{return this.realtime.publish(accountId,event);}}
`);
        pending.push(`Import the configured RealtimeModule in the consuming module and authorize each publication using trusted owner state; no socket handler or route was invented.`);
    }
    return {
        files: await formatFiles(files.sort((a, b) => a.path.localeCompare(b.path))),
        checks: projectChecks(),
        warnings: [
            'Scaffold output is unfinished developer-owned code, not a business operation acceptance record.',
        ],
        pending,
    };
}
function camel(value) {
    return value[0].toLowerCase() + value.slice(1);
}
function moduleSource(type, provider, name, suffix, dataOwner = false, uses = []) {
    const configured = dataOwner || uses.length > 0;
    const options = uses.length
        ? `capabilities:Readonly<Record<${uses.map((name) => `'${name}'`).join('|')},DynamicModule>>`
        : '';
    const parameters = [dataOwner ? 'database:DynamicModule' : '', options]
        .filter(Boolean)
        .join(',');
    const imports = [
        dataOwner ? 'database' : '',
        ...uses.map((name) => `capabilities.${name}`),
    ]
        .filter(Boolean)
        .join(',');
    return `import {Module${configured ? ',type DynamicModule' : ''}} from '@nestjs/common';
import {${provider}} from './${name}.${suffix}.js';
// Import configured capability modules explicitly before activation.
${configured
        ? `@Module({})
export class ${type}Module {static register(${parameters}):DynamicModule{return {module:${type}Module,imports:[${imports}],providers:[${provider}],exports:[${provider}]};}}`
        : `@Module({providers:[${provider}],exports:[${provider}]})
export class ${type}Module {}`}
`;
}
//# sourceMappingURL=render-scaffold.js.map