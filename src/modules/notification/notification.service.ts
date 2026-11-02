import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

// Type: leave | mission | expense | recruitment | reminder | system — pilote
// juste l'icone cote frontend, pas de validation stricte cote base (colonne
// NVarChar libre).
export interface CreateNotificationInput {
  employeeId: string;
  type: 'leave' | 'mission' | 'expense' | 'recruitment' | 'reminder' | 'system';
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

  // Les plus recentes en premier, par pages : `take` (20 par defaut, 50 max) et
  // `before` (CreatedAt de la derniere notification deja chargee) pour la page
  // suivante.
  findMine(employeeId: string, take = 20, before?: string) {
    const beforeDate = before ? new Date(before) : undefined;
    return this.prisma.notification.findMany({
      where: {
        EmployeeId: employeeId,
        ...(beforeDate && !Number.isNaN(beforeDate.getTime()) ? { CreatedAt: { lt: beforeDate } } : {}),
      },
      orderBy: { CreatedAt: 'desc' },
      take: Math.min(Math.max(take, 1), 50),
    });
  }

  // Le badge de la cloche : compte reel en base, independant de ce qui est
  // charge dans la liste.
  async unreadCount(employeeId: string) {
    const count = await this.prisma.notification.count({
      where: { EmployeeId: employeeId, IsRead: false },
    });
    return { count };
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
