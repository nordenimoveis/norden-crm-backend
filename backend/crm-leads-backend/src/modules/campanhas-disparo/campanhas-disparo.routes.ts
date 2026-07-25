import { FastifyInstance } from 'fastify';
import { requireRole } from '@/plugins/auth';
import { CampanhasDisparoService } from './campanhas-disparo.service';
import { uploadMidia } from '@/lib/cloudinary';
import {
  criarCampanhaDisparoSchema,
  atualizarCampanhaDisparoSchema,
  filtroPublicoSchema,
} from './campanhas-disparo.schema';

const MENSAGENS_ERRO: Record<string, { status: number; message: string }> = {
  TEMPLATE_NAO_ENCONTRADO: { status: 404, message: 'Template não encontrado' },
  TEMPLATE_NAO_APROVADO: {
    status: 400,
    message: 'Esse template ainda não foi aprovado pela Meta — não pode ser usado em disparo em massa',
  },
  TEMPLATE_SEM_NOME_META: {
    status: 400,
    message: 'O template precisa ter o "Nome do template na Meta" preenchido para poder ser enviado de verdade',
  },
  PUBLICO_VAZIO: { status: 400, message: 'Nenhum lead encontrado com esse filtro' },
  CAMPANHA_NAO_ENCONTRADA: { status: 404, message: 'Campanha não encontrada' },
  CAMPANHA_NAO_EDITAVEL: { status: 400, message: 'Só é possível editar/apagar campanhas em rascunho' },
  CAMPANHA_NAO_ESTA_PRONTA: { status: 400, message: 'A campanha precisa estar "pronta para envio" antes de iniciar o disparo' },
  MIDIA_OBRIGATORIA: {
    status: 400,
    message: 'Esse template tem cabeçalho de mídia — anexe uma imagem/vídeo/documento antes de criar a campanha',
  },
