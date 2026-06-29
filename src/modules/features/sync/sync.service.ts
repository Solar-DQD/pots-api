import { Injectable } from '@nestjs/common';
import { PotService } from '../../core/pot/pot.service';
import { EnsayoService } from '../../core/ensayo/ensayo.service';
import { UploadPayload } from './types/sync.types';
import { CampanaService } from 'src/modules/core/campana/campana.service';
import { CampanaTipoEnsayoService } from 'src/modules/core/campana-tipo-ensayo/campana-tipo-ensayo.service';
import { EstadoCampanaService } from 'src/modules/core/estado-campana/estado-campana.service';
import { EstadoPotService } from 'src/modules/core/estado-pot/estado-pot.service';
import { TipoEnsayoService } from 'src/modules/core/tipo-ensayo/tipo-ensayo.service';
import { TipoCargaService } from 'src/modules/core/tipo-carga/tipo-carga.service';
import { TipoHincadoService } from 'src/modules/core/tipo-hincado/tipo-hincado.service';
import { PerfilService } from 'src/modules/core/perfil/perfil.service';

@Injectable()
export class SyncService {

  constructor(
    private campanaService: CampanaService,
    private campanaTipoEnsayoService: CampanaTipoEnsayoService,
    private potService: PotService,
    private ensayoService: EnsayoService,
    private estadoCampanaService: EstadoCampanaService,
    private estadoPotService: EstadoPotService,
    private tipoEnsayoService: TipoEnsayoService,
    private tipoCargaService: TipoCargaService,
    private tipoHincadoService: TipoHincadoService,
    private perfilService: PerfilService
  ) { }

  // Convierte strings vacíos a null y DD/MM/AAAA a ISO en campos de fecha
  private sanearFechas(items: Record<string, any>[]): Record<string, any>[] {
    const camposFecha = ['fechaEnsayo', 'fechaRealizacion', 'modifiedAt', 'syncedAt', 'deletedAt'];
    return items.map(item => {
      const clean = { ...item };
      for (const campo of camposFecha) {
        if (!(campo in clean)) continue;
        const v = clean[campo];
        if (v === '' || v === undefined) {
          clean[campo] = null;
          continue;
        }
        if (typeof v === 'string') {
          // DD/MM/AAAA → ISO
          const match = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
          if (match) {
            const [, d, m, y] = match;
            clean[campo] = new Date(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T00:00:00.000Z`).toISOString();
          }
        }
      }
      return clean;
    });
  }

  async upload(payload: UploadPayload) {
    const { campanas, campanaTipoEnsayo, pots, ensayos, perfiles, deviceId } = payload;
    const now = new Date();

    // Perfiles primero (otros registros pueden referenciarlos)
    if (perfiles?.length) {
      await this.perfilService.upsertPerfiles(perfiles);
    }

    const results = {
      campanas: await this.campanaService.upsert(this.sanearFechas(campanas), deviceId),
      campanaTipoEnsayo: await this.campanaTipoEnsayoService.upsert(this.sanearFechas(campanaTipoEnsayo)),
      pots: await this.potService.upsert(this.sanearFechas(pots)),
      ensayos: await this.ensayoService.upsert(this.sanearFechas(ensayos)),
    };

    return { ok: true, syncedAt: now, results };
  }

  async download(since?: number) {
    const sinceDate = since ? new Date(since) : new Date(0);

    const campanas = await this.campanaService.findSince(sinceDate);
    const campanaIds = campanas.map(c => c.id);
    const campanaTipoEnsayo = await this.campanaTipoEnsayoService.findByCampanaIds(campanaIds);
    const pots = await this.potService.findByCampanaIds(campanaIds);
    const ensayos = await this.ensayoService.findByPotIds(pots.map(p => p.id));

    return { campanas, campanaTipoEnsayo, pots, ensayos, timestamp: Date.now() };
  }

  async catalogos() {
    const [estadosCampana, estadosPot, tiposEnsayo, tiposCarga, tiposHincado, perfiles] =
      await Promise.all([
        this.estadoCampanaService.findAll(),
        this.estadoPotService.findAll(),
        this.tipoEnsayoService.findAll(),
        this.tipoCargaService.findAll(),
        this.tipoHincadoService.findAll(),
        this.perfilService.findAll(),
      ]);

    return { estadosCampana, estadosPot, tiposEnsayo, tiposCarga, tiposHincado, perfiles };
  }

  async softDelete(tipo: 'campana' | 'pot' | 'ensayo', id: number) {
    if (tipo === 'campana') {
      await this.campanaTipoEnsayoService.softDeleteByCampanaId(id);
      await this.campanaService.softDelete(id);
    }
    if (tipo === 'pot') await this.potService.softDelete(id);
    if (tipo === 'ensayo') await this.ensayoService.softDelete(id);
    return { ok: true };
  }
}
