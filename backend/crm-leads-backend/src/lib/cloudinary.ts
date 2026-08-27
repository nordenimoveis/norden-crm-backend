import { v2 as cloudinary } from 'cloudinary';
import { env } from '@/config/env';

let configurado = false;

function garantirConfiguracao() {
  if (configurado) return;

  if (!env.CLOUDINARY_CLOUD_NAME || !env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET) {
    throw new Error('CLOUDINARY_NAO_CONFIGURADO');
  }

  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
  });

  configurado = true;
}

export type ResultadoUpload = {
  url: string;
  tipo: 'image' | 'video' | 'document';
};

/**
 * Sobe um arquivo pro Cloudinary a partir do buffer em memória (recebido via
 * multipart) e devolve a URL segura (https) pronta pra usar como cabeçalho
 * de mídia num template do WhatsApp.
 */
export async function uploadMidia(buffer: Buffer, mimeType: string): Promise<ResultadoUpload> {
  garantirConfiguracao();

  const tipo = inferirTipo(mimeType);

  // resource_type 'auto' deixa o Cloudinary decidir a categoria interna —
  // usamos nosso próprio `tipo` (derivado do mimeType) pro que importa de
  // verdade aqui, que é qual campo a API do WhatsApp espera (image/video/document).
  const resultado = await new Promise<{ secure_url: string }>((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { resource_type: 'auto', folder: 'norden-crm/campanhas' },
      (erro, resultado) => {
        if (erro || !resultado) return reject(erro ?? new Error('Falha no upload'));
        resolve(resultado as { secure_url: string });
      }
    );
    uploadStream.end(buffer);
  });

  return { url: resultado.secure_url, tipo };
}

function inferirTipo(mimeType: string): 'image' | 'video' | 'document' {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  return 'document';
}

/**
 * Devolve uma URL da imagem segura para o cabeçalho de template do WhatsApp:
 * a Meta rejeita imagem acima de 5 MB (erro 131053) e só aceita JPEG/PNG. Se a
 * URL for do Cloudinary, injetamos uma transformação on-the-fly que limita a
 * largura, comprime com qualidade automática e força JPEG — o suficiente para
 * ficar abaixo do limite sem perda visível, sem alterar o arquivo original.
 *
 * Só se aplica a imagem. Vídeo/documento (limites bem maiores) passam direto,
 * e qualquer URL que não seja do Cloudinary também é devolvida sem mudança.
 */
export function urlImagemWhatsapp(url: string, tipo: 'image' | 'video' | 'document'): string {
  if (tipo !== 'image') return url;
  const marcador = '/upload/';
  const i = url.indexOf(marcador);
  if (i === -1 || !url.includes('res.cloudinary.com')) return url;

  // c_limit só reduz se for maior que o limite; q_auto:good equilibra
  // qualidade x tamanho; f_jpg garante um formato que o WhatsApp aceita.
  const transformacao = 'c_limit,w_1600,q_auto:good,f_jpg/';
  const depois = url.slice(i + marcador.length);
  // Evita duplicar a transformação se por algum motivo já estiver aplicada.
  if (depois.startsWith(transformacao)) return url;
  return url.slice(0, i + marcador.length) + transformacao + depois;
}
