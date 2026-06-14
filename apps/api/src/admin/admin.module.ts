import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ChatModule } from '../chat/chat.module';
import { HealthModule } from '../health/health.module';
import { RagModule } from '../rag/rag.module';
import { UsersModule } from '../users/users.module';
import { AdminController } from './admin.controller';
import { AdminPathBrowserService } from './admin-path-browser.service';
import { AdminUpdatesController } from './admin-updates.controller';
import { AdminUpdatesService } from './admin-updates.service';
import { AdminService } from './admin.service';

@Module({
  imports: [UsersModule, AuthModule, RagModule, HealthModule, ChatModule],
  controllers: [AdminController, AdminUpdatesController],
  providers: [AdminService, AdminUpdatesService, AdminPathBrowserService],
})
export class AdminModule {}
