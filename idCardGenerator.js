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

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"');
}

/**
 * Build an inline drawing element for the picture placeholder.
 * Uses the same dimensions as the template's picture box (3648710 × 86360 EMU).
 */
function buildInlineDrawing(rId, cx, cy) {
  return `<w:r><w:rPr><w:rFonts w:ascii="Copperplate Gothic Bold" w:hAnsi="Copperplate Gothic Bold"/><w:spacing w:val="-4"/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0" wp14:anchorId="3EEF1DD2" wp14:editId="0616ACFE"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="100" name="Student Photo"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><pic:nvPicPr><pic:cNvPr id="100" name="Student Photo"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}

/**
 * Insert the student photo into the DOCX template, replacing the {{picture}} placeholder.
 * Adds the photo to word/media/photo.jpg and a new relationship rIdN → media/photo.jpg.
 * Replaces the {{picture}} text run with an inline drawing element.
 */
function insertPhoto(zip, documentXml, photoBuffer) {
  const relsFileName = 'word/_rels/document.xml.rels';
  let relsXml = zip.file(relsFileName) ? zip.file(relsFileName).asText() :
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;

  // Find the maximum existing relationship ID
  const maxIdMatch = relsXml.match(/Id="rId(\d+)"/g);
  let maxId = 0;
  if (maxIdMatch) {
    maxIdMatch.forEach(m => {
      const id = parseInt(m.match(/\d+/)[0]);
      if (id > maxId) maxId = id;
    });
  }
  const newRelId = `rId${maxId + 1}`;

  // Add the new relationship
  const newRel = `<Relationship Id="${newRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/photo.jpg"/>`;
  relsXml = relsXml.replace('</Relationships>', newRel + '</Relationships>');

  // Add the photo to the DOCX zip
  zip.file('word/media/photo.jpg', photoBuffer);

  // Update the relationships file
  zip.file(relsFileName, relsXml);

  // Dimensions for the picture box in the template (3648710 × 86360 EMU ≈ 5.1cm × 1.2cm)
  const cx = 3648710;
  const cy = 86360;

  // Build the inline drawing element with the new relationship ID
  const drawingXml = buildInlineDrawing(newRelId, cx, cy);

  // Replace the {{picture}} run with the drawing element.
  // The template has {{picture}} split across runs: {{ + picture}}
  // We need to find the <w:r> element that contains 'picture' in its <w:t> and replace it.
  let result = documentXml;

  // Strategy: Replace any <w:r> that contains 'picture' in its text content with the drawing element
  const pictureRunRegex = /<w:r[^>]*>[\s\S]*?<w:t[^>]*>picture<\/w:t>[^\n]*?<\/w:r>/gi;
  result = result.replace(pictureRunRegex, (match) => {
    // For each match, rebuild the run with the drawing element
    // Keep the original rPr (formatting) from the first run
    const rPrMatch = match.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/);
    const rPr = rPrMatch ? rPrMatch[1] : '';
    // Build the new run: rPr + drawing element (without the closing </w:r> since we'll add it)
    // Actually, let's just replace the entire run xml
    return buildInlineDrawing(newRelId, cx, cy);
  });

  // Also handle the case where picture appears without the opening braces (just the text)
  const pictureTextRegex = /<w:t[^>]*>picture<\/w:t>/g;
  result = result.replace(pictureTextRegex, '<w:t></w:t>');

  return result;
}

function replacePlaceholdersInXml(documentXml, replacements) {
  const runRe = /<w:r\b[^>]*>[\s\S]*?<\/w:r>/g;
  const runs = [];
  let m;
  while ((m = runRe.exec(documentXml)) !== null) {
    const full = m[0];
    const tMatch = full.match(/<w:t\b([^>]*)>([\s\S]*?)<\/w:t>/);
    runs.push({
      runXml: full,
      tAttrs: tMatch ? tMatch[1] : null,
      text: tMatch ? tMatch[2] : null,
      docStart: m.index,
      docEnd: m.index + full.length
    });
  }

  const texts = runs.map(r => r.text !== null ? r.text : '');
  const concat = texts.join('');

  const charAction = new Array(concat.length).fill('keep');
  const replaceMap = new Map();

  const tagList = Object.keys(replacements).sort((a, b) => b.length - a.length);
  for (const tag of tagList) {
    let from = 0;
    while (from < concat.length) {
      const idx = concat.indexOf(tag, from);
      if (idx === -1) break;
      const dominated = [...replaceMap.keys()].some(k => k >= idx && k < idx + tag.length);
      if (!dominated) {
        for (let i = idx; i < idx + tag.length; i++) {
          charAction[i] = (i === idx) ? 'replace' : 'skip';
        }
        replaceMap.set(idx, replacements[tag]);
      }
      from = idx + 1;
    }
  }

  const newTexts = [];
  let concatOffset = 0;
  for (let i = 0; i < texts.length; i++) {
    const origLen = texts[i].length;
    let newT = '';
    for (let j = 0; j < origLen; j++) {
      const gIdx = concatOffset + j;
      if (charAction[gIdx] === 'keep') {
        newT += concat[gIdx];
      } else if (charAction[gIdx] === 'replace') {
        newT += replaceMap.get(gIdx);
      }
    }
    newTexts.push(newT);
    concatOffset += origLen;
  }

  const parts = [];
  let scanPos = 0;
  for (let i = 0; i < runs.length; i++) {
    parts.push(documentXml.substring(scanPos, runs[i].docStart));

    if (runs[i].text === null) {
      parts.push(runs[i].runXml);
    } else {
      const nt = newTexts[i];
      let attrs = runs[i].tAttrs || '';
      if (nt.length > 0 && (nt[0] === ' ' || nt[nt.length - 1] === ' ')) {
        if (!attrs.includes('xml:space')) {
          attrs += ' xml:space="preserve"';
        }
      }
      const newT = `<w:t${attrs}>${escapeXml(nt)}</w:t>`;
      const newRunXml = runs[i].runXml.replace(/<w:t\b[^>]*>[\s\S]*?<\/w:t>/, newT);
      parts.push(newRunXml);
    }
    scanPos = runs[i].docEnd;
  }
  parts.push(documentXml.substring(scanPos));
  return parts.join('');
}

function generateIDCardDocx(student, photoBuffer) {
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
  documentXml = replacePlaceholdersInXml(documentXml, replacements);

  if (photoBuffer) {
    documentXml = insertPhoto(zip, documentXml, photoBuffer);
  }

  zip.file('word/document.xml', documentXml);
  return zip.generate({ type: 'nodebuffer' });
}

function convertDocxToPdf(docxBuffer, studentId) {
  const tmpDir = path.join(__dirname, 'uploads');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  const tmpDocx = path.join(tmpDir, `_tmp_${studentId}.docx`);
  const tmpPdf = path.join(tmpDir, `_tmp_${studentId}.pdf`);
  fs.writeFileSync(tmpDocx, docxBuffer);

  try {
    let cmd;
    if (process.platform === 'win32') {
      const loPaths = [
        'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
        'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe'
      ];
      const loPath = loPaths.find(p => fs.existsSync(p));
      if (!loPath) return null;
      cmd = `"${loPath}" --headless --convert-to pdf --outdir "${tmpDir}" "${tmpDocx}"`;
    } else {
      cmd = `libreoffice --headless --convert-to pdf --outdir "${tmpDir}" "${tmpDocx}"`;
    }
    execSync(cmd, { timeout: 60000, windowsHide: true, stdio: 'pipe' });
    if (fs.existsSync(tmpPdf)) {
      const pdfBuffer = fs.readFileSync(tmpPdf);
      try { fs.unlinkSync(tmpPdf); } catch (e) {}
      return pdfBuffer;
    }
  } catch (e) {
    console.error('PDF conversion failed:', e.message);
  } finally {
    try { fs.unlinkSync(tmpDocx); } catch (e) {}
  }
  return null;
}

function generateIDCard(student, photoBuffer) {
  const docxBuffer = generateIDCardDocx(student, photoBuffer);
  const pdfBuffer = convertDocxToPdf(docxBuffer, student.id || Date.now().toString());
  return pdfBuffer || docxBuffer;
}

module.exports = { generateIDCard, generateIDCardDocx };