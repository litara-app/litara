import { existsSync } from 'fs';
import { join } from 'path';
import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { LibraryModule } from './library/library.module';
import { MetadataModule } from './metadata/metadata.module';
import { BooksModule } from './books/books.module';
import { LibrariesModule } from './libraries/libraries.module';
import { ShelvesModule } from './shelves/shelves.module';
import { AdminModule } from './admin/admin.module';
import { SetupModule } from './setup/setup.module';
import { OpdsModule } from './opds/opds.module';
import { MailModule } from './mail/mail.module';
import { SeriesModule } from './series/series.module';
import { SmartShelvesModule } from './smart-shelves/smart-shelves.module';
import { ReadingProgressModule } from './reading-progress/reading-progress.module';
import { BulkMetadataModule } from './bulk-metadata/bulk-metadata.module';
import { ServerModule } from './server/server.module';
import { AnnotationsModule } from './annotations/annotations.module';
import { BookDropModule } from './book-drop/book-drop.module';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';

const publicPath = join(__dirname, '../public');
const staticModules = existsSync(publicPath)
  ? [
      ServeStaticModule.forRoot({
        rootPath: publicPath,
        exclude: ['/api{/*path}'],
      }),
    ]
  : [];

@Module({
  imports: [
    ...staticModules,
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    DatabaseModule,
    UsersModule,
    AuthModule,
    LibraryModule,
    MetadataModule,
    BooksModule,
    LibrariesModule,
    ShelvesModule,
    AdminModule,
    SetupModule,
    OpdsModule,
    MailModule,
    SeriesModule,
    SmartShelvesModule,
    ReadingProgressModule,
    BulkMetadataModule,
    ServerModule,
    AnnotationsModule,
    BookDropModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
