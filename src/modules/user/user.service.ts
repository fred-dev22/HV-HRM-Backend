import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { Prisma } from '../../../prisma/generated/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { renderEmailHtml, frontendOrigin } from '../mail/email-templates';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { AssignCategoryDto } from './dto/assign-category.dto';
import { SetUserPermissionDto } from './dto/set-user-permission.dto';

const SALT_ROUNDS = 10;

@Injectable()
export class UserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  private sanitize<T extends { PasswordHash?: string }>(user: T) {
    const { PasswordHash, ...rest } = user;
    return rest;
  }

  // Active l'accès système d'un employé : crée le User et relie
  // Employee.UserId dans la même transaction (voir Employee.UserId, nullable
  // — un employé n'a par défaut aucun accès tant que ce n'est pas fait). Les
  // permissions actuelles de la catégorie choisie (CategoryPermission) sont
  // copiées une seule fois dans UserPermission — un changement ultérieur de
  // la catégorie n'affectera jamais ce compte, voir decision du 29/07.
  async create(dto: CreateUserDto) {
    const { Password, EmployeeId, EmployeeCategoryId, ...rest } = dto;

    const employee = await this.prisma.employee.findUnique({ where: { Id: EmployeeId } });
    if (!employee) {
      throw new NotFoundException(`Employé ${EmployeeId} introuvable`);
    }
    if (employee.UserId) {
      throw new BadRequestException('Cet employé a déjà un compte d\'accès système');
    }

    const category = await this.prisma.employeeCategory.findUnique({
      where: { Id: EmployeeCategoryId },
      include: { categoryPermissions: true },
    });
    if (!category) {
      throw new NotFoundException(`Catégorie ${EmployeeCategoryId} introuvable`);
    }

    const PasswordHash = await bcrypt.hash(Password, SALT_ROUNDS);

    const user = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { ...rest, EmployeeCategoryId, PasswordHash },
      });
      if (category.categoryPermissions.length > 0) {
        await tx.userPermission.createMany({
          data: category.categoryPermissions.map((cp) => ({
            UserId: user.Id,
            PermissionId: cp.PermissionId,
            CreatedBy: EmployeeId,
          })),
        });
      }
      await tx.employee.update({ where: { Id: EmployeeId }, data: { UserId: user.Id } });
      return user;
    });

    const title = 'Votre compte Productive 247 HRM a été créé';
    // Le retour de mail.send() n'est jamais une exception (voir MailService.send,
    // qui avale toute erreur pour ne jamais faire echouer une operation dont
    // l'email n'est qu'un effet de bord) — sans lire ce booleen ici, un envoi
    // en echec passait totalement inapercu, y compris lors d'un import en
    // masse ou l'admin RH n'a aucun autre moyen de savoir qu'un employe n'a
    // pas recu ses identifiants (voir employeeImportConfig.ts onRowCreated,
    // qui lit desormais ce champ pour avertir sur la ligne concernee).
    const emailSent = await this.mail.send({
      to: user.Email,
      subject: title,
      html: renderEmailHtml({
        accent: 'primary',
        chipLabel: 'Compte créé',
        title,
        bodyLines: [
          `Bonjour ${employee.FirstName},`,
          `Un compte vous a été créé sur Productive 247 HRM.`,
          // Ne jamais affirmer un changement obligatoire si l'admin RH a
          // decoche cette option a la creation (voir CreateUserAccountDialog.vue
          // form.mustChangePassword) — le mot de passe reste alors valable
          // tel quel jusqu'a ce que l'utilisateur decide lui-meme de le changer.
          dto.MustChangePassword
            ? `Vous devrez le changer dès votre première connexion.`
            : `Vous pourrez le modifier à tout moment depuis votre profil.`,
        ],
        details: [
          { label: 'Identifiant', value: user.Username },
          { label: 'Mot de passe temporaire', value: Password },
        ],
        ctaLabel: 'Se connecter',
        ctaHref: `${frontendOrigin()}/login`,
      }),
    });

    return { ...this.sanitize(user), EmailSent: emailSent };
  }

  async findAll() {
    const users = await this.prisma.user.findMany({ include: { employeeCategory: true } });
    return users.map((user) => this.sanitize(user));
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { Id: id },
      include: { employeeCategory: true },
    });
    if (!user) {
      throw new NotFoundException(`Utilisateur ${id} introuvable`);
    }
    return this.sanitize(user);
  }

  async update(id: string, dto: UpdateUserDto) {
    await this.findOne(id);
    const { Password, ...rest } = dto;
    const data: Record<string, unknown> = { ...rest, ModifiedAt: new Date() };
    if (Password) {
      data.PasswordHash = await bcrypt.hash(Password, SALT_ROUNDS);
    }
    const user = await this.prisma.user.update({ where: { Id: id }, data });
    if (Password) {
      // Reinitialisation par un admin (pas d'auto-service, voir
      // AuthService.changePassword pour ce cas) — le nouveau mot de passe
      // temporaire doit etre communique par un canal que l'utilisateur peut
      // consulter meme sans pouvoir encore se connecter.
      const title = 'Votre mot de passe a été réinitialisé';
      await this.mail.send({
        to: user.Email,
        subject: title,
        html: renderEmailHtml({
          accent: 'warning',
          chipLabel: 'Mot de passe réinitialisé',
          title,
          bodyLines: [
            `Bonjour,`,
            `Le mot de passe de votre compte (${user.Username}) a été réinitialisé par un administrateur.`,
            dto.MustChangePassword
              ? `Vous devrez le changer dès votre prochaine connexion.`
              : `Vous pourrez le modifier à tout moment depuis votre profil.`,
            `Si vous n'êtes pas à l'origine de cette demande, contactez immédiatement le service RH.`,
          ],
          details: [{ label: 'Nouveau mot de passe temporaire', value: Password }],
          ctaLabel: 'Se connecter',
          ctaHref: `${frontendOrigin()}/login`,
        }),
      });
    }
    return this.sanitize(user);
  }

  async remove(id: string) {
    await this.findOne(id);
    try {
      const user = await this.prisma.user.delete({ where: { Id: id } });
      return this.sanitize(user);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
        throw new ConflictException(
          'Ce compte est encore lié à un employé et ne peut pas être supprimé.',
        );
      }
      throw err;
    }
  }

  // Change juste l'étiquette de catégorie du compte — ne touche JAMAIS aux
  // UserPermission déjà en place (voir decision du 29/07 : le seul moment où
  // les permissions d'une catégorie sont copiées vers un user, c'est à la
  // création du compte). Pour ajuster les droits d'un compte existant, voir
  // grantPermission/revokePermission ci-dessous.
  async assignCategory(id: string, dto: AssignCategoryDto) {
    await this.findOne(id);
    const category = await this.prisma.employeeCategory.findUnique({
      where: { Id: dto.EmployeeCategoryId },
    });
    if (!category) {
      throw new NotFoundException(`Catégorie ${dto.EmployeeCategoryId} introuvable`);
    }
    const user = await this.prisma.user.update({
      where: { Id: id },
      data: { EmployeeCategoryId: dto.EmployeeCategoryId, ModifiedAt: new Date() },
    });
    return this.sanitize(user);
  }

  async getEffectivePermissions(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { Id: id },
      include: {
        employeeCategory: true,
        userPermissions: { include: { permission: true } },
      },
    });
    if (!user) {
      throw new NotFoundException(`Utilisateur ${id} introuvable`);
    }
    return {
      categoryName: user.employeeCategory.Name,
      permissions: user.userPermissions.map((up) => up.permission.Code),
      individualGrants: user.userPermissions.map((up) => ({
        permissionId: up.PermissionId,
        code: up.permission.Code,
        module: up.permission.Module,
        label: up.permission.Label,
      })),
    };
  }

  // Présence de la ligne UserPermission = accordé — pas de flag IsGranted,
  // il n'y a plus de rôle sous-jacent à surcharger (voir schema.prisma).
  async grantPermission(userId: string, dto: SetUserPermissionDto, createdBy: string) {
    await this.findOne(userId);
    const permission = await this.prisma.permission.findUnique({ where: { Id: dto.PermissionId } });
    if (!permission) {
      throw new NotFoundException(`Permission ${dto.PermissionId} introuvable`);
    }
    await this.prisma.userPermission.upsert({
      where: { UserId_PermissionId: { UserId: userId, PermissionId: dto.PermissionId } },
      update: {},
      create: { UserId: userId, PermissionId: dto.PermissionId, CreatedBy: createdBy },
    });
    return this.getEffectivePermissions(userId);
  }

  async revokePermission(userId: string, permissionId: string) {
    await this.findOne(userId);
    await this.prisma.userPermission.deleteMany({
      where: { UserId: userId, PermissionId: permissionId },
    });
    return this.getEffectivePermissions(userId);
  }
}
