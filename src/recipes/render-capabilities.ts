import type { ProjectConfig, RenderedFile } from '../contracts.js';
import { bundled, file, runtime } from './bundle.js';
import { retainSelectedMediaRoutes } from './media-routes.js';
import { selection } from './selection.js';
import {
  removeBetween,
  replaceExact,
  requireIndex,
  sliceFrom,
} from './template-markers.js';

export { mailFiles } from './render-mail.js';

export async function storageFiles(
  config: ProjectConfig,
): Promise<RenderedFile[]> {
  const local = selection(config, 'storage') === 'storage.local';
  const profile = selection(config, 'storage') === 'storage.r2' ? 'r2' : 'aws';
  const modes = config.capabilities.media?.options.modes ?? ['mediated'];
  const supported = local
    ? ['mediated']
    : profile === 'aws'
      ? ['mediated', 'presigned', 'multipart']
      : ['mediated', 'multipart'];
  if (
    !Array.isArray(modes) ||
    !modes.length ||
    modes.some((mode) => typeof mode !== 'string' || !supported.includes(mode))
  )
    throw new Error('UNSUPPORTED_UPLOAD_MODE');
  const direct = modes.includes('presigned');
  const paths = [
    'private-filesystem.ts',
    'bounded-stream.ts',
    'local-storage.service.ts',
    'storage.entity.ts',
    'storage-capabilities.ts',
    'storage-provider.ts',
    'storage.service.ts',
    ...(!local ? ['s3-storage.service.ts', 's3-multipart.ts'] : []),
    ...(direct ? ['aws-post-policy.ts'] : []),
  ];
  const files = await Promise.all(
    paths.map((path) => bundled('src/modules/storage/' + path)),
  );
  const entity = files.find((entry) =>
    entry.path.endsWith('storage.entity.ts'),
  )!;
  const tail = sliceFrom(entity.content, 'export type UploadMode', entity.path);
  entity.content = `export type StorageProfile = Readonly<${
    local
      ? "{version:1;driver:'local';root:string}"
      : `{version:1;driver:'s3';profile:'${profile}';bucket:string;region:string;endpoint?:string;forcePathStyle:boolean}`
  } >;\n${tail}`;
  const capabilities = files.find((entry) =>
    entry.path.endsWith('storage-capabilities.ts'),
  )!;
  const selected = local ? 'local' : profile;
  const begin = requireIndex(
    capabilities.content,
    `  // BEGIN ${selected}`,
    capabilities.path,
  );
  const endMarker = `  // END ${selected}`;
  const end = requireIndex(
    capabilities.content,
    endMarker,
    capabilities.path,
    begin,
  );
  const selectedDescriptor = capabilities.content.slice(
    begin,
    end + endMarker.length,
  );
  const objectStart =
    requireIndex(capabilities.content, 'Object.freeze({', capabilities.path) +
    'Object.freeze({'.length;
  const objectEnd = requireIndex(
    capabilities.content,
    '\n} as const);',
    capabilities.path,
    objectStart,
  );
  capabilities.content =
    capabilities.content.slice(0, objectStart) +
    '\n' +
    selectedDescriptor +
    capabilities.content.slice(objectEnd);
  files.push(
    file(
      'src/modules/storage/storage.module.ts',
      `import {Module,type DynamicModule} from '@nestjs/common';
import type {AppConfig} from '../../core/config/app-config.js';
import type {StorageProfile} from './storage.entity.js';
import {LocalStorageService} from './local-storage.service.js';
import {StorageService} from './storage.service.js';
${local ? '' : "import {S3StorageService} from './s3-storage.service.js';"}
${direct ? "import {createAwsPostGrant} from './aws-post-policy.js';" : ''}
${local ? '' : `const providerFactory=(profile:StorageProfile)=>new S3StorageService(profile,${direct ? '{directPost:createAwsPostGrant}' : '{}'});`}
export function selectedStorageProfile(${local ? '_config' : 'config'}:AppConfig,${local ? 'root' : '_root'}:string):StorageProfile{return ${local ? "{version:1,driver:'local',root}" : `{version:1,driver:'s3',profile:'${profile}',bucket:config.storage.bucket,region:config.storage.region,endpoint:config.storage.endpoint,forcePathStyle:config.storage.forcePathStyle}`};}
@Module({})
export class StorageModule {
  static register(service:StorageService=new StorageService(new LocalStorageService())):DynamicModule {
    ${local ? '' : 'service.configureProviders(providerFactory);'}
    return {module:StorageModule,providers:[{provide:StorageService,useValue:service}],exports:[StorageService]};
  }
}
`,
    ),
  );
  const setup = await bundled('ops/storage/private-storage-setup.md');
  // Select the relevant setup paragraph; common filesystem/cleanup/serving requirements remain.
  setup.content = setup.content
    .split('\n\n')
    .filter((paragraph) => {
      if (paragraph.startsWith('AWS S3:')) return !local && profile === 'aws';
      if (paragraph.startsWith('Cloudflare R2:'))
        return !local && profile === 'r2';
      if (paragraph.startsWith('For AWS/R2,')) return !local;
      return true;
    })
    .join('\n\n');
  files.push(setup);
  if (direct) files.push(await bundled('ops/storage/aws-cors.example.json'));
  return files;
}
export async function mediaFiles(
  config: ProjectConfig,
): Promise<RenderedFile[]> {
  const mongo = selection(config, 'database') === 'database.mongodb';
  const variant = mongo ? 'mongodb' : 'postgres';
  const store = mongo ? 'MongoMediaStateStore' : 'PostgresMediaStateStore';
  const paths = [
    'media-state-store.ts',
    'media-storage-mapping.ts',
    'media-transitions.ts',
    'media.controller.ts',
    'media.entity.ts',
    'media.repository.ts',
    'media.service.ts',
    `${mongo ? 'mongo' : 'postgres'}-media-state-store.ts`,
  ];
  const files = await Promise.all(
    paths.map((path) => runtime('src/modules/media/' + path, variant)),
  );
  const mapping = files.find((entry) =>
    entry.path.endsWith('media-storage-mapping.ts'),
  )!;
  if (selection(config, 'storage') === 'storage.local') {
    mapping.content = replaceExact(
      removeBetween(
        mapping.content,
        'const s3Profile =',
        'const evidence =',
        mapping.path,
      ),
      "z.discriminatedUnion('driver', [localProfile, s3Profile])",
      'localProfile',
      mapping.path,
    );
  } else {
    mapping.content = replaceExact(
      replaceExact(
        removeBetween(
          mapping.content,
          'const localProfile =',
          'const s3Profile =',
          mapping.path,
        ),
        "z.discriminatedUnion('driver', [localProfile, s3Profile])",
        's3Profile',
        mapping.path,
      ),
      "z.enum(['aws', 'r2'])",
      `z.literal('${selection(config, 'storage') === 'storage.r2' ? 'r2' : 'aws'}')`,
      mapping.path,
    );
  }
  const controller = files.find((entry) =>
    entry.path.endsWith('media.controller.ts'),
  );
  if (!controller) throw new Error('MEDIA_CONTROLLER_TEMPLATE');
  const modes = config.capabilities.media?.options.modes;
  controller.content = retainSelectedMediaRoutes(
    controller.content,
    Array.isArray(modes)
      ? modes.filter((mode): mode is string => typeof mode === 'string')
      : ['mediated'],
  );
  files.push(
    file(
      'src/modules/media/media.module.ts',
      `import {Module,type DynamicModule} from '@nestjs/common';
import type {AppConfig} from '../../core/config/app-config.js';
import type {PrincipalAuthority} from '../../core/auth/principal-authority.js';
import {HttpSecurityModule} from '../../core/http/http-security.module.js';
import {StorageModule} from '../storage/storage.module.js';
import {StorageService} from '../storage/storage.service.js';
import {MediaService} from './media.service.js';
import {MediaController,MEDIA_HTTP_OPTIONS,type MediaHttpOptions} from './media.controller.js';
import {MediaRepository} from './media.repository.js';
import {${store}} from './${mongo ? 'mongo' : 'postgres'}-media-state-store.js';
import type {MediaStateStore} from './media-state-store.js';
export async function initializeMediaSchema(config:AppConfig):Promise<void>{const store=await ${store}.connect(config.database.url,true);await store.close();}
@Module({})
export class MediaModule {
  static register(store:MediaStateStore,authority:PrincipalAuthority,options:MediaHttpOptions,storage:StorageService):DynamicModule {
    return {module:MediaModule,imports:[HttpSecurityModule.register(authority),StorageModule.register(storage)],controllers:[MediaController],providers:[{provide:MediaRepository,useFactory:()=>new MediaRepository(store)},{provide:MediaService,inject:[MediaRepository,StorageService],useFactory:(repository:MediaRepository,storage:StorageService)=>new MediaService(repository,storage,authority)},{provide:MEDIA_HTTP_OPTIONS,useValue:options}],exports:[MediaService]};
  }
}
export async function createMediaRuntime(config:AppConfig,authority:PrincipalAuthority,options:MediaHttpOptions,storage:StorageService){const store=await ${store}.connect(config.database.url,false);try{return {module:MediaModule.register(store,authority,{...options,modes:config.storage.modes},storage),close:()=>store.close()};}catch(error){await store.close();throw error;}}
`,
    ),
  );
  files.push(await bundled('clients/media-client.ts'));
  return files;
}

export { pushFiles } from './render-push.js';
