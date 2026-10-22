/*
 * Armazenamento do acervo.
 *
 * Cada item guarda a RECEITA (fonte + parâmetros + contrato), não o resultado:
 * o sprite é sempre re-derivável, então mudança de contrato ou de tamanho é
 * uma re-execução, não uma re-exportação manual.
 *
 * IndexedDB quando o navegador deixa (em file:// o Chrome costuma bloquear);
 * memória como queda silenciosa, e o arquivo .pfset como backup de verdade.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else factory(root.PF);
})(typeof self !== 'undefined' ? self : this, function (PF) {
  'use strict';

  var DB_NAME = 'pixelforge';
  var DB_VERSION = 1;

  function newId() {
    return 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function hasIDB() {
    try { return typeof indexedDB !== 'undefined' && indexedDB !== null; } catch (e) { return false; }
  }

  function openDB() {
    return new Promise(function (resolve, reject) {
      var req;
      try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { return reject(e); }
      req.onupgradeneeded = function () {
        var d = req.result;
        try {
          if (!d.objectStoreNames.contains('items')) d.createObjectStore('items', { keyPath: 'id' });
          if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
        } catch (e) { /* segue */ }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('indexedDB indisponível')); };
      req.onblocked = function () { reject(new Error('indexedDB bloqueado')); };
    });
  }

  function createStore() {
    var memory = new Map();
    var metaMem = new Map();
    var db = null;
    var kindName = 'memory';
    var lastError = null;

    var ready = hasIDB()
      ? openDB().then(function (d) { db = d; kindName = 'indexeddb'; return kindName; })
        .catch(function () { db = null; kindName = 'memory'; return kindName; })
      : Promise.resolve('memory');

    function read(storeName, request) {
      return ready.then(function () {
        if (!db) return request(null);
        return new Promise(function (resolve, reject) {
          try {
            var tx = db.transaction(storeName, 'readonly');
            var req = request(tx.objectStore(storeName));
            var result;
            req.onsuccess = function () { result = req.result; };
            tx.oncomplete = function () { resolve(result); };
            tx.onerror = tx.onabort = function () { reject(tx.error || new Error('falha ao ler o acervo')); };
          } catch (e) { reject(e); }
        });
      });
    }

    function all() {
      return read('items', function (store) {
        return store ? store.getAll() : Array.from(memory.values());
      });
    }

    function write(stores, operation, onCommit) {
      return ready.then(function () {
        if (!db) { onCommit(); return; }
        return new Promise(function (resolve, reject) {
          var tx;
          function fail(e) {
            lastError = (tx && tx.error) || e || new Error('não foi possível gravar o acervo');
            reject(lastError);
          }
          try {
            tx = db.transaction(stores, 'readwrite');
            tx.oncomplete = function () { lastError = null; onCommit(); resolve(); };
            tx.onerror = tx.onabort = function () { fail(); };
            operation(tx);
          } catch (e) {
            // Uma operação síncrona pode falhar depois de enfileirar outras escritas.
            if (tx) { try { tx.abort(); } catch (ignored) { /* já encerrada */ } }
            fail(e);
          }
        });
      });
    }

    function put(item) {
      return write(['items'], function (tx) {
        tx.objectStore('items').put(item);
      }, function () { memory.set(item.id, item); });
    }

    function remove(id) {
      return write(['items'], function (tx) {
        tx.objectStore('items').delete(id);
      }, function () { memory.delete(id); });
    }

    function clear() {
      return write(['items'], function (tx) {
        tx.objectStore('items').clear();
      }, function () { memory.clear(); });
    }

    function kind() { return kindName; }

    function putMeta(key, value) {
      return write(['meta'], function (tx) {
        tx.objectStore('meta').put(value, key);
      }, function () { metaMem.set(key, value); });
    }

    function getMeta(key) {
      return read('meta', function (store) { return store ? store.get(key) : metaMem.get(key); });
    }

    // Substitui itens e metadados juntos; um aborto preserva o projeto anterior.
    function replace(records, metadata) {
      return write(['items', 'meta'], function (tx) {
        var itemStore = tx.objectStore('items');
        var metaStore = tx.objectStore('meta');
        itemStore.clear();
        records.forEach(function (record) { itemStore.put(record); });
        Object.keys(metadata).forEach(function (key) { metaStore.put(metadata[key], key); });
      }, function () {
        memory = new Map(records.map(function (record) { return [record.id, record]; }));
        Object.keys(metadata).forEach(function (key) { metaMem.set(key, metadata[key]); });
      });
    }

    return {
      ready: ready, all: all, put: put, remove: remove, clear: clear, kind: kind,
      putMeta: putMeta, getMeta: getMeta, replace: replace,
      error: function () { return lastError; }
    };
  }



  function toSetFile(state) {
    return JSON.stringify({
      format: 'pixelforge-set',
      version: 1,
      created: new Date().toISOString(),
      profile: state.profile,
      contract: state.contract,
      sheet: state.sheet,
      anchorId: state.anchorId || null,
      shadow: state.shadow || null,
      items: (state.items || []).map(function (it) {
        return {
          id: it.id,
          name: it.name,
          profile: it.profile,
          params: it.params,
          contract: it.contract,
          source: it.sourceDataUrl,
          createdAt: it.createdAt
        };
      })
    }, null, 2);
  }

  function fromSetFile(text) {
    var data;
    try { data = JSON.parse(text); } catch (e) { throw new Error('o arquivo não é JSON válido'); }
    if (!data || data.format !== 'pixelforge-set') throw new Error('não é um conjunto do Pixel Forge');
    if (!Array.isArray(data.items)) throw new Error('conjunto sem assets');
    if (data.version !== 1) throw new Error('versão de conjunto não suportada');
    function positiveInt(v, max) { return Number.isInteger(v) && v > 0 && v <= max; }
    function profileValid(id) { return ['character', 'prop', 'background'].indexOf(id) !== -1; }
    function contractValid(c) {
      return c && positiveInt(c.maxColors, 256) && Number.isFinite(c.minDistance) && c.minDistance >= 0 &&
        Number.isFinite(c.maxOrphans) && c.maxOrphans >= 0 && Array.isArray(c.rules) &&
        c.rules.every(function (r) { return typeof r === 'string'; });
    }
    if (!profileValid(data.profile) || !contractValid(data.contract)) throw new Error('perfil ou contrato inválido');
    var ids = new Set();
    data.items.forEach(function (item, index) {
      var p = item && item.params;
      if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id) ||
        !profileValid(item.profile) || !contractValid(item.contract) || !p ||
        !positiveInt(p.sizeW, 2048) || !positiveInt(p.sizeH, 2048) ||
        !Array.isArray(p.palette) || !p.palette.length || p.palette.length > 256 ||
        !p.palette.every(function (c) { return typeof c === 'string' && !!PF.hexToRgb(c); }) ||
        typeof item.source !== 'string' || !/^data:image\//i.test(item.source)) {
        throw new Error('asset ' + (index + 1) + ' inválido');
      }
      ids.add(item.id);
    });
    if (data.sheet) {
      var s = data.sheet;
      if (!positiveInt(s.width, 2048) || !positiveInt(s.height, 2048) || !positiveInt(s.cell, 256) ||
        ['grid', 'ruler'].indexOf(s.mode) === -1 || !Number.isFinite(s.baseline) || s.baseline < 0 ||
        !Array.isArray(s.placements) || !s.placements.every(function (p) {
          return p && ids.has(p.assetId) && Number.isInteger(p.x) && Number.isInteger(p.y);
        })) throw new Error('layout da folha inválido');
    }
    if (data.anchorId && !ids.has(data.anchorId)) throw new Error('âncora não encontrada');
    if (data.shadow) {
      var sh = data.shadow;
      if (['ellipse', 'silhouette'].indexOf(sh.shape) === -1 || !PF.hexToRgb(sh.color) ||
        !Number.isFinite(sh.opacity) || sh.opacity < 0 || sh.opacity > 100 ||
        !Number.isFinite(sh.widthScale) || sh.widthScale < 0.3 || sh.widthScale > 3 ||
        !Number.isFinite(sh.squash) || sh.squash < 0.1 || sh.squash > 1 ||
        !Number.isInteger(sh.pad) || sh.pad < 0 || sh.pad > 64 ||
        !Number.isFinite(sh.offsetX) || !Number.isFinite(sh.offsetY)) throw new Error('sombra inválida');
    }
    return data;
  }

  if (PF) {
    PF.library = {
      createStore: createStore,
      toSetFile: toSetFile,
      fromSetFile: fromSetFile,
      newId: newId
    };
  }

  return { createStore: createStore, toSetFile: toSetFile, fromSetFile: fromSetFile, newId: newId };
});
