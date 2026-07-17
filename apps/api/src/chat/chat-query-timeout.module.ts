import { Module } from '@nestjs/common';
import { ChatQueryTimeoutService } from './chat-query-timeout.service';

@Module({
  providers: [ChatQueryTimeoutService],
  exports: [ChatQueryTimeoutService],
})
export class ChatQueryTimeoutModule {}
