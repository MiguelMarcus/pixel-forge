/* Optional, on-device foreground segmentation. The runtime and weights load only on request. */
(function (root) {
  'use strict';

  var RUNTIME_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/+esm';
  var MODEL_ID = 'xrds/isnet-general-onnx-int8';
  var MODEL_REVISION = '71eff2372ec9c8edbc6ca637ded591423d23b65a';
  var segmenterPromise = null;

  function loadSegmenter(onProgress) {
    if (!segmenterPromise) {
      segmenterPromise = import(RUNTIME_URL).then(function (runtime) {
        runtime.env.useBrowserCache = true;
        return runtime.pipeline('background-removal', MODEL_ID, {
          dtype: 'q8',
          revision: MODEL_REVISION,
          progress_callback: onProgress
        });
      }).catch(function (error) {
        segmenterPromise = null;
        throw error;
      });
    }
    return segmenterPromise;
  }

  function resizeMask(raw, width, height) {
    var channels = raw.channels || Math.round(raw.data.length / (raw.width * raw.height));
    if (!raw.width || !raw.height || !channels || raw.data.length < raw.width * raw.height * channels) {
      throw new Error('o modelo retornou uma máscara inválida');
    }

    var mask = new Uint8Array(width * height);
    for (var y = 0; y < height; y++) {
      var sy = (y + 0.5) * raw.height / height - 0.5;
      var y0 = Math.max(0, Math.floor(sy)), y1 = Math.min(raw.height - 1, y0 + 1);
      var fy = Math.max(0, sy - y0);
      for (var x = 0; x < width; x++) {
        var sx = (x + 0.5) * raw.width / width - 0.5;
        var x0 = Math.max(0, Math.floor(sx)), x1 = Math.min(raw.width - 1, x0 + 1);
        var fx = Math.max(0, sx - x0);
        var a = raw.data[(y0 * raw.width + x0) * channels];
        var b = raw.data[(y0 * raw.width + x1) * channels];
        var c = raw.data[(y1 * raw.width + x0) * channels];
        var d = raw.data[(y1 * raw.width + x1) * channels];
        var top = a + (b - a) * fx;
        var bottom = c + (d - c) * fx;
        mask[y * width + x] = Math.max(0, Math.min(255, Math.round(top + (bottom - top) * fy)));
      }
    }
    return mask;
  }

  async function segmentForeground(image, onProgress) {
    if (!image || !image.width || !image.height ||
        image.data.length !== image.width * image.height * 4) {
      throw new Error('imagem inválida para segmentação');
    }
    if (typeof document === 'undefined') throw new Error('segmentação requer um navegador');

    var canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    var context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('não foi possível criar o canvas para segmentação');
    var pixels = context.createImageData(image.width, image.height);
    pixels.data.set(image.data);
    context.putImageData(pixels, 0, 0);

    var segmenter = await loadSegmenter(onProgress);
    var results = await segmenter(canvas);
    var prediction = Array.isArray(results) ? results[0] : results;
    var rawMask = prediction && (prediction.mask || prediction);
    if (!rawMask || !rawMask.data) throw new Error('o modelo não retornou uma máscara');

    return root.PF.applyForegroundMask(
      image,
      resizeMask(rawMask, image.width, image.height)
    );
  }

  root.PF.segmentForeground = segmentForeground;
})(typeof self !== 'undefined' ? self : this);
