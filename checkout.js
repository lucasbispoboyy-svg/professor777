'use strict';

// Checkout desativado temporariamente para testar a inicialização do servidor.

const GATEWAYS = {};

function mascarar(valor) {
  if (!valor) return '';
  return '••••' + String(valor).slice(-4);
}

async function iniciar() {
  return {
    erro: 'Checkout temporariamente desativado.'
  };
}

module.exports = {
  GATEWAYS,
  mascarar,
  iniciar
};
