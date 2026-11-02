import { Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('notifications')
export class NotificationController {
  constructor(private readonly service: NotificationService) {}

  @Get()
  findMine(
    @CurrentUser('employeeId') employeeId: string,
    @Query('take') take?: string,
    @Query('before') before?: string,
  ) {
    return this.service.findMine(employeeId, take ? Number(take) || 20 : 20, before);
  }

  @Get('unread-count')
  unreadCount(@CurrentUser('employeeId') employeeId: string) {
    return this.service.unreadCount(employeeId);
  }

  @Patch(':id/read')
  markAsRead(@Param('id') id: string, @CurrentUser('employeeId') employeeId: string) {
    return this.service.markAsRead(id, employeeId);
  }

  @Patch('read-all')
  markAllAsRead(@CurrentUser('employeeId') employeeId: string) {
    return this.service.markAllAsRead(employeeId);
  }
}
