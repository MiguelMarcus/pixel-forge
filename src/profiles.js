/*
 * Perfis de aplicação.
 *
 * Cada classe de asset tem regras opostas: personagem precisa de pé na base e
 * outline fechado; fundo precisa ser opaco, preencher o quadro e emendar quando
 * repetido; prop precisa ficar centralizado e legível em qualquer posição.
 *
 * O perfil define três coisas: os padrões do pipeline, o contrato e quais
 * regras extras de validação rodam.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else factory(root.PF);
})(typeof self !== 'undefined' ? self : this, function (PF) {
  'use strict';

  var PROFILES = {

    character: {
      id: 'character',
      name: 'Personagem',
      hint: 'pé na base · outline fechado · silhueta limpa',
      sizeMode: 'square',
      sizes: [16, 32, 48, 64],
      autoBg: true,
      defaults: {
        sizeW: 64, sizeH: 64,
        mode: 'shape', fit: 'contain', align: 'bottom', margin: 1,
        autoCrop: true, removeBg: true, bgTolerance: 32,
        alpha: 128, dither: 'none', ditherAmount: 50,
        outline: true, outlineRadius: 1, outlineDiag: false,
        orphanCleanup: true, palette: 'sweetie16', scrollFactor: 1, extractMode: 'dominant',
        removeBW: false, bwTolerance: 12, outlineColor: '#101018', outlineAuto: true, outlineInner: false, silhouette: 'off'
      },
      contract: {
        maxColors: 16, minDistance: 16, requireOutline: true,
        requireMargin: false, maxOrphans: 0,
        rules: ['ground', 'centeredX']
      },
      pivot: function (w, h) { return { x: Math.floor(w / 2), y: h - 1 }; }
    },

    prop: {
      id: 'prop',
      name: 'Objeto / prop',
      hint: 'centralizado · outline · leitura em qualquer posição',
      sizeMode: 'square',
      sizes: [16, 32, 48, 64],
      autoBg: true,
      defaults: {
        sizeW: 64, sizeH: 64,
        mode: 'shape', fit: 'contain', align: 'center', margin: 1,
        autoCrop: true, removeBg: true, bgTolerance: 32,
        alpha: 128, dither: 'none', ditherAmount: 50,
        outline: true, outlineRadius: 1, outlineDiag: false,
        orphanCleanup: true, palette: 'pico8', scrollFactor: 1, extractMode: 'dominant',
        removeBW: false, bwTolerance: 12, outlineColor: '#101018', outlineAuto: true, outlineInner: false, silhouette: 'off'
      },
      contract: {
        maxColors: 12, minDistance: 16, requireOutline: true,
        requireMargin: false, maxOrphans: 0,
        rules: ['centered']
      },
      pivot: function (w, h) { return { x: Math.floor(w / 2), y: Math.floor(h / 2) }; }
    },

    background: {
      id: 'background',
      name: 'Fundo / parallax',
      hint: 'opaco · preenche o quadro · emenda · 32+ cores',
      sizeMode: 'rect',
      sizes: [[320, 180], [384, 216], [480, 270], [512, 288], [640, 360]],
      autoBg: false,
      defaults: {
        sizeW: 320, sizeH: 180,
        mode: 'box', fit: 'cover', align: 'center', margin: 0,
        autoCrop: false, removeBg: false, bgTolerance: 32,
        alpha: 128, dither: 'none', ditherAmount: 30,
        outline: false, outlineRadius: 1, outlineDiag: false,
        orphanCleanup: false, palette: 'sweetie16', scrollFactor: 0.5, extractMode: 'spread',
        removeBW: false, bwTolerance: 12, outlineColor: '#101018', outlineAuto: true, outlineInner: false, silhouette: 'off'
      },
      contract: {
        maxColors: 64, minDistance: 8, requireOutline: false,
        requireMargin: false, maxOrphans: 4,
        rules: ['opaque', 'fullFrame', 'seamlessX', 'noOutline']
      },
      pivot: function () { return null; }
    }
  };

  var ORDER = ['character', 'prop', 'background'];

  function list() {
    var out = [];
    for (var i = 0; i < ORDER.length; i++) out.push(PROFILES[ORDER[i]]);
    return out;
  }

  function get(id) {
    return PROFILES[id] || PROFILES.character;
  }

  function paramsFor(id) {
    var p = get(id);
    var out = {};
    for (var k in p.defaults) {
      if (Object.prototype.hasOwnProperty.call(p.defaults, k)) out[k] = p.defaults[k];
    }
    return out;
  }

  function contractFor(id) {
    var c = get(id).contract;
    return {
      maxColors: c.maxColors,
      minDistance: c.minDistance,
      requireOutline: c.requireOutline,
      requireMargin: c.requireMargin,
      maxOrphans: c.maxOrphans,
      rules: (c.rules || []).slice()
    };
  }

  function pivotFor(id, w, h) {
    var p = get(id);
    return p.pivot ? p.pivot(w, h) : null;
  }

  if (PF) {
    PF.PROFILES = PROFILES;
    PF.profileList = list;
    PF.profileGet = get;
    PF.profileParams = paramsFor;
    PF.profileContract = contractFor;
    PF.profilePivot = pivotFor;
  }

  return {
    PROFILES: PROFILES,
    list: list,
    get: get,
    paramsFor: paramsFor,
    contractFor: contractFor,
    pivotFor: pivotFor
  };
});
