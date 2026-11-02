import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { RequireModule } from '../../../common/modules/require-module.decorator';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { MorphoService } from './morpho.service';
import { QueryMorphoImportsDto, QueryMorphoRecordsDto, UpdateMorphoConfigDto } from './morpho.dto';

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

@RequireModule('time')
@Controller('time/morpho')
@RequirePermission('TEMPS_ACCES')
export class MorphoController {
  constructor(private readonly service: MorphoService) {}

  @Get('config')
  getConfig() {
    return this.service.getConfig();
  }

  @Put('config')
  updateConfig(@Body() dto: UpdateMorphoConfigDto) {
    return this.service.updateConfig(dto);
  }

  // Import du dossier surveille.
  @Post('import')
  importFolder(@CurrentUser('employeeId') employeeId: string) {
    return this.service.importFolder('manual', employeeId);
  }

  // Import d'un fichier envoye depuis l'ecran.
  @Post('import/upload')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES }, defParamCharset: 'utf8' } as Record<string, unknown>),
  )
  importUpload(@UploadedFile() file: Express.Multer.File | undefined, @CurrentUser('employeeId') employeeId: string) {
    if (!file) throw new BadRequestException('Aucun fichier reçu');
    return this.service.importUpload(file.originalname, file.buffer, employeeId);
  }

  @Get('imports')
  findImports(@Query() q: QueryMorphoImportsDto) {
    return this.service.findImports(q);
  }

  @Get('imports/:id')
  findImport(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.findImport(id);
  }

  @Get('records')
  findRecords(@Query() q: QueryMorphoRecordsDto) {
    return this.service.findRecords(q);
  }

  // Apres correction d'un matricule : rattache les pointages restes sans employe.
  @Post('rematch')
  rematch() {
    return this.service.rematchUnmatched();
  }
}
