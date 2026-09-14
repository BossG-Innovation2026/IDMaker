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
 * Insert the student photo into the DOCX template, replacing the {{picture}} placeholder.
 *
 * Strategy:
 * The {{picture}} placeholder lives inside a <wps:wsp> text box anchored via <wp:anchor>.
 * Rather than trying to insert a <wp:inline> drawing inside the text box (which LibreOffice
 * ignores), we convert the wps:wsp shape itself into a picture frame:
 *   1. Remove txBox="1" from wps:cNvSpPr  → shape is no longer a text box
 *   2. Replace <a:noFill/> with <a:blipFill> pointing to the photo
 *   3. Remove <wps:txbx>...</wps:txbx>  → no text content
 *   4. Replace <wps:bodyPr> with minimal body props
 *   5. Keep the entire <wp:anchor> positioning intact
 *
 * srcRect crops to the face region: center 60% width, top 40% height.
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

  // Match the outer <w:r> that wraps the picture mc:AlternateContent block
  result = result.replace(
    /<w:r\b[^>]*>(?:<w:rPr>[\s\S]*?<\/w:rPr>)?<mc:AlternateContent>([\s\S]*?)<\/mc:AlternateContent><\/w:r>/g,
    (fullMatch, mcContent) => {
      const block = `<mc:AlternateContent>${mcContent}</mc:AlternateContent>`;
      if (!block.includes('picture}}') && !block.includes('{{picture')) {
        return fullMatch;
      }

      // Extract the wp:anchor element (the full positioned frame)
      const anchorMatch = block.match(/<wp:anchor([\s\S]*?)<\/wp:anchor>/);
      if (!anchorMatch) return fullMatch;

      const anchorAttrs = anchorMatch[0].match(/<wp:anchor([^>]*)>/);
      const anchorInner = anchorMatch[1];

      // Extract extent (frame size)
      const extentMatch = anchorInner.match(/<wp:extent[^/]* cx="(\d+)"[^/]* cy="(\d+)"\/>/);
      const cx = extentMatch ? parseInt(extentMatch[1]) : 1193800;
      const cy = extentMatch ? parseInt(extentMatch[2]) : 295275;

      // Build the blipFill with face crop — NO xmlns redeclarations (already on doc root)
      // srcRect: crop 20% from each side horizontally, keep top 40% vertically
      const blipFill = `<a:blipFill><a:blip r:embed="${newRelId}"/><a:srcRect l="20000" t="0" r="20000" b="60000"/><a:stretch><a:fillRect/></a:stretch></a:blipFill>`;

      // Build the new wps:wsp as a picture shape (not a text box)
      // No inline xmlns — all namespaces already declared on <w:document>
      const newWsp = `<wps:wsp><wps:cNvSpPr><a:spLocks noChangeArrowheads="1"/></wps:cNvSpPr><wps:spPr bwMode="auto"><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${blipFill}<a:ln w="9525"><a:noFill/></a:ln></wps:spPr><wps:bodyPr rot="0" vert="horz" wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="t" anchorCtr="0"><a:noAutofit/></wps:bodyPr></wps:wsp>`;

      // Rebuild graphicData/graphic keeping existing namespace attributes from the anchor
      const newGraphicData = `<a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">${newWsp}</a:graphicData>`;
      const newGraphic = `<a:graphic>${newGraphicData}</a:graphic>`;

      // Replace only the graphic element inside the anchor, keep everything else
      const newAnchorInner = anchorInner.replace(
        /<a:graphic[\s\S]*?<\/a:graphic>/,
        newGraphic
      );

      // Also update docPr name and cNvGraphicFramePr
      const finalAnchorInner = newAnchorInner
        .replace(/name="[^"]*"/, 'name="Student Photo"')
        .replace(/<wp:cNvGraphicFramePr>[\s\S]*?<\/wp:cNvGraphicFramePr>/,
          '<wp:cNvGraphicFramePr/>');

      // Return just the drawing (no outer <w:r> wrapper needed for anchor)
      return `<w:r><w:rPr><w:noProof/></w:rPr><w:drawing><wp:anchor${anchorAttrs ? anchorAttrs[1] : ''}>${finalAnchorInner}</wp:anchor></w:drawing></w:r>`;
    }
  );

  // STEP 2: Remove any remaining standalone {{picture}} runs
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