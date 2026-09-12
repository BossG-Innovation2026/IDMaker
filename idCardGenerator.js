const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const fs = require('fs');
const path = require('path');

const PLACEHOLDER_DIR = path.join(__dirname, 'public', 'placeholders');
const WIDTH = 252;
const HEIGHT = 158.4;

function loadImageIfExists(filePath) {
  if (filePath && fs.existsSync(filePath)) {
    return fs.readFileSync(filePath);
  }
  return null;
}

function getStrandFromSection(section) {
  if (!section) return 'ACADEMIC';
  const upper = section.toUpperCase();
  if (upper.includes('STEM')) return 'STEM';
  if (upper.includes('ABM')) return 'ABM';
  if (upper.includes('HUMSS')) return 'HUMSS';
  if (upper.includes('TVL')) return 'TVL';
  if (upper.includes('GAS')) return 'GAS';
  return 'ACADEMIC';
}

async function generateIDCardPDF(student, photoPath) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const photoBuf = loadImageIfExists(photoPath);
  const sealBuf = loadImageIfExists(path.join(PLACEHOLDER_DIR, 'seal.png'));
  const depedBuf = loadImageIfExists(path.join(PLACEHOLDER_DIR, 'deped.png'));

  const lastName = (student.lastName || '').toUpperCase();
  const firstName = (student.firstName || '').toUpperCase();
  const middleName = student.middleName ? student.middleName.toUpperCase() : '';
  const mi = student.middleName ? student.middleName.charAt(0) + '.' : '';
  const strand = getStrandFromSection(student.section);

  const formattedDate = new Date(student.birthday).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric'
  });

  const GREEN = rgb(0.106, 0.369, 0.125);
  const DARK = rgb(0.2, 0.2, 0.2);
  const WHITE = rgb(1, 1, 1);

  // ===== FRONT =====
  const front = pdfDoc.addPage([WIDTH, HEIGHT]);

  front.drawRectangle({ x: 0, y: 0, width: WIDTH, height: HEIGHT, color: rgb(0.91, 0.96, 0.91) });
  front.drawRectangle({ x: 0, y: 0, width: WIDTH, height: HEIGHT, borderColor: GREEN, borderWidth: 2 });

  if (photoBuf) {
    let photoImg;
    try { photoImg = await pdfDoc.embedJpg(photoBuf); } catch(e) {
      try { photoImg = await pdfDoc.embedPng(photoBuf); } catch(e2) {}
    }
    if (photoImg) {
      front.drawImage(photoImg, { x: 8, y: 68, width: 58, height: 70 });
    }
  }
  front.drawRectangle({ x: 8, y: 68, width: 58, height: 70, borderColor: GREEN, borderWidth: 1 });

  if (sealBuf) {
    try {
      const sealImg = await pdfDoc.embedPng(sealBuf);
      front.drawImage(sealImg, { x: 130, y: 80, width: 65, height: 65 });
    } catch(e) {}
  }

  front.drawText(student.studentNo || '', {
    x: 155, y: 72, size: 11, font: boldFont, color: GREEN
  });

  front.drawText('LRN ::', {
    x: 210, y: 115, size: 6, font: boldFont, color: GREEN
  });

  front.drawText(lastName, {
    x: 8, y: 52, size: 14, font: boldFont, color: GREEN
  });

  front.drawText(`${firstName} ${mi}`, {
    x: 8, y: 38, size: 10, font: boldFont, color: GREEN
  });

  front.drawText(strand, {
    x: 150, y: 42, size: 16, font: boldFont, color: GREEN
  });

  front.drawText('VALID FOR 2026-2027 / 2027-2028', {
    x: 145, y: 28, size: 5, font: boldFont, color: GREEN
  });

  // ===== BACK =====
  const back = pdfDoc.addPage([WIDTH, HEIGHT]);

  back.drawRectangle({ x: 0, y: 0, width: WIDTH, height: HEIGHT, borderColor: GREEN, borderWidth: 2 });

  back.drawText('STUDENT INFORMATION', {
    x: 85, y: 143, size: 6, font: boldFont, color: DARK
  });

  const fullName = middleName ? `${firstName} ${middleName} ${lastName}` : `${firstName} ${lastName}`;
  back.drawText(fullName, {
    x: 55, y: 132, size: 10, font: boldFont, color: GREEN
  });

  back.drawText(student.address || '', {
    x: 100, y: 123, size: 6, font, color: DARK
  });

  back.drawText(formattedDate, {
    x: 108, y: 115, size: 6, font, color: DARK
  });

  back.drawLine({ start: { x: 80, y: 105 }, end: { x: 180, y: 105 }, thickness: 0.5, color: rgb(0.6, 0.6, 0.6) });
  back.drawText('Student Signature', {
    x: 105, y: 100, size: 4, font, color: rgb(0.5, 0.5, 0.5)
  });

  back.drawLine({ start: { x: 10, y: 95 }, end: { x: 242, y: 95 }, thickness: 0.5, color: GREEN });

  back.drawText('IN CASE OF EMERGENCY', {
    x: 85, y: 88, size: 6, font: boldFont, color: GREEN
  });

  back.drawText('PARENT/GUARDIAN', {
    x: 85, y: 79, size: 7, font: boldFont, color: DARK
  });

  back.drawText(`${student.parentName || ''} | ${student.contactNumber || ''}`, {
    x: 65, y: 70, size: 6, font, color: DARK
  });

  const terms = 'This card is non-transferable. The loss of this card must be reported immediately to the issuing office. A replacement fee will be charged for duplicate cards. Any form of misuse will be subject to disciplinary action. Cabiao Senior High School is dedicated to providing safe and conducive learning environments where students thrive under the guidance of our educators.';

  const termsLines = [];
  let remaining = terms;
  while (remaining.length > 0) {
    termsLines.push(remaining.substring(0, 110));
    remaining = remaining.substring(110);
  }

  termsLines.forEach((line, i) => {
    back.drawText(line, {
      x: 15, y: 58 - (i * 6), size: 4, font, color: rgb(0.33, 0.33, 0.33)
    });
  });

  back.drawText('MARVIN A. BATOY', {
    x: 15, y: 22, size: 6, font: boldFont, color: DARK
  });
  back.drawText('SCHOOL PRINCIPAL III', {
    x: 15, y: 16, size: 4.5, font, color: DARK
  });

  if (depedBuf) {
    try {
      const depedImg = await pdfDoc.embedPng(depedBuf);
      back.drawImage(depedImg, { x: 218, y: 10, width: 30, height: 24 });
    } catch(e) {}
  }

  back.drawText('LRN ::', {
    x: 230, y: 115, size: 6, font: boldFont, color: GREEN
  });

  return Buffer.from(await pdfDoc.save());
}

module.exports = { generateIDCardPDF };
