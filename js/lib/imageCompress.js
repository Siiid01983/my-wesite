/* ════════════════════════════════════════════════════════════════════════════
   imageCompress.js — client-side image downscale + recompress before upload
   (window.HMImageCompress). Mobile-first: shrinks large camera photos so uploads
   are fast and cheap without hurting readability.

   HMImageCompress.process(file, opts?) → Promise<File>
     • Only touches raster photos (JPEG/PNG/WebP). NON-images, PDFs and animated
       GIFs are returned UNCHANGED (never lose a document or animation).
     • Resizes so the longest edge ≤ maxEdge (default 1600px); re-encodes to JPEG
       (or WebP where supported) at `quality`. If the result isn't smaller than the
       original (already tiny), the original is kept.
     • Fully self-contained (canvas + createObjectURL); no network, no deps.
     • Never rejects — on any failure it resolves the ORIGINAL file, so the upload
       pipeline is never blocked by compression.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.HMImageCompress) return;

  var COMPRESSIBLE = { 'image/jpeg': 1, 'image/png': 1, 'image/webp': 1 };

  function _supportsWebp() {
    try {
      var c = document.createElement('canvas');
      return c.toDataURL('image/webp').indexOf('data:image/webp') === 0;
    } catch (_) { return false; }
  }

  function _renamed(name, ext) {
    var base = String(name || 'image').replace(/\.[^.]+$/, '');
    return base + '.' + ext;
  }

  function process(file, opts) {
    opts = opts || {};
    var maxEdge = opts.maxEdge || 1600;
    var quality = opts.quality || 0.82;
    return new Promise(function (resolve) {
      try {
        if (!file || !file.type || !COMPRESSIBLE[file.type]) return resolve(file);   // skip non-photos
        // Small files rarely benefit; skip < ~150KB to avoid pointless work.
        if (file.size && file.size < 150 * 1024) return resolve(file);

        var url = URL.createObjectURL(file);
        var img = new Image();
        img.onload = function () {
          try {
            var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
            if (!w || !h) { URL.revokeObjectURL(url); return resolve(file); }
            var scale = Math.min(1, maxEdge / Math.max(w, h));
            var tw = Math.max(1, Math.round(w * scale)), th = Math.max(1, Math.round(h * scale));
            var canvas = document.createElement('canvas');
            canvas.width = tw; canvas.height = th;
            var ctx = canvas.getContext('2d');
            if (!ctx) { URL.revokeObjectURL(url); return resolve(file); }
            ctx.drawImage(img, 0, 0, tw, th);
            URL.revokeObjectURL(url);

            var useWebp = (opts.webp !== false) && _supportsWebp();
            var mime = useWebp ? 'image/webp' : 'image/jpeg';
            var ext  = useWebp ? 'webp' : 'jpg';
            canvas.toBlob(function (blob) {
              // Keep the original if compression didn't actually shrink it (or failed).
              if (!blob || (file.size && blob.size >= file.size)) return resolve(file);
              var out;
              try { out = new File([blob], _renamed(file.name, ext), { type: mime, lastModified: file.lastModified || 0 }); }
              catch (_) { out = blob; out.name = _renamed(file.name, ext); }   // Safari <14 File ctor fallback
              resolve(out);
            }, mime, quality);
          } catch (_) { try { URL.revokeObjectURL(url); } catch (e) {} resolve(file); }
        };
        img.onerror = function () { try { URL.revokeObjectURL(url); } catch (e) {} resolve(file); };
        img.src = url;
      } catch (_) { resolve(file); }
    });
  }

  // Convenience: process an array/FileList, preserving order.
  function processAll(files, opts) {
    return Promise.all(Array.prototype.slice.call(files || []).map(function (f) { return process(f, opts); }));
  }

  window.HMImageCompress = { process: process, processAll: processAll };
})();
