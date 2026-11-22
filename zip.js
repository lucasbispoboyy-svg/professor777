'use strict';
// Leitor de ZIP simples (sem dependências): suporta arquivos "store" e "deflate".
const zlib = require('zlib');

function lerZip(buf) {
  // Procura o fim do diretório central (EOCD)
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Arquivo ZIP inválido.');
  const total = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const arquivos = [];
  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('ZIP corrompido.');
    const flags = buf.readUInt16LE(p + 8);
    const metodo = buf.readUInt16LE(p + 10);
    const tamComp = buf.readUInt32LE(p + 20);
    const tamNome = buf.readUInt16LE(p + 28);
    const tamExtra = buf.readUInt16LE(p + 30);
    const tamComent = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const nomeBuf = buf.subarray(p + 46, p + 46 + tamNome);
    const nome = (flags & 0x800 ? nomeBuf.toString('utf8') : nomeBuf.toString('latin1')).replace(/\\/g, '/');
    p += 46 + tamNome + tamExtra + tamComent;
    if (nome.endsWith('/') || nome.startsWith('__MACOSX/') || /(^|\/)\.DS_Store$/.test(nome)) continue;
    if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error('ZIP corrompido.');
    const inicio = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const dados = buf.subarray(inicio, inicio + tamComp);
    let conteudo;
    if (metodo === 0) conteudo = dados;
    else if (metodo === 8) conteudo = zlib.inflateRawSync(dados);
    else throw new Error(`O arquivo "${nome}" usa uma compressão não suportada. Gere o ZIP pelo Windows (Enviar para → Pasta compactada).`);
    arquivos.push({ nome, conteudo });
  }
  return arquivos;
}

module.exports = { lerZip };
