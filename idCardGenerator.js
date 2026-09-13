const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const { execSync } = require('child_process');

const TEMPLATE_PATH = path.join(__dirname, 'templates', 'id-template.docx');

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

function generateIDCardDocx(student) {
  const templateBuf = fs.readFileSync(TEMPLATE_PATH);
  const zip = new PizZip(templateBuf);

  const mi = student.middleName ? student.middleName.charAt(0) + '.' : '';
  const formattedDate = new Date(student.birthday).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric'
  });

  const replacements = {
    '{{FIRSTNAME}}': (student.firstName || '').toUpperCase(),
    '{{MIDDLENAME}}': student.middleName ? student.middleName.toUpperCase() : '',
    '{{LASTNAME}}': (student.lastName || '').toUpperCase(),
    '{{M.I.}}': mi.toUpperCase(),
    '{{BIRTHDAY}}': formattedDate,
    '{{SEX}}': student.sex || '',
    '{{ADDRESS}}': student.address || '',
    '{{GUARDIAN}}': (student.parentName || '').toUpperCase(),
    '{{CONTACT}}': student.contactNumber || '',
    '{{LRN}}': student.lrn || '',
    '{{SECTION}}': student.section || '',
    '{{STUDENT_NO}}': student.studentNo || '',
    '{{STRAND}}': getStrandFromSection(student.section)
  };

  let documentXml = zip.file('word/document.xml').asText();
  for (const [tag, value] of Object.entries(replacements)) {
    while (documentXml.includes(tag)) {
      documentXml = documentXml.replace(tag, value);
    }
  }
  zip.file('word/document.xml', documentXml);
  return zip.generate({ type: 'nodebuffer' });
}

function convertDocxToPdf(docxBuffer, studentId) {
  const tmpDir = path.join(__dirname, 'uploads');
  const tmpDocx = path.join(tmpDir, `_tmp_${studentId}.docx`);
  const tmpPdf = path.join(tmpDir, `_tmp_${studentId}.pdf`);

  fs.writeFileSync(tmpDocx, docxBuffer);

  try {
    execSync(
      `libreoffice --headless --convert-to pdf --outdir "${tmpDir}" "${tmpDocx}"`,
      { timeout: 30000, windowsHide: true, stdio: 'pipe' }
    );
    const pdfBuffer = fs.readFileSync(tmpPdf);
    try { fs.unlinkSync(tmpPdf); } catch(e) {}
    return pdfBuffer;
  } catch(e) {
    return null;
  } finally {
    try { fs.unlinkSync(tmpDocx); } catch(e) {}
  }
}

function generateIDCard(student) {
  const docxBuffer = generateIDCardDocx(student);
  const pdfBuffer = convertDocxToPdf(docxBuffer, student.id || Date.now().toString());
  return pdfBuffer || docxBuffer;
}

module.exports = { generateIDCard, generateIDCardDocx };
