import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { existsSync } from 'fs';
import { join } from 'path';
import { Public } from '../auth/decorators/public.decorator';

// Sert les fichiers deposes localement par SharePointService quand
// GRAPH_SHAREPOINT_* n'est pas configure (voir uploadFileLocally). @Public()
// requis : le guard JWT global bloquerait sinon meme les CV de candidats
// externes qui n'ont pas de compte. Meme niveau de protection que le lien
// SharePoint qu'il remplace (URL non devinable, prefixee d'un UUID court) —
// pas d'auth cote SharePoint non plus pour un lien direct de ce type.
@Controller('uploads')
export class UploadsController {
  @Public()
  @Get(':filename')
  get(@Param('filename') filename: string, @Res() res: Response) {
    // Rejette tout ce qui pourrait sortir du dossier /uploads (aucun
    // separateur de chemin attendu dans un nom genere par uploadFileLocally).
    if (!filename || filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
      throw new NotFoundException('Fichier introuvable');
    }
    const path = join(process.cwd(), 'uploads', filename);
    if (!existsSync(path)) {
      throw new NotFoundException('Fichier introuvable');
    }
    res.sendFile(path);
  }
}
