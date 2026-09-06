import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { Public } from './modules/auth/decorators/public.decorator';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  // Consulte par le panneau "About" du frontend (bouton top bar) pour
  // afficher/comparer la version deployee — voir API_VERSION dans .env,
  // a incrementer par le deployeur a chaque mise en prod. Public : aucune
  // info sensible, et doit rester lisible meme si le token a expire.
  @Get('version')
  @Public()
  getVersion() {
    return { name: 'P247 HRM API', version: process.env.API_VERSION ?? '0.0.0' };
  }
}
