import pdfParse from 'pdf-parse';
import * as cheerio from 'cheerio';

export async function extrairTextoDePdf(buffer: Buffer): Promise<string> {
  const resultado = await pdfParse(buffer);
  return resultado.text;
}

export async function extrairTextoDeUrl(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Não foi possível acessar a URL (status ${response.status})`);

  const html = await response.text();
  const $ = cheerio.load(html);
  $('script, style, nav, footer, header').remove();
  return $('body').text();
}
