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
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Build a photo drawing that fits inside the text box frame.
 * srcRect crops the photo to the top-center region to zoom into the face.
 * The frame is very wide (4:1 ratio), so we crop the photo vertically to show
 * only the upper portion (face area) and horizontally center it.
 *
 * srcRect values are in 1/1000ths of a percent (100000 = 100%).
 * l/r crop sides horizontally, t/b crop top/bottom.
 * For a portrait photo (3:4), to fill a 4:1 frame we need to show ~20% of
 * the photo height. We take the top 20% centered horizontally.
 */
function buildPhotoDrawing(rId, cx, cy) {
  // Crop: show top 25% of photo height (face region), centered horizontally.
  // For a typical portrait photo this puts the face in frame.
  // l=25000 r=25000 = crop 25% from each side (keep center 50% width)
  // t=0 b=75000 = crop bottom 75% (keep top 25% height)
  const srcRect = `l="20000" t="0" r="20000" b="60000"`;
  return `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="100" name="Student Photo"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="0"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><pic:nvPicPr><pic:cNvPr id="100" name="Student Photo"/><pic:cNvPicPr><a:picLocks noChangeAspect="0"/></pic:cNvPicPr></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rId}"/><a:srcRect ${srcRect}/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`;
}

/**
 * Insert the student photo into the DOCX template, replacing the {{picture}} placeholder.
 *
 * Strategy:
 * 1. Find mc:AlternateContent blocks containing the actual {{picture}} placeholder
 *    (check for 'picture}}' not just 'picture' to avoid false positives from XML namespaces).
 * 2. Keep the mc:Choice section intact (preserves wp:anchor frame position/size/wrapping).
 * 3. Inside wps:txbxContent, replace the {{picture}} runs with the photo drawing.
 * 4. Photo is sized to the effective area (box minus padding) and cropped to face region.
 */
function insertPhoto(zip, documentXml, photoBuffer) {
  const relsFileName = 'word/_rels/document.xml.rels';
  let relsXml = zip.file(relsFileName) ? zip.file(relsFileName).asText() :
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;

  const maxIdMatch = relsXml.match(/Id="rId(\d+)"/g);
  let maxId = 0;
  if (maxIdMatch) {
    maxIdMatch.forEach(m => {
      const id = parseInt(m.match(/\d+/)[0]);
      if (id > maxId) maxId = id;
    });
  }
  const newRelId = `rId${maxId + 1}`;

  relsXml = relsXml.replace('</Relationships>',
    `<Relationship Id="${newRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/photo.jpg"/></Relationships>`);
  zip.file('word/media/photo.jpg', photoBuffer);
  zip.file(relsFileName, relsXml);

  const ctFileName = '[Content_Types].xml';
  let ctXml = zip.file(ctFileName) ? zip.file(ctFileName).asText() : '';
  if (!ctXml.includes('jpg') && !ctXml.includes('jpeg')) {
    ctXml = ctXml.replace('</Types>', '  <Default Extension="jpg" ContentType="image/jpeg"/>\n</Types>');
    zip.file(ctFileName, ctXml);
  }

  let result = documentXml;

  // STEP 1: Find <w:r> elements that wrap mc:AlternateContent blocks containing {{picture}}.
  // Template structure: <w:r><w:rPr>...</w:rPr><mc:AlternateContent>...</mc:AlternateContent></w:r>
  // We must match the entire outer <w:r> to avoid leaving a dangling </w:r>.
  result = result.replace(
    /<w:r\b[^>]*>(?:<w:rPr>[\s\S]*?<\/w:rPr>)?<mc:AlternateContent>([\s\S]*?)<\/mc:AlternateContent><\/w:r>/g,
    (fullMatch, mcContent) => {
      const block = `<mc:AlternateContent>${mcContent}</mc:AlternateContent>`;

      if (!block.includes('picture}}') && !block.includes('{{picture')) {
        return fullMatch; // not a picture block — leave untouched
      }

      // Extract mc:Choice (wp:anchor + wps:wsp frame)
      const choiceMatch = block.match(/<mc:Choice[^>]*>([\s\S]*?)<\/mc:Choice>/);
      if (!choiceMatch) return fullMatch;

      let choiceContent = choiceMatch[1];

      // Read frame dimensions from wp:extent
      const extentMatch = choiceContent.match(/<wp:extent[^>]*cx="(\d+)"[^>]*cy="(\d+)"/);
      let boxCx = 1193800, boxCy = 295275;
      if (extentMatch) { boxCx = parseInt(extentMatch[1]); boxCy = parseInt(extentMatch[2]); }

      // Read padding from wps:bodyPr
      const bodyPrMatch = choiceContent.match(/wps:bodyPr[^>]*lIns="(\d+)"[^>]*tIns="(\d+)"[^>]*rIns="(\d+)"[^>]*bIns="(\d+)"/);
      let lIns = 0, tIns = 0, rIns = 0, bIns = 0;
      if (bodyPrMatch) {
        lIns = parseInt(bodyPrMatch[1]); tIns = parseInt(bodyPrMatch[2]);
        rIns = parseInt(bodyPrMatch[3]); bIns = parseInt(bodyPrMatch[4]);
      }

      const drawCx = boxCx - lIns - rIns;
      const drawCy = boxCy - tIns - bIns;
      const photoDrawing = buildPhotoDrawing(newRelId, drawCx, drawCy);

      // Replace wps:txbxContent with photo drawing
      choiceContent = choiceContent.replace(
        /<wps:txbxContent>[\s\S]*?<\/wps:txbxContent>/,
        `<wps:txbxContent><w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="0"/></w:pPr><w:r>${photoDrawing}</w:r></w:p></wps:txbxContent>`
      );

      // Return just the mc:AlternateContent (no outer <w:r> — the original had one but it only
      // served as a container; the anchor drawing stands on its own in the paragraph)
      return `<mc:AlternateContent><mc:Choice Requires="wps">${choiceContent}</mc:Choice></mc:AlternateContent>`;
    }
  );

  // Also handle mc:AlternateContent NOT wrapped in <w:r> (belt-and-suspenders)
  result = result.replace(
    /(?<!<\/w:rPr>)<mc:AlternateContent>([\s\S]*?)<\/mc:AlternateContent>/g,
    (match, mcContent) => {
      if (!match.includes('picture}}') && !match.includes('{{picture')) return match;

      const choiceMatch = match.match(/<mc:Choice[^>]*>([\s\S]*?)<\/mc:Choice>/);
      if (!choiceMatch) return match;
      let choiceContent = choiceMatch[1];

      const extentMatch = choiceContent.match(/<wp:extent[^>]*cx="(\d+)"[^>]*cy="(\d+)"/);
      let boxCx = 1193800, boxCy = 295275;
      if (extentMatch) { boxCx = parseInt(extentMatch[1]); boxCy = parseInt(extentMatch[2]); }

      const bodyPrMatch = choiceContent.match(/wps:bodyPr[^>]*lIns="(\d+)"[^>]*tIns="(\d+)"[^>]*rIns="(\d+)"[^>]*bIns="(\d+)"/);
      let lIns = 0, tIns = 0, rIns = 0, bIns = 0;
      if (bodyPrMatch) { lIns = parseInt(bodyPrMatch[1]); tIns = parseInt(bodyPrMatch[2]); rIns = parseInt(bodyPrMatch[3]); bIns = parseInt(bodyPrMatch[4]); }

      const drawCx = boxCx - lIns - rIns;
      const drawCy = boxCy - tIns - bIns;
      const photoDrawing = buildPhotoDrawing(newRelId, drawCx, drawCy);

      choiceContent = choiceContent.replace(
        /<wps:txbxContent>[\s\S]*?<\/wps:txbxContent>/,
        `<wps:txbxContent><w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="0"/></w:pPr><w:r>${photoDrawing}</w:r></w:p></wps:txbxContent>`
      );

      return `<mc:AlternateContent><mc:Choice Requires="wps">${choiceContent}</mc:Choice></mc:AlternateContent>`;
    }
  );

  // STEP 2: Remove any remaining standalone {{picture}} runs outside mc blocks
  result = result.replace(
    /<w:r\b[^>]*>[\s\S]*?<\/w:r>/g,
    (match) => {
      const tMatch = match.match(/<w:t[^>]*>([^<]*)<\/w:t>/);
      if (tMatch && (tMatch[1].includes('{{') || tMatch[1].includes('picture') || tMatch[1].includes('}}'))) {
        return '';
      }
      return match;
    }
  );

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
      cmd = `"${loPath}" --headless --norestore --nolockcheck --convert-to pdf --outdir "${tmpDir}" "${tmpDocx}"`;
    } else {
      const loPaths = [
        '/usr/bin/libreoffice',
        '/usr/bin/soffice',
        '/usr/bin/libreoffice-writer'
      ];
      let loPath = null;
      for (const p of loPaths) {
        if (fs.existsSync(p)) { loPath = p; break; }
      }
      if (!loPath) {
        try {
          const result = require('child_process').execSync('which libreoffice 2>/dev/null || which soffice 2>/dev/null', { encoding: 'utf8', stdio: 'pipe' }).trim();
          if (result) loPath = result;
        } catch (e) {}
      }
      if (!loPath) return null;
      
      const absDocxPath = path.resolve(tmpDocx);
      const absOutDir = path.resolve(tmpDir);
      const profileDir = `/tmp/lo_profile_${studentId}`;
      
      cmd = `"${loPath}" --headless --norestore --nolockcheck --nologo --convert-to pdf --outdir "${absOutDir}" "${absDocxPath}"`;
    }
    
    console.log(`PDF conversion cmd: ${cmd}`);
    const { execSync } = require('child_process');
    let stdout = '', stderr = '';
    try {
      const result = execSync(cmd, { 
        timeout: 120000, 
        windowsHide: true, 
        stdio: 'pipe', 
        encoding: 'utf8',
        env: {
          ...process.env,
          HOME: `/tmp/lo_profile_${studentId}`,
          TMPDIR: `/tmp/lo_profile_${studentId}`,
          USER: 'libreoffice'
        }
      });
      stdout = result || '';
    } catch(e) {
      stdout = (e.stdout || '').toString();
      stderr = (e.stderr || '').toString();
      if (!stderr && e.message) stderr = e.message;
    }
    console.log(`PDF conversion stdout: ${stdout.substring(0, 500)}`);
    console.log(`PDF conversion stderr: ${stderr.substring(0, 500)}`);
    
    if (fs.existsSync(tmpPdf)) {
      const pdfBuffer = fs.readFileSync(tmpPdf);
      try { fs.unlinkSync(tmpPdf); } catch (e) {}
      return pdfBuffer;
    } else {
      console.error('PDF not found after conversion');
      // Check alternative output locations
      const altPdfPath = path.join(tmpDir, `${path.basename(tmpDocx, '.docx')}.pdf`);
      if (fs.existsSync(altPdfPath)) {
        console.log(`Found PDF at alternative path: ${altPdfPath}`);
        const pdfBuffer = fs.readFileSync(altPdfPath);
        try { fs.unlinkSync(altPdfPath); } catch (e) {}
        return pdfBuffer;
      }
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