import { Controller, Get, Header, NotFoundException, Res } from '@nestjs/common';
import { createHash } from 'crypto';
import type { Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { getBrand, getBrandLogo } from '../../config/brand';
import { getEnabledModules } from '../../common/modules/modules.config';
import { readClientFile } from '../../config/client-file';

// Configuration publique de l'instance : marque, modules actifs, options
// d'interface. Lue par le frontend AVANT l'affichage de la page de connexion
// (donc sans jeton) : elle ne contient rien de confidentiel. C'est ce qui
// permet d'utiliser la meme version du frontend pour tous les clients.
@Controller('config')
export class AppConfigController {
  @Public()
  @Get('public')
  @Header('Cache-Control', 'no-store')
  getPublicConfig() {
    const brand = getBrand();
    const logo = getBrandLogo();
    return {
      brand: {
        ...brand,
        // Change quand le logo change : evite qu'un navigateur garde l'ancien.
        hasLogo: logo !== null,
        logoVersion: logo ? createHash('sha1').update(logo.buffer).digest('hex').slice(0, 10) : null,
      },
      modules: getEnabledModules(),
      features: {
        jobDistributionUi: readClientFile().jobDistributionUi === true,
      },
    };
  }

  @Public()
  @Get('logo')
  logo(@Res() res: Response) {
    const logo = getBrandLogo();
    if (!logo) throw new NotFoundException('Aucun logo configure');
    res.setHeader('Content-Type', logo.mime);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(logo.buffer);
  }
}
