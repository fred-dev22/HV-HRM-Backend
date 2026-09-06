import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomBytes, createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { renderEmailHtml } from '../mail/email-templates';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';

const SALT_ROUNDS = 10;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1h

function hashToken(token: string): string {
  // Le jeton lui-meme part par email (canal non chiffre en base) — seul son
  // hash est stocke, meme logique que pour un mot de passe.
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly mail: MailService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { Email: dto.email },
      include: { employee: true, employeeCategory: true },
    });

    // Meme message generique que !user/!IsActive ci-dessous (pas de fuite
    // d'info sur l'existence du compte) — un employe supprime definitivement
    // (Lot I) ou desactive (Status='Inactive') ne doit plus jamais pouvoir se
    // connecter, sans reconnexion requise pour que ca prenne effet
    // immediatement.
    if (!user || !user.IsActive || user.employee?.IsDeleted || user.employee?.Status === 'Inactive') {
      throw new UnauthorizedException('Identifiants invalides');
    }

    const passwordMatches = await bcrypt.compare(dto.password, user.PasswordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Identifiants invalides');
    }

    if (!user.employee) {
      throw new UnauthorizedException('Ce compte n\'est lié à aucun employé');
    }

    await this.prisma.user.update({
      where: { Id: user.Id },
      data: { LastLoginAt: new Date() },
    });

    // Les permissions ne sont jamais mises dans le token : le PermissionGuard
    // les relit en base a chaque requete pour qu'un retrait de droit ou une
    // desactivation de compte soit effectif immediatement, sans reconnexion.
    const payload: JwtPayload = {
      sub: user.Id,
      employeeId: user.employee.Id,
      categoryName: user.employeeCategory.Name,
      mustChangePassword: user.MustChangePassword,
    };

    return { accessToken: this.jwtService.sign(payload) };
  }

  // Auto-only (userId vient du JWT, jamais d'un parametre de route) — sert a
  // la fois le changement force apres creation de compte (mot de passe
  // temporaire communique par le RH) et un changement volontaire ulterieur.
  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { Id: userId },
      include: { employee: true, employeeCategory: true },
    });
    if (!user) {
      throw new UnauthorizedException('Compte introuvable');
    }

    const currentMatches = await bcrypt.compare(dto.currentPassword, user.PasswordHash);
    if (!currentMatches) {
      throw new UnauthorizedException('Mot de passe actuel incorrect');
    }

    const PasswordHash = await bcrypt.hash(dto.newPassword, SALT_ROUNDS);
    await this.prisma.user.update({
      where: { Id: userId },
      data: { PasswordHash, MustChangePassword: false },
    });

    await this.mail.send({
      to: user.Email,
      subject: 'Votre mot de passe a été modifié',
      html: renderEmailHtml({
        accent: 'info',
        chipLabel: 'Mot de passe modifié',
        title: 'Mot de passe modifié',
        bodyLines: [
          `Bonjour,`,
          `Le mot de passe de votre compte (${user.Username}) vient d'être modifié.`,
          `Si vous n'êtes pas à l'origine de ce changement, contactez immédiatement le service RH.`,
        ],
      }),
    });

    // Le token deja en circulation porte l'ancien mustChangePassword=true —
    // en signer un nouveau evite de compter sur le frontend pour ignorer un
    // flag perime tant que l'ancien JWT n'a pas expire.
    const payload: JwtPayload = {
      sub: user.Id,
      employeeId: user.employee?.Id ?? '',
      categoryName: user.employeeCategory.Name,
      mustChangePassword: false,
    };
    return { accessToken: this.jwtService.sign(payload) };
  }

  // Retourne toujours le meme resultat que l'email existe ou non — sinon le
  // formulaire "mot de passe oublie" devient un moyen de decouvrir quels
  // emails ont un compte dans l'app.
  async forgotPassword(dto: ForgotPasswordDto): Promise<{ message: string }> {
    const genericResult = {
      message: 'Si un compte existe pour cet email, un lien de réinitialisation vient de lui être envoyé.',
    };
    const user = await this.prisma.user.findUnique({
      where: { Email: dto.email },
      include: { employee: true },
    });
    if (!user || !user.IsActive || user.employee?.IsDeleted || user.employee?.Status === 'Inactive') {
      return genericResult;
    }

    const token = randomBytes(32).toString('hex');
    await this.prisma.user.update({
      where: { Id: user.Id },
      data: {
        ResetPasswordTokenHash: hashToken(token),
        ResetPasswordExpiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      },
    });

    const frontendOrigin = (process.env.CORS_ORIGIN?.split(',')[0] ?? 'http://localhost:5173').trim();
    const resetUrl = `${frontendOrigin}/reset-password?token=${token}`;

    await this.mail.send({
      to: user.Email,
      subject: 'Réinitialisation de votre mot de passe',
      html: renderEmailHtml({
        accent: 'info',
        chipLabel: 'Mot de passe oublié',
        title: 'Réinitialisez votre mot de passe',
        bodyLines: [
          `Bonjour,`,
          `Une demande de réinitialisation a été faite pour le compte associé à cet email (${user.Username}).`,
          `Cliquez sur le bouton ci-dessous pour choisir un nouveau mot de passe. Ce lien expire dans 1 heure.`,
          `Si vous n'êtes pas à l'origine de cette demande, ignorez cet email — votre mot de passe actuel reste inchangé.`,
        ],
        ctaLabel: 'Réinitialiser mon mot de passe',
        ctaHref: resetUrl,
      }),
    });

    return genericResult;
  }

  async resetPassword(dto: ResetPasswordDto): Promise<{ message: string }> {
    const tokenHash = hashToken(dto.token);
    const user = await this.prisma.user.findFirst({ where: { ResetPasswordTokenHash: tokenHash } });
    if (!user || !user.ResetPasswordExpiresAt || user.ResetPasswordExpiresAt < new Date()) {
      throw new BadRequestException('Ce lien de réinitialisation est invalide ou a expiré.');
    }

    const PasswordHash = await bcrypt.hash(dto.newPassword, SALT_ROUNDS);
    await this.prisma.user.update({
      where: { Id: user.Id },
      data: {
        PasswordHash,
        MustChangePassword: false,
        ResetPasswordTokenHash: null,
        ResetPasswordExpiresAt: null,
      },
    });

    await this.mail.send({
      to: user.Email,
      subject: 'Votre mot de passe a été réinitialisé',
      html: renderEmailHtml({
        accent: 'info',
        chipLabel: 'Mot de passe modifié',
        title: 'Mot de passe réinitialisé',
        bodyLines: [
          `Bonjour,`,
          `Le mot de passe de votre compte (${user.Username}) vient d'être réinitialisé.`,
          `Si vous n'êtes pas à l'origine de ce changement, contactez immédiatement le service RH.`,
        ],
      }),
    });

    return { message: 'Mot de passe réinitialisé avec succès.' };
  }
}
