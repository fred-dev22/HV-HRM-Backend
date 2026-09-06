import 'dotenv/config';
import { NestFactory, HttpAdapterHost } from '@nestjs/core';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter';

async function bootstrap() {
  // CORS_ORIGIN sert aussi de base aux liens generes dans les emails (voir
  // frontendOrigin() dans email-templates.ts) : sans lui, ces liens pointent
  // silencieusement vers localhost, invisibles tant que personne ne clique
  // dessus depuis un serveur distant. Avertissement bien visible au demarrage
  // plutot qu'un defaut silencieux, pour reperer l'oubli tout de suite au
  // deploiement au lieu d'attendre une plainte client.
  if (!process.env.CORS_ORIGIN) {
    console.warn(
      "[ATTENTION] CORS_ORIGIN n'est pas defini. L'API n'acceptera que http://localhost:5173, " +
        'et les liens generes dans les emails (validation de demande, creation de compte...) ' +
        "pointeront aussi vers localhost au lieu de l'adresse reelle du serveur. " +
        "Definir CORS_ORIGIN dans le fichier .env avec l'adresse publique du frontend (voir .env.example).",
    );
  }
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') ?? 'http://localhost:5173',
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      // Sans exceptionFactory, Nest renvoie tel quel le texte par defaut de
      // class-validator (toujours en anglais, ex: "email must be an email")
      // — le frontend l'affiche directement (voir getApiErrorMessage). La
      // plupart des champs sont deja valides cote formulaire Vue ; cette
      // erreur ne sert donc que de filet de securite, un message francais
      // generique suffit plutot que de traduire chaque decorateur DTO un a un.
      exceptionFactory: () =>
        new BadRequestException(
          'Certains champs du formulaire sont invalides ou manquants. Veuillez vérifier vos saisies.',
        ),
    }),
  );
  const { httpAdapter } = app.get(HttpAdapterHost);
  app.useGlobalFilters(new PrismaExceptionFilter(httpAdapter));
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
