const Docxtemplater = require('docxtemplater');
const PizZip = require('pizzip');
const fs = require('fs');
const path = require('path');

const TEMPLATE_PATH = path.join(__dirname, 'templates', 'id-template.docx');
const PLACEHOLDER_DIR = path.join(__dirname, 'public', 'placeholders');

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
  const templateBuf = fs.readFileSync(TEMPLATE_PATH);
  const zip = new PizZip(templateBuf);
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });

  const fullName = student.middleName
    ? `${student.firstName} ${student.middleName} ${student.lastName}`
    : `${student.firstName} ${student.lastName}`;

  const mi = student.middleName ? student.middleName.charAt(0) + '.' : '';

  const formattedDate = new Date(student.birthday).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric'
  });

  doc.render({
    FIRSTNAME: (student.firstName || '').toUpperCase(),
    MIDDLENAME: student.middleName ? student.middleName.toUpperCase() : '',
    LASTNAME: (student.lastName || '').toUpperCase(),
    MI: mi.toUpperCase(),
    LRN: student.lrn || '',
    STUDENT_NO: student.studentNo || '',
    SECTION: student.section || '',
    STRAND: getStrandFromSection(student.section),
    BIRTHDAY: formattedDate,
    ADDRESS: student.address || '',
    PARENT: (student.parentName || '').toUpperCase(),
    CONTACT: student.contactNumber || ''
  });

  const docxBuffer = doc.getZip().generate({ type: 'nodebuffer' });

  const outDir = path.join(__dirname, 'uploads');
  const tmpDocx = path.join(outDir, `_tmp_id_${student.id || Date.now()}.docx`);
  fs.writeFileSync(tmpDocx, docxBuffer);

  try {
    const { execSync } = require('child_process');
    const tmpPdf = tmpDocx.replace('.docx', '.pdf');

    try {
      execSync(`libreoffice --headless --convert-to pdf --outdir "${outDir}" "${tmpPdf.replace('.pdf', '.docx')}"`, {
        timeout: 30000,
        windowsHide: true
      });
      const pdfBuf = fs.readFileSync(tmpPdf);
      try { fs.unlinkSync(tmpPdf); } catch(e) {}
      return pdfBuf;
    } catch(e) {
      console.log('LibreOffice not available, returning .docx instead of PDF');
      return docxBuffer;
    }
  } finally {
    try { fs.unlinkSync(tmpDocx); } catch(e) {}
  }
}

function generateIDCardDocx(student, photoPath) {
  const templateBuf = fs.readFileSync(TEMPLATE_PATH);
  const zip = new PizZip(templateBuf);
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });

  const mi = student.middleName ? student.middleName.charAt(0) + '.' : '';

  const formattedDate = new Date(student.birthday).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric'
  });

  doc.render({
    FIRSTNAME: (student.firstName || '').toUpperCase(),
    MIDDLENAME: student.middleName ? student.middleName.toUpperCase() : '',
    LASTNAME: (student.lastName || '').toUpperCase(),
    MI: mi.toUpperCase(),
    LRN: student.lrn || '',
    STUDENT_NO: student.studentNo || '',
    SECTION: student.section || '',
    STRAND: getStrandFromSection(student.section),
    BIRTHDAY: formattedDate,
    ADDRESS: student.address || '',
    PARENT: (student.parentName || '').toUpperCase(),
    CONTACT: student.contactNumber || ''
  });

  return doc.getZip().generate({ type: 'nodebuffer' });
}

module.exports = { generateIDCardPDF, generateIDCardDocx };
