import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

// Type: leave | mission | expense | system — pilote juste l'icone cote
// frontend, pas de validation stricte cote base (colonne NVarChar libre).
export interface CreateNotificationInput {
  employeeId: string;
  type: 'leave' | 'mission' | 'expense' | 'system';
  title: string;
  message: string;
  href?: string;
}

@Injectable()
export class NotificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async create(input: CreateNotificationInput) {
    const notification = await this.prisma.notification.create({
      data: {
        EmployeeId: input.employeeId,
        Type: input.type,
        Title: input.title,
        Message: input.message,
        Href: input.href,
      },
    });
    // Pousse la notification en direct a la cloche de son destinataire —
    // meme forme que ce que renvoie findMine(), pour que le frontend
    // reutilise le meme mapper (voir stores/notifications.ts).
    this.realtime.notifyEmployee(input.employeeId, 'notification:new', notification);
    return notification;
  }

  // Les plus recentes en premier, limitees a 50 — pas de pagination pour
  // l'instant, la cloche n'a pas vocation a afficher un historique complet.
  findMine(employeeId: string) {
    return this.prisma.notification.findMany({
      where: { EmployeeId: employeeId },
      orderBy: { CreatedAt: 'desc' },
      take: 50,
    });
  }

  async markAsRead(id: string, employeeId: string) {
    const notif = await this.prisma.notification.findUnique({ where: { Id: id } });
    if (!notif || notif.EmployeeId !== employeeId) {
      throw new NotFoundException('Notification introuvable');
    }
    return this.prisma.notification.update({ where: { Id: id }, data: { IsRead: true } });
  }

  async markAllAsRead(employeeId: string) {
    await this.prisma.notification.updateMany({
      where: { EmployeeId: employeeId, IsRead: false },
      data: { IsRead: true },
    });
    return { success: true };
  }
}
