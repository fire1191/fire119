'use strict';
const sheetLink=document.getElementById('sheet-link');
sheetLink.href=window.APP_CONFIG.spreadsheetUrl;
const url=window.APP_CONFIG.siteUrl;
document.getElementById('site-link').href=url;
try{const qr=qrcode(0,'M');qr.addData(url);qr.make();const data=qr.createDataURL(8,32);document.getElementById('qr-image').src=data;document.getElementById('qr-download').href=data;}catch{document.getElementById('qr-caption').textContent='QR을 불러오지 못했습니다. 새로고침해 주세요.';}
