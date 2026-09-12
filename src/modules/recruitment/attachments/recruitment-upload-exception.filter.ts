import { ArgumentsHost, Catch, PayloadTooLargeException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';

// Un upload multipart qui depasse `limits.fileSize` est deja transforme par
// Nest (@nestjs/platform-express transformException) en PayloadTooLargeException
// 413, mais avec un message anglais ("File too large"). Ce filtre se contente
// de remplacer ce message par sa version francaise.
//
// Il ne capte QUE le 413 : le 415 du fileFilter porte deja son message
// francais, et toute autre exception (erreurs Prisma -> PrismaExceptionFilter
// global, 404 metier, 400 de validation...) suit son cours normal.
@Catch(PayloadTooLargeException)
export class RecruitmentUploadExceptionFilter extends BaseExceptionFilter {
  catch(_exception: PayloadTooLargeException, host: ArgumentsHost): void {
    super.catch(
      new PayloadTooLargeException('Le fichier depasse la taille maximale de 5 Mo.'),
      host,
    );
  }
}
