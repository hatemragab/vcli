import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { selectedIdentityFixture } from './identity-rendering-fixture.ts';

/** Child module mocks are controlled driver boundaries, not native database acceptance. */
for (const database of ['mongodb', 'postgres'] as const) {
  test(`controlled ${database} native observations count whole retries and preserve errors/markers`, async () => {
    const fixture = await selectedIdentityFixture(
      database,
      'firebase',
      'provider',
    );
    fixture.emit();
    const script = join(fixture.directory, 'native-observation.mjs');
    await writeFile(
      script,
      `
import assert from 'node:assert/strict';
import {mock} from 'node:test';
const state={markers:new Set(['identity-v1','identity-lifecycle-v2']),queries:[],nativeTransactions:0,closed:0,connectFailure:null,closeFailure:null};
const peer={};
${
  database === 'mongodb'
    ? `
const connection={db:{admin:()=>({command:async()=>({setName:'controlled-replica'})}),collection:()=>({findOne:async({name})=>{state.queries.push(name);return state.markers.has(name)?{name,completed:true}:null;}})},
 startSession:async()=>({withTransaction:async(work)=>{state.nativeTransactions++;return work();},endSession:async()=>{}}),
 close:async()=>{state.closed++;if(state.closeFailure)throw state.closeFailure;}};
await mock.module(import.meta.resolve('mongoose'),{namedExports:{createConnection:()=>({asPromise:async()=>{if(state.connectFailure)throw state.connectFailure;return connection;}})}});
const {MongoDatabase:Database}=await import('./out/core/database/mongo-database.js');
`
    : `
const {PgDialect}=await import('drizzle-orm/pg-core');const dialect=new PgDialect();
class ControlledPool {async end(){state.closed++;if(state.closeFailure)throw state.closeFailure;}}
await mock.module(import.meta.resolve('pg'),{namedExports:{Pool:ControlledPool}});
await mock.module(import.meta.resolve('drizzle-orm/node-postgres'),{namedExports:{drizzle:()=>({
 execute:async(query)=>{const sql=dialect.sqlToQuery(query).sql;state.queries.push(sql);if(state.connectFailure)throw state.connectFailure;return {rowCount:sql.includes('ref_migrations')?state.markers.size:1,rows:[]};},
 transaction:async(work)=>{state.nativeTransactions++;return work(peer);}
})}});
const {PostgresDatabase:Database}=await import('./out/core/database/postgres-database.js');
`
}
const {ApplicationError}=await import('./out/core/errors/application-error.js');
const events=[];
const observation={async observe(operation,work){try{const result=await work();events.push({operation,outcome:'ok'});return result;}catch(error){events.push({operation,outcome:'error',error});throw error;}}};
const db=await Database.connect('controlled-no-network',true,observation);
assert.equal(events.filter(event=>event.operation==='connect').length,1);
let attempts=0;const contexts=[];
const value=await db.run(async(context)=>{contexts.push(context);attempts++;assert.ok(db.context(context));if(attempts===1)throw Object.assign(new Error('CONTROLLED_RETRY'),{code:${database === 'mongodb' ? '11000' : "'40001'"}});return 17;});
assert.equal(value,17);assert.equal(attempts,2);assert.equal(state.nativeTransactions,2);
assert.equal(events.filter(event=>event.operation==='transaction').length,1);
for(const context of contexts)assert.throws(()=>db.context(context),{code:'INVALID_TRANSACTION_CONTEXT'});
const sentinel=new ApplicationError('CONTROLLED_EXACT_FAILURE',409);
await assert.rejects(db.run(async()=>{throw sentinel;}),error=>error===sentinel);
assert.equal(events.filter(event=>event.operation==='transaction').length,2);
assert.equal(events.find(event=>event.operation==='transaction'&&event.outcome==='error').error,sentinel);
const first=db.close(),second=db.close();assert.equal(first,second);await Promise.all([first,second]);
assert.equal(state.closed,1);assert.equal(events.filter(event=>event.operation==='close').length,1);
state.markers=new Set(['identity-v1']);
await assert.rejects(Database.connect('controlled-no-network',true,observation),{code:'DATABASE_INITIALIZATION_REQUIRED'});
assert.equal(events.filter(event=>event.operation==='connect').length,2);
state.queries=[];state.markers=new Set();
const unchecked=await Database.connect('controlled-no-network',false,observation);await unchecked.close();
assert.equal(state.queries.some(query=>query.includes('identity-')||query.includes('ref_migrations')),false);
const {openDatabase}=await import('./out/core/database/database.js');
const forwarded=await openDatabase({database:{url:'controlled-no-network'}},false,observation);await forwarded.close();
const connectError=new Error('CONTROLLED_CONNECT_FAILURE');state.connectFailure=connectError;
await assert.rejects(Database.connect('controlled-no-network',false,observation),error=>error===connectError);
assert.equal(events.filter(event=>event.operation==='connect').length,5);
state.connectFailure=null;
const failedClose=await Database.connect('controlled-no-network',false,observation),closeError=new Error('CONTROLLED_CLOSE_FAILURE');state.closeFailure=closeError;
const before=state.closed,one=failedClose.close(),two=failedClose.close();assert.equal(one,two);
await assert.rejects(one,error=>error===closeError);await assert.rejects(two,error=>error===closeError);assert.equal(state.closed,before+1);
assert.equal(state.queries.every(query=>${database === 'mongodb' ? "query==='identity-v1'||query==='identity-lifecycle-v2'" : '/^SELECT /u.test(query)'}),true);
process.stdout.write('controlled observation checks passed');
`,
    );
    const result = spawnSync(
      process.execPath,
      ['--experimental-test-module-mocks', script],
      { encoding: 'utf8', timeout: 30000 },
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /controlled observation checks passed/);
  });
  test(`controlled ${database} explicit identity release is preserving/idempotent and marks lifecycle only after success`, async () => {
    const fixture = await selectedIdentityFixture(
      database,
      'firebase',
      'provider',
    );
    fixture.emit();
    const script = join(fixture.directory, 'schema-release.mjs');
    await writeFile(
      script,
      `
import assert from 'node:assert/strict';
import {mock} from 'node:test';
const state={markers:new Map(),events:[],closed:0,fail:false};
const failure=new Error('CONTROLLED_OWNER_RELEASE_FAILURE');
${
  database === 'mongodb'
    ? `
const collection=name=>({
 createIndex:async()=>{state.events.push('index:'+name);},
 findOne:async(query)=>state.markers.get(query.name)===true?{name:query.name,completed:true}:null,
 insertOne:async(row)=>{if(state.markers.has(row.name))throw new Error('CONTROLLED_DUPLICATE_LOCK');state.markers.set(row.name,row.completed);state.events.push('claim:'+row.name);},
 updateOne:async(query,update)=>{state.markers.set(query.name,update.$set.completed);state.events.push('complete:'+query.name);},
 updateMany:async()=>{state.events.push('migrate:'+name);if(state.fail&&name==='ref_installations')throw failure;}
});
const db={connection:{db:{collection},model:name=>({createCollection:async()=>{state.events.push('collection:'+name);},createIndexes:async()=>{state.events.push('indexes:'+name);}})},close:async()=>{state.closed++;}};
`
    : `
const {PgDialect}=await import('drizzle-orm/pg-core');const dialect=new PgDialect();
const db={db:{transaction:async(work)=>{const original=new Map(state.markers);try{return await work({execute:async(query)=>{
 const {sql,params}=dialect.sqlToQuery(query);
 if(sql.includes('ADD COLUMN IF NOT EXISTS capability_hash')){state.events.push('apply:v2');if(state.fail)throw failure;}
 else if(sql.includes('CREATE TABLE IF NOT EXISTS ref_accounts'))state.events.push('apply:v1');
 else if(sql.startsWith('SELECT name FROM ref_migrations'))return {rowCount:state.markers.has(params[0])?1:0};
 else if(sql.startsWith('INSERT INTO ref_migrations')){state.markers.set(params[0],true);state.events.push('complete:'+params[0]);}
 return {rowCount:1,rows:[]};
 }});}catch(error){state.markers=original;throw error;}}},close:async()=>{state.closed++;}};
`
}
await mock.module(new URL('./out/core/database/database.js',import.meta.url).href,{namedExports:{openDatabase:async(_config,requireInitialized)=>{assert.equal(requireInitialized,false);return db;}}});
const {initializeIdentityDatabase}=await import('./out/initialize-identity-database.js');
await initializeIdentityDatabase({});
assert.equal(state.markers.get('identity-v1'),true);assert.equal(state.markers.get('identity-lifecycle-v2'),true);
assert.ok(state.events.indexOf('complete:identity-lifecycle-v2')>state.events.indexOf(${database === 'mongodb' ? "'migrate:ref_sessions'" : "'apply:v2'"}));
assert.equal(state.closed,1);
state.events=[];await initializeIdentityDatabase({});
assert.equal(state.events.some(event=>event.startsWith('migrate:')||event.startsWith('collection:')||event.startsWith('apply:')),false);assert.equal(state.closed,2);
state.markers=new Map([['identity-v1',true]]);state.events=[];state.fail=true;
await assert.rejects(initializeIdentityDatabase({}),error=>error===failure);
assert.equal(state.markers.get('identity-v1'),true);assert.notEqual(state.markers.get('identity-lifecycle-v2'),true);assert.equal(state.closed,3);
${
  database === 'mongodb'
    ? `
await assert.rejects(initializeIdentityDatabase({}),{code:'MIGRATION_LOCKED_OR_INCOMPLETE'});
assert.equal(state.markers.get('identity-lifecycle-v2'),false);
`
    : `
state.fail=false;await initializeIdentityDatabase({});assert.equal(state.markers.get('identity-lifecycle-v2'),true);
`
}
process.stdout.write('controlled release checks passed');
`,
    );
    const result = spawnSync(
      process.execPath,
      ['--experimental-test-module-mocks', script],
      { encoding: 'utf8', timeout: 30000 },
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /controlled release checks passed/);
  });
}
