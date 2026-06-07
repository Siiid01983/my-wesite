'use strict';

/* ════════════════════════════════════════════════════════
   PDF DOWNLOAD — Phase 12
   _capturePrintHtml: monkey-patches window.open to capture
   the HTML any print function would write, without opening
   a visible popup.
   _pdfDownload: renders captured HTML in an off-screen
   iframe, captures via html2canvas, exports with jsPDF.
   ════════════════════════════════════════════════════════ */
function _capturePrintHtml(printFn) {
  let captured = null;
  const orig = window.open;
  window.open = function() {
    window.open = orig;
    let html = '';
    return { document: { write(s) { html += s; }, close() { captured = html; } }, close() {} };
  };
  printFn();
  window.open = orig;
  return captured;
}

async function _pdfDownload(html, filename) {
  if (!window.html2canvas || !window.jspdf) {
    toast('PDFライブラリを読み込み中です。しばらく待ってから再試行してください'); return;
  }
  toast('PDF生成中...');
  const safeHtml = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;top:0;left:-9999px;width:794px;height:1123px;border:none';
  document.body.appendChild(iframe);
  iframe.contentDocument.open();
  iframe.contentDocument.write(safeHtml);
  iframe.contentDocument.close();
  await new Promise(r => setTimeout(r, 700));
  try {
    const { jsPDF } = window.jspdf;
    const canvas = await html2canvas(iframe.contentDocument.body, {
      scale: 2, useCORS: true, allowTaint: true,
      backgroundColor: '#ffffff', windowWidth: 794, scrollX: 0, scrollY: 0,
    });
    const imgData = canvas.toDataURL('image/jpeg', 0.93);
    const A4W = 210, A4H = 297;
    const imgH = (canvas.height / canvas.width) * A4W;
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
    let y = 0;
    while (y < imgH) {
      if (y > 0) pdf.addPage();
      pdf.addImage(imgData, 'JPEG', 0, -y, A4W, imgH);
      y += A4H;
    }
    pdf.save(filename);
    toast(`✓ ${filename}`);
  } catch(e) {
    console.error('[PDF]', e);
    toast('PDF生成に失敗しました');
  } finally {
    document.body.removeChild(iframe);
  }
}

async function downloadPDFCalendar()   { const h = _capturePrintHtml(printCalendar);          if (h) await _pdfDownload(h, '空き状況カレンダー.pdf'); }
async function downloadPDFCapacity()   { const h = _capturePrintHtml(printCapacity);          if (h) await _pdfDownload(h, '容量設定レポート.pdf'); }
async function downloadPDFPricing()    { const h = _capturePrintHtml(printPricing);           if (h) await _pdfDownload(h, '料金表.pdf'); }
async function downloadPDFDisposal()   { const h = _capturePrintHtml(printDisposal);          if (h) await _pdfDownload(h, '不用品処分料金表.pdf'); }
async function downloadPDFReport()     { const h = _capturePrintHtml(printReport);            if (h) await _pdfDownload(h, '売上レポート.pdf'); }
async function downloadPDFBackup()     { const h = _capturePrintHtml(printBackup);            if (h) await _pdfDownload(h, 'システム状況レポート.pdf'); }
async function downloadPDFAnalytics()  { const h = _capturePrintHtml(printAnalytics);         if (h) await _pdfDownload(h, '分析レポート.pdf'); }
async function downloadPDFQuote(id)    { const h = _capturePrintHtml(() => printQuote(id));   if (h) await _pdfDownload(h, `見積り確認書_${id}.pdf`); }
async function downloadPDFReview(id)   { const h = _capturePrintHtml(() => printReview(id));  if (h) await _pdfDownload(h, `レビュー確認_${id}.pdf`); }
async function downloadPDFCustomer(id) { const h = _capturePrintHtml(() => printCustomer(id));if (h) await _pdfDownload(h, `顧客プロフィール_${id}.pdf`); }