import { Controller, Get, Param, Patch } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('notifications')
export class NotificationController {
  constructor(private readonly service: NotificationService) {}

  @Get()
  findMine(@CurrentUser('employeeId') employeeId: string) {
    return this.service.findMine(employeeId);
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
