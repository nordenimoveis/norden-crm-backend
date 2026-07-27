export type LeadStatus =
  | 'novo'
  | 'respondeu'
  | 'em_atendimento'
  | 'visita_agendada'
  | 'proposta'
  | 'negocio_fechado'
  | 'perdido'
  | 'frio_standby';

export type LeadOrigem = 'meta_ads' | 'site_imobzi' | 'legado_imobzi' | 'importacao_planilha' | 'manual';

export type LeadTemperatura = 'nao_avaliado' | 'frio' | 'morno' | 'quente';

export type Usuario = {
  id: string;
  nome: string;
  email: string;
  papel: 'gestor' | 'corretor' | 'admin';
  ativo: boolean;
};

export type Imovel = {
  id: string;
  titulo: string;
  bairro: string | null;
  cidade: string;
  valor: string | null;
  metragem: number | null;
  quartos: number | null;
  descricao: string | null;
  fotoUrl: string | null;
  referenciaExterna: string | null;
  ativo: boolean;
  criadoEm: string;
};

export type PerfilBusca = {
  bairro?: string;
  orcamentoMin?: number;
  orcamentoMax?: number;
  quartos?: number;
  finalidade?: 'moradia' | 'investimento';
};

export type MatchImovel = {
  imovel: Imovel;
  matchScore: number;
  motivo: string;
};

export type DadosImovelExtraidos = {
  titulo: string;
  bairro: string | null;
  cidade: string | null;
  valor: number | null;
  metragem: number | null;
  quartos: number | null;
  descricao: string;
};

export type AlertaLead = 'aguardando_resposta' | 'sem_atividade' | null;

export type TipoAgendamento = 'visita' | 'reuniao' | 'ligacao' | 'whatsapp' | 'outro';

export const ROTULO_TIPO_AGENDAMENTO: Record<TipoAgendamento, string> = {
  visita: 'Visita',
  reuniao: 'Reunião',
  ligacao: 'Ligação',
  whatsapp: 'WhatsApp',
  outro: 'Outro',
};

export type StatusIA = 'inativa' | 'ativa' | 'pausada_humano';

export const ROTULO_STATUS_IA: Record<StatusIA, string> = {
  inativa: 'Desligada (atendimento humano)',
  ativa: 'Ativa (IA responde sozinha)',
  pausada_humano: 'Pausada (humano assumiu)',
};

export type Lead = {
  id: string;
  nome: string | null;
  telefone: string;
  email: string | null;
  status: LeadStatus;
  origem: LeadOrigem;
  temperatura: LeadTemperatura;
  atendimentoHumano: boolean;
  corretorId: string | null;
  corretor: Usuario | null;
  imovel: Imovel | null;
  criadoEm: string;
  alerta: AlertaLead;
  horasParado: number | null;
  dataAgendamento: string | null;
  tipoAgendamento: TipoAgendamento | null;
  naoLida: boolean;
  ultimaMensagemEm: string | null;
  statusIA: StatusIA;
  score: number;
  perfilBusca: PerfilBusca | null;
  perfilSemantico: string | null;
};

export type OrigemDocumento = 'pdf' | 'url';

export type Documento = {
  id: string;
  titulo: string;
  origem: OrigemDocumento;
  urlOrigem: string | null;
  criadoEm: string;
  _count: { chunks: number };
};

export type NotaInterna = {
  id: string;
  leadId: string;
  texto: string;
  criadoEm: string;
  usuario: { id: string; nome: string };
};

export type ListaLeadsResposta = {
  items: Lead[];
  total: number;
  page: number;
  pageSize: number;
};

export type MensagemDirecao = 'enviada' | 'recebida';
export type MensagemStatus = 'pendente' | 'enviada' | 'entregue' | 'lida' | 'falhou';

export type Mensagem = {
  id: string;
  leadId: string;
  direcao: MensagemDirecao;
  conteudo: string;
  status: MensagemStatus;
  enviadaPorUsuarioId: string | null;
  enviadaPorUsuario: { id: string; nome: string } | null;
  criadoEm: string;
};

// GET /api/leads/:id retorna o lead + histórico de mensagens
export type LeadDetalhado = Lead & {
  mensagens: Mensagem[];
};

export const ROTULO_STATUS: Record<LeadStatus, string> = {
  novo: 'Novo Lead',
  respondeu: 'Aguardando Resposta',
  em_atendimento: 'Em Atendimento',
  visita_agendada: 'Visita Agendada',
  proposta: 'Proposta',
  negocio_fechado: 'Negócio Fechado',
  frio_standby: 'Standby / Nutrição',
  perdido: 'Perdido',
};

export type QuickReplyTipo = 'global' | 'pessoal';

export type QuickReply = {
  id: string;
  titulo: string;
  textoMensagem: string;
  tipo: QuickReplyTipo;
  usuarioId: string | null;
  ativo: boolean;
  paraAvaliacaoGoogle: boolean;
};

// --- Templates de mensagem (WhatsApp Cloud API — usados em cadência e campanhas) ---

export type MidiaTipo = 'image' | 'video' | 'document';

export const ROTULO_MIDIA_TIPO: Record<MidiaTipo, string> = {
  image: 'Imagem',
  video: 'Vídeo',
  document: 'Documento (PDF)',
};

export type TemplateMensagem = {
  id: string;
  nome: string;
  conteudo: string;
  metaTemplateName: string | null;
  aprovadoMeta: boolean;
  midiaTipo: MidiaTipo | null;
  criadoEm: string;
};

// --- Campanhas de disparo em massa ---

export type CampanhaDisparoStatus = 'rascunho' | 'pronta' | 'enviando' | 'concluida' | 'cancelada';

export const ROTULO_STATUS_CAMPANHA: Record<CampanhaDisparoStatus, string> = {
  rascunho: 'Rascunho',
  pronta: 'Pronta para envio',
  enviando: 'Enviando',
  concluida: 'Concluída',
  cancelada: 'Cancelada',
};

export type FiltroPublico = {
  origem?: LeadOrigem;
  status?: LeadStatus;
  temperatura?: LeadTemperatura;
  busca?: string;
};

export type CampanhaDisparo = {
  id: string;
  nome: string;
  templateMensagemId: string;
  templateMensagem: TemplateMensagem;
  status: CampanhaDisparoStatus;
  midiaUrl: string | null;
  criadoPor: { id: string; nome: string };
  criadoEm: string;
  atualizadoEm: string;
  _count: { destinatarios: number };
};

export type CampanhaDisparoDestinatario = {
  id: string;
  status: string;
  enviadoEm: string | null;
  lead: { id: string; nome: string | null; telefone: string };
};

export type CampanhaDisparoDetalhado = CampanhaDisparo & {
  destinatarios: CampanhaDisparoDestinatario[];
  progresso: { pendente: number; enviado: number; falhou: number };
};
