const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');

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
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Insert the student photo into the DOCX template by replacing the placeholder image.
 * 
 * Strategy: The template has an image placeholder (image1.jpeg → rId4).
 * We simply replace that image file in the ZIP with the student photo.
 * All positioning, sizing, and formatting stays intact.
 */
function insertPhoto(zip, documentXml, photoBuffer) {
  // Find the photo placeholder — try both .jpeg and .png
  let photoPlaceholder = null;
  for (const name of ['word/media/image1.jpeg', 'word/media/image1.png']) {
    if (zip.file(name)) {
      photoPlaceholder = name;
      break;
    }
  }
  
  if (photoPlaceholder) {
    zip.file(photoPlaceholder, photoBuffer);
    console.log(`Replaced ${photoPlaceholder} with student photo (${photoBuffer.length} bytes)`);
  } else {
    console.warn(`Photo placeholder ${photoPlaceholder} not found in template — photo not inserted`);
  }

  // Photo frame stays at template's original size — no resize needed
  // Just remove noChangeAspect lock so Word doesn't complain about aspect ratio
  const rid4Pos = documentXml.indexOf('r:embed="rId4"');
  if (rid4Pos >= 0) {
    const anchorStart = documentXml.lastIndexOf('<wp:anchor', rid4Pos);
    const anchorEnd = documentXml.indexOf('</wp:anchor>', rid4Pos);
    if (anchorStart >= 0 && anchorEnd > anchorStart) {
      let anchor = documentXml.substring(anchorStart, anchorEnd + 12);
      anchor = anchor.replace(/noChangeAspect="1"/g, 'noChangeAspect="0"');
      documentXml = documentXml.substring(0, anchorStart) + anchor + documentXml.substring(anchorEnd + 12);
    }
  }

  return documentXml;
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
    '{{TIMESTAMP}}': student.createdAt ? new Date(student.createdAt).toLocaleString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '',
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

module.exports = { generateIDCardDocx };