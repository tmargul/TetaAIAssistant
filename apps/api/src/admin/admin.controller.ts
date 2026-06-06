import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type {
  AppUserRecord,
  CreateTetaServerRequest,
  GrantUserAccessRequest,
  TetaServer,
  UpdateTetaServerRequest,
} from '@teta/shared';
import { AdminGuard } from '../auth/admin.guard';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminService } from './admin.service';

@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('users')
  listUsers(): AppUserRecord[] {
    return this.admin.listUsers();
  }

  @Post('users/grant')
  grantUser(
    @Req() req: AuthenticatedRequest,
    @Body() body: GrantUserAccessRequest,
  ): AppUserRecord {
    return this.admin.grantUserAccess(req.user.id, body);
  }

  @Post('users/:id/revoke')
  revokeUser(@Param('id', ParseIntPipe) id: number): AppUserRecord {
    return this.admin.revokeUserAccess(id);
  }

  @Get('teta-servers')
  listTetaServers(): TetaServer[] {
    return this.admin.listTetaServers();
  }

  @Post('teta-servers')
  createTetaServer(@Body() body: CreateTetaServerRequest): TetaServer {
    return this.admin.createTetaServer(body);
  }

  @Patch('teta-servers/:id')
  updateTetaServer(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateTetaServerRequest,
  ): TetaServer {
    return this.admin.updateTetaServer(id, body);
  }

  @Delete('teta-servers/:id')
  deleteTetaServer(@Param('id', ParseIntPipe) id: number): { ok: true } {
    this.admin.deleteTetaServer(id);
    return { ok: true };
  }
}
