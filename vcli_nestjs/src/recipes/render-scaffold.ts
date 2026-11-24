import type {
  ProjectConfig,
  RenderedFile,
  RenderedProject,
} from '../contracts.js';
import { file } from './bundle.js';
import { formatFiles } from './format-files.js';
import { basicLocalAuth, selection } from './selection.js';
import { projectChecks } from './project-checks.js';
export type ScaffoldKind =
  | 'feature'
  | 'service'
  | 'controller'
  | 'dto'
  | 'repository'
  | 'command'
  | 'query'
  | 'realtime';
export interface ScaffoldRequest {
  kind: ScaffoldKind;
  name: string;
  uses?: readonly string[];
}
export const injectableCapabilities = {
  notes: {
    service: 'NotesService',
    file: '../notes/notes.service.js',
    module: 'NotesModule',
  },
  mail: {
    service: 'MailService',
    file: '../mail/mail.service.js',
    module: 'MailModule',
  },
  storage: {
    service: 'StorageService',
    file: '../storage/storage.service.js',
    module: 'StorageModule',
  },
  media: {
    service: 'MediaService',
    file: '../media/media.service.js',
    module: 'MediaModule',
  },
  realtime: {
    service: 'RealtimeService',
    file: '../realtime/realtime.service.js',
    module: 'RealtimeModule',
  },
  push: {
    service: 'PushService',
    file: '../push/push.service.js',
    module: 'PushModule',
  },
} as const;
type ModuleImport = Readonly<{ symbol: string; path: string }>;
const databaseModule: ModuleImport = {
  symbol: 'DatabaseModule',
  path: '../../core/database/database.module.js',
};
export const scaffoldKinds: readonly string[] = [
  'feature',
  'service',
  'controller',
  'dto',
  'repository',
  'command',
  'query',
  'realtime',
];
export async function renderScaffold(
  config: ProjectConfig,
  request: ScaffoldRequest,
): Promise<RenderedProject> {
  if (!scaffoldKinds.includes(request.kind))
    throw new Error('UNKNOWN_SCAFFOLD_KIND');
  if (
    !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(request.name) ||
    request.name.length > 64 ||
    (request.name === 'auth' && basicLocalAuth(config)) ||
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
    ].includes(request.name)
  )
    throw new Error('INVALID_OR_RESERVED_SCAFFOLD_NAME');
  const name = request.name,
    type = name
      .split('-')
      .map((part) => part[0]!.toUpperCase() + part.slice(1))
      .join('');
  const files: RenderedFile[] = [];
  const uses = [...new Set(request.uses ?? [])].sort();
  if (uses.length && request.kind !== 'feature')
    throw new Error('CAPABILITY_IMPORTS_REQUIRE_FEATURE_SCAFFOLD');
  for (const name of uses) {
    if (!Object.hasOwn(injectableCapabilities, name))
      throw new Error('UNSUPPORTED_SCAFFOLD_CAPABILITY');
    if (
      !(name === 'push'
        ? selection(config, 'push-fcm') || selection(config, 'push-apns')
        : selection(config, name))
    )
      throw new Error('SCAFFOLD_CAPABILITY_NOT_SELECTED');
  }
  const capabilities = uses.map((name) => ({
    name,
    ...injectableCapabilities[name as keyof typeof injectableCapabilities],
  }));
  const serviceImports = capabilities
    .map(
      (capability) =>
        `import {${capability.service}} from '${capability.file}';`,
    )
    .join('\n');
  const serviceParameters = capabilities
    .map(
      (capability) =>
        `@Inject(${capability.service}) protected readonly ${capability.name}:${capability.service}`,
    )
    .join(',');
  const capabilityModules = capabilities.map(({ name, module }) => ({
    symbol: module,
    path: `../${name}/${name}.module.js`,
  }));
  const pending: string[] = [];
  if (request.kind === 'feature' || request.kind === 'repository')
    pending.push(
      `Add ${type}Module to the imports of AppCustomModule in src/app.custom.module.ts when the feature is ready.`,
    );
  const add = (suffix: string, source: string) =>
    files.push(
      file(`src/modules/${name}/${name}.${suffix}.ts`, source, 'scaffold'),
    );
  if (
    request.kind === 'repository' ||
    (request.kind === 'feature' && selection(config, 'database'))
  ) {
    if (!selection(config, 'database'))
      throw new Error('DATABASE_REQUIRED_FOR_REPOSITORY');
    const mongo = selection(config, 'database') === 'database.mongodb',
      database = mongo ? 'MongoDatabase' : 'PostgresDatabase';
    if (mongo)
      add(
        'entity',
        `import {Schema} from 'mongoose';
export type ${type}=Readonly<{id:string}>;
const fields={
  _id:{type:String,required:true},
  id:{type:String,required:true,unique:true},
};
export const ${camel(type)}Schema=new Schema<${type}>(fields,{
  collection:'${name.replaceAll('-', '_')}',
  versionKey:false,
  strict:'throw',
  autoCreate:false,
  autoIndex:false,
});
`,
      );
    else
      add(
        'entity',
        `import {pgTable,uuid} from 'drizzle-orm/pg-core';
export const ${camel(type)}Table=pgTable('${name.replaceAll('-', '_')}',{id:uuid('id').primaryKey()});
export type ${type}=typeof ${camel(type)}Table.$inferSelect;
`,
      );
    const suffix = request.kind === 'feature' ? 'service' : 'repository',
      className = type + (suffix === 'service' ? 'Service' : 'Repository');
    add(
      suffix,
      `import {Injectable,Inject} from '@nestjs/common';
import {BaseRepository} from '../../core/database/base-repository.js';
import {${database}} from '../../core/database/${mongo ? 'mongo' : 'postgres'}-database.js';
${mongo ? '' : "import {getTableColumns} from 'drizzle-orm';"}
import {${camel(type)}${mongo ? 'Schema' : 'Table'},type ${type}} from './${name}.entity.js';
${serviceImports}
/** Internal owner service. Define actor policy and invariants before exposing operations. */
@Injectable()
export class ${className} extends BaseRepository<${type}>{constructor(@Inject(${database}) database:${database}${serviceParameters ? ',' + serviceParameters : ''}){super(database,${mongo ? `'${type}',${camel(type)}Schema` : `{table:${camel(type)}Table,columns:{...getTableColumns(${camel(type)}Table)},conflictTargets:[['id']]}`});}}
`,
    );
    add(
      'module',
      moduleSource(type, className, name, suffix, [
        databaseModule,
        ...capabilityModules,
      ]),
    );
    pending.push(
      mongo
        ? `Initialize the ${camel(type)}Schema collection and indexes before enabling the feature.`
        : `Define and apply the schema for ${camel(type)}Table before enabling the feature.`,
    );
    if (request.kind === 'feature') {
      add(
        'seed',
        `import type { ModuleSeeder } from '../../core/database/module-seeder.js';
import { ApplicationError } from '../../core/errors/application-error.js';

/**
 * Define fixture prerequisites, validation and insert-if-missing operations in this feature.
 * When ready, import seed${type} in src/seed/custom-seeders.ts and add
 * { module: '${name}', run: seed${type} } to customSeeders.
 */
export const seed${type}: ModuleSeeder = async (_database) => {
  throw new ApplicationError('SEED_FIXTURES_NOT_IMPLEMENTED');
};
`,
      );
      pending.push(
        `After implementing fixtures in src/modules/${name}/${name}.seed.ts, import seed${type} from '../modules/${name}/${name}.seed.js' in src/seed/custom-seeders.ts and add { module: '${name}', run: seed${type} } to customSeeders.`,
      );
    }
  } else if (
    request.kind === 'feature' ||
    request.kind === 'service' ||
    request.kind === 'command' ||
    request.kind === 'query'
  ) {
    const suffix = request.kind === 'feature' ? 'service' : request.kind,
      className = type + suffix[0]!.toUpperCase() + suffix.slice(1);
    add(
      suffix,
      `import {Injectable${uses.length ? ',Inject' : ''}} from '@nestjs/common';
${serviceImports}
/** Define the operation contract before adding a transport route or event handler. */
@Injectable()
export class ${className}{${serviceParameters ? `constructor(${serviceParameters}){}` : ''}async execute(_input:Readonly<Record<string,never>>):Promise<never>{throw new Error('${name.toUpperCase().replaceAll('-', '_')}_NOT_IMPLEMENTED');}}
`,
    );
    if (request.kind === 'feature')
      add(
        'module',
        moduleSource(type, className, name, suffix, capabilityModules),
      );
    pending.push(
      'Implement typed input, verified actor policy, owner invariants and an explicit result; unfinished execute throws and is unexposed.',
    );
  } else if (request.kind === 'controller') {
    add(
      'controller',
      `import {Controller} from '@nestjs/common';
/** No routes: define validated inputs, verified actor policy and a service contract first. */
@Controller()
export class ${type}Controller {}
`,
    );
    pending.push(
      'Choose and implement explicit HTTP operations; this controller exposes no route.',
    );
  } else if (request.kind === 'dto') {
    add(
      'dto',
      `import {z} from 'zod';
// Add explicitly approved transport fields; unknown keys are rejected.
export const ${camel(type)}Input=z.strictObject({});
export class ${type}Dto {static parse(input:unknown):${type}Dto{${camel(type)}Input.parse(input);return new ${type}Dto();}}
`,
    );
    pending.push(
      'Define the actual transport schema and mapping before using this empty strict input.',
    );
  } else {
    if (!selection(config, 'auth') || !selection(config, 'realtime'))
      throw new Error('AUTH_AND_REALTIME_REQUIRED');
    add(
      'realtime',
      `import {Injectable} from '@nestjs/common';
import {RealtimeService} from '../realtime/realtime.service.js';
import type {ApplicationEvent,PublicationOutcome} from '../../core/realtime/event-publisher.js';
@Injectable()
export class ${type}Realtime {constructor(private readonly realtime:RealtimeService){} publish(accountId:string,event:ApplicationEvent):Promise<PublicationOutcome>{return this.realtime.publish(accountId,event);}}
`,
    );
    pending.push(
      'Import RealtimeModule in the consuming module and authorize each publication using trusted owner state.',
    );
  }
  return {
    files: await formatFiles(
      files.sort((a, b) => a.path.localeCompare(b.path)),
    ),
    checks: projectChecks(),
    warnings: [
      'Scaffold output is unfinished developer-owned code, not a business operation acceptance record.',
    ],
    pending,
  };
}
function camel(value: string): string {
  return value[0]!.toLowerCase() + value.slice(1);
}
function moduleSource(
  type: string,
  provider: string,
  name: string,
  suffix: string,
  dependencies: readonly ModuleImport[],
): string {
  const moduleName = `${type}Module`;
  const imports = dependencies.map(({ symbol, path }) => ({
    symbol,
    path,
    localName: symbol === moduleName ? `Vcli${symbol}` : symbol,
  }));
  const moduleImports = imports
    .map(
      ({ symbol, path, localName }) =>
        `import {${symbol}${symbol === localName ? '' : ` as ${localName}`}} from '${path}';`,
    )
    .join('\n');
  const importMetadata = imports.length
    ? `imports:[${imports.map(({ localName }) => localName).join(',')}],`
    : '';
  return `import {Module} from '@nestjs/common';
${moduleImports}
import {${provider}} from './${name}.${suffix}.js';
@Module({${importMetadata}providers:[${provider}],exports:[${provider}]})
export class ${moduleName} {}
`;
}
