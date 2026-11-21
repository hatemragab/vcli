import { Module, type DynamicModule } from '@nestjs/common';
import { MongoDatabase } from './mongo-database.js';
@Module({})
export class DatabaseModule {
  static register(database: MongoDatabase): DynamicModule {
    return {
      module: DatabaseModule,
      providers: [{ provide: MongoDatabase, useValue: database }],
      exports: [MongoDatabase],
    };
  }
}
